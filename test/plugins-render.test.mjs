/* 插件渲染回归测试：真实加载 host.js + app.js（dangerously 模式下动态注入的插件脚本会执行），
 * 用真实 src/builtin-plugins.json 验证插件「发现 → 注入 → 注册 → 激活 → 抽屉渲染」全链路，
 * 防止 ctx.emit 之类的宿主 bug 再次让插件抽屉空白。 */
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
  const builtin = JSON.parse(readFileSync(path.join(SRC, 'builtin-plugins.json'), 'utf8'));
  return {
    getVersion: () => '2.1.0',
    getDataPath: () => dataDir,
    loadNovels: () => fsstore.loadNovels(dataDir),
    saveNovels: (db) => { fsstore.saveNovels(dataDir, db); return true; },
    exportFile: (o) => { const p = path.join(dataDir, o.defaultName || 'out.txt'); fsstore.writeFile(p, o.content); return p; },
    importFile: () => null,
    openDataFolder: () => true,
    openPluginsFolder: () => true,
    getPlugins: () => Promise.resolve(builtin),
    pluginFs: () => Promise.resolve({ ok: true })
  };
}

function buildDom(dataDir) {
  let html = readFileSync(path.join(SRC, 'index.html'), 'utf8')
    .replace('<script src="../lib/format.js"></script>', '')
    .replace('<script src="js/plugins/host.js"></script>', '')
    .replace('<script src="js/store.js"></script>', '')
    .replace('<script src="js/app.js"></script>', '');
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => console.log('  [JSDOM ERROR]', (e && (e.detail || e.stack || e.message)) || e));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.electronAPI = makeElectronAPI(dataDir);
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
    }
  });
  const w = dom.window;
  const code = ['../lib/format.js', 'js/plugins/host.js', 'js/store.js', 'js/app.js']
    .map((p) => readFileSync(p.startsWith('..') ? path.resolve(__dirname, '..', p.replace('../', '')) : path.join(SRC, p), 'utf8'))
    .join('\n;\n');
  w.eval(code);
  // dangerously 模式下 jsdom 解析完会自动派发 DOMContentLoaded，无需手动触发（手动触发会导致 boot 重复）
  return dom;
}

(async () => {
  console.log('[测试] 插件渲染链路（jsdom + dangerously）');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moye-prender-'));
  const dom = buildDom(dataDir);
  const w = dom.window, doc = w.document;
  await wait(2000);
  ok('启动完成', w.__moyeBootDone === true);
  ok('MoyePlugins 宿主存在', !!w.MoyePlugins);
  ok('插件清单含 3 个内置插件', w.MoyePlugins && w.MoyePlugins.list().length === 3);
  ok('工具栏已注入插件按钮（#pluginTools 非空）', doc.getElementById('pluginTools') && doc.getElementById('pluginTools').children.length >= 1);
  ok('插件管理抽屉已渲染行（#pluginsList 非空）', doc.getElementById('pluginsList') && doc.getElementById('pluginsList').children.length === 3);
  // 模拟勾选停用一个插件 → 该插件的工具栏按钮（data-plugin 标记）应被移除
  const before = doc.querySelectorAll('#pluginTools [data-plugin]').length;
  // 直接调用宿主停用接口，验证 deactivate 移除 UI 痕迹
  try { w.MoyePlugins.setEnabled('fulltext-search', false); } catch (e) { console.log('  [debug] setEnabled threw', e.message); }
  await wait(50);
  const after = doc.querySelectorAll('#pluginTools [data-plugin]').length;
  ok('停用插件后其工具栏按钮被移除（数量 -1）', after === before - 1);

  // 内置写作计时（非插件）：底栏入口 + 抽屉交互（回归防护）
  ok('内置写作计时入口存在（#stTimer）', !!doc.getElementById('stTimer'));
  ok('写作计时抽屉存在（#timerDrawer）', !!doc.getElementById('timerDrawer'));
  try {
    const st = doc.getElementById('stTimer'); if (st) st.click();
    await wait(40);
    ok('点击计时入口打开计时抽屉', !!doc.getElementById('timerDrawer') && doc.getElementById('timerDrawer').classList.contains('show'));
    const startBtn = doc.getElementById('btnTimerStart');
    ok('计时抽屉含开始/暂停按钮', !!startBtn);
    if (startBtn) {
      const t0 = startBtn.textContent;
      startBtn.click(); await wait(20);
      ok('计时开始/暂停按钮可切换', startBtn.textContent !== t0);
    }
  } catch (e) {
    ok('写作计时交互正常', false);
    console.log('  [debug] 计时交互异常', e.message);
  }
  dom.window.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exitCode = fail ? 1 : 0;
})();
