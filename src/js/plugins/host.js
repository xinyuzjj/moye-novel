/* ===== 墨页 · 插件宿主（渲染进程） =====
 * 职责：
 *   1) 在启动完成后，通过 electronAPI.getPlugins() 拿到插件清单（入口脚本文本）；
 *   2) 把每个插件入口注入页面执行（插件用 window.MoyePlugins.register(...) 注册自己）；
 *   3) 向插件提供一套稳定的 API（ctx）：数据读取、持久化、导航、UI 扩展点、事件总线、设置；
 *   4) 管理插件的启用 / 停用（停用即移除该插件在 DOM 上的所有痕迹并调用其 deactivate）。
 *
 * 设计原则：
 *   - 核心永远保持「空壳」，功能都靠插件长出来；想要哪个功能，把对应插件放进去即可。
 *   - 插件只能拿到 ctx 暴露的能力，不直接碰内部变量，升级核心不破插件。
 *   - 插件运行在渲染进程，文件读写统一走主进程的 plugin-fs（沙箱限定在 data 目录内）。
 */
(function () {
  'use strict';

  const PLUGINS = new Map();   // id -> { manifest, mod, enabled, location }
  let CTX = null;
  let booted = false;

  function escAttr(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function tag(el, id) { if (el && el.setAttribute) el.setAttribute('data-plugin', id || ''); return el; }

  /* ───────── UI 扩展点（插件通过 ctx.ui.* 调用） ───────── */
  const ui = {
    addToolbarButton(opt) {
      const box = document.getElementById('pluginTools');
      if (!box) return null;
      const b = document.createElement('button');
      b.className = 'mini-btn' + (opt.primary ? ' primary' : '');
      b.textContent = opt.label || opt.title || '按钮';
      if (opt.title) b.title = opt.title;
      b.addEventListener('click', () => { try { opt.onClick && opt.onClick(); } catch (e) { console.error('[插件]', e); } });
      tag(box.appendChild(b), CTX && CTX._activeId);
      return b;
    },
    addSettingsSection(opt) {
      const wrap = document.getElementById('pluginSettings');
      if (!wrap) return null;
      const g = document.createElement('div');
      g.className = 'set-group';
      tag(g, CTX && CTX._activeId);
      if (opt.title) {
        const lab = document.createElement('label');
        lab.className = 'set-label';
        lab.textContent = opt.title;
        g.appendChild(lab);
      }
      const c = document.createElement('div');
      g.appendChild(c);
      wrap.appendChild(g);
      try { opt.render && opt.render(c); } catch (e) { console.error('[插件]', e); }
      return g;
    },
    openModal(opt) {
      const id = (CTX && CTX._activeId) || 'plugin';
      const mask = tag(document.createElement('div'), id);
      mask.className = 'drawer-mask';
      const d = tag(document.createElement('div'), id);
      d.className = 'drawer';
      d.style.zIndex = '95';
      d.innerHTML = '<div class="drawer-head"><h3>' + escAttr(opt.title || '插件') + '</h3>' +
        '<button class="icon-btn tiny" data-close>✕</button></div>' +
        '<div class="drawer-body" data-body></div>';
      document.body.appendChild(mask);
      document.body.appendChild(d);
      mask.classList.add('show');
      d.classList.add('show');
      const body = d.querySelector('[data-body]');
      const close = () => {
        d.classList.remove('show'); mask.classList.remove('show');
        setTimeout(() => { try { d.remove(); mask.remove(); } catch (e) {} }, 60);
        try { opt.onClose && opt.onClose(); } catch (e) {}
      };
      d.querySelector('[data-close]').addEventListener('click', close);
      mask.addEventListener('click', close);
      try { opt.render && opt.render(body, close); } catch (e) { console.error('[插件]', e); }
      return { close, el: d, body };
    }
  };

  /* ───────── 插件管理抽屉 ───────── */
  function buildDrawer() {
    const list = document.getElementById('pluginsList');
    if (!list) return;
    const items = listPlugins();
    list.innerHTML = '';
    if (!items.length) {
      list.innerHTML = '<div class="empty-tip" id="pluginsEmpty">还没有插件<br>把插件文件夹放到安装目录下的 <b>plugins\\</b> 即可即插即用</div>' +
        '<button class="mini-btn" id="btnPluginDiagnose" style="margin-top:12px;width:100%">诊断插件加载</button>' +
        '<pre id="pluginDiagnoseOut" style="display:none;margin-top:10px;padding:10px;background:#f5f5f5;border-radius:6px;font-size:11px;white-space:pre-wrap;word-break:break-all;max-height:260px;overflow:auto"></pre>';
      const diagBtn = document.getElementById('btnPluginDiagnose');
      if (diagBtn && CTX && CTX.electronAPI && CTX.electronAPI.pluginDiagnose) {
        diagBtn.addEventListener('click', async () => {
          const out = document.getElementById('pluginDiagnoseOut');
          try {
            const info = await CTX.electronAPI.pluginDiagnose();
            out.textContent = JSON.stringify(info, null, 2);
          } catch (e) {
            out.textContent = '诊断失败：' + (e && e.message);
          }
          out.style.display = 'block';
        });
      }
      return;
    }
    items.forEach((it) => {
      const row = document.createElement('div');
      row.className = 'plugin-row';
      row.setAttribute('data-plugin', it.id);
      const main = document.createElement('div');
      main.className = 'pr-main';
      main.innerHTML = '<div class="pr-name">' + escAttr(it.name || it.id) +
        (it.builtin ? '' : ' <span class="pr-tag">用户</span>') + '</div>' +
        '<div class="pr-desc">' + escAttr(it.desc || '') + '</div>';
      const toggle = document.createElement('label');
      toggle.className = 'pr-toggle';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!it.enabled;
      cb.addEventListener('change', () => host.setEnabled(it.id, cb.checked));
      toggle.appendChild(cb);
      row.appendChild(main);
      row.appendChild(toggle);
      list.appendChild(row);
    });
  }

  function listPlugins() {
    return Array.from(PLUGINS.values()).map((p) => ({
      id: p.manifest ? p.manifest.id : (p.mod && p.mod.id),
      name: (p.mod && p.mod.name) || (p.manifest && p.manifest.name),
      desc: p.manifest && p.manifest.description,
      enabled: p.enabled,
      builtin: p.manifest && p.manifest.builtin
    }));
  }

  /* ───────── 激活 / 停用 ───────── */
  function activate(id) {
    const p = PLUGINS.get(id);
    if (!p || !p.mod) return;
    CTX._activeId = id;
    try { p.mod.activate && p.mod.activate(CTX); }
    catch (e) { console.error('[插件] 激活失败 ' + id, e); }
    CTX._activeId = null;
  }
  function deactivate(id) {
    const p = PLUGINS.get(id);
    if (!p || !p.mod) return;
    try { p.mod.deactivate && p.mod.deactivate(); } catch (e) { console.error('[插件] 卸载失败 ' + id, e); }
    try {
      Array.prototype.slice.call(document.querySelectorAll('[data-plugin="' + id + '"]')).forEach((el) => el.remove());
    } catch (e) {}
  }

  function loadScript(text, id) {
    return new Promise((resolve) => {
      try {
        const s = document.createElement('script');
        s.type = 'text/javascript';
        s.dataset.plugin = id;
        s.textContent = text;
        document.head.appendChild(s);
      } catch (e) { console.error('[插件] 入口执行失败 ' + id, e); }
      setTimeout(resolve, 0);
    });
  }

  /* ───────── 对外 API ───────── */
  const host = {
    _ui: ui,
    _buildDrawer: buildDrawer,
    register(plugin) {
      if (!plugin || !plugin.id) { console.warn('[插件] register 缺少 id', plugin); return; }
      const prev = PLUGINS.get(plugin.id);
      PLUGINS.set(plugin.id, {
        manifest: prev ? prev.manifest : null,
        mod: plugin,
        enabled: prev ? prev.enabled : true,
        location: prev ? prev.location : null
      });
      if (booted && CTX) activate(plugin.id);
    },
    async start(ctx) {
      CTX = ctx;
      const list = (ctx.electronAPI && ctx.electronAPI.getPlugins)
        ? (await ctx.electronAPI.getPlugins().catch(() => [])) : [];
      const jobs = [];
      (list || []).forEach((item) => {
        const id = item.manifest && item.manifest.id;
        if (!id) return;
        const enabled = ctx.getSetting('plugin.' + id + '.enabled', true);
        PLUGINS.set(id, { manifest: item.manifest, mod: null, enabled: !!enabled, location: item.location });
        if (enabled && item.entryText) jobs.push(loadScript(item.entryText, id));
      });
      await Promise.all(jobs);
      booted = true;
      PLUGINS.forEach((p, id) => { if (p.enabled && p.mod) activate(id); });
      // 即使 emit 出错也不影响插件抽屉渲染
      try { if (CTX && CTX.emit) CTX.emit('boot', {}); } catch (e) { console.error('[插件] emit boot 失败', e); }
      buildDrawer();
    },
    setEnabled(id, on) {
      const p = PLUGINS.get(id);
      if (!p) return;
      p.enabled = !!on;
      if (CTX && CTX.setSetting) CTX.setSetting('plugin.' + id + '.enabled', !!on);
      if (!booted) return;
      if (on) activate(id); else deactivate(id);
      buildDrawer();
    },
    list: listPlugins
  };

  window.MoyePlugins = host;
})();
