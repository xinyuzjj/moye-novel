#!/usr/bin/env node
/**
 * 墨页 · 构建脚本（单文件内联 + 自动校验）
 * 把 src/ 下的 css + store.js + app.js 内联进单个 resources/index.html，
 * 再 neu build，最后解包校验。任何一步失败都直接报错退出，绝不产出坏包。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, copyFileSync, readdirSync, statSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, 'src');
const RES = join(__dirname, 'resources');
const esc = (s) => s.replace(/<\/script/gi, '<\\/script');
const read = (p) => readFileSync(p, 'utf8');

function syntaxGate() {
  for (const f of ['src/js/neutralino.js', 'src/js/store.js', 'src/js/app.js']) {
    const full = join(__dirname, f);
    if (!existsSync(full)) throw new Error('缺少源文件: ' + f);
    execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' });
  }
  console.log('✔ JS 语法检查通过 (neutralino.js / store.js / app.js)');
}

function inline() {
  let html = read(join(SRC, 'index.html'));
  const css = read(join(SRC, 'css', 'style.css'));
  const store = read(join(SRC, 'js', 'store.js'));
  const app = read(join(SRC, 'js', 'app.js'));
  html = html.replace(/<link[^>]+href=["']css\/style\.css["'][^>]*>/i, () => `<style>\n${css}\n</style>`);
  html = html.replace(/<script[^>]+src=["']js\/store\.js["'][^>]*><\/script>/i, () => `<script>\n${esc(store)}\n</script>`);
  html = html.replace(/<script[^>]+src=["']js\/app\.js["'][^>]*><\/script>/i, () => `<script>\n${esc(app)}\n</script>`);
  return html;
}

function assertNoExternalRefs(html) {
  const bad = [];
  if (/href=["']css\//.test(html)) bad.push('css/ 外链未内联');
  if (/src=["']js\/store\.js["']/.test(html)) bad.push('store.js 外链未内联');
  if (/src=["']js\/app\.js["']/.test(html)) bad.push('app.js 外链未内联');
  if (bad.length) throw new Error('内联失败: ' + bad.join('; '));
  // v6 框架在根路径会自动注入 __neutralino_globals.js（含端口/令牌），
  // 手动引用反而 404，故必须确保不出现该外链。
  if (html.includes('__neutralino_globals.js')) throw new Error('不应手动引用 __neutralino_globals.js（框架自动注入，手动引用会 404）');
  if (!html.includes('js/neutralino.js')) throw new Error('必须保留框架客户端库 js/neutralino.js 引用');
  console.log('✔ 内联成功：store.js/app.js/css 已内联；未手动引用 __neutralino_globals.js（由框架注入）；保留框架客户端库外链');
}

function writeResources(html) {
  if (!existsSync(RES)) mkdirSync(RES, { recursive: true });
  writeFileSync(join(RES, 'index.html'), html, 'utf8');
  const nlFrom = join(SRC, 'js', 'neutralino.js');
  const nlTo = join(RES, 'js', 'neutralino.js');
  if (!existsSync(dirname(nlTo))) mkdirSync(dirname(nlTo), { recursive: true });
  if (existsSync(nlFrom)) copyFileSync(nlFrom, nlTo);
  const iconFrom = join(SRC, 'icons', 'appIcon.png');
  const iconTo = join(RES, 'icons', 'appIcon.png');
  if (!existsSync(dirname(iconTo))) mkdirSync(dirname(iconTo), { recursive: true });
  if (existsSync(iconFrom)) copyFileSync(iconFrom, iconTo);
  console.log('✔ 已生成 resources/index.html (单文件) + js/neutralino.js + 图标');
}

function rmSafe(p) {
  // 容错清理：遇到 EBUSY（文件被占用/被杀软锁）时重试几次，仍失败则跳过，让 neu build 自行覆盖
  for (let i = 0; i < 3; i++) {
    try { rmSync(p, { recursive: true, force: true }); return; }
    catch (e) {
      if (e.code === 'EBUSY' || e.code === 'EPERM') { try { execFileSync('cmd', ['/c', 'del', '/f', '/q', '/s', p], { stdio: 'ignore' }); } catch (_) {} }
      else throw e;
    }
  }
  try { rmSync(p, { recursive: true, force: true }); } catch (e) { console.warn('  ⚠ 清理跳过（被占用）：', p); }
}

function neuBuild() {
  // 旧版 neu 的 --clean 在新版 CLI 已移除；手动清理缓存/旧产物，避免用上一轮的包蒙混过关
  for (const d of ['.tmp', 'temp', join('dist', '墨页')]) {
    const p = join(__dirname, d);
    if (existsSync(p)) rmSafe(p);
  }
  console.log('→ 执行 neu build --release ...');
  execFileSync('npx', ['neu', 'build', '--release'], { stdio: 'inherit', shell: true, cwd: __dirname });
}

function fixDistName() {
  const d = join(__dirname, 'dist', '墨页');
  const wrong = join(d, 'res.neu');
  const right = join(d, 'resources.neu');
  if (existsSync(wrong)) {
    if (existsSync(right)) rmSync(right);
    renameSync(wrong, right);
    console.log('✔ 已将包名 res.neu → resources.neu（v6.9.0 二进制要求）');
  }
  // 清理 neu CLI 为跨平台打包产生的空占位文件与旧版依赖占位
  for (const f of ['墨页-linux_x64', '墨页-linux_ia32', '墨页-linux_armhf', '墨页-mac_x64', 'WebView2Loader.dll']) {
    const p = join(d, f);
    if (existsSync(p) && statSync(p).size === 0) rmSync(p);
  }
}

async function verifyPackage() {
  const req = createRequire(import.meta.url);
  const asar = req('@electron/asar');
  const pkg = join(__dirname, 'dist', '墨页', 'resources.neu');
  if (!existsSync(pkg)) throw new Error('未找到构建产物: ' + pkg);
  const tmp = join(__dirname, 'dist', '_verify');
  rmSync(tmp, { recursive: true, force: true });
  asar.extractAll(pkg, tmp);
  const files = [];
  (function walk(d, base = '') {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p, base + e + '/');
      else files.push(base + e);
    }
  })(tmp);
  const html = readFileSync(join(tmp, 'resources', 'index.html'), 'utf8');
  const must = ['installErrorReporter', '__showBootError', 'Neutralino', 'contenteditable', 'bootError'];
  const miss = must.filter((m) => !html.includes(m));
  if (miss.length) throw new Error('打包内容缺失: ' + miss.join(', '));
  if (files.some((f) => /(^|\/)css\//.test(f) || /(^|\/)js\/store\.js$/.test(f) || /(^|\/)js\/app\.js$/.test(f)))
    throw new Error('包内仍存在 css/ 或 js/store|app.js 碎片，内联未生效');
  rmSync(tmp, { recursive: true, force: true });
  const exe = join(__dirname, 'dist', '墨页', '墨页-win_x64.exe');
  const neuSize = statSync(pkg).size;
  const exeSize = existsSync(exe) ? statSync(exe).size : 0;
  console.log('✔ 解包校验通过：单文件 html 含全部逻辑，无 css/js 碎片');
  console.log('   包内文件:', files.join(', '));
  console.log(`   体积 → exe ${(exeSize / 1024 / 1024).toFixed(2)} MB · resources.neu ${(neuSize / 1024).toFixed(0)} KB`);
  console.log('   总体积 ≈ ' + ((exeSize + neuSize) / 1024 / 1024).toFixed(2) + ' MB');
  // 写启动器
  const bat = join(__dirname, 'dist', '墨页', 'launch.bat');
  writeFileSync(bat,
    '@echo off\r\n' +
    'setlocal\r\n' +
    'for %%f in (*-win_x64.exe) do set EXE=%%f\r\n' +
    'if not defined EXE (echo ERROR: exe not found in this folder. & pause & exit /b 1)\r\n' +
    'if not exist resources.neu (echo ERROR: resources.neu missing - keep it next to the exe. & pause & exit /b 1)\r\n' +
    'start "" "%EXE%"\r\n' +
    'endlocal\r\n', 'utf8');
  console.log('✔ 已生成 dist/墨页/launch.bat');
}

(async () => {
  try {
    syntaxGate();
    const html = inline();
    assertNoExternalRefs(html);
    writeResources(html);
    neuBuild();
    fixDistName();
    await verifyPackage();
    console.log('\n✅ 构建完成，校验全部通过。');
  } catch (e) {
    console.error('\n❌ 构建失败:', e.message);
    process.exit(1);
  }
})();
