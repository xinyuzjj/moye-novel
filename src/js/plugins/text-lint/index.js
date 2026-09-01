/* 文本体检插件：扫描全书或当前章节，检查常见排版/错别字类问题：
 *  - 连续重复标点（3 个及以上相同标点）
 *  - 中文之间多余空格
 *  - 中文之间误用半角标点（应全角）
 *  - 全角标点后多余空格
 *  - 行尾多余空格
 * 结果可点击跳转到对应章节。仅用宿主暴露的 ctx API。 */
(function () {
  'use strict';

  window.MoyePlugins.register({
    id: 'text-lint',
    name: '文本体检',
    activate(ctx) {
      this._ctx = ctx;
      this.scope = 'book';
      ctx.ui.addToolbarButton({ label: '文本体检', title: '错别字与排版体检', onClick: () => this.open() });
    },

    open() {
      const ctx = this._ctx;
      ctx.ui.openModal({
        title: '文本体检',
        render: (body) => { this.render(body); }
      });
    },

    collectChapters() {
      const ctx = this._ctx;
      if (this.scope === 'chapter') {
        const ch = ctx.getActiveChapter();
        return ch ? [ch] : [];
      }
      return ctx.getAllChapters();
    },

    lint(text) {
      const issues = [];
      const lines = text.split('\n');
      lines.forEach((line, li) => {
        // A. 连续重复标点
        let m = line.match(/([，。！？、；：])\1{2,}/);
        if (m) issues.push({ ln: li + 1, msg: '连续重复的标点符号「' + m[1] + '」', snip: line });
        // A2. 省略号过长
        if (/…{4,}/.test(line)) issues.push({ ln: li + 1, msg: '省略号过长（建议一个「…」或「......」）', snip: line });
        // B. 中文之间多余空格
        if (/[一-鿿]\s+[一-鿿]/.test(line)) issues.push({ ln: li + 1, msg: '中文之间有多余空格', snip: line });
        // C. 中文之间半角标点
        if (/[一-鿿][,.!?;:][一-鿿]/.test(line)) issues.push({ ln: li + 1, msg: '中文之间误用半角标点，建议改全角', snip: line });
        // D. 全角标点后空格
        if (/[，。！？、；：]\s/.test(line)) issues.push({ ln: li + 1, msg: '全角标点后有空格', snip: line });
        // E. 行尾空格
        if (/\s+$/.test(line)) issues.push({ ln: li + 1, msg: '行尾有多余空格', snip: line });
      });
      return issues;
    },

    render(body) {
      const ctx = this._ctx;
      body.innerHTML = '';

      const head = document.createElement('div');
      head.className = 'tool-row';
      head.style.cssText = 'margin-bottom:8px;gap:10px;flex-wrap:wrap';

      const scopeSel = document.createElement('select');
      scopeSel.className = 'mini-btn';
      scopeSel.innerHTML = '<option value="book">全书</option><option value="chapter">本章</option>';
      scopeSel.value = this.scope;
      scopeSel.addEventListener('change', () => { this.scope = scopeSel.value; this.render(body); });

      const recheck = document.createElement('button');
      recheck.className = 'mini-btn primary';
      recheck.textContent = '重新体检';
      recheck.addEventListener('click', () => this.render(body));
      head.appendChild(scopeSel);
      head.appendChild(recheck);
      body.appendChild(head);

      const chapters = this.collectChapters();
      if (!chapters.length) {
        const tip = document.createElement('div');
        tip.className = 'empty-tip';
        tip.textContent = this.scope === 'chapter' ? '当前没有选中章节' : '还没有章节';
        body.appendChild(tip);
        return;
      }

      const all = [];
      chapters.forEach((ch) => {
        const text = ctx.htmlToText(ch.html || '');
        if (!text) return;
        const issues = this.lint(text);
        issues.forEach((it) => { all.push({ chId: ch.id, chTitle: ch.title || '未命名', ln: it.ln, msg: it.msg, snip: it.snip }); });
      });

      const stat = document.createElement('div');
      stat.className = 'muted';
      stat.style.cssText = 'font-size:12px;margin-bottom:8px';
      stat.textContent = '范围：' + (this.scope === 'chapter' ? '本章' : '全书 ' + chapters.length + ' 章') + ' · 发现 ' + all.length + ' 处疑似问题';
      body.appendChild(stat);

      if (!all.length) {
        const okEl = document.createElement('div');
        okEl.className = 'empty-tip';
        okEl.textContent = '未发现上述常见排版问题，很干净 ✨';
        body.appendChild(okEl);
        return;
      }

      const cap = 300;
      const shown = all.slice(0, cap);
      const list = document.createElement('div');
      list.style.cssText = 'max-height:320px;overflow:auto';
      shown.forEach((it) => {
        const row = document.createElement('div');
        row.className = 'tool-row';
        row.style.cssText = 'justify-content:space-between;align-items:flex-start;gap:10px;padding:6px 0;border-bottom:1px solid var(--line);cursor:pointer';
        const left = document.createElement('div');
        left.style.cssText = 'min-width:0;flex:1';
        const snip = it.snip.length > 60 ? it.snip.slice(0, 60) + '…' : it.snip;
        left.innerHTML = '<div style="font-size:12px;color:#b34"><b>' + ctx.escapeHtml(it.msg) + '</b></div>' +
          '<div class="muted" style="font-size:12px">' + ctx.escapeHtml(it.chTitle) + ' · 第 ' + it.ln + ' 行</div>' +
          '<div style="font-size:12px;white-space:pre-wrap;word-break:break-all">' + ctx.escapeHtml(snip) + '</div>';
        const btn = document.createElement('button');
        btn.className = 'mini-btn';
        btn.textContent = '跳转';
        row.appendChild(left);
        row.appendChild(btn);
        row.addEventListener('click', () => {
          ctx.selectChapter(it.chId);
          ctx.toast('已跳转到：' + it.chTitle + '（第 ' + it.ln + ' 行附近）');
        });
        list.appendChild(row);
      });
      body.appendChild(list);
      if (all.length > cap) {
        const more = document.createElement('div');
        more.className = 'muted';
        more.style.cssText = 'font-size:12px;margin-top:6px';
        more.textContent = '仅显示前 ' + cap + ' 条，共 ' + all.length + ' 条';
        body.appendChild(more);
      }
    },

    deactivate() {}
  });
})();
