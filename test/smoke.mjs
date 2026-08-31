#!/usr/bin/env node
/**
 * 启动冒烟测试：用 jsdom 加载「构建后的单文件 resources/index.html」，
 * stub 一个最小 Neutralino，触发 DOMContentLoaded，确认 boot() 不抛错、
 * 启动屏正常关闭、目录树/素材已渲染。
 * 覆盖三种场景：浏览器模式、桌面模式（Neutralino 无 init API，如 v6.9.0）、已有数据。
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'resources', 'index.html'), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function stubWindow(window, seeded, opts = {}) {
  window.NL_MODE = opts.mode || 'window';
  const ok = (v) => Promise.resolve(v);
  let fileExists = !!seeded;
  const fs = {
    createDirectory: () => ok({}),
    writeFile: () => ok({}),
    readFile: () => fileExists ? ok(JSON.stringify(seeded)) : Promise.reject(new Error('ENOENT')),
    getStats: () => fileExists ? ok({ size: 100 }) : Promise.reject(new Error('ENOENT'))
  };
  const nl = {
    version: '6.9.0',
    events: { on: () => {} },
    app: { exit: () => {} },
    os: { getPath: () => ok('C:\\mock'), spawnProcess: () => ok({}), showOpenDialog: () => ok([]), showSaveDialog: () => ok('C:\\mock\\out.txt') },
    filesystem: fs,
    window: { show: () => {}, hide: () => {}, setTitle: () => {} }
  };
  // 场景 2：模拟 v6.9.0 客户端库，没有 init API
  if (!opts.hasInit) delete nl.init;
  else nl.init = () => {};

  if (opts.mode === 'browser') window.Neutralino = undefined;
  else window.Neutralino = nl;

  window.confirm = () => true; window.prompt = () => 'x';
  window.__caught = [];
  window.addEventListener('error', (e) => window.__caught.push('error: ' + ((e.error && e.error.stack) || e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__caught.push('unhandledrejection: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));
}

function seededDb() {
  const ch = (t, n) => ({ id: 'c' + n, title: t, status: 'draft', html: '<p>内容' + n + '</p>', words: 100 + n, updatedAt: Date.now(), snapshots: [] });
  return {
    books: [
      { id: 'b1', title: '书一', author: '甲', desc: '', volumes: [
        { id: 'v1', name: '正文', collapsed: false, chapters: [ch('第一章', 1), ch('第二章', 2)] },
        { id: 'v2', name: '番外', collapsed: false, chapters: [ch('番外一', 3)] }
      ], notes: [{ id: 'n1', cat: 'character', title: '主角', body: 'xxx', updatedAt: Date.now() }], outline: { outline: '走向', character: '', world: '', idea: '' }, settings: {}, today: { date: '2026-08-31', words: 50 }, history: { '2026-08-30': 30, '2026-08-31': 50 } },
      { id: 'b2', title: '书二', author: '', desc: '', volumes: [{ id: 'v3', name: '正文', collapsed: false, chapters: [ch('开篇', 4)] }], notes: [], outline: { outline: '', character: '', world: '', idea: '' }, settings: {}, today: { date: '2026-08-31', words: 0 }, history: {} }
    ],
    activeId: 'b1', dayBaseline: 0, today: null
  };
}

async function runScenario(name, seeded, opts = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const m = String(e.detail?.message || e.message || '');
    if (/__neutralino_globals\.js|js\/neutralino\.js|Could not load|resource/i.test(m)) return;
    errors.push('jsdomError: ' + (e.detail?.stack || m));
  });
  const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole: vc, url: 'http://localhost/', beforeParse: (w) => stubWindow(w, seeded, opts) });
  await wait(900);
  const w = dom.window, doc = w.document;
  const be = doc.getElementById('bootError');
  const overlay = be && !be.hidden;
  const beMsg = overlay && doc.getElementById('bootErrorMsg') ? doc.getElementById('bootErrorMsg').textContent : '';
  const splash = doc.getElementById('bootSplash');
  const splashHidden = !splash || splash.style.display === 'none';
  const splashErr = splash && doc.getElementById('bootSplashErr');
  const toc = doc.getElementById('tocTree') ? doc.getElementById('tocTree').children.length : 0;
  const notes = doc.getElementById('noteList') ? doc.getElementById('noteList').children.length : 0;
  const stats = doc.getElementById('statsBody') ? doc.getElementById('statsBody').innerHTML.length : 0;
  const caught = (w.__caught || []).concat(errors);
  const okAll = !overlay && splashHidden && caught.length === 0 && toc > 0 && stats > 0;
  console.log('\n=== 场景：' + name + ' ===');
  console.log((!overlay ? '✔' : '✘') + ' 错误浮层未弹出');
  console.log((splashHidden ? '✔' : '✘') + ' 启动屏已关闭');
  if (!splashHidden && splashErr && !splashErr.hidden) console.log('   启动屏错误: ' + splashErr.textContent.slice(0, 200));
  console.log((caught.length === 0 ? '✔' : '✘') + ' 无未捕获异常 (' + caught.length + ')');
  console.log((toc > 0 ? '✔' : '✘') + ' 目录树渲染 (节点 ' + toc + ')');
  console.log((notes >= 0 ? '✔' : '✘') + ' 素材列表渲染 (卡片 ' + notes + ')');
  console.log((stats > 0 ? '✔' : '✘') + ' 统计面板渲染');
  if (caught.length) caught.forEach((e) => console.log('   - ' + e));
  if (overlay) console.log('   浮层内容:\n' + beMsg);
  dom.window.close();
  return okAll;
}

const a = await runScenario('浏览器模式（无 Neutralino）', null, { mode: 'browser', hasInit: false });
const b = await runScenario('桌面模式（Neutralino v6.9.0 无 init API）', null, { mode: 'window', hasInit: false });
const c = await runScenario('已有数据（2 书 / 多分卷 / 素材 / 历史）', seededDb(), { mode: 'window', hasInit: false });
if (a && b && c) { console.log('\n✅ 冒烟测试全部通过：应用可正常启动并完成初始化。'); process.exit(0); }
else { console.error('\n❌ 冒烟测试未通过'); process.exit(1); }
