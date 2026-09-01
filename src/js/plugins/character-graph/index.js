/* 人物关系图插件：从「人物」卡片提取角色名，扫描全书各章正文，
 * 统计同一章内的共现关系，生成可点击跳转的关系图谱。
 * 仅用宿主暴露的 ctx API，不碰任何内部变量。 */
(function () {
  'use strict';

  function escXml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  window.MoyePlugins.register({
    id: 'character-graph',
    name: '人物关系图',
    activate(ctx) {
      this._ctx = ctx;
      ctx.ui.addToolbarButton({ label: '人物图', title: '人物关系图谱', onClick: () => this.open() });
    },

    open() {
      const ctx = this._ctx;
      ctx.ui.openModal({
        title: '人物关系图',
        render: (body, close) => {
          this._close = close;
          this.render(body);
        }
      });
    },

    compute() {
      const ctx = this._ctx;
      const book = ctx.getActiveBook();
      if (!book) return { tip: '未打开作品', nodes: [], edges: [] };
      const cards = (book.cards && book.cards.character) || [];
      const names = [];
      const seen = new Set();
      cards.forEach((c) => { const n = (c.name || '').trim(); if (n && !seen.has(n)) { seen.add(n); names.push(n); } });
      if (!names.length) return { tip: '先在右侧资料栏的「人物」卡片里添加角色，再来看关系图。', nodes: [], edges: [] };

      const nodes = names.map((n) => ({ name: n, mentions: 0, chSet: new Set(), firstChId: null }));
      const edgeMap = {};
      book.volumes.forEach((v) => v.chapters.forEach((ch) => {
        const text = ctx.htmlToText(ch.html || '');
        if (!text) return;
        const present = [];
        nodes.forEach((nd, i) => {
          const needle = nd.name;
          let count = 0, k = 0;
          while ((k = text.indexOf(needle, k)) !== -1) { count++; k += needle.length; }
          if (count > 0) {
            nd.mentions += count;
            nd.chSet.add(ch.id);
            if (!nd.firstChId) nd.firstChId = ch.id;
            present.push(i);
          }
        });
        for (let a = 0; a < present.length; a++) {
          for (let b = a + 1; b < present.length; b++) {
            const key = present[a] + '|' + present[b];
            edgeMap[key] = (edgeMap[key] || 0) + 1;
          }
        }
      }));

      const edges = Object.keys(edgeMap).map((key) => {
        const p = key.split('|').map(Number);
        return { a: p[0], b: p[1], w: edgeMap[key] };
      });
      return { tip: null, nodes, edges };
    },

    jump(firstChId, name) {
      const ctx = this._ctx;
      if (firstChId) {
        ctx.selectChapter(firstChId);
        ctx.toast('已跳转到：「' + name + '」首次出场');
      } else {
        ctx.toast('「' + name + '」在正文中还没有出现');
      }
      if (this._close) this._close();
    },

    render(body) {
      const ctx = this._ctx;
      body.innerHTML = '';
      const data = this.compute();

      const head = document.createElement('div');
      head.className = 'tool-row';
      head.style.cssText = 'margin-bottom:8px;justify-content:space-between';
      const recheck = document.createElement('button');
      recheck.className = 'mini-btn';
      recheck.textContent = '重新计算';
      recheck.addEventListener('click', () => this.render(body));
      const hint = document.createElement('span');
      hint.className = 'muted';
      hint.style.cssText = 'font-size:12px';
      hint.textContent = '关系线=同章共现次数（基于「人物」卡片，近似统计）';
      head.appendChild(recheck);
      head.appendChild(hint);
      body.appendChild(head);

      if (data.tip) {
        const tip = document.createElement('div');
        tip.className = 'empty-tip';
        tip.textContent = data.tip;
        body.appendChild(tip);
        return;
      }

      const used = data.nodes.filter((n) => n.mentions > 0).length;
      const stat = document.createElement('div');
      stat.className = 'muted';
      stat.style.cssText = 'font-size:12px;margin-bottom:8px';
      stat.textContent = '共 ' + data.nodes.length + ' 个角色 · 正文出现 ' + used + ' 个 · 关系线 ' + data.edges.length + ' 条';
      body.appendChild(stat);

      // 布局：环形排布
      const W = 620, H = 420, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 70;
      data.nodes.forEach((n, i) => {
        const a = (i / Math.max(1, data.nodes.length)) * Math.PI * 2 - Math.PI / 2;
        n.x = Math.round(cx + Math.cos(a) * R);
        n.y = Math.round(cy + Math.sin(a) * R);
        n.r = 14 + Math.min(22, Math.sqrt(n.mentions) * 3.5);
      });
      const maxW = data.edges.reduce((m, e) => Math.max(m, e.w), 0) || 1;

      let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-height:420px;background:var(--panel,#fff);border:1px solid var(--line);border-radius:8px">';
      data.edges.forEach((e) => {
        const A = data.nodes[e.a], B = data.nodes[e.b];
        const op = (0.18 + 0.6 * (e.w / maxW)).toFixed(2);
        const sw = (1 + 3 * (e.w / maxW)).toFixed(1);
        svg += '<line x1="' + A.x + '" y1="' + A.y + '" x2="' + B.x + '" y2="' + B.y + '" stroke="#c9a0dc" stroke-opacity="' + op + '" stroke-width="' + sw + '" />';
      });
      data.nodes.forEach((n, i) => {
        const dim = n.mentions === 0;
        const fill = dim ? '#e6e6e6' : '#f3c6a8';
        const stroke = dim ? '#cfcfcf' : '#d98a5a';
        const label = n.name.length > 8 ? n.name.slice(0, 8) + '…' : n.name;
        svg += '<g class="cg-node" data-ch="' + i + '" style="cursor:pointer">';
        svg += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + n.r + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5" />';
        if (n.mentions > 0) svg += '<text x="' + n.x + '" y="' + (n.y + 4) + '" text-anchor="middle" font-size="12" fill="#5a3a22">' + n.mentions + '</text>';
        svg += '<text x="' + n.x + '" y="' + (n.y + n.r + 14) + '" text-anchor="middle" font-size="13" fill="#333">' + escXml(label) + '</text>';
        svg += '</g>';
      });
      svg += '</svg>';

      const svgWrap = document.createElement('div');
      svgWrap.innerHTML = svg;
      body.appendChild(svgWrap);

      const list = document.createElement('div');
      list.style.cssText = 'margin-top:10px';
      data.nodes.slice().sort((a, b) => b.mentions - a.mentions).forEach((n) => {
        const i = data.nodes.indexOf(n);
        const row = document.createElement('div');
        row.className = 'tool-row';
        row.style.cssText = 'justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);cursor:pointer';
        row.innerHTML = '<span><b>' + ctx.escapeHtml(n.name) + '</b> <span class="muted" style="font-size:12px">出现 ' + n.mentions + ' 次 · ' + n.chSet.size + ' 章</span></span>' +
          '<button class="mini-btn">跳转</button>';
        row.addEventListener('click', () => this.jump(n.firstChId, n.name));
        list.appendChild(row);
      });
      body.appendChild(list);

      // SVG 节点点击
      Array.prototype.slice.call(body.querySelectorAll('.cg-node')).forEach((g) => {
        g.addEventListener('click', () => {
          const nd = data.nodes[+g.getAttribute('data-ch')];
          this.jump(nd.firstChId, nd.name);
        });
      });
    },

    deactivate() {}
  });
})();
