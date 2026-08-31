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

  /* ---------- Neutralino 路径 ---------- */
  let _dataDir = null;
  async function dataDir() {
    if (_dataDir) return _dataDir;
    let dir = null;
    try {
      const base = await nlCall(Neutralino.os.getPath, ['current'], 2000, null);
      if (base) {
        dir = base + '/data';
        await nlCall(Neutralino.filesystem.createDirectory, [dir], 2000, null);
      }
    } catch (e) {}
    if (!dir) {
      try {
        const docs = await nlCall(Neutralino.os.getPath, ['documents'], 2000, null);
        if (docs) {
          dir = docs + '/墨页小说写作/data';
          await nlCall(Neutralino.filesystem.createDirectory, [dir], 2000, null);
        }
      } catch (e2) {}
    }
    if (!dir) dir = 'data'; // 最后兜底，避免崩溃
    _dataDir = dir;
    return dir;
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
      await nlCall(Neutralino.filesystem.writeFile, [file, txt], 2000, null);
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
        const path = await nlCall(Neutralino.os.showSaveDialog, [{
          title: '导出文件', filters: [{ name: '文本', extensions: ['txt', 'md'] }]
        }], 5000, null);
        if (!path) return null; // 用户取消
        await nlCall(Neutralino.filesystem.writeFile, [path, content], 5000, null);
        return path;
      } catch (e) { return false; }
    }
    download(filename, content);
    return filename;
  }

  async function backup(db) {
    const json = JSON.stringify(db, null, 2);
    if (NL()) {
      try {
        const path = await nlCall(Neutralino.os.showSaveDialog, [{
          title: '备份全部数据', filters: [{ name: 'JSON', extensions: ['json'] }]
        }], 5000, null);
        if (!path) return null; // 用户取消
        await nlCall(Neutralino.filesystem.writeFile, [path, json], 5000, null);
        return path;
      } catch (e) { return false; }
    }
    download('墨页-备份-' + Date.now() + '.json', json);
    return '墨页-备份-' + Date.now() + '.json';
  }

  // 返回解析后的对象，或 null（取消/失败）
  async function restore() {
    if (NL()) {
      try {
        const paths = await Neutralino.os.showOpenDialog({
          title: '从备份恢复', filters: [{ name: 'JSON', extensions: ['json'] }]
        });
        if (!paths || !paths.length) return null;
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
      let cmd = 'explorer', args = [dir];
      if (typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)) { cmd = 'open'; args = [dir]; }
      else if (typeof navigator !== 'undefined' && /Linux/.test(navigator.platform)) { cmd = 'xdg-open'; args = [dir]; }
      await Neutralino.os.spawnProcess(cmd, args);
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
