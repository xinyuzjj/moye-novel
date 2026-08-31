/* ===== 墨页 · 中文自动排版（纯函数，无 DOM 依赖，便于测试） =====
 * 规则（均可在 opts 中关闭）：
 *   - fullPunct：半角标点 , ; : ! ? . 转为中文全角（数字小数点 3.14 不转）
 *   - spaceCN  ：中文与英文字母/数字之间补一个空格
 *   - fullQuote：半角引号 " ' 配对转为中文全角 “” ‘’
 *   - indentFirst：每段首行前补两个全角空格（首行缩进两字符）
 * 段落级：去除行内首尾空格、合并连续空格、压缩连续空行（段落间只留一个空行）。
 */
(function (global) {
  'use strict';

  // CJK 汉字(一-鿿) + 中文标点(　-〿) + 全角符号(＀-￯)，统一用 \u 转义
  var RE_CJK = /[㐀-䶿一-鿿　-〿＀-￯]/;
  var CJK_CLASS = '㐀-䶿一-鿿　-〿＀-￯';
  var RE_LATIN = /[a-zA-Z0-9]/;

  function isCJK(ch) { return ch && RE_CJK.test(ch); }
  function isLatin(ch) { return ch && RE_LATIN.test(ch); }

  // 半角标点 -> 全角（数字内的小数点除外）
  function toFullPunct(s) {
    s = s.replace(/,/g, '，').replace(/;/g, '；').replace(/:/g, '：')
         .replace(/!/g, '！').replace(/\?/g, '？');
    // 句点只在中文语境转全角句号：其后为空白/结尾/中文或全角标点
    s = s.replace(/\.(?=\s|$|\u4e00-\u9fff\u3000-\u303f\uff00-\uffef|，|。|！|？|；|：|、)/g, '。');
    return s;
  }

  // 中文与拉丁字符之间补空格
  function addCnSpace(s) {
    s = s.replace(new RegExp('([' + CJK_CLASS + '])([a-zA-Z0-9])', 'g'), '$1 $2');
    s = s.replace(new RegExp('([a-zA-Z0-9])([' + CJK_CLASS + '])', 'g'), '$1 $2');
    return s;
  }

  // 半角引号配对转全角（" -> “” ，' -> ‘’）
  function toFullQuote(s) {
    var out = '', dq = 0, sq = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '"') { out += dq ? '”' : '“'; dq = !dq; }
      else if (ch === "'") { out += sq ? '’' : '‘'; sq = !sq; }
      else out += ch;
    }
    return out;
  }

  // 处理单行（不含换行）
  function formatLine(line, opts) {
    var s = (line || '').replace(/[ \t　]+/g, ' ');
    if (opts.fullPunct) s = toFullPunct(s);
    // 去掉中文标点前的误加空格
    s = s.replace(/\s+([，。！？；：、）】」』”…—])/g, '$1');
    if (opts.spaceCN) s = addCnSpace(s);
    if (opts.fullQuote) s = toFullQuote(s);
    s = s.replace(/[ \t]+/g, ' '); // 二次合并（加空格/引号可能产生双空格）
    return s.trim();
  }

  // 整章：按行排，压缩连续空行
  function formatChapterText(text, opts) {
    opts = opts || {};
    var raw = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
    var lines = raw.map(function (l) { return formatLine(l, opts); });
    var out = [], lastBlank = false;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l === '') {
        if (!lastBlank && out.length) { out.push(''); lastBlank = true; }
      } else {
        if (opts.indentFirst) l = '\u3000\u3000' + l; // 首行缩进两全角空格
        out.push(l); lastBlank = false;
      }
    }
    while (out.length && out[0] === '') out.shift();
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n');
  }

  var api = { formatLine: formatLine, formatChapterText: formatChapterText, toFullPunct: toFullPunct, addCnSpace: addCnSpace, toFullQuote: toFullQuote };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.MoyeFormat = api;
})(typeof window !== 'undefined' ? window : globalThis);
