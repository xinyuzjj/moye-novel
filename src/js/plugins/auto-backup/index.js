/* 自动备份插件：监听 save 事件，节流后把全书写入 data/backups/ 滚动备份。
 * 文件操作统一走 ctx.electronAPI.pluginFs（主进程沙箱，限定在 data 目录内）。 */
(function () {
  'use strict';
  const KEEP = 20;          // 保留最近多少份
  const INTERVAL = 5 * 60 * 1000; // 两次自动备份最小间隔 5 分钟

  window.MoyePlugins.register({
    id: 'auto-backup',
    name: '自动备份',
    activate(ctx) {
      this._ctx = ctx;
      this._last = 0;
      this._onSave = () => this.maybeBackup();
      ctx.on('save', this._onSave);

      ctx.ui.addSettingsSection({
        title: '自动备份（全书快照）',
        render: (c) => {
          const tip = document.createElement('p');
          tip.className = 'muted';
          tip.style.cssText = 'font-size:12px;line-height:1.6;margin:0 0 10px';
          tip.textContent = '保存后自动滚动备份到 data/backups/，保留最近 ' + KEEP + ' 份。';
          const row = document.createElement('div');
          row.className = 'tool-row';
          const now = document.createElement('button');
          now.className = 'mini-btn primary';
          now.textContent = '立即备份';
          now.addEventListener('click', () => this.backupNow(true));
          const restore = document.createElement('button');
          restore.className = 'mini-btn';
          restore.textContent = '恢复最近一份';
          restore.addEventListener('click', () => this.restoreLatest());
          row.appendChild(now);
          row.appendChild(restore);
          c.appendChild(tip);
          c.appendChild(row);
        }
      });
    },
    maybeBackup() {
      const now = Date.now();
      if (now - this._last < INTERVAL) return;
      this.backupNow(false);
    },
    async backupNow(manual) {
      const ctx = this._ctx;
      try {
        const db = ctx.getDb();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const rel = 'backups/novels-' + stamp + '.json';
        const r = await ctx.electronAPI.pluginFs({ op: 'write', rel, content: JSON.stringify(db, null, 2) });
        if (!r || !r.ok) { if (manual) ctx.toast('备份失败：' + (r && r.error)); return; }
        this._last = Date.now();
        await this.prune();
        if (manual) ctx.toast('已备份全书');
      } catch (e) {
        console.error('[自动备份]', e);
        if (manual) ctx.toast('备份失败');
      }
    },
    async prune() {
      const ctx = this._ctx;
      try {
        const r = await ctx.electronAPI.pluginFs({ op: 'list', rel: 'backups' });
        if (!r || !r.ok) return;
        const files = r.items.filter((n) => /^novels-.*\.json$/.test(n)).sort();
        while (files.length > KEEP) {
          const old = files.shift();
          await ctx.electronAPI.pluginFs({ op: 'delete', rel: 'backups/' + old });
        }
      } catch (e) { console.error('[自动备份] 清理', e); }
    },
    async restoreLatest() {
      const ctx = this._ctx;
      try {
        const r = await ctx.electronAPI.pluginFs({ op: 'list', rel: 'backups' });
        if (!r || !r.ok) { ctx.toast('读取备份失败'); return; }
        const files = r.items.filter((n) => /^novels-.*\.json$/.test(n)).sort();
        if (!files.length) { ctx.toast('还没有备份'); return; }
        const last = files[files.length - 1];
        const rd = await ctx.electronAPI.pluginFs({ op: 'read', rel: 'backups/' + last });
        if (!rd || !rd.ok) { ctx.toast('读取备份失败'); return; }
        ctx.replaceDb(JSON.parse(rd.content));
        ctx.toast('已恢复：' + last);
      } catch (e) {
        console.error('[自动备份] 恢复', e);
        ctx.toast('恢复失败');
      }
    },
    deactivate() {
      if (this._ctx && this._onSave) this._ctx.off('save', this._onSave);
    }
  });
})();
