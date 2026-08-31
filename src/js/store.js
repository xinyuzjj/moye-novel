/* ===== 墨页 · 存储层 =====
 * 统一抽象：Neutralino 桌面端走 filesystem（exe 同级 data/，不可写回退文档目录）；
 * 浏览器/直开 HTML 走 IndexedDB。所有原生 API 调用都包了 try/catch，
 * 任何异常都降级而不是中断启动。
 */
const Store = (() => {
  'use strict';

  const NL = () => (typeof Neutralino !== 'undefined');

  /* ---------- 原生存储调用超时封装 ----------
   * Neutralino 客户端库若尚未与本地进程建立连接，API 调用可能永久挂起。
   * 给每个原生调用加 2 秒超时，超时即降级，保证启动不卡死。 */
  function withTimeout(promise, ms, fallback) {
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, ms);
      Promise.resolve(promise).then(
        (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } },
        () => { if (!done) { done = true; clearTimeout(t); resolve(fallback); } }
      );
    });
  }
  async function nlCall(fn, args, ms, fallback) {
    if (!NL()) return fallback;
    try { return await withTimeout(fn.apply(null, args), ms, fallback); } catch (e) { return fallback; }
  }

  /* ---------- 递归创建目录 ----------
   * 关键坑：Neutralino 的 filesystem.createDirectory 不会自动创建父目录，
   * 直接建多级路径会因父目录不存在而静默失败，导致数据永远写不进去。
   * 这里逐层建目录，返回最终目录是否就绪。 */
  async function mkdirp(dir) {
    const norm = String(dir).replace(/\\/g, '/');
    const parts = norm.split('/').filter(Boolean);
    let cur = '';
    for (const p of parts) {
      cur += (cur && !/^[A-Za-z]:$/.test(cur) ? '/' : '') + p;
      let exists = false;
      try {
        const st = await nlCall(Neutralino.filesystem.getStats, [cur], 1200, null);
        if (st && st.type && String(st.type).toUpperCase().indexOf('DIR') >= 0) exists = true;
      } catch (e) {}
      if (exists) continue;
      await nlCall(Neutralino.filesystem.createDirectory, [cur], 1200, null);
    }
    try {
      const st = await nlCall(Neutralino.filesystem.getStats, [dir], 1200, null);
      return !!(st && st.type && String(st.type).toUpperCase().indexOf('DIR') >= 0);
    } catch (e) { return false; }
  }

  /* ---------- 对话框返回路径归一化 ----------
   * 不同版本 showSaveDialog / showOpenDialog 可能返回字符串，也可能返回
   * {filePath} / {filePaths} 对象；统一归一化，避免把对象当路径传入 writeFile。 */
  function normPath(p) {
    if (!p) return null;
    if (typeof p === 'string') return p;
    if (typeof p === 'object') return normPath(p.filePath || p.path || null);
    return null;
  }
  function pickPaths(res) {
    if (!res) return [];
    if (Array.isArray(res)) return res.map(normPath).filter(Boolean);
    if (typeof res === 'object') {
      if (Array.isArray(res.filePaths)) return res.filePaths.map(normPath).filter(Boolean);
      if (res.filePath) return [normPath(res.filePath)];
      if (res.path) return [normPath(res.path)];
    }
    return [];
  }

  /* ---------- Neutralino 数据目录 ----------
   * 优先级：
   *   1) window.NL_PATH（Neutralino 注入的程序所在目录）→ exe 同级 data，便携可带走
   *   2) 文档目录 Documents/墨页小说写作/data（最可靠、用户易找）
   *   3) 相对 data（最后兜底，不崩溃）
   * 目录用 mkdirp 递归创建，确保一定存在。 */
  let _dataDir = null;
  async function dataDir() {
    if (_dataDir) return _dataDir;
    const candidates = [];
    try { if (typeof window !== 'undefined' && window.NL_PATH) candidates.push(String(window.NL_PATH).replace(/[\\/]$/, '') + '/data'); } catch (e) {}
    try { const docs = await nlCall(Neutralino.os.getPath, ['documents'], 2000, null); if (docs) candidates.push(docs.replace(/[\\/]$/, '') + '/墨页小说写作/data'); } catch (e) {}
    candidates.push('data');
    for (const dir of candidates) {
      if (await mkdirp(dir)) { _dataDir = dir; console.log('[墨页 存储] 数据目录：' + dir); return dir; }
    }
    _dataDir = 'data';
    return 'data';
  }

  async function dataPathText() {
    if (NL()) { try { return await dataDir(); } catch (e) { return '（无法获取）'; } }
    return '浏览器本地 (IndexedDB)';
  }

  /* ---------- 原始读写 ---------- */
  async function loadRaw() {
    if (NL()) {
      try {
        const dir = await dataDir();
        const file = dir + '/novels.json';
        const stats = await nlCall(Neutralino.filesystem.getStats, [file], 2000, null);
        if (stats && stats.size > 0) {
          const txt = await nlCall(Neutralino.filesystem.readFile, [file], 2000, null);
          if (txt !== null) return txt;
        }
      } catch (e) { /* 尚无文件 */ }
      return null;
    }
    return await browserGet('novels.json');
  }
  async function saveRaw(txt) {
    if (NL()) {
      const dir = await dataDir();
      const file = dir + '/novels.json';
      await nlCall(Neutralino.filesystem.writeFile, [file, txt], 5000, null);
      return;
    }
    await browserSet('novels.json', txt);
  }

  async function load() {
    const raw = await loadRaw();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  async function save(db) {
    await saveRaw(JSON.stringify(db));
  }

  /* ---------- 浏览器存储兜底（优先 IndexedDB，不支持时用内存） ---------- */
  let _memStore = {};
  const hasIDB = () => (typeof indexedDB !== 'undefined');
  function idbOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('moye-novel', 1);
      r.onupgradeneeded = () => { try { r.result.createObjectStore('kv'); } catch (e) {} };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function browserGet(key) {
    if (!hasIDB()) return _memStore[key] || null;
    try {
      const db = await idbOpen();
      return await new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').get(key);
        req.onsuccess = () => res(req.result || null);
        req.onerror = () => rej(req.error);
      });
    } catch (e) { return _memStore[key] || null; }
  }
  async function browserSet(key, val) {
    _memStore[key] = val;
    if (!hasIDB()) return;
    try {
      const db = await idbOpen();
      await new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    } catch (e) { /* 内存兜底已写，静默失败 */ }
  }

  /* ---------- 导出 / 备份 / 恢复 ---------- */
  function download(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  async function exportText(filename, content) {
    if (NL()) {
      try {
        const picked = normPath(await nlCall(Neutralino.os.showSaveDialog, ['导出文件', {
          filters: [{ name: '文本', extensions: ['txt', 'md'] }]
        }], 120000, null));
        if (!picked) return null; // 用户取消
        await nlCall(Neutralino.filesystem.writeFile, [picked, content], 8000, null);
        return picked;
      } catch (e) { return false; }
    }
    download(filename, content);
    return filename;
  }

  async function backup(db) {
    const json = JSON.stringify(db, null, 2);
    if (NL()) {
      try {
        const picked = normPath(await nlCall(Neutralino.os.showSaveDialog, ['备份全部数据', {
          filters: [{ name: 'JSON', extensions: ['json'] }]
        }], 120000, null));
        if (!picked) return null; // 用户取消
        await nlCall(Neutralino.filesystem.writeFile, [picked, json], 8000, null);
        return picked;
      } catch (e) { return false; }
    }
    download('墨页-备份-' + Date.now() + '.json', json);
    return '墨页-备份-' + Date.now() + '.json';
  }

  // 返回解析后的对象，或 null（取消/失败）
  async function restore() {
    if (NL()) {
      try {
        const paths = pickPaths(await nlCall(Neutralino.os.showOpenDialog, ['从备份恢复', {
          filters: [{ name: 'JSON', extensions: ['json'] }]
        }], 120000, null));
        if (!paths.length) return null;
        const txt = await Neutralino.filesystem.readFile(paths[0]);
        return JSON.parse(txt);
      } catch (e) { return null; }
    }
    return await pickJson();
  }

  function pickJson() {
    return new Promise((res) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) return res(null);
        const r = new FileReader();
        r.onload = () => { try { res(JSON.parse(r.result)); } catch (e) { res(null); } };
        r.onerror = () => res(null);
        r.readAsText(f);
      };
      inp.click();
    });
  }

  async function openDataFolder() {
    if (!NL()) return false;
    try {
      const dir = await dataDir();
      // Neutralino.os.open(path) 会调用系统默认程序打开该路径；
      // 传目录时 Windows 用资源管理器、macOS 用访达、Linux 用文件管理器打开。
      await Neutralino.os.open(dir);
      return true;
    } catch (e) { return false; }
  }

  function confirm(msg) {
    return new Promise((res) => res(window.confirm(msg)));
  }

  return {
    mode: () => NL() ? 'neutralino' : 'browser',
    load, save,
    backup, restore, exportText,
    dataPathText, openDataFolder, confirm
  };
})();
