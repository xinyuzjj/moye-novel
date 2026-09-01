/* ===== 墨页 · 存储层（Electron 渲染端） =====
 * 全部文件读写都通过 window.electronAPI（主进程原生 fs）完成。
 * 没有框架桥接、没有 API 签名歧义、没有异步挂起风险——调用即返回结果。
 */
const Store = (() => {
  'use strict';

  const isElectron = () => (typeof window !== 'undefined' && !!window.electronAPI);

  /* ---------- 加载 / 保存 ---------- */
  async function load() {
    if (!isElectron()) return null;
    try {
      const data = await window.electronAPI.loadNovels();
      return data || null;
    } catch (e) {
      console.error('[墨页] 加载失败', e);
      return null;
    }
  }

  async function save(db) {
    if (!isElectron()) return;
    await window.electronAPI.saveNovels(db);
  }

  /* ---------- 数据位置文案 ---------- */
  async function dataPathText() {
    if (!isElectron()) return '（未知）';
    try { return await window.electronAPI.getDataPath(); }
    catch (e) { return '（无法获取）'; }
  }

  /* ---------- 导出 / 备份 / 恢复 ---------- */
  // 返回：文件路径字符串 | null（用户取消） | false（失败）
  async function exportText(filename, content) {
    if (!isElectron()) return null;
    try {
      return await window.electronAPI.exportFile({
        content,
        defaultName: filename,
        filters: [{ name: '文本', extensions: ['txt', 'md'] }]
      });
    } catch (e) { return false; }
  }

  async function backup(db) {
    const json = JSON.stringify(db, null, 2);
    if (!isElectron()) return null;
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      return await window.electronAPI.exportFile({
        content: json,
        defaultName: '墨页-备份-' + stamp + '.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
    } catch (e) { return false; }
  }

  // 返回：解析后的对象 | null（取消/失败/无效）
  async function restore() {
    if (!isElectron()) return null;
    try {
      const res = await window.electronAPI.importFile({
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (!res || !res.content) return null;
      return JSON.parse(res.content);
    } catch (e) { return null; }
  }

  async function openDataFolder() {
    if (!isElectron()) return false;
    try { return await window.electronAPI.openDataFolder(); }
    catch (e) { return false; }
  }

  function confirm(msg) {
    return new Promise((res) => {
      if (typeof window !== 'undefined' && window.MoyeDialogs && window.MoyeDialogs.confirm) {
        window.MoyeDialogs.confirm(msg).then((r) => res(!!r));
        return;
      }
      res(window.confirm(msg));
    });
  }

  return {
    mode: () => isElectron() ? 'electron' : 'browser',
    load, save,
    backup, restore, exportText,
    dataPathText, openDataFolder, confirm
  };
})();
