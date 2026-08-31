/* ===== 墨页 · 文件存储层（纯 Node，主进程与测试共用） =====
 * 这里只有最朴素、最可靠的 fs 操作，没有任何框架桥接、没有任何签名歧义。
 * - 数据目录：exe 同级 data/ 优先（便携可带走），写不进则落到 AppData/墨页/data（永远可写）
 * - 写文件用「临时文件 + rename」原子替换，避免写到一半程序退出导致 novels.json 损坏
 */
'use strict';
const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// 真实验证目录在本机是否可落盘：建目录 → 写探针 → 读回 → 删除
function ensureWritable(dir) {
  try {
    ensureDir(dir);
    const probe = path.join(dir, '.writetest');
    fs.writeFileSync(probe, 'ok');
    const back = fs.readFileSync(probe, 'utf8');
    try { fs.unlinkSync(probe); } catch (e) {}
    return back === 'ok';
  } catch (e) {
    return false;
  }
}

function novelsFile(dataDir) {
  return path.join(dataDir, 'novels.json');
}

function loadNovels(dataDir) {
  try {
    const f = novelsFile(dataDir);
    if (!fs.existsSync(f)) return null;
    const txt = fs.readFileSync(f, 'utf8');
    if (!txt) return null;
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

function saveNovels(dataDir, db) {
  ensureDir(dataDir);
  const f = novelsFile(dataDir);
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, f); // 原子替换
  return true;
}

function writeFile(p, content) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content);
  return p;
}

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

module.exports = {
  ensureDir,
  ensureWritable,
  loadNovels,
  saveNovels,
  writeFile,
  readFile,
  novelsFile
};
