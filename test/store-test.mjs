/* 存储层仿真测试：用真实 fs 模拟 Neutralino filesystem / getPath / 对话框，
 * 验证 (1) 递归建目录后能落盘并读回 (2) 导出/备份/恢复在对话框返回 {filePath} 对象时也能工作。
 * 运行：node test/store-test.mjs   （可用 NO_NL_PATH=1 切到文档目录兜底场景） */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'moye-store-'));
const APPDIR = path.join(ROOT, 'app');
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(ROOT, 'out');
fs.mkdirSync(APPDIR, { recursive: true });
fs.mkdirSync(DOCS, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// NL_PATH 模拟 exe 所在目录（便携场景）；NO_NL_PATH=1 时退化为文档目录兜底
if (!process.env.NO_NL_PATH) globalThis.window = { NL_PATH: APPDIR.replace(/\\/g, '/') };
else globalThis.window = {};

const norm = (p) => String(p).replace(/\//g, path.sep);
const violations = [];
const DBG = (label, cond) => { if (!cond) violations.push(label); };
globalThis.Neutralino = {
  os: {
    // 真实签名：getPath(name:string)
    getPath: async (name) => {
      DBG('getPath 第一个参数必须是字符串', typeof name === 'string');
      return name === 'documents' ? DOCS.replace(/\\/g, '/') : null;
    },
    // 真实签名：showSaveDialog(title:string, options?:object) —— 必须 (title, options) 两个位置参数
    showSaveDialog: async (title, options) => {
      DBG('showSaveDialog 第一个参数必须是标题字符串', typeof title === 'string' && title.length > 0);
      DBG('showSaveDialog 第二个参数必须是 options 对象', options && typeof options === 'object' && Array.isArray(options.filters));
      return path.join(OUT, 'book.txt').replace(/\\/g, '/');
    },
    // 真实签名：showOpenDialog(title:string, options?:object)
    showOpenDialog: async (title, options) => {
      DBG('showOpenDialog 第一个参数必须是标题字符串', typeof title === 'string' && title.length > 0);
      DBG('showOpenDialog 第二个参数必须是 options 对象', options && typeof options === 'object' && Array.isArray(options.filters));
      return [path.join(OUT, 'in.json').replace(/\\/g, '/')];
    },
    // 真实签名：open(path:string) —— 打开数据文件夹用
    open: async (p) => { DBG('os.open 收到目录路径', typeof p === 'string' && p.length > 0); return true; },
  },
  filesystem: {
    getStats: async (p) => {
      const s = fs.statSync(norm(p));
      return { size: s.size, type: s.isDirectory() ? 'DIRECTORY' : 'FILE' };
    },
    createDirectory: async (p) => { fs.mkdirSync(norm(p), { recursive: false }); },
    writeFile: async (p, data) => { fs.writeFileSync(norm(p), data, 'utf8'); },
    readFile: async (p) => fs.readFileSync(norm(p), 'utf8'),
  },
};

const code = fs.readFileSync(new URL('../src/js/store.js', import.meta.url), 'utf8');
const Store = (new Function(code + '\n; return Store;'))();

const db = { books: [{ id: 'b1', title: '测试小说', chapters: [{ id: 'c1', title: '第一章', html: '<p>hello</p>' }] }] };

let pass = 0, fail = 0;
const check = (name, ok, extra) => { console.log((ok ? '✔ ' : '✘ ') + name + (extra ? '  ' + extra : '')); ok ? pass++ : fail++; };

// 1) 保存 → 数据目录被递归创建并落盘
await Store.save(db);
const dataDir = await Store.dataPathText();
const savedPath = path.join(norm(dataDir), 'novels.json');
check('数据目录已创建并落盘 novels.json', fs.existsSync(savedPath), dataDir);

// 2) 读回
const loaded = await Store.load();
check('读取数据可还原', !!loaded && loaded.books[0].title === '测试小说');

// 3) 导出：对话框返回 {filePath} 对象 → 归一化后写出，返回字符串路径
const ep = await Store.exportText('x.txt', '正文内容');
check('导出返回字符串路径（对象已归一化）', typeof ep === 'string', String(ep));
check('导出文件已生成', fs.existsSync(path.join(OUT, 'book.txt')));

// 4) 备份
const bp = await Store.backup(db);
check('备份返回字符串路径', typeof bp === 'string');

// 5) 恢复：对话框返回数组
fs.writeFileSync(path.join(OUT, 'in.json'), JSON.stringify(db));
const restored = await Store.restore();
check('从备份恢复可还原', !!restored && restored.books[0].title === '测试小说');

// 6) 打开数据文件夹：应调用 os.open(dir) 且返回 true
const opened = await Store.openDataFolder();
check('打开数据文件夹成功', opened === true);

// 7) 全部原生 API 调用都使用了正确签名
check('原生 API 调用签名全部正确', violations.length === 0, violations.length ? violations.join('；') : '');

console.log(`\n结果：${pass} 通过 / ${fail} 失败  （场景：${process.env.NO_NL_PATH ? '文档目录兜底' : 'exe 同级便携'}）`);
process.exit(fail ? 1 : 0);
