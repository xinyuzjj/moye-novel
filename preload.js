/* ===== 墨页 · Electron 预加载脚本 =====
 * 通过 contextBridge 把受限的 IPC 能力安全地暴露给渲染进程（window.electronAPI）。
 * 渲染层只调用这些方法，不直接碰 node，安全且简单。
 */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  getDataPath: () => ipcRenderer.invoke('get-data-path'),
  loadNovels: () => ipcRenderer.invoke('load-novels'),
  saveNovels: (db) => ipcRenderer.invoke('save-novels', db),
  exportFile: (opts) => ipcRenderer.invoke('export-file', opts),
  importFile: (opts) => ipcRenderer.invoke('import-file', opts),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  openPluginsFolder: () => ipcRenderer.invoke('open-plugins-folder'),
  getPlugins: () => ipcRenderer.invoke('get-plugins'),
  pluginDiagnose: () => ipcRenderer.invoke('plugin-diagnose'),
  pluginFs: (arg) => ipcRenderer.invoke('plugin-fs', arg),
  kbSelectFolder: () => ipcRenderer.invoke('kb-select-folder'),
  kbList: (dir) => ipcRenderer.invoke('kb-list', dir),
  kbRead: (arg) => ipcRenderer.invoke('kb-read', arg),
  windowControl: (action) => ipcRenderer.invoke('window-control', action),
  onWindowState: (cb) => ipcRenderer.on('window-state', (_e, state) => cb(state))
});
