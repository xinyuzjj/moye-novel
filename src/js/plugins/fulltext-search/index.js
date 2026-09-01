/* 全文搜索插件：在本书全部章节里搜关键词，点结果跳转。
 * 支持「区分大小写」「正则」两个开关。仅用宿主暴露的 ctx API，不碰任何内部变量。 */
(function () {
  'use strict';
  window.MoyePlugins.register({
    id: 'fulltext-search',
    name: '全文搜索',
    activate(ctx) {
      this._ctx = ctx;
      this.caseSensitive = false;
      this.useRegex = false;
      ctx.ui.addToolbarButton({ label: '搜索', title: '跨章节搜索全书', onClick: () => this.open() });
    },
    open() {
      const ctx = this._ctx;
      ctx.ui.openModal({
        title: '全文搜索',
        render: (body) => {
          const input = document.createElement('input');
          input.className = 'fts-input';
          input.placeholder = '输入关键词，即时搜索（全书所有章节）';
          const opts = document.createElement('div');
          opts.className = 'tool-row';
          opts.style.cssText = 'margin-bottom:8px';
          opts.innerHTML =
            '<label class="set-check"><input type="checkbox" id="ftsCase"> 区分大小写</label>' +
            '<label class="set-check"><input type="checkbox" id="ftsRe"> 正则</label>';
          const caseCb = opts.querySelector('#ftsCase');
          const reCb = opts.querySelector('#ftsRe');
          caseCb.checked = this.caseSensitive;
          reCb.checked = this.useRegex;
          caseCb.addEventListener('change', () => { this.caseSensitive = caseCb.checked; run(); });
          reCb.addEventListener('change', () => { this.useRegex = reCb.checked; run(); });

          const count = document.createElement('div');
          count.className = 'fts-count';
          const list = document.createElement('div');
          body.appendChild(input);
          body.appendChild(opts);
          body.appendChild(count);
          body.appendChild(list);

          let timer = null;
          const run = () => {
            const q = input.value.trim();
            if (!q) { count.textContent = ''; list.innerHTML = ''; return; }
            const book = ctx.getActiveBook();
            if (!book) { count.textContent = '未打开作品'; return; }

            let re = null;
            if (this.useRegex) {
              try { re = new RegExp(q, this.caseSensitive ? 'g' : 'gi'); }
              catch (e) { count.textContent = '正则无效：' + e.message; list.innerHTML = ''; return; }
            }
            const ql = this.caseSensitive ? q : q.toLowerCase();

            const hits = [];
            book.volumes.forEach((v) => {
              if (hits.length >= 200) return;
              v.chapters.forEach((c) => {
                if (hits.length >= 200) return;
                const text = ctx.htmlToText(c.html || '');
                if (!text) return;
                if (re) {
                  re.lastIndex = 0; let m;
                  while ((m = re.exec(text)) !== null) {
                    if (m.index === re.lastIndex) re.lastIndex++;
                    if (hits.length >= 200) break;
                    const start = Math.max(0, m.index - 14);
                    const end = Math.min(text.length, m.index + m[0].length + 14);
                    let sn = text.slice(start, end);
                    if (start > 0) sn = '…' + sn;
                    if (end < text.length) sn = sn + '…';
                    hits.push({ chId: c.id, chTitle: c.title || '未命名', vol: v.name, text: sn, hit: m[0] });
                  }
                } else {
                  const tl = this.caseSensitive ? text : text.toLowerCase();
                  let idx = tl.indexOf(ql);
                  while (idx !== -1 && hits.length < 200) {
                    const start = Math.max(0, idx - 14);
                    const end = Math.min(text.length, idx + ql.length + 14);
                    let sn = text.slice(start, end);
                    if (start > 0) sn = '…' + sn;
                    if (end < text.length) sn = sn + '…';
                    hits.push({ chId: c.id, chTitle: c.title || '未命名', vol: v.name, text: sn, hit: ql });
                    idx = tl.indexOf(ql, idx + ql.length);
                  }
                }
              });
            });

            count.textContent = '命中 ' + hits.length + ' 处' + (hits.length >= 200 ? '（仅显示前 200）' : '');
            list.innerHTML = '';
            if (!hits.length) { list.innerHTML = '<div class="empty-tip">没有匹配结果</div>'; return; }
            const escHit = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            hits.forEach((h) => {
              const item = document.createElement('div');
              item.className = 'fts-item';
              const needle = h.hit || q;
              const hl = h.text.replace(new RegExp(escHit(needle), this.caseSensitive ? 'g' : 'gi'), (m) => '<mark>' + m + '</mark>');
              item.innerHTML = '<div class="fts-ch">' + ctx.escapeHtml(h.vol ? h.vol + ' / ' : '') + ctx.escapeHtml(h.chTitle) + '</div>' +
                '<div class="fts-sn">' + hl + '</div>';
              item.addEventListener('click', () => {
                ctx.selectChapter(h.chId);
                ctx.toast('已跳转到：' + h.chTitle);
                const mask = item.closest('.drawer-mask');
                if (mask) mask.click();
              });
              list.appendChild(item);
            });
          };
          input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 200); });
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); run(); } });
          setTimeout(() => { try { input.focus(); } catch (e) {} }, 30);
        }
      });
    },
    deactivate() {}
  });
})();
