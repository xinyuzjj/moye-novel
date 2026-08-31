// 忠实模拟 Neutralino 存储层：真实 fs + Windows 盘符路径 + createDirectory 不自动建父目录
// 目的：捕获 mkdirp 对 C:/... 盘符路径的处理 bug（曾经把 C:/Users 拼成 C:Users 导致数据目录建不出来）
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const DRIVE = 'E:/小说软件/.ptmp';
function clean() { fs.rmSync(DRIVE, { recursive: true, force: true }); }
clean();

function makeSandbox(nlPath) {
  const sandbox = {
    console,
    setTimeout,
    Promise,
    clearTimeout,
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    Blob: function () {},
    document: undefined,
    indexedDB: undefined,
    window: nlPath ? { NL_PATH: nlPath } : {},
  };
  const docsDir = DRIVE + '/docs';
  const filesystem = {
    getStats: async (p) => {
      try {
        const s = fs.statSync(p);
        return { size: s.size, type: s.isDirectory() ? 'DIRECTORY' : 'FILE' };
      } catch (e) { throw new Error('not found: ' + p); }
    },
    // 关键：与 Neutralino 一致，不递归建父目录，父目录缺失则抛错
    createDirectory: async (p) => { fs.mkdirSync(p, { recursive: false }); },
    writeFile: async (p, data) => { fs.writeFileSync(p, data, 'utf8'); },
    readFile: async (p) => fs.readFileSync(p, 'utf8'),
    remove: async (p) => { fs.rmSync(p, { force: true }); },
  };
  sandbox.Neutralino = {
    os: {
      getPath: async (name) => (name === 'documents' ? docsDir : null),
      showSaveDialog: async (title, opts) => ({ filePath: path.join(DRIVE, 'export_' + title + '.txt') }),
      showOpenDialog: async () => [path.join(DRIVE, 'in.json')],
      open: async (p) => { sandbox.__opened = p; return true; },
    },
    filesystem,
  };
  sandbox.globalThis = sandbox;
  return sandbox;
}

function loadStore(sandbox) {
  let code = fs.readFileSync('src/js/store.js', 'utf8');
  code = code.replace('const Store =', 'globalThis.Store =');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.Store;
}

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name); }
}

async function run(label, nlPath, expectSubdir) {
  console.log('\n=== 场景：' + label + ' (NL_PATH=' + (nlPath || '(无)') + ') ===');
  clean();
  // 清掉可能由旧版测试桩残留的相对 ./data，避免污染断言
  fs.rmSync(path.join(process.cwd(), 'data'), { recursive: true, force: true });
  const sb = makeSandbox(nlPath);
  const Store = loadStore(sb);
  const db = { books: [{ id: 'b1', title: '测试小说', chapters: [{ id: 'c1', title: '第一章', content: '<p>你好世界</p>' }] }], settings: { theme: 'xuan' } };

  await Store.save(db);
  const dataFile = expectSubdir + '/novels.json';
  check('数据文件已落到预期目录 ' + dataFile, fs.existsSync(dataFile));
  const loaded = await Store.load();
  check('重新加载与原数据一致', !!loaded && loaded.books[0].title === '测试小说' && loaded.books[0].chapters[0].content.includes('你好世界'));

  // 导出（验证对话框对象返回路径也能写出）
  const p = await Store.exportText('a.md', '# 测试');
  check('导出写出成功', typeof p === 'string' && fs.existsSync(p));

  // 打开数据文件夹按钮
  const ok = await Store.openDataFolder();
  check('打开数据文件夹调用成功', ok === true && sb.__opened === expectSubdir);

  // 关键回归断言：不能落到不可靠的相对路径 ./data
  const cwdData = path.join(process.cwd(), 'data', 'novels.json');
  check('未误用相对 ./data（flaky 路径）', !fs.existsSync(cwdData));
  return sb;
}

(async () => {
  // A) 安装/便携版：exe 同级 data（window.NL_PATH 指向 C:/ 盘符路径）
  await run('exe 同级持久化', DRIVE + '/exe', DRIVE + '/exe/data');
  // B) 无 NL_PATH：兜底到 文档/墨页小说写作/data
  await run('文档目录兜底', null, DRIVE + '/docs/墨页小说写作/data');

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  clean();
  process.exit(fail ? 1 : 0);
})();
