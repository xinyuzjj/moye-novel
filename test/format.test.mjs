/* ===== 墨页 · 自动排版纯函数测试 ===== */
import F from '../lib/format.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n); } };
const eq = (n, a, b) => ok(n + '  (得到：' + JSON.stringify(a) + ')', a === b);

console.log('[测试] 自动排版（format.js）');

// 1. 标点全角
eq('半角逗号转全角', F.formatChapterText('你好,世界', { fullPunct: true }).trim(), '你好，世界');
eq('半角叹号转全角', F.formatChapterText('太棒了!', { fullPunct: true }).trim(), '太棒了！');
eq('半角问号转全角', F.formatChapterText('真的吗?', { fullPunct: true }).trim(), '真的吗？');
eq('半角冒号分号转全角', F.formatChapterText('他说:停;走', { fullPunct: true }).trim(), '他说：停；走');
eq('数字小数点不转全角', F.formatChapterText('面积是3.14平方米', { fullPunct: true }).trim(), '面积是3.14平方米');
eq('句末英文点转全角句号', F.formatChapterText('结束了.', { fullPunct: true }).trim(), '结束了。');

// 2. 中英文间加空格
eq('中文与英文间加空格', F.formatChapterText('他说hello世界', { spaceCN: true }).trim(), '他说 hello 世界');
eq('中文与数字间加空格', F.formatChapterText('第3章开始', { spaceCN: true }).trim(), '第 3 章开始');

// 3. 引号配对转全角
eq('双引号配对转全角', F.formatChapterText('他说"你好"', { fullQuote: true }).trim(), '他说“你好”');
eq('单引号配对转全角', F.formatChapterText("她说'晚安'", { fullQuote: true }).trim(), '她说‘晚安’');

// 4. 标点前误加空格去除
eq('中文标点前空格去除', F.formatChapterText('你好 ，世界', { fullPunct: true }).trim(), '你好，世界');

// 5. 行首尾空格 / 合并连续空格
eq('行内连续空格合并', F.formatChapterText('他    说', {}).trim(), '他 说');
eq('行首行尾空格去除', F.formatChapterText('  你好  ', {}).trim(), '你好');

// 6. 空行压缩（段落间只留一个空行）
eq('连续空行压缩为一个', F.formatChapterText('第一段\n\n\n\n第二段', {}), '第一段\n\n第二段');
eq('去除首尾空行', F.formatChapterText('\n\n第一段\n\n', {}), '第一段');

// 6.5 首行缩进两空格
const SP2 = '\u3000\u3000';
eq('每段首行补两全角空格', F.formatChapterText('第一段\n第二段', { indentFirst: true }), SP2 + '第一段\n' + SP2 + '第二段');
eq('非 indentFirst 时不加空格', F.formatChapterText('第一段\n第二段', {}), '第一段\n第二段');
eq('首行缩进与空行共存不误加', F.formatChapterText('第一段\n\n第二段', { indentFirst: true }), SP2 + '第一段\n\n' + SP2 + '第二段');
eq('首行缩进仅作用于非空段', F.formatChapterText('\n\n第一段', { indentFirst: true }), SP2 + '第一段');

// 7. 组合：一篇杂例
const sample = `林惊羽said: "let's go" ，  他在2024年写了3.5万字。\n\n\n下一章 开始。`;
const out = F.formatChapterText(sample, { spaceCN: true, fullPunct: true, fullQuote: true });
// 拆解断言关键片段
ok('组合：中英文加空格', out.includes('林惊羽 said'));
ok('组合：英文引号配对转全角且转义', out.includes('“') && out.includes('”'));
ok('组合：年份数字不破坏', out.includes('2024 年'));
ok('组合：小数点保留', out.includes('3.5 万'));
ok('组合：句号全角', out.includes('开始。'));
ok('组合：空行压缩', !out.includes('\n\n\n'));

// 8. 关闭所有选项时不破坏内容（仅做空行压缩/trim）
eq('全部关闭仅压缩空行', F.formatChapterText('a , b .\n\n\nc', {}).trim(), 'a , b .\n\nc');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;
