/* ===== 墨页 · 文件存储层真实单测 =====
 * 直接对 lib/fsstore.js 跑真实 fs 操作（不是模拟、不是桩），
 * 证明「保存 / 加载 / 原子写 / 导出 / 导入 / 目录可写性兜底」在真实文件系统上成立。
 * 这是换用 Electron 后最大的可靠性保障：以前 Neutralino 的桥接 API 没法在沙箱真跑，
 * 现在这一段就是纯 Node，和最终产品里跑的代码完全一致。
 */
import fsstore from '../lib/fsstore.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'moye-test-'));
  return d;
}

(async () => {
  console.log('[测试] 文件存储层（真实 fs）');

  // 1) 目录可写性探测：临时目录应可写
  const d = tmpDir();
  ok('ensureWritable 对临时目录返回 true', fsstore.ensureWritable(d) === true);

  // 2) 保存后加载能原样回来（核心：数据不丢）
  const db = {
    books: [{ id: 'b1', title: '测试书', volumes: [{ id: 'v1', name: '正文', chapters: [{ id: 'c1', title: '第一章', html: '<p>你好世界</p>', words: 4 }] }], settings: { theme: 'paper' } }],
    activeId: 'b1'
  };
  fsstore.saveNovels(d, db);
  const loaded = fsstore.loadNovels(d);
  ok('保存后 loadNovels 能读回', loaded && loaded.books && loaded.books.length === 1);
  ok('读回内容一致', loaded && loaded.books[0].title === '测试书' && loaded.books[0].volumes[0].chapters[0].words === 4);

  // 3) 原子写：落盘后不应残留 .tmp，且内容完整
  const f = fsstore.novelsFile(d);
  ok('novels.json 存在', fs.existsSync(f));
  ok('无残留 .tmp 文件', !fs.existsSync(f + '.tmp'));
  ok('文件内容与写入一致', fs.readFileSync(f, 'utf8') === JSON.stringify(db));

  // 4) 中文/特殊字符内容不丢
  const db2 = { books: [{ id: 'x', title: '《剑来》·番外', volumes: [], settings: {} }], activeId: 'x' };
  fsstore.saveNovels(d, db2);
  const loaded2 = fsstore.loadNovels(d);
  ok('中文与书名号内容正确往返', loaded2 && loaded2.books[0].title === '《剑来》·番外');

  // 5) 文件缺失时 loadNovels 返回 null（首运行场景）
  const empty = tmpDir();
  ok('目录为空时 loadNovels 返回 null', fsstore.loadNovels(empty) === null);

  // 6) 导出写文件 + 导入读回
  const exp = path.join(d, '导出.txt');
  fsstore.writeFile(exp, '正文内容一二三');
  ok('导出文件已写入', fs.existsSync(exp));
  ok('导入读回内容一致', fsstore.readFile(exp) === '正文内容一二三');

  // 7) 父路径是文件（无法在其下建目录）时 ensureWritable 返回 false —— 与权限无关，可靠验证兜底逻辑
  const td = tmpDir();
  fs.writeFileSync(path.join(td, 'afile'), 'x');
  ok('父路径为文件时 ensureWritable 返回 false（兜底逻辑可用）', fsstore.ensureWritable(path.join(td, 'afile', 'sub')) === false);
  try { fs.rmSync(td, { recursive: true, force: true }); } catch (e) {}

  // 清理
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {}
  try { fs.rmSync(empty, { recursive: true, force: true }); } catch (e) {}

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  if (ROOT) process.exitCode = fail ? 1 : 0;
})();
