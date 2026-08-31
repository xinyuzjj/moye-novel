/* 构建时生成内置插件清单。
 * Electron 打包成 app.asar 后，运行时用 fs.readdirSync 扫描 asar 内目录不可靠，
 * 因此在构建阶段把内置插件的元数据+入口脚本提前打包成单个 JSON 文件，
 * 主进程启动时直接读取该文件即可（单文件读取在 asar 内始终可用）。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = join(__dirname, '..', 'src', 'js', 'plugins');
const OUT_FILE = join(__dirname, '..', 'src', 'builtin-plugins.json');

function listDirs(dir) {
  try {
    return readdirSync(dir).filter((n) => {
      try { return statSync(join(dir, n)).isDirectory(); } catch (e) { return false; }
    });
  } catch (e) { return []; }
}

const out = [];
for (const name of listDirs(PLUGINS_DIR)) {
  const base = join(PLUGINS_DIR, name);
  const mfPath = join(base, 'plugin.json');
  try {
    const mf = JSON.parse(readFileSync(mfPath, 'utf8'));
    if (!mf.id) mf.id = name;
    const entryName = mf.entry || 'index.js';
    const entryText = readFileSync(join(base, entryName), 'utf8');
    out.push({ manifest: mf, location: 'builtin', entryText });
  } catch (e) {
    console.warn('[build-plugins-manifest] 跳过插件目录:', name, e.message);
  }
}

writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), 'utf8');
console.log(`[build-plugins-manifest] 已生成 ${OUT_FILE}，包含 ${out.length} 个内置插件`);
