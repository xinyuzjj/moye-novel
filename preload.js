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
  openDataFolder: () => ipcRenderer.invoke('open-data-folder')
});
