/* 全文搜索插件：在本书全部章节里搜关键词，点结果跳转。
 * 仅用宿主暴露的 ctx API，不碰任何内部变量。 */
(function () {
  'use strict';
  window.MoyePlugins.register({
    id: 'fulltext-search',
    name: '全文搜索',
    activate(ctx) {
      this._ctx = ctx;
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
          const count = document.createElement('div');
          count.className = 'fts-count';
          const list = document.createElement('div');
          body.appendChild(input);
          body.appendChild(count);
          body.appendChild(list);

          let timer = null;
          const run = () => {
            const q = input.value.trim();
            if (!q) { count.textContent = ''; list.innerHTML = ''; return; }
            const book = ctx.getActiveBook();
            if (!book) { count.textContent = '未打开作品'; return; }
            const lower = q.toLowerCase();
            const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const hits = [];
            book.volumes.forEach((v) => v.chapters.forEach((c) => {
              const text = ctx.htmlToText(c.html || '');
              const tl = text.toLowerCase();
              let idx = tl.indexOf(lower);
              while (idx !== -1 && hits.length < 200) {
                const start = Math.max(0, idx - 14);
                const end = Math.min(text.length, idx + q.length + 14);
                let sn = text.slice(start, end);
                if (start > 0) sn = '…' + sn;
                if (end < text.length) sn = sn + '…';
                hits.push({ chId: c.id, chTitle: c.title || '未命名', vol: v.name, text: sn });
                idx = tl.indexOf(lower, idx + q.length);
              }
            }));
            count.textContent = '命中 ' + hits.length + ' 处' + (hits.length >= 200 ? '（仅显示前 200）' : '');
            list.innerHTML = '';
            if (!hits.length) { list.innerHTML = '<div class="empty-tip">没有匹配结果</div>'; return; }
            hits.forEach((h) => {
              const item = document.createElement('div');
              item.className = 'fts-item';
              const hl = h.text.replace(new RegExp(esc, 'gi'), (m) => '<mark>' + m + '</mark>');
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
