/* 插件清单与入口校验：确保每个插件的 plugin.json 合法、entry 文件存在、入口调用了 register。 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } }

function scan(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => { try { return statSync(join(dir, n)).isDirectory(); } catch (e) { return false; } });
}

function checkPlugin(base, builtin) {
  const mfPath = join(base, 'plugin.json');
  ok('存在 plugin.json: ' + base, existsSync(mfPath));
  if (!existsSync(mfPath)) return;
  let mf;
  try { mf = JSON.parse(readFileSync(mfPath, 'utf8')); } catch (e) { ok('plugin.json 合法 JSON: ' + base, false); return; }
  ok('有 id: ' + base, !!(mf.id && typeof mf.id === 'string'));
  ok('有 name: ' + base, !!mf.name);
  ok('有 description: ' + base, !!mf.description);
  ok('有 builtin 字段: ' + base, typeof mf.builtin === 'boolean');
  ok('builtin 标记正确: ' + base, mf.builtin === builtin);
  const entry = mf.entry || 'index.js';
  const entryAbs = join(base, entry);
  ok('入口文件存在: ' + entryAbs, existsSync(entryAbs));
  if (existsSync(entryAbs)) {
    const code = readFileSync(entryAbs, 'utf8');
    ok('入口调用 register: ' + entryAbs, code.includes('window.MoyePlugins.register('));
  }
}

// 内置插件
scan(join(ROOT, 'src', 'js', 'plugins')).forEach((n) => checkPlugin(join(ROOT, 'src', 'js', 'plugins', n), true));
// 用户示例插件
const userDir = join(ROOT, 'plugins');
if (existsSync(userDir)) scan(userDir).forEach((n) => checkPlugin(join(userDir, n), false));

console.log('插件校验：' + pass + ' 通过' + (fail ? (', ' + fail + ' 失败') : ''));
process.exit(fail ? 1 : 0);
