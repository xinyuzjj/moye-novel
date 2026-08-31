/* ===== 墨页 · Electron 主进程 ===== */
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fsstore = require('./lib/fsstore');

let mainWin = null;
let dataDir = null;
let userPluginsDir = null;

/* 数据目录解析：
 *  1) exe 同级 data/ —— 便携版/解压即用，数据随程序带走
 *  2) AppData/Roaming/墨页/data —— 安装到 Program Files 没写权限时自动兜底，永远可写
 */
function resolveDataDir() {
  const exeDir = path.dirname(app.getPath('exe'));
  const candidates = [
    path.join(exeDir, 'data'),
    path.join(app.getPath('userData'), 'data')
  ];
  for (const d of candidates) {
    if (fsstore.ensureWritable(d)) return d;
  }
  return candidates[1];
}

/* 用户插件目录：默认放在 userData/plugins（AppData 内，永远可写，即插即用最稳）。
 * 同时扫描 exe 同级 plugins/（便携版解压即用）。两者都算「用户插件」。 */
function resolveUserPluginsDir() {
  return path.join(app.getPath('userData'), 'plugins');
}

/* 发现插件：扫描内置目录（asar 内）与用户目录（exe 同级），返回清单 + 入口脚本文本。
 * 入口以文本形式回传，渲染进程用内联 <script> 执行，规避 file:// 进 asar 的坑。 */
function scanPlugins() {
  const out = [];
  const roots = [
    { dir: path.join(__dirname, 'src', 'js', 'plugins'), builtin: true },
    { dir: userPluginsDir, builtin: false },
    { dir: path.join(path.dirname(app.getPath('exe')), 'plugins'), builtin: false }
  ];
  for (const r of roots) {
    if (!r.dir || !fs.existsSync(r.dir)) continue;
    let names = [];
    try {
      names = fs.readdirSync(r.dir).filter((n) => {
        try { return fs.statSync(path.join(r.dir, n)).isDirectory(); } catch (e) { return false; }
      });
    } catch (e) { continue; }
    for (const name of names) {
      const base = path.join(r.dir, name);
      const mfPath = path.join(base, 'plugin.json');
      if (!fs.existsSync(mfPath)) continue;
      let mf;
      try { mf = JSON.parse(fs.readFileSync(mfPath, 'utf8')); } catch (e) { continue; }
      if (!mf.id) mf.id = name;
      const entry = mf.entry || 'index.js';
      const entryAbs = path.join(base, entry);
      if (!fs.existsSync(entryAbs)) continue;
      let entryText = '';
      try { entryText = fs.readFileSync(entryAbs, 'utf8'); } catch (e) { continue; }
      out.push({ manifest: mf, location: r.builtin ? 'builtin' : 'user', entryText });
    }
  }
  return out;
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '墨页 · 小说写作',
    backgroundColor: '#f3efe6',
    icon: path.join(__dirname, 'resources', 'icons', 'appIcon.ico'),
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWin.loadFile(path.join(__dirname, 'src', 'index.html'));

  // 调试：需要时把下一行注释取消，运行时按 F12 或自动开 DevTools
  // mainWin.webContents.openDevTools();
}

function registerIpc() {
  // 窗口控制
  ipcMain.handle('window-control', (e, action) => {
    if (!mainWin) return false;
    switch (action) {
      case 'minimize': mainWin.minimize(); return true;
      case 'maximize':
        if (mainWin.isMaximized()) mainWin.unmaximize(); else mainWin.maximize();
        return mainWin.isMaximized();
      case 'close': mainWin.close(); return true;
      case 'is-maximized': return mainWin.isMaximized();
    }
    return false;
  });

  ipcMain.handle('get-version', () => app.getVersion());
  ipcMain.handle('get-data-path', () => dataDir);

  ipcMain.handle('load-novels', () => fsstore.loadNovels(dataDir));

  ipcMain.handle('save-novels', (e, db) => {
    try { fsstore.saveNovels(dataDir, db); return true; }
    catch (err) { console.error('[墨页] 保存失败', err); return false; }
  });

  // 导出：弹系统保存框，写文件
  ipcMain.handle('export-file', async (e, opts) => {
    const { content, defaultName, filters } = opts || {};
    const res = await dialog.showSaveDialog(mainWin, {
      title: '导出文件',
      defaultPath: path.join(app.getPath('documents'), defaultName || '未命名'),
      filters: filters || [{ name: '文本', extensions: ['txt', 'md'] }]
    });
    if (res.canceled || !res.filePath) return null; // 用户取消
    try { fsstore.writeFile(res.filePath, content); return res.filePath; }
    catch (err) { console.error('[墨页] 导出失败', err); return false; }
  });

  // 导入/恢复：弹系统打开框，读内容
  ipcMain.handle('import-file', async (e, opts) => {
    const { filters } = opts || {};
    const res = await dialog.showOpenDialog(mainWin, {
      title: '选择备份文件',
      properties: ['openFile'],
      filters: filters || [{ name: 'JSON', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePaths || !res.filePaths.length) return null;
    try { return { path: res.filePaths[0], content: fsstore.readFile(res.filePaths[0]) }; }
    catch (err) { console.error('[墨页] 读取失败', err); return false; }
  });

  // 打开数据文件夹（资源管理器）
  ipcMain.handle('open-data-folder', () => {
    try { shell.openPath(dataDir); return true; }
    catch (e) { return false; }
  });

  // 插件：返回插件清单（含入口脚本文本）
  ipcMain.handle('get-plugins', () => scanPlugins());

  // 插件：打开用户插件目录（不存在则创建）
  ipcMain.handle('open-plugins-folder', () => {
    try { fsstore.ensureDir(userPluginsDir); shell.openPath(userPluginsDir); return true; }
    catch (e) { return false; }
  });

  // 插件：在 data 目录内的沙箱文件读写（防目录穿越）
  ipcMain.handle('plugin-fs', (e, arg) => {
    const { op, rel, content } = arg || {};
    if (!dataDir || !rel) return { ok: false, error: 'bad-arg' };
    const p = path.join(dataDir, rel);
    if (path.relative(dataDir, p).startsWith('..')) return { ok: false, error: 'forbidden' };
    try {
      if (op === 'write') { fsstore.ensureDir(path.dirname(p)); fs.writeFileSync(p, content); return { ok: true, path: p }; }
      if (op === 'read') { return { ok: true, content: fs.readFileSync(p, 'utf8') }; }
      if (op === 'list') {
        if (!fs.existsSync(p)) return { ok: true, items: [] };
        const items = fs.readdirSync(p);
        return { ok: true, items };
      }
      if (op === 'delete') { fs.unlinkSync(p); return { ok: true }; }
      if (op === 'ensureDir') { fsstore.ensureDir(p); return { ok: true }; }
      return { ok: false, error: 'unknown-op' };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  dataDir = resolveDataDir();
  userPluginsDir = resolveUserPluginsDir();
  console.log('[墨页] 数据目录：' + dataDir);
  registerIpc();
  createWindow();

  // 窗口最大化/还原时通知渲染进程更新按钮图标
  mainWin.on('maximize', () => { try { mainWin.webContents.send('window-state', 'maximized'); } catch (e) {} });
  mainWin.on('unmaximize', () => { try { mainWin.webContents.send('window-state', 'restored'); } catch (e) {} });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
