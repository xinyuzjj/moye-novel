/* 自动备份插件：监听 save 事件，节流后把全书写入 data/backups/ 滚动备份。
 * 文件操作统一走 ctx.electronAPI.pluginFs（主进程沙箱，限定在 data 目录内）。
 * 设置区：可调保留份数（默认 20）与最小间隔（默认 5 分钟），列出全部备份可逐份恢复。 */
(function () {
  'use strict';
  const DEF_KEEP = 20;
  const DEF_INTERVAL = 5 * 60 * 1000;

  window.MoyePlugins.register({
    id: 'auto-backup',
    name: '自动备份',
    activate(ctx) {
      this._ctx = ctx;
      this._last = 0;
      this._onSave = () => this.maybeBackup();
      ctx.on('save', this._onSave);

      const keep = ctx.getSetting('autoBackupKeep', DEF_KEEP);
      const interval = ctx.getSetting('autoBackupInterval', DEF_INTERVAL);

      ctx.ui.addSettingsSection({
        title: '自动备份（全书快照）',
        render: (c) => {
          const tip = document.createElement('p');
          tip.className = 'muted';
          tip.style.cssText = 'font-size:12px;line-height:1.6;margin:0 0 8px';
          tip.textContent = '保存后自动滚动备份到 data/backups/。';
          c.appendChild(tip);

          const optRow = document.createElement('div');
          optRow.className = 'tool-row';
          optRow.style.marginBottom = '8px';
          optRow.innerHTML =
            '<label class="set-check">保留 <input type="number" id="abKeep" min="1" max="200" value="' + keep + '" style="width:56px"> 份</label>' +
            '<label class="set-check">最小间隔 <input type="number" id="abInt" min="1" max="120" value="' + Math.round(interval / 60000) + '" style="width:48px"> 分</label>';
          c.appendChild(optRow);
          const keepInput = optRow.querySelector('#abKeep');
          const intInput = optRow.querySelector('#abInt');
          keepInput.addEventListener('change', () => ctx.setSetting('autoBackupKeep', Math.max(1, parseInt(keepInput.value) || DEF_KEEP)));
          intInput.addEventListener('change', () => ctx.setSetting('autoBackupInterval', Math.max(1, parseInt(intInput.value) || 5) * 60000));

          const row = document.createElement('div');
          row.className = 'tool-row';
          row.style.marginBottom = '10px';
          const backupNow = document.createElement('button');
          backupNow.className = 'mini-btn primary';
          backupNow.textContent = '立即备份';
          backupNow.addEventListener('click', () => this.backupNow(true));
          const restore = document.createElement('button');
          restore.className = 'mini-btn';
          restore.textContent = '恢复最近一份';
          restore.addEventListener('click', () => this.restoreLatest());
          row.appendChild(backupNow);
          row.appendChild(restore);
          c.appendChild(row);

          const listTitle = document.createElement('div');
          listTitle.className = 'muted';
          listTitle.style.cssText = 'font-size:12px;margin-bottom:4px';
          listTitle.textContent = '可恢复备份（点击恢复该份）';
          c.appendChild(listTitle);

          const list = document.createElement('div');
          list.id = 'abList';
          list.style.cssText = 'max-height:180px;overflow:auto';
          c.appendChild(list);
          this._listEl = list;
          this.renderList();
        }
      });
    },

    async renderList() {
      const ctx = this._ctx, list = this._listEl;
      if (!list) return;
      list.innerHTML = '<div class="muted" style="font-size:12px">读取中…</div>';
      try {
        const r = await ctx.electronAPI.pluginFs({ op: 'list', rel: 'backups' });
        if (!r || !r.ok) { list.innerHTML = '<div class="muted" style="font-size:12px">读取失败</div>'; return; }
        const files = r.items.filter((n) => /^novels-.*\.json$/.test(n)).sort().reverse();
        if (!files.length) { list.innerHTML = '<div class="muted" style="font-size:12px">还没有备份</div>'; return; }
        list.innerHTML = '';
        files.slice(0, 50).forEach((f) => {
          const item = document.createElement('div');
          item.className = 'tool-row';
          item.style.cssText = 'justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)';
          const label = document.createElement('span');
          label.style.cssText = 'font-size:12px';
          label.textContent = f.replace(/^novels-/, '').replace(/\.json$/, '').replace(/-/g, ':');
          const btn = document.createElement('button');
          btn.className = 'mini-btn';
          btn.textContent = '恢复';
          btn.addEventListener('click', () => this.restoreFile(f));
          item.appendChild(label);
          item.appendChild(btn);
          list.appendChild(item);
        });
      } catch (e) {
        list.innerHTML = '<div class="muted" style="font-size:12px">读取失败</div>';
      }
    },

    getKeep() { return Math.max(1, this._ctx.getSetting('autoBackupKeep', DEF_KEEP)); },
    getInterval() { return Math.max(1, this._ctx.getSetting('autoBackupInterval', DEF_INTERVAL)); },

    maybeBackup() {
      const now = Date.now();
      if (now - this._last < this.getInterval()) return;
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
        if (manual) { ctx.toast('已备份全书'); this.renderList(); }
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
        const keep = this.getKeep();
        while (files.length > keep) {
          const old = files.shift();
          await ctx.electronAPI.pluginFs({ op: 'delete', rel: 'backups/' + old });
        }
      } catch (e) { console.error('[自动备份] 清理', e); }
    },

    async restoreFile(f) {
      const ctx = this._ctx;
      try {
        const rd = await ctx.electronAPI.pluginFs({ op: 'read', rel: 'backups/' + f });
        if (!rd || !rd.ok) { ctx.toast('读取失败'); return; }
        ctx.replaceDb(JSON.parse(rd.content));
        ctx.toast('已恢复：' + f);
        this.renderList();
      } catch (e) {
        console.error('[自动备份] 恢复', e);
        ctx.toast('恢复失败');
      }
    },

    async restoreLatest() {
      const ctx = this._ctx;
      try {
        const r = await ctx.electronAPI.pluginFs({ op: 'list', rel: 'backups' });
        if (!r || !r.ok) { ctx.toast('读取备份失败'); return; }
        const files = r.items.filter((n) => /^novels-.*\.json$/.test(n)).sort();
        if (!files.length) { ctx.toast('还没有备份'); return; }
        await this.restoreFile(files[files.length - 1]);
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
