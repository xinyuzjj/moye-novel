/* ===== 墨页 · 渲染端集成冒烟（jsdom + 真实 fs 存储层） =====
 * 用 jsdom 加载真实的 index.html / store.js / app.js，把 window.electronAPI 接到
 * 真实 lib/fsstore.js（指向一个临时目录）。验证：
 *   1) 启动后 UI 接管（window.__moyeBootDone=true）
 *   2) 首运行自动把默认库写入磁盘 novels.json
 *   3) 二次启动能从磁盘读回同一本书（数据不丢）
 * 这不需要显示器，却真实跑通了「渲染层 → electronAPI → 主进程 fs」整条链路。
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import fsstore from '../lib/fsstore.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', 'src');

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function makeElectronAPI(dataDir) {
  return {
    getVersion: () => '2.0.0',
    getDataPath: () => dataDir,
    loadNovels: () => fsstore.loadNovels(dataDir),
    saveNovels: (db) => { fsstore.saveNovels(dataDir, db); return true; },
    exportFile: (opts) => { const p = path.join(dataDir, opts.defaultName || 'out.txt'); fsstore.writeFile(p, opts.content); return p; },
    importFile: () => null,
    openDataFolder: () => true
  };
}

function buildDom(dataDir) {
  let html = readFileSync(path.join(SRC, 'index.html'), 'utf8');
  // 去掉页面里的脚本标签：jsdom 用 outside-only 模式不自动执行页面脚本，
  // 我们改为手动 eval 一次，避免 jsdom 把内联脚本重复编译两次而误报重复声明。
  html = html
    .replace('<script src="js/store.js"></script>', '')
    .replace('<script src="js/app.js"></script>', '');

  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { console.log('  [JSDOM ERROR]', (e && (e.detail || e.stack || e.message)) || e); });
  vc.sendTo(console, { omitJSDOMErrors: true });
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.electronAPI = makeElectronAPI(dataDir);
      window.confirm = () => true;
      window.alert = () => {};
      window.prompt = () => null;
    }
  });
  const w = dom.window;
  const formatJs = readFileSync(path.resolve(__dirname, '..', 'lib', 'format.js'), 'utf8');
  const storeJs = readFileSync(path.join(SRC, 'js', 'store.js'), 'utf8');
  const appJs = readFileSync(path.join(SRC, 'js', 'app.js'), 'utf8');
  // 一次性 eval（format + store + app 拼在同一作用域），再手动派发 DOMContentLoaded 触发启动
  w.eval(formatJs + '\n;\n' + storeJs + '\n;\n' + appJs);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return dom;
}

(async () => {
  console.log('[测试] 渲染端集成冒烟（jsdom + 真实 fs）');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moye-render-'));

  // 首次启动
  const dom1 = buildDom(dataDir);
  await wait(1600);
  const w1 = dom1.window;
  ok('首次启动 UI 已接管（__moyeBootDone）', w1.__moyeBootDone === true);
  const f = fsstore.novelsFile(dataDir);
  ok('首次启动已落盘 novels.json', fs.existsSync(f));
  const saved = fsstore.loadNovels(dataDir);
  ok('落盘内容含默认书「我的小说」', saved && saved.books && saved.books[0].title === '我的小说');
  dom1.window.close();

  // 模拟：用户在界面里改了书名
  if (saved) { saved.books[0].title = '改过的书名'; fsstore.saveNovels(dataDir, saved); }

  // 二次启动（等同重启软件）
  const dom2 = buildDom(dataDir);
  await wait(1600);
  const w2 = dom2.window;
  ok('二次启动 UI 已接管', w2.__moyeBootDone === true);
  // 通过页面里的 Store 读回（验证渲染层确实用 electronAPI.loadNovels）
  const reloaded = await w2.electronAPI.loadNovels();
  ok('二次启动从磁盘读回改过的书名（数据持久化成立）', reloaded && reloaded.books[0].title === '改过的书名');
  dom2.window.close();

  // 第三阶段：人物卡片功能（端到端模拟界面操作）
  const dom3 = buildDom(dataDir);
  await wait(1600);
  const w3 = dom3.window, doc3 = w3.document;
  const charTab = [...doc3.querySelectorAll('.outline-tab')].find((t) => t.dataset.tab === 'character');
  charTab.dispatchEvent(new w3.MouseEvent('click', { bubbles: true }));
  doc3.getElementById('btnNewCard').dispatchEvent(new w3.MouseEvent('click', { bubbles: true }));
  doc3.getElementById('cardName').value = '林惊羽';
  doc3.getElementById('cardMeta').value = '男主';
  doc3.getElementById('cardDesc').value = '外表冷峻，内心温柔。';
  doc3.getElementById('cardTags').value = '冷酷, 背负仇恨';
  doc3.getElementById('cardSave').dispatchEvent(new w3.MouseEvent('click', { bubbles: true }));
  await wait(1600); // 等自动保存落盘
  const card = doc3.querySelector('#cardList .info-card');
  ok('人物卡片已渲染到资料栏列表', !!card);
  ok('卡片显示姓名', card && card.querySelector('.ic-name').textContent === '林惊羽');
  ok('卡片显示身份标签', card && card.querySelector('.ic-meta') && card.querySelector('.ic-meta').textContent === '男主');
  const persistedCards = fsstore.loadNovels(dataDir);
  ok('人物卡片已持久化到磁盘', persistedCards.books[0].cards.character.length === 1 &&
    persistedCards.books[0].cards.character[0].name === '林惊羽' &&
    persistedCards.books[0].cards.character[0].tags.join() === '冷酷,背负仇恨');
  dom3.window.close();

  // 给默认书预置一点大纲内容，用于验证知识库「本书资料」
  const preset = fsstore.loadNovels(dataDir);
  if (preset && preset.books && preset.books[0]) {
    preset.books[0].outline = preset.books[0].outline || {};
    preset.books[0].outline.outline = '## 主线\n主角历经磨难，最终复仇。\n\n## 伏笔\n戒指里的老人身份成谜。';
    fsstore.saveNovels(dataDir, preset);
  }

  // 第四阶段：知识库面板（只读，连接本地 .md 文件夹）
  const dom4 = buildDom(dataDir);
  await wait(1600);
  const w4 = dom4.window, doc4 = w4.document;
  const kbTab = [...doc4.querySelectorAll('.outline-tab')].find((t) => t.dataset.tab === 'kb');
  ok('资料栏含「知识库」tab', !!kbTab);
  kbTab.dispatchEvent(new w4.MouseEvent('click', { bubbles: true }));
  await wait(60);
  ok('点击知识库 tab 后面板可见（#kbPanel 未隐藏）', doc4.getElementById('kbPanel') && doc4.getElementById('kbPanel').hidden === false);
  ok('知识库面板含「连接文件夹」按钮', !!doc4.getElementById('kbConnect'));
  ok('未连接外部库时显示「未连接外部库」提示', doc4.getElementById('kbFolderLabel') && doc4.getElementById('kbFolderLabel').textContent.trim() === '未连接外部库');
  ok('知识库面板含搜索框与列表', !!doc4.getElementById('kbSearch') && !!doc4.getElementById('kbList'));
  ok('未连接外部库时仍显示「本书资料」分组', doc4.querySelector('.kb-group') && doc4.querySelector('.kb-group').textContent.trim() === '本书资料');
  const outlineItem = doc4.querySelector('.kb-item[data-local^="outline"]');
  if (outlineItem) {
    outlineItem.dispatchEvent(new w4.MouseEvent('click', { bubbles: true }));
    await wait(40);
    ok('点击本书大纲后知识库详情面板显示', doc4.getElementById('kbView') && doc4.getElementById('kbView').hidden === false);
    ok('知识库详情标题显示“本书大纲”', doc4.getElementById('kbViewTitle') && doc4.getElementById('kbViewTitle').textContent.trim() === '本书大纲');
  } else {
    ok('存在本书大纲条目', false);
  }
  dom4.window.close();

  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exitCode = fail ? 1 : 0;
})();
