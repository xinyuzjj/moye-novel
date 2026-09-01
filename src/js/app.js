/* ===== 墨页 · 小说写作 核心逻辑 ===== */
(function () {
  'use strict';

  const APP_VERSION = '2.4.4';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  function bootLog(msg) { if (window.__bootLog) window.__bootLog(msg); else try { console.log('[墨页启动]', msg); } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function withTimeout(promise, ms, fallback) {
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, ms);
      Promise.resolve(promise).then((v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } },
        () => { if (!done) { done = true; clearTimeout(t); resolve(fallback); } });
    });
  }
  function countWords(t) { return t ? t.replace(/\s/g, '').length : 0; }
  function dateKey(d) { const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function fmtTime(ts) { const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }

  const DEFAULT_SETTINGS = {
    theme: 'paper', fontSize: 18, lineHeight: 1.9, fontFamily: 'serif',
    editorWidth: 760, dailyGoal: 2000, autoSave: 0.8,
    indent: true, typewriter: false, snapshot: true,
    autoFormat: true, fmtSpace: true, fmtPunct: true, fmtQuote: true, fmtIndent: true,
    kbFolder: ''
  };
  const FONT_MAP = {
    serif: '"Songti SC","Noto Serif SC","Source Han Serif SC","SimSun",Georgia,serif',
    sans: '"PingFang SC","Microsoft YaHei UI","Hiragino Sans GB",sans-serif',
    kai: '"Kaiti SC","KaiTi","STKaiti","Songti SC",serif'
  };
  const NOTE_CAT = { character: '人物', world: '设定', plot: '情节', other: '其他' };

  /* ───────── 插件事件总线 ───────── */
  const pbus = {
    _m: {},
    on(ev, fn) { (this._m[ev] = this._m[ev] || []).push(fn); },
    off(ev, fn) { if (this._m[ev]) this._m[ev] = this._m[ev].filter((f) => f !== fn); },
    emit(ev) {
      const a = Array.prototype.slice.call(arguments, 1);
      (this._m[ev] || []).slice().forEach((f) => { try { f.apply(null, a); } catch (e) { console.error('[插件事件] ' + ev, e); } });
    }
  };
  function emitPlugin(ev, payload) { pbus.emit(ev, payload); }

  let db = null, S = null, curChapterId = null, editor = null;
  let saveTimer = null, dirty = false, saving = false;
  let lastSnapAt = 0, snapTimer = null;
  let editingNoteId = null, editingNoteCat = 'character';
  let findHits = [], findPos = -1, tocFilter = '';

  /* ───────── 写作计时（内置核心功能，非插件） ───────── */
  let timer = {
    running: false, sessionStart: 0, baseWords: 0,
    lastCommitAt: 0, lastCommitWords: 0,
    pomoMode: 'work', pomoEndAt: 0, workMin: 25, breakMin: 5, tickId: null
  };
  function fmtDur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return h + 'h' + String(m).padStart(2, '0') + 'm';
    return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }
  function timerElapsed() { return timer.running ? (Date.now() - timer.sessionStart) : 0; }
  function timerNewWords() { return Math.max(0, totalWordsNow() - timer.baseWords); }
  function timerSpeed() { const ms = timerElapsed(); return ms > 0 ? Math.round(timerNewWords() / (ms / 60000)) : 0; }
  function commitDaily() {
    if (!timer.running) return;
    const now = Date.now(), total = totalWordsNow();
    const dw = Math.max(0, total - timer.lastCommitWords);
    const tk = dateKey(new Date());
    db.timerDaily[tk] = db.timerDaily[tk] || { ms: 0, words: 0 };
    db.timerDaily[tk].ms += (now - timer.lastCommitAt);
    db.timerDaily[tk].words += dw;
    timer.lastCommitAt = now; timer.lastCommitWords = total;
  }
  function tickTimer() {
    if (!timer.running) return;
    commitDaily();
    if (timer.pomoEndAt && Date.now() >= timer.pomoEndAt) {
      if (timer.pomoMode === 'work') { timer.pomoMode = 'break'; timer.pomoEndAt = Date.now() + timer.breakMin * 60000; toast('番茄钟：专注结束，休息一下 ☕'); }
      else { timer.pomoMode = 'work'; timer.pomoEndAt = Date.now() + timer.workMin * 60000; toast('番茄钟：休息结束，继续写 ✍️'); }
    }
    updateTimerUI();
  }
  function startStopTimer() {
    if (timer.running) { commitDaily(); timer.running = false; }
    else {
      timer.running = true;
      timer.sessionStart = Date.now(); timer.baseWords = totalWordsNow();
      timer.lastCommitAt = Date.now(); timer.lastCommitWords = totalWordsNow();
      if (!timer.pomoEndAt) { timer.pomoMode = 'work'; timer.pomoEndAt = Date.now() + timer.workMin * 60000; }
    }
    if (!timer.tickId) timer.tickId = setInterval(tickTimer, 1000);
    updateTimerUI();
  }
  function resetPomo() {
    timer.pomoMode = 'work';
    timer.pomoEndAt = timer.running ? (Date.now() + timer.workMin * 60000) : 0;
    updateTimerUI();
  }
  function updateTimerUI() {
    const el = $('#stTimer');
    if (el) el.textContent = '⏱ ' + fmtDur(timerElapsed()) + ' · +' + timerNewWords() + ' 字';
    const s1 = $('#timerSessionTime'); if (s1) s1.textContent = fmtDur(timerElapsed());
    const s2 = $('#timerSessionWords'); if (s2) s2.textContent = '+' + timerNewWords() + ' 字';
    const s3 = $('#timerSpeed'); if (s3) s3.textContent = timerSpeed() + ' 字/分';
    const pomo = $('#timerPomo');
    if (pomo) {
      if (timer.running && timer.pomoEndAt) pomo.textContent = (timer.pomoMode === 'work' ? '专注 ' : '休息 ') + fmtDur(Math.max(0, timer.pomoEndAt - Date.now()));
      else pomo.textContent = timer.pomoMode === 'work' ? '专注待开始' : '休息待开始';
    }
    const today = $('#timerToday');
    if (today) { const tk = dateKey(new Date()); const c = db.timerDaily[tk] || { ms: 0, words: 0 }; today.textContent = '今日累计 ' + fmtDur(c.ms) + ' · +' + c.words + ' 字'; }
    const btn = $('#btnTimerStart'); if (btn) btn.textContent = timer.running ? '暂停计时' : '开始计时';
  }
  function initTimer() {
    timer.sessionStart = Date.now(); timer.baseWords = totalWordsNow();
    timer.lastCommitAt = Date.now(); timer.lastCommitWords = totalWordsNow();
    timer.running = true; timer.pomoMode = 'work'; timer.pomoEndAt = Date.now() + timer.workMin * 60000;
    if (!timer.tickId) timer.tickId = setInterval(tickTimer, 1000);
    updateTimerUI();
  }

  /* ───────── 启动错误浮层 ───────── */
  function installErrorReporter() {
    const overlay = $('#bootError'), msgEl = $('#bootErrorMsg'), hintEl = $('#bootErrorHint');
    const splash = $('#bootSplash'), splashText = $('#bootSplashText'), splashErr = $('#bootSplashErr'), splashHint = $('#bootSplashHint');
    function writeHint(nl, mode) {
      return '运行环境：Electron（mode=' + mode + '）<br><br>' +
        '若界面未能渲染，请尝试：<br>1) 重新从官网下载并运行 <b>墨页-setup.exe</b> 安装；<br>' +
        '2) 若被杀软拦截：把安装目录加入白名单后重试；<br>' +
        '3) 按 <b>F12</b> 打开开发者工具，查看 Console 里的红色报错并截图反馈。';
    }
    function showOnSplash(title, detail) {
      if (splashText) splashText.textContent = title || '启动失败';
      if (splashErr) { splashErr.hidden = false; splashErr.textContent = detail || ''; }
      if (splashHint) splashHint.innerHTML = writeHint(typeof Neutralino !== 'undefined', (typeof NL_MODE !== 'undefined' && NL_MODE) || window.NL_MODE || 'unknown');
    }
    window.__showBootError = function (title, detail) {
      showOnSplash(title, detail);
      if (overlay) {
        overlay.hidden = false;
        msgEl.textContent = String(title || '未知错误') + (detail ? '\n\n' + detail : '');
        hintEl.innerHTML = writeHint(typeof Neutralino !== 'undefined', (typeof NL_MODE !== 'undefined' && NL_MODE) || window.NL_MODE || 'unknown');
      }
      console.error('[墨页] ' + title, detail);
    };
    window.__hideBootSplash = function () {
      window.__moyeBootDone = true;
      if (splash) splash.style.display = 'none';
    };
    window.addEventListener('error', (e) => {
      window.__showBootError('页面脚本错误', (e.error && e.error.stack) || (e.message + (e.filename ? ' @ ' + e.filename + ':' + e.lineno : '')));
    });
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason; window.__showBootError('未处理的异步错误', (r && (r.stack || r.message)) || String(r));
    });
    setTimeout(() => {
      // Electron 下 window.electronAPI 一定存在；只有既不是 Electron、也不是 Neutralino、也没 NL_MODE 时才算真缺环境
      if (!window.__moyeBootDone && !window.electronAPI && typeof Neutralino === 'undefined' && !window.NL_MODE) {
        window.__showBootError('未检测到本地运行环境', '本软件需通过「墨页-setup.exe」安装后用桌面快捷方式启动，不能直接用浏览器打开 index.html。');
      }
    }, 3000);
  }

  /* ───────── 提示 ───────── */
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast'); if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
  }
  function setSaveState(st) {
    const el = $('#saveState'); if (!el) return;
    el.className = 'save-state' + (st === 'saving' ? ' saving' : '');
    el.textContent = st === 'saving' ? '保存中…' : (st === 'failed' ? '保存失败' : '已保存');
  }

  /* ───────── 数据模型 ───────── */
  function defaultBook(name) {
    const cid = uid();
    return {
      id: uid(), title: name || '我的小说', author: '', desc: '',
      volumes: [{ id: uid(), name: '正文', collapsed: false, chapters: [{ id: cid, title: '第一章', html: '', words: 0, updatedAt: Date.now(), snapshots: [] }] }],
      notes: [], outline: { outline: '', character: '', world: '', idea: '' },
      cards: { character: [], world: [], idea: [] },
      settings: Object.assign({}, DEFAULT_SETTINGS), today: { date: dateKey(new Date()), words: 0 }, history: {}
    };
  }
  function defaultDb() { return { books: [defaultBook()], activeId: null, dayBaseline: 0, today: null, plugins: {}, timerDaily: {} }; }
  function normalize(d) {
    if (!d.books || !d.books.length) d.books = [defaultBook()];
    d.plugins = (d.plugins && typeof d.plugins === 'object') ? d.plugins : {};
    d.timerDaily = (d.timerDaily && typeof d.timerDaily === 'object') ? d.timerDaily : {};
    d.books.forEach((b) => {
      b.volumes = b.volumes || [];
      b.notes = b.notes || [];
      b.outline = b.outline || { outline: '', character: '', world: '', idea: '' };
      b.cards = b.cards || { character: [], world: [], idea: [] };
      ['character', 'world', 'idea'].forEach((k) => {
        b.cards[k] = Array.isArray(b.cards[k]) ? b.cards[k] : [];
        // 旧版：这些 tab 是纯文本，升级时迁移成一张卡片，避免丢数据
        const oldText = b.outline[k];
        if (oldText && !b.cards[k].length) b.cards[k].push({ id: uid(), name: '', meta: '', desc: oldText, tags: [] });
        b.cards[k].forEach((c) => { c.id = c.id || uid(); c.tags = Array.isArray(c.tags) ? c.tags : []; });
      });
      b.settings = Object.assign({}, DEFAULT_SETTINGS, b.settings || {});
      b.volumes.forEach((v) => { v.chapters = v.chapters || []; v.chapters.forEach((c) => { c.snapshots = c.snapshots || []; }); });
      if (!b.today) b.today = { date: dateKey(new Date()), words: 0 };
      if (!b.history) b.history = {};
    });
    if (!d.activeId || !d.books.some((b) => b.id === d.activeId)) d.activeId = d.books[0].id;
    if (typeof d.dayBaseline !== 'number') d.dayBaseline = 0;
    return d;
  }
  function activeBook() { return db.books.find((b) => b.id === db.activeId) || db.books[0]; }
  function allChapters() {
    const b = activeBook(), r = [];
    b.volumes.forEach((v) => v.chapters.forEach((c) => { c._vol = v.name; r.push(c); }));
    return r;
  }
  function findChapter(id) {
    for (const b of db.books) for (const v of b.volumes) for (const c of v.chapters)
      if (c.id === id) return { book: b, vol: v, ch: c };
    return null;
  }
  function bookWords(b) { let n = 0; b.volumes.forEach((v) => v.chapters.forEach((c) => n += (c.words || 0))); return n; }
  function totalWordsNow() { return db.books.reduce((s, b) => s + bookWords(b), 0); }

  /* ───────── 持久化 ───────── */
  async function saveNow() {
    if (saving) return;
    saving = true; setSaveState('saving');
    try {
      await Store.save(db);
      dirty = false; setSaveState('saved');
      emitPlugin('save', { book: db.activeId });
    } catch (e) {
      setSaveState('failed');
      console.error('save failed', e);
    } finally { saving = false; }
  }
  function scheduleSave() {
    dirty = true; setSaveState('saving'); clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveNow().then(updateGoal).catch(() => {}), (S.autoSave || 0.8) * 1000);
  }
  function flushChapter() {
    const f = findChapter(curChapterId);
    if (f && editor) { f.ch.html = editor.innerHTML; f.ch.words = countWords(editor.textContent); f.ch.updatedAt = Date.now(); }
  }

  /* ───────── 自动排版 ───────── */
  function fmtOpts() { return { spaceCN: !!S.fmtSpace, fullPunct: !!S.fmtPunct, fullQuote: !!S.fmtQuote, indentFirst: !!S.fmtIndent }; }
  function formattedToHtml(text) {
    const parts = String(text || '').split('\n').map((p) => p === '' ? '<div><br></div>' : '<div>' + esc(p) + '</div>');
    return parts.length ? parts.join('') : '<div><br></div>';
  }
  function setCursorToEnd(el) {
    try {
      el.focus();
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    } catch (e) {}
  }
  function formatCurrentChapter(manual) {
    if (!editor) return;
    const f = findChapter(curChapterId);
    if (!f) { if (manual) toast('请先选择一个章节'); return; }
    const before = editor.innerText || '';
    const norm = before.replace(/\r/g, '');
    const fmt = (window.MoyeFormat ? window.MoyeFormat.formatChapterText(before, fmtOpts()) : norm);
    if (fmt === norm) { if (manual) toast('当前章节无需排版'); return; }
    editor.innerHTML = formattedToHtml(fmt);
    setCursorToEnd(editor);
    f.ch.html = editor.innerHTML; f.ch.words = countWords(editor.textContent); f.ch.updatedAt = Date.now();
    markNonEmpty(); updateWordsLive(); updateGoal();
    if (manual) toast('已自动排版');
    scheduleSave();
  }

  /* ───────── 字数 / 目标 ───────── */
  function updateGoal() {
    const tk = dateKey(new Date());
    if (!db.today || db.today.date !== tk) {
      db.today = { date: tk, words: 0 };
      db.dayBaseline = totalWordsNow();
    }
    const written = Math.max(0, totalWordsNow() - (db.dayBaseline || 0));
    db.today.words = written;
    db.activeId && (activeBook().today = db.today);
    activeBook().history[tk] = written;
    const goal = S.dailyGoal || 2000;
    const pct = Math.min(100, Math.round((written / goal) * 100));
    const g = $('#stGoal'); if (g) g.textContent = '今日 ' + written + ' / ' + goal;
    const fill = $('#goalFill'); if (fill) fill.style.width = pct + '%';
    const t = $('#stTotal'); if (t) t.textContent = '全书 ' + totalWordsNow() + ' 字';
  }
  function updateWordsLive() {
    const f = findChapter(curChapterId);
    const w = f ? (f.ch.words || 0) : 0;
    const el = $('#stWords'); if (el) el.textContent = w + ' 字';
  }

  /* ───────── 目录树 ───────── */
  function renderTOC() {
    const tree = $('#tocTree'); if (!tree) return;
    const b = activeBook();
    const q = (tocFilter || '').trim().toLowerCase();
    tree.innerHTML = '';
    let shownCh = 0;
    b.volumes.forEach((v) => {
      const chs = v.chapters.filter((c) => !q || (c.title || '').toLowerCase().includes(q));
      if (q && chs.length === 0) return;
      const vol = document.createElement('div'); vol.className = 'toc-volume'; vol.dataset.id = v.id;
      const row = document.createElement('div'); row.className = 'row'; row.draggable = true; row.dataset.type = 'volume'; row.dataset.id = v.id;
      row.innerHTML = '<span class="vol-name">' + esc(v.name) + '</span>' +
        '<span class="vol-tools">' +
        '<button class="row-btn" data-act="rename-vol" data-id="' + v.id + '">改名</button>' +
        '<button class="row-btn" data-act="del-vol" data-id="' + v.id + '">删</button></span>';
      vol.appendChild(row);
      const list = document.createElement('div'); list.className = 'toc-chapters';
      chs.forEach((c) => {
        shownCh++;
        const item = document.createElement('div');
        item.className = 'toc-chapter' + (c.id === curChapterId ? ' selected' : '');
        item.draggable = true; item.dataset.type = 'chapter'; item.dataset.id = c.id;
        item.innerHTML = '<span class="ch-title">' + esc(c.title || '未命名') + '</span>' +
          '<span class="ch-words">' + (c.words || 0) + '</span>';
        list.appendChild(item);
      });
      vol.appendChild(list);
      tree.appendChild(vol);
    });
    if (shownCh === 0 && !q) tree.innerHTML = '<div class="empty-tip">还没有章节<br>点上方「＋ 章节」开始写</div>';
    else if (shownCh === 0) tree.innerHTML = '<div class="empty-tip">没有匹配「' + esc(tocFilter) + '」的章节</div>';
    const foot = $('#tocFoot'); if (foot) foot.textContent = '共 ' + allChapters().length + ' 章 · ' + bookWords(b) + ' 字';
  }
  function highlightTOC() {
    $$('.toc-chapter').forEach((el) => el.classList.toggle('selected', el.dataset.id === curChapterId));
  }

  /* ───────── 章节操作 ───────── */
  function selectChapter(id) {
    if (curChapterId && id !== curChapterId) flushChapter();
    const f = findChapter(id); if (!f) return;
    curChapterId = id;
    editor.innerHTML = f.ch.html || '';
    $('#chapterTitle').value = f.ch.title || '';
    markNonEmpty();
    highlightTOC();
    const st = $('#stChapter'); if (st) st.textContent = (f.vol.name ? f.vol.name + ' / ' : '') + (f.ch.title || '未命名');
    updateWordsLive(); updateCursorInfo();
    emitPlugin('chapterChange', { id, chapter: f.ch });
  }
  function newChapter() {
    const b = activeBook();
    let vol = b.volumes[b.volumes.length - 1];
    if (!vol) { vol = { id: uid(), name: '正文', collapsed: false, chapters: [] }; b.volumes.push(vol); }
    const c = { id: uid(), title: '新章节', html: '', words: 0, updatedAt: Date.now(), snapshots: [] };
    vol.chapters.push(c);
    renderTOC(); selectChapter(c.id); scheduleSave(); updateGoal();
    const t = $('#chapterTitle'); if (t) { t.focus(); t.select(); }
  }
  function newVolume() {
    const b = activeBook();
    const v = { id: uid(), name: '新分卷', collapsed: false, chapters: [] };
    b.volumes.push(v);
    renderTOC(); scheduleSave(); toast('已新建分卷');
  }
  async function deleteChapter(id) {
    const f = findChapter(id); if (!f) return;
    if (!(await Store.confirm('确定删除章节「' + (f.ch.title || '未命名') + '」？此操作不可撤销。'))) return;
    const idx = f.vol.chapters.indexOf(f.ch);
    if (idx >= 0) f.vol.chapters.splice(idx, 1);
    if (f.vol.chapters.length === 0 && f.book.volumes.length > 1) {
      const vi = f.book.volumes.indexOf(f.vol); if (vi >= 0) f.book.volumes.splice(vi, 1);
    }
    if (curChapterId === id) {
      curChapterId = null; const next = allChapters()[0];
      if (next) selectChapter(next.id); else { editor.innerHTML = ''; $('#chapterTitle').value = ''; markNonEmpty(); }
    }
    renderTOC(); scheduleSave(); updateGoal();
  }
  async function deleteVolume(id) {
    const b = activeBook(); const v = b.volumes.find((x) => x.id === id);
    if (!v) return;
    if (v.chapters.length && !(await Store.confirm('分卷「' + v.name + '」内含 ' + v.chapters.length + ' 章，确定删除？'))) return;
    const vi = b.volumes.indexOf(v); if (vi >= 0) b.volumes.splice(vi, 1);
    if (b.volumes.length === 0) b.volumes.push({ id: uid(), name: '正文', collapsed: false, chapters: [] });
    renderTOC(); scheduleSave();
  }

  /* ───────── 拖拽排序 ───────── */
  let dragInfo = null;
  function onDragStart(e) {
    const el = e.target.closest('[data-type]'); if (!el) return;
    dragInfo = { type: el.dataset.type, id: el.dataset.id };
    try { e.dataTransfer.setData('text/plain', dragInfo.id); } catch (x) {}
  }
  function onDragOver(e) { e.preventDefault(); const el = e.target.closest('.toc-chapter,.toc-volume'); if (el) el.classList.add('drag-over'); }
  function onDragLeave(e) { const el = e.target.closest('.toc-chapter,.toc-volume'); if (el) el.classList.remove('drag-over'); }
  function onDrop(e) {
    e.preventDefault();
    $$('.drag-over').forEach((x) => x.classList.remove('drag-over'));
    if (!dragInfo) return;
    const target = e.target.closest('.toc-chapter,.toc-volume'); if (!target) return;
    try {
      if (dragInfo.type === 'chapter') moveChapter(dragInfo.id, target.dataset.id, target.dataset.type);
      else if (dragInfo.type === 'volume') moveVolume(dragInfo.id, target.dataset.id);
      renderTOC(); if (curChapterId) highlightTOC(); scheduleSave();
    } catch (err) { console.error(err); }
    dragInfo = null;
  }
  function extractChapter(id) {
    for (const b of db.books) for (let i = 0; i < b.volumes.length; i++) {
      const vi = b.volumes[i].chapters.findIndex((c) => c.id === id);
      if (vi >= 0) { const [c] = b.volumes[i].chapters.splice(vi, 1); return { ch: c, book: b, volIdx: i }; }
    }
    return null;
  }
  function moveChapter(id, targetId, targetType) {
    const ex = extractChapter(id); if (!ex) return;
    const b = activeBook();
    if (targetType === 'chapter') {
      const tf = findChapter(targetId); if (!tf) { b.volumes[b.volumes.length - 1].chapters.push(ex.ch); return; }
      const ti = tf.vol.chapters.findIndex((c) => c.id === targetId);
      tf.vol.chapters.splice(ti, 0, ex.ch);
    } else if (targetType === 'volume') {
      const v = b.volumes.find((x) => x.id === targetId); if (v) v.chapters.push(ex.ch); else b.volumes[0].chapters.push(ex.ch);
    }
  }
  function moveVolume(id, targetId) {
    const b = activeBook(); const from = b.volumes.findIndex((v) => v.id === id);
    if (from < 0) return; const [v] = b.volumes.splice(from, 1);
    const to = b.volumes.findIndex((x) => x.id === targetId);
    if (to < 0) b.volumes.push(v); else b.volumes.splice(to < from ? to : to, 0, v);
  }

  /* ───────── 素材 ───────── */
  function renderNotes() {
    const list = $('#noteList'); if (!list) return;
    const b = activeBook();
    list.innerHTML = '';
    if (!b.notes.length) { list.innerHTML = '<div class="empty-tip">还没有素材<br>点「＋ 新建素材」记录人物、设定、灵感</div>'; return; }
    b.notes.forEach((n) => {
      const card = document.createElement('div'); card.className = 'note-card'; card.dataset.id = n.id;
      card.innerHTML = '<div class="nc-title"><span>' + esc(n.title || '未命名') + '</span><span class="nc-cat">' + (NOTE_CAT[n.cat] || '其他') + '</span></div>' +
        '<div class="nc-body">' + esc(n.body || '') + '</div>';
      list.appendChild(card);
    });
  }
  function openNote(id) {
    const b = activeBook(); const n = b.notes.find((x) => x.id === id);
    if (!n) { // 新建
      editingNoteId = null; editingNoteCat = 'character';
      $('#noteTitle').value = ''; $('#noteBody').value = ''; setSeg('noteCat', 'character');
    } else {
      editingNoteId = n.id; editingNoteCat = n.cat;
      $('#noteTitle').value = n.title || ''; $('#noteBody').value = n.body || ''; setSeg('noteCat', n.cat);
    }
    openDrawer('noteDrawer');
  }
  function saveNote() {
    const b = activeBook();
    const title = $('#noteTitle').value.trim(); const body = $('#noteBody').value;
    if (!title && !body.trim()) { closeDrawer('noteDrawer'); return; }
    if (editingNoteId) {
      const n = b.notes.find((x) => x.id === editingNoteId);
      if (n) { n.title = title; n.body = body; n.cat = editingNoteCat; n.updatedAt = Date.now(); }
    } else {
      b.notes.push({ id: uid(), title, body, cat: editingNoteCat, updatedAt: Date.now() });
    }
    renderNotes(); closeDrawer('noteDrawer'); scheduleSave();
  }
  async function deleteNote() {
    if (!editingNoteId) { closeDrawer('noteDrawer'); return; }
    const b = activeBook(); const i = b.notes.findIndex((x) => x.id === editingNoteId);
    if (i >= 0) b.notes.splice(i, 1);
    renderNotes(); closeDrawer('noteDrawer'); scheduleSave();
  }

  /* ───────── 统计 ───────── */
  function renderStats() {
    const body = $('#statsBody'); if (!body) return;
    const b = activeBook();
    const tk = dateKey(new Date());
    const days = [];
    for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = dateKey(d); days.push({ k, w: b.history[k] || 0 }); }
    const maxW = Math.max(1, ...days.map((d) => d.w));
    const goal = S.dailyGoal || 2000;
    const heat = days.map((d) => {
      let lvl = 0; if (d.w > 0) lvl = 1; if (d.w >= goal * 0.3) lvl = 2; if (d.w >= goal * 0.6) lvl = 3; if (d.w >= goal) lvl = 4;
      return '<div class="heat-cell lvl' + lvl + '" data-tip="' + d.k + '：' + d.w + ' 字"></div>';
    }).join('');
    const bars = days.map((d) => '<div class="bar-col"><div class="bar" style="height:' + Math.round((d.w / maxW) * 90) + 'px"></div><div>' + d.k.slice(5) + '</div></div>').join('');
    body.innerHTML =
      '<div class="stat-block"><h4>全书字数</h4><div class="stat-bignum">' + totalWordsNow() + ' 字</div></div>' +
      '<div class="stat-block"><h4>近 14 天码字热力</h4><div class="heatmap">' + heat + '</div></div>' +
      '<div class="stat-block"><h4>近 14 天柱状</h4><div class="barchart">' + bars + '</div></div>' +
      '<div class="stat-block"><h4>今日进度</h4><div>已写 ' + (db.today ? db.today.words : 0) + ' / ' + goal + ' 字</div></div>';
  }

  /* ───────── 资料栏（现为知识库栏） ───────── */
  function renderOutlinePanel() { renderKb(); }

  function updateOutlineCount() {
    const c = $('#kbCount'); if (!c) return;
    const n = kbFiles.length;
    c.textContent = n ? n + ' 篇笔记' : '知识库';
  }

  let kbFiles = [], kbRoot = '', kbOpenRel = '';
  const KB_COLLAPSE_KEY = 'kbCollapsedFolders';

  async function renderKb() {
    const label = $('#kbFolderLabel'), list = $('#kbList'), connect = $('#kbConnect'), switchBtn = $('#kbSwitch'), bar = $('.kb-toolbar');
    if (!label || !list) return;
    kbRoot = (S && S.kbFolder) || '';
    showKbList();
    if (!kbRoot) {
      label.textContent = '未连接知识库'; label.title = '';
      label.classList.add('empty');
      if (connect) connect.hidden = false;
      if (switchBtn) switchBtn.hidden = true;
      if (bar) bar.classList.add('disconnected');
      list.innerHTML = '<div class="empty-tip">点「连接文件夹」选择 Obsidian 库<br>或任意 .md 笔记文件夹</div>';
      kbFiles = []; updateOutlineCount(); return;
    }
    if (connect) connect.hidden = true;
    if (switchBtn) switchBtn.hidden = false;
    if (bar) bar.classList.remove('disconnected');
    label.classList.remove('empty');
    label.textContent = shortPath(kbRoot); label.title = kbRoot;
    list.innerHTML = '<div class="empty-tip">正在读取…</div>';
    try {
      const r = await window.electronAPI.kbList(kbRoot);
      if (!r || !r.ok) { list.innerHTML = '<div class="empty-tip">读取失败：' + esc((r && r.error) || '未知错误') + '</div>'; kbFiles = []; updateOutlineCount(); return; }
      kbFiles = r.files || [];
      if (r.capped) toast('笔记过多，仅显示前 ' + r.files.length + ' 篇');
      renderKbList();
    } catch (e) {
      list.innerHTML = '<div class="empty-tip">读取异常：' + esc(e.message || '') + '</div>'; kbFiles = [];
    }
    updateOutlineCount();
  }
  function shortPath(p) {
    if (!p) return '';
    const parts = p.split(/[\\/]/); return parts.length > 2 ? parts.slice(-2).join('/') : p;
  }
  function kbCollapsedFolders() {
    try { return JSON.parse(localStorage.getItem(KB_COLLAPSE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function kbToggleFolder(name) {
    const s = kbCollapsedFolders(); s[name] = !s[name]; localStorage.setItem(KB_COLLAPSE_KEY, JSON.stringify(s));
  }
  function kbFolderKey(rel) {
    const i = rel.lastIndexOf('/'); return i >= 0 ? rel.slice(0, i) : '(根目录)';
  }
  function renderKbList() {
    const list = $('#kbList'); if (!list) return;
    if (!kbRoot) { list.innerHTML = '<div class="empty-tip">点「连接文件夹」选择 Obsidian 库<br>或任意 .md 笔记文件夹</div>'; return; }
    if (!kbFiles.length) { list.innerHTML = '<div class="empty-tip">该文件夹下没有 .md 笔记</div>'; return; }
    const collapsed = kbCollapsedFolders();
    const groups = {};
    kbFiles.forEach((f) => { const k = kbFolderKey(f.rel); (groups[k] = groups[k] || []).push(f); });
    const order = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    let html = '';
    order.forEach((folder) => {
      const isRoot = folder === '(根目录)';
      const folded = !!collapsed[folder];
      const display = isRoot ? '根目录' : folder.replace(/\//g, ' / ');
      html += '<div class="kb-folder-group">' +
        '<div class="kb-folder-title ' + (folded ? 'collapsed' : '') + '" data-folder="' + esc(folder) + '">' + esc(display) + ' <span class="muted">(' + groups[folder].length + ')</span></div>' +
        '<div class="kb-folder-items" ' + (folded ? 'hidden' : '') + '>' +
        groups[folder].map((f) => '<div class="kb-item' + (kbOpenRel === f.rel ? ' active' : '') + '" data-rel="' + esc(f.rel) + '"><div class="kb-item-name">' + esc(f.name) + '</div></div>').join('') +
        '</div></div>';
    });
    list.innerHTML = html;
  }

  function showKbList() { const l = $('#kbList'), v = $('#kbView'); if (l) l.hidden = false; if (v) v.hidden = true; }
  function showKbView() { const l = $('#kbList'), v = $('#kbView'); if (l) l.hidden = true; if (v) v.hidden = false; }

  async function kbOpenItem(rel) {
    const f = kbFiles.find((x) => x.rel === rel); if (!f) return;
    kbOpenRel = rel;
    renderKbList(); // 刷新 active 高亮
    const titleEl = $('#kbViewTitle'), body = $('#kbViewBody');
    if (titleEl) titleEl.textContent = f.name;
    if (body) body.innerHTML = '<div class="empty-tip">加载中…</div>';
    showKbView();
    if (!kbRoot) { if (body) body.innerHTML = '<div class="empty-tip">未连接外部知识库文件夹</div>'; return; }
    try {
      const r = await window.electronAPI.kbRead({ dir: kbRoot, rel });
      if (!r || !r.ok) { if (body) body.innerHTML = '<div class="empty-tip">读取失败：' + esc((r && r.error) || '') + '</div>'; return; }
      if (body) body.innerHTML = renderMarkdown(r.content);
    } catch (e) {
      if (body) body.innerHTML = '<div class="empty-tip">读取异常：' + esc(e.message || '') + '</div>';
    }
  }

  // 轻量 Markdown → HTML（安全转义，避免笔记内容注入）
  function renderMarkdown(md) {
    if (!md) return '';
    const lines = md.replace(/\r\n?/g, '\n').split('\n');
    let html = '', i = 0;
    function inline(s) {
      s = esc(s);
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
      s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
      s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      return s;
    }
    function isBlockStart(idx) {
      const l = lines[idx];
      return /^(#{1,6})\s/.test(l) || /^---+$/.test(l) || /^>\s?/.test(l) || /^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l) || /^```/.test(l) || /^\|/.test(l) || l.trim() === '';
    }
    function parseTable(start) {
      const rows = [];
      let j = start;
      while (j < lines.length && /^\|/.test(lines[j])) { rows.push(lines[j]); j++; }
      if (rows.length < 2) return null;
      const header = rows[0].split('|').map((c) => c.trim()).filter((_, idx, arr) => idx !== 0 && idx !== arr.length - 1);
      const align = rows[1].split('|').map((c) => c.trim()).filter((_, idx, arr) => idx !== 0 && idx !== arr.length - 1).map((c) => {
        if (/^:-+:$/.test(c)) return 'center';
        if (/^-+:$/.test(c)) return 'right';
        return 'left';
      });
      if (header.length === 0) return null;
      const body = rows.slice(2).map((r) => r.split('|').map((c) => c.trim()).filter((_, idx, arr) => idx !== 0 && idx !== arr.length - 1));
      let h = '<thead><tr>' + header.map((c, idx) => '<th style="text-align:' + (align[idx] || 'left') + '">' + inline(c) + '</th>').join('') + '</tr></thead>';
      let b = '<tbody>' + body.map((r) => '<tr>' + r.map((c, idx) => '<td style="text-align:' + (align[idx] || 'left') + '">' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody>';
      return { html: '<table class="md-table">' + h + b + '</table>', next: j };
    }
    while (i < lines.length) {
      const ln = lines[i];
      const h = ln.match(/^(#{1,6})\s+(.*)$/);
      if (h) { const lvl = h[1].length; html += '<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>'; i++; continue; }
      if (/^---+$/.test(ln)) { html += '<hr>'; i++; continue; }
      if (/^```/.test(ln)) {
        const lang = ln.slice(3).trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(esc(lines[i])); i++; }
        html += '<pre><code' + (lang ? ' class="lang-' + esc(lang) + '"' : '') + '>' + buf.join('\n') + '</code></pre>';
        if (i < lines.length && /^```/.test(lines[i])) i++;
        continue;
      }
      if (/^\|/.test(ln)) {
        const t = parseTable(i);
        if (t) { html += t.html; i = t.next; continue; }
      }
      if (/^>\s?/.test(ln)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(inline(lines[i].replace(/^>\s?/, ''))); i++; }
        html += '<blockquote>' + buf.join('<br>') + '</blockquote>'; continue;
      }
      if (/^\s*[-*]\s+/.test(ln)) {
        const buf = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          const raw = lines[i].replace(/^\s*[-*]\s+/, '');
          const task = raw.match(/^\[([ x])\]\s+(.*)$/i);
          if (task) {
            const checked = task[1].toLowerCase() === 'x' ? ' checked' : '';
            buf.push('<li><label class="task-label"><input type="checkbox" disabled' + checked + '> ' + inline(task[2]) + '</label></li>');
          } else {
            buf.push('<li>' + inline(raw) + '</li>');
          }
          i++;
        }
        html += '<ul>' + buf.join('') + '</ul>'; continue;
      }
      if (/^\s*\d+\.\s+/.test(ln)) {
        const buf = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { buf.push('<li>' + inline(lines[i].replace(/^\s*\d+\.\s+/, '')) + '</li>'); i++; }
        html += '<ol>' + buf.join('') + '</ol>'; continue;
      }
      if (ln.trim() === '') { i++; continue; }
      const buf = [];
      while (i < lines.length && !isBlockStart(i)) { buf.push(inline(lines[i])); i++; }
      html += '<p>' + buf.join('<br>') + '</p>';
    }
    return html;
  }

  /* ───────── 历史快照 ───────── */
  function startSnapTimer() {
    clearInterval(snapTimer);
    snapTimer = setInterval(() => {
      const f = findChapter(curChapterId); if (!f) return;
      const tk = Date.now();
      if (tk - lastSnapAt < 5 * 60 * 1000) return;
      lastSnapAt = tk;
      f.ch.snapshots = f.ch.snapshots || [];
      f.ch.snapshots.unshift({ t: tk, html: f.ch.html || '', words: f.ch.words || 0 });
      if (f.ch.snapshots.length > 30) f.ch.snapshots.length = 30;
      scheduleSave();
    }, 30 * 1000);
  }
  function renderHistory() {
    const list = $('#historyList'); if (!list) return;
    const f = findChapter(curChapterId); if (!f) { list.innerHTML = '<div class="empty-tip">未选择章节</div>'; return; }
    const snaps = f.ch.snapshots || [];
    if (!snaps.length) { list.innerHTML = '<div class="empty-tip">暂无历史快照<br>每 5 分钟自动保存一次</div>'; return; }
    list.innerHTML = '';
    snaps.forEach((s, i) => {
      const row = document.createElement('div'); row.className = 'hist-item';
      row.innerHTML = '<div><div class="hi-time">' + fmtTime(s.t) + '</div><div class="hi-words">' + (s.words || 0) + ' 字</div></div>' +
        '<button data-i="' + i + '">恢复</button>';
      list.appendChild(row);
    });
  }
  function restoreSnapshot(i) {
    const f = findChapter(curChapterId); if (!f || !f.ch.snapshots || !f.ch.snapshots[i]) return;
    f.ch.html = f.ch.snapshots[i].html; f.ch.words = f.ch.snapshots[i].words || countWords(f.ch.html);
    selectChapter(curChapterId); scheduleSave(); toast('已恢复到该版本');
  }

  /* ───────── 导出 / 备份 ───────── */
  function safeName(name) {
    return String(name || '未命名')
      .replace(/[\\/:*?"<>|\r\n\t]+/g, '_')
      .replace(/^\.+/, '').trim().slice(0, 80) || '未命名';
  }
  function htmlToPlain(html) {
    if (!html) return '';
    let s = String(html)
      .replace(/<br\s*\/?>(?=\s|<)/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6])>/gi, '\n')
      .replace(/<(p|div|h[1-6])[^>]*>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
    return s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  }
  function htmlToMd(html) {
    if (!html) return '';
    let s = String(html)
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n')
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n')
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n')
      .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n')
      .replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n')
      .replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div)>/gi, '\n')
      .replace(/<(p|div)[^>]*>/gi, '')
      .replace(/<(strong|b)[^>]*>(.*?)<\/(strong|b)>/gi, '**$2**')
      .replace(/<(em|i)[^>]*>(.*?)<\/(em|i)>/gi, '*$2*')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
    return s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  }
  function bookToText(b, md) {
    let out = md ? ('# ' + (b.title || '未命名') + '\n\n') : ((b.title || '未命名') + '\n\n');
    if (b.author) out += (md ? '> 作者：' : '作者：') + b.author + '\n\n';
    b.volumes.forEach((v) => {
      out += (md ? '## ' : '') + (v.name || '未命名') + '\n\n';
      v.chapters.forEach((c) => {
        out += (md ? '### ' : '') + (c.title || '未命名') + '\n\n';
        out += (md ? htmlToMd(c.html) : htmlToPlain(c.html)) + '\n\n';
      });
    });
    return out.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  function reportExport(r, label) {
    if (r === null) { toast('已取消导出'); return; }
    if (!r) { toast(label + ' 导出失败'); return; }
    const name = String(r).split(/[\\/]/).pop() || r;
    toast('已导出' + label + '：' + name);
  }
  async function doExport(act) {
    const b = activeBook();
    if (act === 'export-book-txt') {
      reportExport(await Store.exportText(safeName(b.title) + '.txt', bookToText(b, false)), '全书 TXT');
    } else if (act === 'export-book-md') {
      reportExport(await Store.exportText(safeName(b.title) + '.md', bookToText(b, true)), '全书 Markdown');
    } else if (act === 'export-chapter-txt') {
      const f = findChapter(curChapterId);
      if (!f) { toast('请先选择章节'); return closePopup(); }
      reportExport(await Store.exportText(safeName(f.ch.title || '未命名') + '.txt', htmlToPlain(f.ch.html)), '本章 TXT');
    } else if (act === 'export-chapter-md') {
      const f = findChapter(curChapterId);
      if (!f) { toast('请先选择章节'); return closePopup(); }
      reportExport(await Store.exportText(safeName(f.ch.title || '未命名') + '.md', htmlToMd(f.ch.html)), '本章 Markdown');
    } else if (act === 'export-all-txt') {
      const all = db.books.map((bk) => bookToText(bk, false)).join('\n\n');
      reportExport(await Store.exportText(safeName('墨页-全部作品') + '.txt', all), '全部作品 TXT');
    } else if (act === 'export-all-md') {
      const all = db.books.map((bk) => bookToText(bk, true)).join('\n\n');
      reportExport(await Store.exportText(safeName('墨页-全部作品') + '.md', all), '全部作品 Markdown');
    } else if (act === 'backup') {
      const r = await Store.backup(db);
      if (r === null) toast('已取消备份');
      else if (r) toast('已备份：' + String(r).split(/[\\/]/).pop());
      else toast('备份失败');
    } else if (act === 'restore') {
      const data = await Store.restore();
      if (data) { db = normalize(Object.assign(defaultDb(), data)); S = activeBook().settings; applySettings(); renderAll(); scheduleSave(); toast('已从备份恢复'); }
      else toast('恢复已取消或文件无效');
    }
    closePopup();
  }

  /* ───────── 查找替换 ───────── */
  function getTextNodes(root) {
    const out = []; const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n; while ((n = walk.nextNode())) { if (n.nodeValue && n.nodeValue.trim()) out.push(n); }
    return out;
  }
  function buildHits(q) {
    findHits = []; if (!q) return;
    const lower = q.toLowerCase(); const nodes = getTextNodes(editor);
    nodes.forEach((node) => {
      const low = node.nodeValue.toLowerCase(); let idx = 0;
      while ((idx = low.indexOf(lower, idx)) !== -1) { findHits.push({ node, start: idx, end: idx + q.length }); idx += q.length; }
    });
    findPos = findHits.length ? 0 : -1;
  }
  function showHit() {
    if (findPos < 0 || !findHits[findPos]) return;
    const h = findHits[findPos]; const r = document.createRange();
    r.setStart(h.node, h.start); r.setEnd(h.node, h.end);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    try { h.node.parentElement.scrollIntoView({ block: 'center' }); } catch (e) {}
  }
  function findGo(dir) {
    const q = $('#findInput').value; if (!q) return;
    if (!findHits.length || findHits[0].node.nodeValue.toLowerCase().indexOf(q.toLowerCase()) === -1) buildHits(q);
    if (!findHits.length) { $('#findCount').textContent = '0/0'; return; }
    findPos = (findPos + dir + findHits.length) % findHits.length; showHit();
    $('#findCount').textContent = (findPos + 1) + '/' + findHits.length;
  }
  function replaceOne() {
    if (findPos < 0 || !findHits[findPos]) return;
    const h = findHits[findPos]; const rep = $('#replaceInput').value;
    h.node.nodeValue = h.node.nodeValue.slice(0, h.start) + rep + h.node.nodeValue.slice(h.end);
    flushChapter(); scheduleSave(); findHits = []; $('#findCount').textContent = '0/0';
  }
  function replaceAll() {
    const q = $('#findInput').value; if (!q) return; buildHits(q);
    const rep = $('#replaceInput').value;
    let n = 0; findHits.forEach((h) => { h.node.nodeValue = h.node.nodeValue.slice(0, h.start) + rep + h.node.nodeValue.slice(h.end); n++; });
    if (n) { flushChapter(); scheduleSave(); toast('已替换 ' + n + ' 处'); }
    findHits = []; $('#findCount').textContent = '0/0';
  }

  /* ───────── 设置 ───────── */
  function applySettings() {
    const root = document.documentElement;
    document.body.setAttribute('data-theme', S.theme || 'paper');
    document.body.setAttribute('data-indent', S.indent ? '1' : '0');
    root.style.setProperty('--editor-width', (S.editorWidth || 760) + 'px');
    root.style.setProperty('--editor-fontsize', (S.fontSize || 18) + 'px');
    root.style.setProperty('--editor-lineheight', String(S.lineHeight || 1.9));
    root.style.setProperty('--editor-font', FONT_MAP[S.fontFamily] || FONT_MAP.serif);
    setSeg('setTheme', S.theme);
    setSeg('setFontFamily', S.fontFamily);
    setRange('setFont', S.fontSize, 'valFont', ''); setRange('setLine', S.lineHeight, 'valLine', '');
    setRange('setWidth', S.editorWidth, 'valWidth', ''); setRange('setGoal', S.dailyGoal, 'valGoal', '');
    setRange('setAuto', S.autoSave, 'valAuto', '');
    $('#setIndent').checked = !!S.indent; $('#setTypewriter').checked = !!S.typewriter; $('#setSnap').checked = !!S.snapshot;
    $('#setAutoFormat').checked = !!S.autoFormat; $('#setFmtSpace').checked = !!S.fmtSpace; $('#setFmtPunct').checked = !!S.fmtPunct; $('#setFmtQuote').checked = !!S.fmtQuote; $('#setFmtIndent').checked = !!S.fmtIndent;
    const dp = $('#dataPath'); if (dp) Store.dataPathText().then((t) => { dp.textContent = t; });
    const av = $('#aboutVersion'); if (av) av.textContent = 'v' + APP_VERSION;
    const av2 = $('#aboutVersion2'); if (av2) av2.textContent = 'v' + APP_VERSION;
  }
  function setSeg(id, v) { $$('#' + id + ' button').forEach((b) => b.classList.toggle('active', b.dataset.v === v)); }
  function setRange(id, v, label, suffix) { const el = $('#' + id); if (el) el.value = v; const l = $('#' + label); if (l) l.textContent = v + (suffix || ''); }
  function onSettingChange() {
    S.theme = segVal('setTheme'); S.fontFamily = segVal('setFontFamily');
    S.fontSize = +$('#setFont').value; S.lineHeight = +$('#setLine').value;
    S.editorWidth = +$('#setWidth').value; S.dailyGoal = +$('#setGoal').value; S.autoSave = +$('#setAuto').value;
    S.indent = $('#setIndent').checked; S.typewriter = $('#setTypewriter').checked; S.snapshot = $('#setSnap').checked;
    S.autoFormat = $('#setAutoFormat').checked; S.fmtSpace = $('#setFmtSpace').checked; S.fmtPunct = $('#setFmtPunct').checked; S.fmtQuote = $('#setFmtQuote').checked; S.fmtIndent = $('#setFmtIndent').checked;
    setRange('setFont', S.fontSize, 'valFont', ''); setRange('setLine', S.lineHeight, 'valLine', '');
    setRange('setWidth', S.editorWidth, 'valWidth', ''); setRange('setGoal', S.dailyGoal, 'valGoal', '');
    setRange('setAuto', S.autoSave, 'valAuto', '');
    applySettings();
    if (S.snapshot) startSnapTimer(); else clearInterval(snapTimer);
    scheduleSave(); renderStats(); updateGoal();
  }
  function segVal(id) { const a = $('#' + id + ' button.active'); return a ? a.dataset.v : null; }

  /* ───────── 抽屉 / 弹层 ───────── */
  function openDrawer(id) { const d = $('#' + id); if (d) d.classList.add('show'); const m = $('#drawerMask'); if (m) m.classList.add('show'); }
  function closeDrawer(id) { const d = $('#' + id); if (d) d.classList.remove('show'); if (!$('.drawer.show')) $('#drawerMask').classList.remove('show'); }
  function closePopup() { const p = $('#exportMenu'); if (p) p.classList.remove('show'); }
  function toggleOutline() { const p = $('#outlinePanel'); if (p) p.classList.toggle('hidden'); }

  /* ───────── 侧栏宽度拖拽 ───────── */
  function initResizer() {
    const resizer = $('#outlineResizer'), panel = $('#outlinePanel');
    if (!resizer || !panel) return;
    let resizing = false, startX = 0, startW = 0;
    resizer.addEventListener('mousedown', (e) => {
      resizing = true; startX = e.clientX; startW = panel.offsetWidth;
      resizer.classList.add('dragging'); document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const w = Math.max(240, Math.min(520, startW - (e.clientX - startX)));
      panel.style.flexBasis = w + 'px'; panel.style.width = w + 'px';
      try { localStorage.setItem('moye.kbWidth', String(w)); } catch (e) {}
    });
    document.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false; resizer.classList.remove('dragging'); document.body.style.userSelect = '';
    });
    // 双击重置
    resizer.addEventListener('dblclick', () => {
      panel.style.flexBasis = ''; panel.style.width = '';
      try { localStorage.removeItem('moye.kbWidth'); } catch (e) {}
    });
  }
  function restoreKbWidth() {
    const panel = $('#outlinePanel'); if (!panel) return;
    try {
      const w = parseInt(localStorage.getItem('moye.kbWidth') || '', 10);
      if (w >= 240 && w <= 520) { panel.style.flexBasis = w + 'px'; panel.style.width = w + 'px'; }
    } catch (e) {}
  }

  /* ───────── 作品切换 ───────── */
  function renderBookSwitch() {
    const cur = $('#bookCurrent'); if (cur && activeBook()) cur.textContent = activeBook().title || '未命名';
    const list = $('#bookList'); if (!list) return;
    list.innerHTML = '';
    db.books.forEach((b) => {
      const row = document.createElement('div');
      row.className = 'book-row' + (b.id === db.activeId ? ' active' : '');
      row.dataset.id = b.id;
      row.innerHTML = '<span>' + esc(b.title || '未命名') + '</span><span class="ch-words">' + bookWords(b) + '</span>';
      list.appendChild(row);
    });
  }
  function switchBook(id) {
    if (curChapterId) flushChapter();
    db.activeId = id; S = activeBook().settings;
    curChapterId = null; applySettings(); renderAll();
    const first = allChapters()[0]; if (first) selectChapter(first.id);
    updateGoal(); scheduleSave();
    emitPlugin('bookChange', { id });
  }
  let bookDialogMode = 'new';
  function openBookDialog(mode, id) {
    bookDialogMode = mode || 'new';
    $('#bookDialogTitle').textContent = mode === 'edit' ? '作品设置' : '新建作品';
    if (mode === 'edit') {
      const b = activeBook();
      $('#bkTitle').value = b.title || ''; $('#bkAuthor').value = b.author || ''; $('#bkDesc').value = b.desc || '';
      $('#bkDelete').style.display = ''; $('#btnNewBook').dataset.id = b.id;
    } else {
      $('#bkTitle').value = ''; $('#bkAuthor').value = ''; $('#bkDesc').value = '';
      $('#bkDelete').style.display = 'none';
    }
    openDrawer('bookDialog');
  }
  function saveBook() {
    const title = $('#bkTitle').value.trim();
    if (!title) { toast('请填写书名'); return; }
    if (bookDialogMode === 'edit') {
      const b = activeBook(); b.title = title; b.author = $('#bkAuthor').value.trim(); b.desc = $('#bkDesc').value.trim();
    } else {
      const nb = defaultBook(title); nb.author = $('#bkAuthor').value.trim(); nb.desc = $('#bkDesc').value.trim();
      db.books.push(nb); db.activeId = nb.id; S = nb.settings; applySettings();
    }
    renderBookSwitch(); renderAll(); closeDrawer('bookDialog'); scheduleSave(); updateGoal(); toast('已保存');
  }
  async function deleteBook() {
    if (db.books.length <= 1) { toast('至少保留一部作品'); return; }
    if (!(await Store.confirm('确定删除当前作品及其全部内容？'))) return;
    const i = db.books.findIndex((b) => b.id === db.activeId);
    if (i >= 0) db.books.splice(i, 1);
    db.activeId = db.books[0].id; S = activeBook().settings; applySettings();
    renderBookSwitch(); renderAll(); closeDrawer('bookDialog'); scheduleSave(); toast('已删除');
  }

  function renderAll() {
    renderBookSwitch(); renderTOC(); renderNotes(); renderStats(); renderOutlinePanel();
    const first = allChapters()[0]; if (first && !curChapterId) selectChapter(first.id);
    updateGoal();
  }

  /* ───────── 事件绑定 ───────── */
  /* ───────── 插件上下文（暴露给插件的安全 API） ───────── */
  function buildPluginCtx() {
    return {
      version: APP_VERSION,
      electronAPI: window.electronAPI,
      // 数据
      getDb: () => db,
      getBooks: () => db.books,
      getActiveBook: () => activeBook(),
      getBook: (id) => db.books.find((b) => b.id === id),
      getChapter: (id) => { const f = findChapter(id); return f ? f.ch : null; },
      getActiveChapter: () => { const f = findChapter(curChapterId); return f ? f.ch : null; },
      getAllChapters: () => allChapters(),
      htmlToText: (html) => htmlToPlain(html),
      escapeHtml: esc,
      // 持久化
      scheduleSave: () => scheduleSave(),
      saveNow: () => saveNow(),
      replaceDb: (data) => { db = normalize(Object.assign(defaultDb(), data)); S = activeBook().settings; applySettings(); renderAll(); scheduleSave(); },
      // 导航
      selectChapter: (id) => selectChapter(id),
      // UI
      toast: (m) => toast(m),
      openDrawer: (id) => openDrawer(id),
      closeDrawer: (id) => closeDrawer(id),
      // 事件
      on: (ev, fn) => pbus.on(ev, fn),
      off: (ev, fn) => pbus.off(ev, fn),
      emit: (ev, ...rest) => pbus.emit(ev, ...rest),
      // 设置（全局，存 db.plugins）
      getSetting: (k, def) => { const v = db.plugins[k]; return (v === undefined ? def : v); },
      setSetting: (k, v) => { db.plugins[k] = v; scheduleSave(); },
      // UI 扩展点（委托给宿主）
      ui: {
        addToolbarButton: (o) => window.MoyePlugins._ui.addToolbarButton(o),
        openModal: (o) => window.MoyePlugins._ui.openModal(o),
        addSettingsSection: (o) => window.MoyePlugins._ui.addSettingsSection(o)
      }
    };
  }
  async function startPlugins() {
    if (!window.MoyePlugins || !window.MoyePlugins.start) return;
    try { await window.MoyePlugins.start(buildPluginCtx()); }
    catch (e) { console.error('[墨页] 插件加载失败', e); }
  }

  function bindUI() {
    // 顶栏
    $('#bookSwitch').addEventListener('click', (e) => {
      if (e.target.closest('#bookCurrent')) $('#bookSwitch').classList.toggle('open');
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('#bookSwitch')) $('#bookSwitch').classList.remove('open'); });
    $('#bookList').addEventListener('click', (e) => { const r = e.target.closest('.book-row'); if (r) { switchBook(r.dataset.id); $('#bookSwitch').classList.remove('open'); } });
    $('#btnNewBook').addEventListener('click', () => openBookDialog('new'));
    $('#btnBookSettings').addEventListener('click', () => openBookDialog('edit'));

    $('#btnOutline').addEventListener('click', toggleOutline);
    $('#outlineClose').addEventListener('click', toggleOutline);
    $('#btnFocus').addEventListener('click', () => document.body.classList.add('focus-mode'));
    $('#focusStopBtn').addEventListener('click', () => document.body.classList.remove('focus-mode'));
    $('#btnExport').addEventListener('click', (e) => {
      const p = $('#exportMenu'); const r = e.target.getBoundingClientRect();
      p.style.top = (r.bottom + 6) + 'px'; p.style.left = (r.left - 140) + 'px'; p.classList.toggle('show');
    });
    $('#exportMenu').addEventListener('click', (e) => { const b = e.target.closest('button[data-act]'); if (b) doExport(b.dataset.act); });
    document.addEventListener('click', (e) => { if (!e.target.closest('#btnExport') && !e.target.closest('#exportMenu')) closePopup(); });
    $('#btnSettings').addEventListener('click', () => openDrawer('settingsDrawer'));
    $('#btnAbout').addEventListener('click', () => openDrawer('aboutDialog'));
    $('#aboutClose').addEventListener('click', () => closeDrawer('aboutDialog'));

    // 插件管理
    $('#btnPlugins') && $('#btnPlugins').addEventListener('click', () => { if (window.MoyePlugins && window.MoyePlugins._buildDrawer) window.MoyePlugins._buildDrawer(); openDrawer('pluginsDrawer'); });
    $('#pluginsClose') && $('#pluginsClose').addEventListener('click', () => closeDrawer('pluginsDrawer'));
    $('#btnOpenPluginsFolder') && $('#btnOpenPluginsFolder').addEventListener('click', () => { if (window.electronAPI && window.electronAPI.openPluginsFolder) window.electronAPI.openPluginsFolder(); });
    $('#pluginsList') && $('#pluginsList').addEventListener('change', (e) => {
      const cb = e.target.closest('input[type=checkbox]');
      if (!cb) return;
      const row = e.target.closest('.plugin-row');
      if (row && window.MoyePlugins) window.MoyePlugins.setEnabled(row.getAttribute('data-plugin'), cb.checked);
    });

    // 侧栏
    $$('.side-tab').forEach((t) => t.addEventListener('click', () => {
      $$('.side-tab').forEach((x) => x.classList.toggle('active', x === t));
      $$('.side-view').forEach((v) => v.classList.toggle('active', v.dataset.view === t.dataset.view));
    }));
    $('#btnNewChapter').addEventListener('click', newChapter);
    $('#btnNewVolume').addEventListener('click', newVolume);
    $('#tocSearch').addEventListener('input', (e) => { tocFilter = e.target.value; renderTOC(); });
    $('#tocTree').addEventListener('click', (e) => {
      const ch = e.target.closest('.toc-chapter'); if (ch) { selectChapter(ch.dataset.id); return; }
      const act = e.target.closest('[data-act]'); if (act && act.dataset.act === 'rename-vol') {
        const v = activeBook().volumes.find((x) => x.id === act.dataset.id); const name = prompt('分卷名称', v.name); if (name != null) { v.name = name; renderTOC(); scheduleSave(); }
      }
      if (act && act.dataset.act === 'del-vol') deleteVolume(act.dataset.id);
    });
    $('#tocTree').addEventListener('dragstart', onDragStart);
    $('#tocTree').addEventListener('dragover', onDragOver);
    $('#tocTree').addEventListener('dragleave', onDragLeave);
    $('#tocTree').addEventListener('drop', onDrop);

    $('#btnNewNote').addEventListener('click', () => openNote(null));
    $('#noteList').addEventListener('click', (e) => { const c = e.target.closest('.note-card'); if (c) openNote(c.dataset.id); });
    $('#noteSave').addEventListener('click', saveNote);
    $('#noteClose').addEventListener('click', () => closeDrawer('noteDrawer'));
    $('#noteDelete').addEventListener('click', deleteNote);
    $('#noteCat').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) { editingNoteCat = b.dataset.v; setSeg('noteCat', b.dataset.v); } });

    // 编辑器
    $('#editor').addEventListener('input', () => {
      const f = findChapter(curChapterId);
      if (f) { f.ch.html = editor.innerHTML; f.ch.words = countWords(editor.textContent); f.ch.updatedAt = Date.now(); }
      markNonEmpty(); updateWordsLive(); updateCursorInfo(); scheduleSave(); updateGoal();
    });
    $('#editor').addEventListener('blur', () => { if (S && S.autoFormat) formatCurrentChapter(false); });
    $('#chapterTitle').addEventListener('input', (e) => {
      const f = findChapter(curChapterId); if (f) { f.ch.title = e.target.value; renderTOC(); highlightTOC(); const st = $('#stChapter'); if (st) st.textContent = (f.vol.name ? f.vol.name + ' / ' : '') + (f.ch.title || '未命名'); scheduleSave(); }
    });
    $('#btnDelChapter').addEventListener('click', () => { if (curChapterId) deleteChapter(curChapterId); });
    $('#btnHistory').addEventListener('click', () => { renderHistory(); openDrawer('historyDrawer'); });
    $('#btnFormat').addEventListener('click', () => formatCurrentChapter(true));

    // 知识库栏（可拖拽调整宽度）
    initResizer();

    // 知识库（只读，连接本地 .md 文件夹）
    async function kbPickFolder() {
      if (!window.electronAPI || !window.electronAPI.kbSelectFolder) { toast('知识库仅桌面端支持'); return; }
      const r = await window.electronAPI.kbSelectFolder();
      if (!r || !r.ok) { toast('选择失败：' + ((r && r.error) || '')); return; }
      if (!r.path) return;
      kbOpenRel = '';
      S.kbFolder = r.path; scheduleSave(); renderKb(); toast('已连接知识库');
    }
    $('#kbConnect').addEventListener('click', kbPickFolder);
    $('#kbSwitch').addEventListener('click', kbPickFolder);
    $('#kbList').addEventListener('click', (e) => {
      const folder = e.target.closest('.kb-folder-title');
      if (folder) { kbToggleFolder(folder.dataset.folder); renderKbList(); return; }
      const it = e.target.closest('.kb-item');
      if (it) kbOpenItem(it.dataset.rel);
    });
    $('#kbBack').addEventListener('click', () => { kbOpenRel = ''; renderKbList(); showKbList(); });

    // 查找
    $('#btnFind') && $('#btnFind').addEventListener('click', () => $('#findBar').classList.add('show'));
    $('#findNext').addEventListener('click', () => findGo(1));
    $('#findPrev').addEventListener('click', () => findGo(-1));
    $('#findInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') findGo(e.shiftKey ? -1 : 1); });
    $('#replaceOne').addEventListener('click', replaceOne);
    $('#replaceAll').addEventListener('click', replaceAll);
    $('#findClose').addEventListener('click', () => $('#findBar').classList.remove('show'));

    // 设置
    $('#settingsClose').addEventListener('click', () => closeDrawer('settingsDrawer'));
    $('#drawerMask').addEventListener('click', () => { $$('.drawer.show').forEach((d) => d.classList.remove('show')); $('#drawerMask').classList.remove('show'); });
    $('#setTheme').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) onSettingChange(); });
    $('#setFontFamily').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) onSettingChange(); });
    ['setFont', 'setLine', 'setWidth', 'setGoal', 'setAuto'].forEach((id) => $('#' + id).addEventListener('input', onSettingChange));
    $('#setIndent').addEventListener('change', onSettingChange);
    $('#setTypewriter').addEventListener('change', onSettingChange);
    $('#setSnap').addEventListener('change', onSettingChange);
    ['setAutoFormat', 'setFmtSpace', 'setFmtPunct', 'setFmtQuote', 'setFmtIndent'].forEach((id) => $('#' + id).addEventListener('change', onSettingChange));
    $('#btnOpenData').addEventListener('click', async () => { if (!await Store.openDataFolder()) toast('当前为浏览器模式，数据存在 IndexedDB'); });
    $('#btnReloadData').addEventListener('click', async () => { const data = await Store.load(); if (data) { db = normalize(data); S = activeBook().settings; applySettings(); renderAll(); toast('已重新载入'); } });
    try {
      const inEl = (typeof window !== 'undefined' && window.electronAPI);
      const envEl = $('#envInfo'); if (envEl) envEl.textContent = '运行环境：' + (inEl ? 'Electron 桌面端' : '浏览器');
    } catch (e) {}

    // 作品对话框
    $('#bookDialogClose').addEventListener('click', () => closeDrawer('bookDialog'));
    $('#bkSave').addEventListener('click', saveBook);
    $('#bkDelete').addEventListener('click', deleteBook);

    // 历史抽屉
    $('#historyClose').addEventListener('click', () => closeDrawer('historyDrawer'));
    $('#historyList').addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) restoreSnapshot(+b.dataset.i); });

    // 写作计时（内置核心功能）
    $('#stTimer') && $('#stTimer').addEventListener('click', () => { updateTimerUI(); openDrawer('timerDrawer'); });
    $('#timerClose') && $('#timerClose').addEventListener('click', () => closeDrawer('timerDrawer'));
    $('#btnTimerStart') && $('#btnTimerStart').addEventListener('click', startStopTimer);
    $('#btnTimerResetPomo') && $('#btnTimerResetPomo').addEventListener('click', resetPomo);

    // 快捷键
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { document.body.classList.remove('focus-mode'); closePopup(); $$('.drawer.show').forEach((d) => d.classList.remove('show')); $('#drawerMask').classList.remove('show'); }
      if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); toggleOutline(); }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); openDrawer('settingsDrawer'); }
      if (e.key === 'F11') { e.preventDefault(); document.body.classList.toggle('focus-mode'); }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); formatCurrentChapter(true); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); $('#findBar').classList.add('show'); $('#findInput').focus(); }
    });
  }

  function markNonEmpty() {
    const ed = editor; if (!ed) return;
    const empty = !ed.textContent.trim();
    ed.classList.toggle('is-empty', empty);
    if (S && S.typewriter && !empty) {
      try { ed.scrollTop = ed.scrollHeight; } catch (e) {}
    }
  }
  function updateCursorInfo() {
    const el = $('#stCursor'); if (!el) return;
    try {
      const sel = window.getSelection(); if (!sel.rangeCount) return;
      const r = sel.getRangeAt(0); const pre = r.cloneRange(); pre.selectNodeContents(editor); pre.setEnd(r.endContainer, r.endOffset);
      const text = pre.toString(); const line = text.split('\n').length; const col = text.length - text.lastIndexOf('\n');
      el.textContent = '行 ' + line + '，列 ' + col;
    } catch (e) {}
  }

  /* ───────── 自定义标题栏（Electron frameless 窗口控制按钮） ───────── */
  function initTitleBar() {
    if (!window.electronAPI || !window.electronAPI.windowControl) return;
    const minBtn = $('#tbMin'), maxBtn = $('#tbMax'), closeBtn = $('#tbClose');
    if (!minBtn || !maxBtn || !closeBtn) return;

    minBtn.addEventListener('click', () => window.electronAPI.windowControl('minimize'));
    maxBtn.addEventListener('click', async () => {
      const maximized = await window.electronAPI.windowControl('maximize');
      maxBtn.innerHTML = maximized ? '❐' : '□';
      maxBtn.title = maximized ? '还原' : '最大化';
    });
    closeBtn.addEventListener('click', () => window.electronAPI.windowControl('close'));

    if (window.electronAPI.onWindowState) {
      window.electronAPI.onWindowState((state) => {
        const isMax = state === 'maximized';
        maxBtn.innerHTML = isMax ? '❐' : '□';
        maxBtn.title = isMax ? '还原' : '最大化';
      });
    }
  }

  /* ───────── 桌面初始化 ───────── */
  function initDesktop() {
    // Electron：自动保存已覆盖持久化。额外在窗口失焦/隐藏时补一次保存，
    // 最大化避免「关太快没存上」的极端情况。
    try {
      const flush = () => { try { if (db) window.electronAPI && window.electronAPI.saveNovels(db); } catch (e) {} };
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
      window.addEventListener('blur', flush);
    } catch (e) {}
  }

  /* ───────── 启动 ───────── */
  async function boot() {
    bootLog('检查运行环境');
    const inEl = (typeof window !== 'undefined' && window.electronAPI);
    const nl = (typeof Neutralino !== 'undefined');
    const mode = inEl ? 'electron' : (nl ? 'window' : 'browser');
    bootLog('运行环境 ' + (inEl ? 'Electron' : (nl ? 'Neutralino' : '浏览器')) + ' / ' + mode);

    bootLog('加载本地数据');
    // 原生存储加载加超时兜底：若 Neutralino 连接异常导致 API 调用永久挂起，
    // 3 秒后降级为空数据库，保证界面一定能渲染出来。
    const loaded = await withTimeout(Store.load(), 3000, null);
    bootLog('数据加载结果 ' + (loaded ? '有数据' : '无数据/超时'));
    if (loaded && loaded.books && loaded.books.length) db = normalize(loaded);
    else {
      db = defaultDb();
      bootLog('使用默认空库');
      try { await withTimeout(saveNow(), 2000, null); bootLog('初始保存完成'); } catch (e) { bootLog('初始保存跳过'); }
    }
    db = normalize(db);
    S = activeBook().settings;
    bootLog('应用设置');
    applySettings();
    bootLog('绑定界面事件');
    bindUI();
    bootLog('渲染界面');
    renderAll();
    restoreKbWidth();
    if (S.snapshot) startSnapTimer();
    updateGoal();
    initTimer();
    bootLog('加载插件');
    await startPlugins();
    bootLog('启动完成');
  }

  // 最终保险：无论任何原因，6.5 秒后必须让界面出来
  const bootInsurance = setTimeout(() => {
    bootLog('强制兜底渲染');
    if (!db) db = normalize(defaultDb());
    if (!S) S = activeBook().settings;
    try { applySettings(); } catch (e) {}
    try { bindUI(); } catch (e) {}
    try { renderAll(); } catch (e) {}
    try { restoreKbWidth(); } catch (e) {}
    try { updateGoal(); } catch (e) {}
    if (window.__hideBootSplash) window.__hideBootSplash();
    if (window.__markBootDone) window.__markBootDone();
  }, 6500);

  document.addEventListener('DOMContentLoaded', () => {
    installErrorReporter();
    editor = $('#editor');
    initTitleBar();
    initDesktop();
    boot().then(() => {
      clearTimeout(bootInsurance);
      if (window.__hideBootSplash) window.__hideBootSplash();
      if (window.__markBootDone) window.__markBootDone();
    }).catch((e) => {
      console.error(e);
      clearTimeout(bootInsurance);
      if (window.__showBootError) window.__showBootError('初始化失败', (e && (e.stack || e.message)) || String(e));
    });
  });
})();
