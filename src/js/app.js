/* ===== 墨页 · 小说写作 核心逻辑 ===== */
(function () {
  'use strict';

  const APP_VERSION = '2.7.0';

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
    kbFolder: '', bg: 'theme', bgColor: '#f7f3ea'
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
      characters: [],
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
      b.characters = Array.isArray(b.characters) ? b.characters : [];
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
    updateTodayHero(); updateFocusHud();
  }
  function updateWordsLive() {
    const f = findChapter(curChapterId);
    const w = f ? (f.ch.words || 0) : 0;
    const el = $('#stWords'); if (el) el.textContent = w + ' 字';
    updateFocusHud();
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
      const vol = document.createElement('div'); vol.className = 'toc-volume' + (v.collapsed ? ' collapsed' : ''); vol.dataset.id = v.id;
      const row = document.createElement('div'); row.className = 'row'; row.draggable = true; row.dataset.type = 'volume'; row.dataset.id = v.id;
      row.innerHTML = '<span class="vol-name"><span class="vol-fold">' + (v.collapsed ? '▸' : '▾') + '</span>' + esc(v.name) + '</span>' +
        '<span class="vol-tools">' +
        '<button class="row-btn" data-act="add-chap" data-id="' + v.id + '" title="在本卷添加章节">＋章</button>' +
        '<button class="row-btn" data-act="rename-vol" data-id="' + v.id + '">改名</button>' +
        '<button class="row-btn" data-act="del-vol" data-id="' + v.id + '">删</button></span>';
      vol.appendChild(row);
      const list = document.createElement('div'); list.className = 'toc-chapters';
      if (!v.collapsed) {
        chs.forEach((c) => {
          shownCh++;
          const item = document.createElement('div');
          item.className = 'toc-chapter' + (c.id === curChapterId ? ' selected' : '') + (c.done ? ' done' : '');
          item.draggable = true; item.dataset.type = 'chapter'; item.dataset.id = c.id;
          item.innerHTML = '<span class="ch-title">' + esc(c.title || '未命名') + '</span>' +
            '<span class="ch-words">' + (c.words || 0) + '</span>';
          list.appendChild(item);
        });
      }
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
    hideDoneBar();
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
  function newChapter(volId) {
    const b = activeBook();
    let vol = volId ? b.volumes.find((x) => x.id === volId) : null;
    if (!vol) vol = b.volumes[b.volumes.length - 1];
    if (!vol) { vol = { id: uid(), name: '正文', collapsed: false, chapters: [] }; b.volumes.push(vol); }
    vol.collapsed = false;
    const c = { id: uid(), title: '新章节', html: '', words: 0, updatedAt: Date.now(), snapshots: [] };
    vol.chapters.push(c);
    renderTOC(); selectChapter(c.id); scheduleSave(); updateGoal();
    const t = $('#chapterTitle'); if (t) { t.focus(); t.select(); }
  }
  function newChapterInVolume(volId) { newChapter(volId); }
  function toggleVolume(volId) {
    const b = activeBook();
    const v = b.volumes.find((x) => x.id === volId);
    if (!v) return;
    v.collapsed = !v.collapsed;
    renderTOC(); scheduleSave();
  }
  function newVolume() {
    const b = activeBook();
    const v = { id: uid(), name: '新分卷', collapsed: false, chapters: [] };
    b.volumes.push(v);
    renderTOC(); scheduleSave(); toast('已新建分卷');
  }
  function nextChapterId(id) {
    const b = activeBook();
    let hit = false;
    for (const v of b.volumes) {
      for (const c of v.chapters) {
        if (hit) return c.id;
        if (c.id === id) hit = true;
      }
    }
    return null;
  }
  function hideDoneBar() { const bar = $('#chapterDoneBar'); if (bar) bar.hidden = true; }
  function doneChapter() {
    const f = findChapter(curChapterId); if (!f) return;
    f.ch.done = true; renderTOC(); scheduleSave();
    const nx = nextChapterId(curChapterId);
    const msg = $('#doneMsg'); if (msg) msg.textContent = '「' + (f.ch.title || '未命名') + '」已标记完成 🎉';
    const bar = $('#chapterDoneBar'); if (bar) bar.hidden = false;
    const nb = $('#doneNext');
    if (nb) { nb.hidden = false; nb.textContent = nx ? '写下一章 →' : '新建章节 →'; }
    const st = $('#doneStay'); if (st) st.hidden = false;
    toast('本章已完成，去写下一章吧');
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

  /* ───────── 人物 / 素材 ───────── */
  // 常见姓氏（单字）与复姓，用于从正文中自动识别有名有姓的出场人物
  const SURNAMES = new Set('赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍却璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东'.split(''));
  const DOUBLE_SURNAMES = new Set(['欧阳','太史','端木','上官','司马','东方','独孤','南宫','万俟','闻人','夏侯','诸葛','尉迟','羊舌','公羊','澹台','公冶','宗政','濮阳','淳于','单于','太叔','申屠','公孙','仲孙','轩辕','令狐','钟离','宇文','长孙','慕容','鲜于','闾丘','司徒','司空','亓官','司寇','仉督','子车','颛孙','端木','巫马','公西','漆雕','乐正','壤驷','公良','拓跋','夹谷','宰父','谷梁','段干','百里','东郭','南门','呼延','归海','羊舌','微生','岳帅','缑亢','况后','有琴','梁丘','左丘','东门','西门','商牟','佘佴','伯赏','南宫','墨哈','谯笪','年爱','阳佟','第五','言福']);
  const NAME_BLACKLIST = new Set(['今天','明天','昨天','后天','早上','上午','中午','下午','晚上','夜里','夜晚','午夜','凌晨','清晨','傍晚','现在','过去','未来','刚才','一会儿','很久','曾经','忽然','突然','猛然','竟然','居然','果然','虽然','但是','然而','可是','因为','所以','因此','如果','即使','尽管','不但','而且','或者','还是','要么','我们','你们','他们','她们','它们','大家','咱们','自己','别人','人家','某人','有人','这个','那个','这些','那些','这里','那里','这边','那边','东西','地方','时间','时候','时刻','年代','年月','日子','生活','人生','世界','社会','国家','城市','乡村','地方','房间','屋子','门口','窗外','桌上','地上','手中','心里','眼前','耳边','身后','故事','小说','章节','正文','内容','情节','作品','作者','读者','主角','配角','人物','角色','名字','姓名','称呼','称号','标题','目录','大纲','设定','灵感','素材','笔记','记录','备注','说明','描述','介绍','评论','想法','看法','意见','建议','问题','答案','原因','结果','过程','方式','方法','技巧','经验','知识','理论','概念','定义','解释','例子','案例','事实','真相','谎言','谣言','消息','新闻','传闻','事件','事故','事情','事务','业务','工作','任务','项目','计划','目标','目的','意图','愿望','梦想','理想','现实','实际','假象','幻觉','错觉','感觉','感受','心情','情绪','表情','神态','动作','行为','言语','话语','声音','语气','语调','口吻','口气','态度','模样','样子','外貌','长相','身材','身高','体型','体重','面容','脸色','眼神','目光','神情','神色','气色','姿态','姿势','举止','习惯','爱好','特长','优点','缺点','特点','特征','个性','性格','脾气','性情','气质','品质','品德','道德','修养','素质','能力','本领','技能','才华','才能','智慧','聪明','才智','头脑','思想','思维','念头','心思','心意','欲望','野心','雄心','抱负','志向','志气','意志','毅力','决心','信心','信念','信仰','观念','观点','见解','认识','理解','体会','感悟','感慨','感叹','惊叹','惊奇','惊讶','诧异','疑惑','困惑','怀疑','信任','依赖','依靠','指望','期望','希望','盼望','渴望','期待','等待','守候','陪伴','相随','同行','共处','相处','交往','交流','沟通','交谈','谈话','聊天','对话','讨论','议论','争论','辩论','争吵','吵架','打斗','战斗','战争','战役','战场','武器','兵器','刀剑','弓箭','枪支','炮火','弹药','军队','士兵','将军','元帅','国王','皇后','公主','王子','皇帝','陛下','大人','老爷','夫人','小姐','公子','少爷','姑娘','娘子','相公','官人','侠客','英雄','好汉','壮士','义士','隐士','高人','神仙','妖怪','魔鬼','鬼魂','灵魂','尸体','身体','性命','生命','生死','命运','运气','机遇','机缘','缘分','姻缘','情缘','情感','感情','爱情','友情','亲情','交情','私情','恩情','仇恨','怨恨','愤怒','怒火','怒气','暴怒','狂怒','哀伤','悲伤','悲痛','忧伤','忧愁','忧郁','郁闷','烦闷','烦恼','苦恼','痛苦','难受','心疼','心酸','心碎','绝望','失望','失落','沮丧','消沉','颓废','落寞','孤独','寂寞','空虚','无聊','疲惫','疲倦','劳累','辛苦','艰难','困难','困苦','贫困','贫穷','富裕','富有','富贵','荣华','奢华','豪华','简朴','朴素','平凡','普通','寻常','平常','一般','特别','特殊','格外','尤其','十分','非常','极其','极端','绝对','完全','彻底','究竟','到底','简直','几乎','大概','大约','左右','上下','以内','以外','之前','之后','之间','之内','其中','其余','其他','另外','此外','反而','反倒','何况','况且','要不','不然','否则','除非','假如','假定','假设','设若','若是','倘若','倘使','只要','只有','无论','不管','不论','虽说','固然','自然','当然','其实','实际上','事实上','本来','原来','向来','从来','一直','始终','永远','永久','长久','短暂','暂时','临时','蓦然','欣然','怅然','惘然','愕然','茫然','恍然','泰然','安然','淡然','漠然','热情','冷淡','冷漠','冷酷','残忍','善良','仁慈','和蔼','温和','温柔','体贴','细心','粗心','大意','马虎','认真','仔细','谨慎','小心','大胆','勇敢','胆怯','懦弱','软弱','坚强','顽强','固执','倔强','顽固','死板','灵活','机灵','聪明','愚蠢','愚笨','笨拙','伶俐','乖巧','顽皮','淘气','老实','憨厚','狡猾','奸诈','虚伪','真诚','诚实','坦率','直率','爽快','爽朗','开朗','活泼','内向','外向','安静','文静','稳重','成熟','幼稚','天真','单纯','复杂','深奥','浅显','简单','容易','困难','轻松','愉快','高兴','快乐','开心','欢乐','欢喜','喜悦','兴奋','激动','感动','震撼','惊讶','吃惊','意外','幸运','幸福','美满','甜蜜','温馨','和谐','和睦','融洽','友好','亲切','热烈','无情','绝情','狠心','恶毒','邪恶','阴险','狡诈','伪装','表象','表面','本质','实质','核心','关键','重点','要点','要害','细节','环节','步骤','程序','流程','顺序','秩序','结构','组织','系统','体系','机制','体制','制度','规则','规矩','规范','准则','原则','标准','水平','程度','等级','级别','层次','阶层','阶级','地位','身份','资格','资历','经历','阅历','学历','学位','职称','职务','职位','岗位','事业','产业','行业','专业','手艺','技术','途径','渠道','来源','根源','起因','后果','效果','成果','成效','成绩','成就','成功','胜利','挫折','过失','罪过','罪恶','罪行','犯罪','惩罚','处罚','处分','责备','责怪','埋怨','抱怨','牢骚','不满','气愤','气恼','恼火','恼怒','嫉恨','嫉妒','羡慕','仰慕','钦佩','敬佩','敬重','尊敬','尊重','轻视','鄙视','蔑视','藐视','侮辱','羞辱','欺凌','欺负','压迫','剥削','压榨','搜刮','掠夺','抢夺','抢劫','盗窃','偷盗','偷窃','贪污','受贿','行贿','诈骗','欺骗','哄骗','诱骗','诱惑','引诱','引导','指导','教导','教诲','教训','训诫','劝诫','劝告','劝说','说服','劝导','开导','启发','启示','启迪','启蒙','感化','感染','影响','作用','效用','效力','功能','机能','性能','性质','中心','重心','焦点','热点','难点','疑点','盲点','误区','偏差','差错','失误','误会','误解','曲解','歪曲','颠倒','错乱','混乱','杂乱','凌乱','整齐','整洁','干净','清洁','卫生','肮脏','污秽','污浊','浑浊','清澈','清晰','明白','明确','模糊','含糊','朦胧','隐约','迷迷糊糊','昏昏沉沉','糊里糊涂','稀里糊涂','莫名其妙','不可思议']);
  const NAME_STOP = new Set('的是了着过吗呢吧啊哦嗯唉也得在与和把被让给向对从到为以就都以把被让给向对从到为以就都由跟与同和对于关于由于把被让给向对从到为以就都与同和对于关于由于'.split(''));

  function extractCharacterNames() {
    const b = activeBook();
    const chapters = allChapters();
    const order = {};
    chapters.forEach((c, i) => order[c.id] = i);
    const map = new Map();
    chapters.forEach((ch) => {
      const text = htmlToPlain(ch.html);
      const matches = text.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
      matches.forEach((m) => {
        if (NAME_BLACKLIST.has(m)) return;
        let sur = '', rest = '';
        const d2 = m.slice(0, 2);
        if (DOUBLE_SURNAMES.has(d2)) { sur = d2; rest = m.slice(2); }
        else {
          if (!SURNAMES.has(m[0])) return;
          sur = m[0]; rest = m.slice(1);
        }
        if (!rest || rest.length > 2) return;
        // 名字部分不能全是虚词/数字/量词
        if (Array.from(rest).every((c) => NAME_STOP.has(c))) return;
        const rec = map.get(m) || { chapterIds: [], count: 0 };
        if (!rec.chapterIds.includes(ch.id)) rec.chapterIds.push(ch.id);
        rec.count++;
        map.set(m, rec);
      });
    });
    const arr = [];
    map.forEach((v, name) => {
      v.chapterIds.sort((a, b) => (order[a] || 0) - (order[b] || 0));
      arr.push({ name, chapterIds: v.chapterIds.slice(), count: v.count });
    });
    arr.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
    return arr;
  }
  function refreshCharacters() {
    const b = activeBook();
    const extracted = extractCharacterNames();
    const existing = new Map((b.characters || []).map((c) => [c.name, c]));
    const merged = extracted.map((item) => {
      const old = existing.get(item.name) || {};
      return { id: old.id || uid(), name: item.name, chapterIds: item.chapterIds, count: item.count, ignored: !!old.ignored, manual: !!old.manual, updatedAt: Date.now() };
    });
    // 保留手动添加、但正文中未出现的人名
    (b.characters || []).forEach((c) => {
      if (c.manual && !extracted.some((e) => e.name === c.name)) {
        merged.push({ id: c.id || uid(), name: c.name, chapterIds: c.chapterIds || [], count: c.count || 0, ignored: !!c.ignored, manual: true, updatedAt: Date.now() });
      }
    });
    b.characters = merged;
    renderNotes();
    scheduleSave();
    const visible = b.characters.filter((c) => !c.ignored).length;
    toast('已识别 ' + visible + ' 位出场人物' + (b.characters.length > visible ? '（忽略 ' + (b.characters.length - visible) + ' 个）' : ''));
  }
  function ignoreCharacter(id) {
    const b = activeBook(); const c = (b.characters || []).find((x) => x.id === id);
    if (!c) return; c.ignored = true; renderNotes(); scheduleSave();
  }
  function addCharacterManual(name) {
    name = (name || '').trim();
    if (!name) return false;
    const b = activeBook();
    const ex = (b.characters || []).find((c) => c.name === name);
    if (ex) { ex.manual = true; ex.ignored = false; }
    else { b.characters.push({ id: uid(), name, chapterIds: [], count: 0, ignored: false, manual: true, updatedAt: Date.now() }); }
    renderNotes(); scheduleSave();
    toast('已添加人物：' + name);
    return true;
  }

  function renderNotes() {
    const list = $('#noteList'); if (!list) return;
    const b = activeBook();
    list.innerHTML = '';

    // 1) 自动识别的人物
    const chars = (b.characters || []).filter((c) => !c.ignored);
    if (chars.length) {
      chars.forEach((c) => {
        const card = document.createElement('div'); card.className = 'character-item'; card.dataset.id = c.id;
        const chaps = c.chapterIds.map((id) => {
          const f = findChapter(id);
          if (!f) return '';
          const title = (f.ch.title || '未命名').slice(0, 12);
          return '<span class="ci-chap" data-id="' + id + '" title="' + esc(f.vol.name + ' / ' + f.ch.title) + '">' + esc(title) + '</span>';
        }).join('');
        card.innerHTML =
          '<div class="ci-main">' +
            '<div class="ci-info">' +
              '<span class="ci-name">' + esc(c.name) + '</span>' +
              '<span class="ci-count">' + c.count + ' 次出场</span>' +
            '</div>' +
            '<div class="ci-actions">' +
              '<button class="ci-action" data-act="ignore" title="忽略此人">忽略</button>' +
            '</div>' +
          '</div>' +
          '<div class="ci-chapters" hidden>' + chaps + '</div>';
        list.appendChild(card);
      });
    }

    // 2) 手动素材卡片
    const notes = b.notes || [];
    if (notes.length) {
      if (chars.length) {
        const sep = document.createElement('div');
        sep.className = 'note-section-title';
        sep.textContent = '手动素材';
        list.appendChild(sep);
      }
      notes.forEach((n) => {
        const card = document.createElement('div'); card.className = 'note-card'; card.dataset.id = n.id;
        card.innerHTML = '<div class="nc-title"><span>' + esc(n.title || '未命名') + '</span><span class="nc-cat">' + (NOTE_CAT[n.cat] || '其他') + '</span></div>' +
          '<div class="nc-body">' + esc(n.body || '') + '</div>';
        list.appendChild(card);
      });
    }

    if (!chars.length && !notes.length) {
      list.innerHTML = '<div class="empty-tip">还没有识别到人物<br>点「刷新人物」扫描全篇</div>';
    }
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
  function openNoteWithText(text) {
    editingNoteId = null; editingNoteCat = 'character';
    $('#noteTitle').value = text || ''; $('#noteBody').value = ''; setSeg('noteCat', 'character');
    openDrawer('noteDrawer');
  }
  async function deleteNote() {
    if (!editingNoteId) { closeDrawer('noteDrawer'); return; }
    const b = activeBook(); const i = b.notes.findIndex((x) => x.id === editingNoteId);
    if (i >= 0) b.notes.splice(i, 1);
    renderNotes(); closeDrawer('noteDrawer'); scheduleSave();
  }

  /* ───────── 统计（以「今天」为主） ───────── */
  function todayStat() {
    const tk = dateKey(new Date());
    const goal = S.dailyGoal || 2000;
    const written = (db.today && db.today.date === tk) ? (db.today.words || 0) : 0;
    const pct = Math.min(100, Math.round((written / goal) * 100));
    const remain = Math.max(0, goal - written);
    const over = Math.max(0, written - goal);
    return { tk, goal, written, pct, remain, over };
  }
  function curWords() { const f = findChapter(curChapterId); return f ? (f.ch.words || 0) : 0; }
  function renderStats() {
    const body = $('#statsBody'); if (!body) return;
    const b = activeBook();
    const ts = todayStat();
    const days = [];
    for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = dateKey(d); days.push({ k, w: b.history[k] || 0 }); }
    const maxW = Math.max(1, ...days.map((d) => d.w));
    const bars = days.map((d) => {
      const h = Math.round((d.w / maxW) * 78);
      const t = d.k === ts.tk;
      return '<div class="bar-col' + (t ? ' today' : '') + '"><div class="bar' + (t ? ' today' : '') + '" style="height:' + h + 'px"></div><div class="bar-d">' + d.k.slice(5) + '</div></div>';
    }).join('');
    const heat = days.map((d) => {
      let lvl = 0; if (d.w > 0) lvl = 1; if (d.w >= ts.goal * 0.3) lvl = 2; if (d.w >= ts.goal * 0.6) lvl = 3; if (d.w >= ts.goal) lvl = 4;
      return '<div class="heat-cell lvl' + lvl + (d.k === ts.tk ? ' today' : '') + '" data-tip="' + d.k + '：' + d.w + ' 字"></div>';
    }).join('');
    body.innerHTML =
      '<div class="stat-today">' +
        '<div class="st-today-ring" id="stTodayRing"><div class="st-today-ring-in"><b id="stTodayRingNum">0</b><span>%</span></div></div>' +
        '<div class="st-today-info">' +
          '<div class="st-today-num" id="stTodayNum">今日已写 0 字</div>' +
          '<div class="st-today-sub" id="stTodaySub">目标 0 字</div>' +
          '<div class="st-goal-bar"><i id="stTodayFill"></i></div>' +
          '<div class="st-today-extra" id="stTodayExtra"></div>' +
        '</div>' +
      '</div>' +
      '<div class="stat-block"><h4>近 14 天（今天高亮）</h4><div class="barchart">' + bars + '</div></div>' +
      '<div class="stat-block"><h4>码字热力（今天高亮）</h4><div class="heatmap">' + heat + '</div></div>' +
      '<div class="stat-block"><h4>全书字数</h4><div class="stat-bignum">' + totalWordsNow() + ' 字</div></div>';
    updateTodayHero(); updateFocusHud();
  }
  function updateTodayHero() {
    const ts = todayStat();
    const ring = $('#stTodayRing'); if (ring) ring.style.setProperty('--p', ts.pct);
    const num = $('#stTodayRingNum'); if (num) num.textContent = ts.pct;
    const n = $('#stTodayNum'); if (n) n.innerHTML = '今日已写 <b>' + ts.written + '</b> 字';
    const sub = $('#stTodaySub'); if (sub) sub.textContent = '目标 ' + ts.goal + ' 字' + (ts.over ? ' · 已超额 ' + ts.over + ' 字 🎉' : ' · 还差 ' + ts.remain + ' 字');
    const f = $('#stTodayFill'); if (f) f.style.width = ts.pct + '%';
    const ex = $('#stTodayExtra'); if (ex) ex.textContent = '当前章节 ' + curWords() + ' 字 · 全书 ' + totalWordsNow() + ' 字';
  }
  function updateFocusHud() {
    const hud = $('#focusHud'); if (!hud) return;
    const ts = todayStat();
    const f = findChapter(curChapterId);
    const name = f ? ((f.vol.name ? f.vol.name + ' / ' : '') + (f.ch.title || '未命名')) : '未选章节';
    hud.innerHTML = '今日 <b>' + ts.written + '</b> / ' + ts.goal + ' 字 · ' + esc(name) + ' · ' + curWords() + ' 字';
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
  function takeSnapshot(force) {
    const f = findChapter(curChapterId); if (!f) return false;
    const tk = Date.now();
    if (!force && tk - lastSnapAt < 5 * 60 * 1000) return false;
    lastSnapAt = tk;
    f.ch.snapshots = f.ch.snapshots || [];
    f.ch.snapshots.unshift({ t: tk, html: f.ch.html || '', words: f.ch.words || 0 });
    if (f.ch.snapshots.length > 30) f.ch.snapshots.length = 30;
    scheduleSave();
    return true;
  }
  function startSnapTimer() {
    clearInterval(snapTimer);
    snapTimer = setInterval(() => takeSnapshot(false), 30 * 1000);
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
    setSeg('setBg', S.bg || 'theme');
    const bgc = $('#setBgColor'); if (bgc) { bgc.value = S.bgColor || '#f7f3ea'; bgc.style.display = (S.bg === 'custom') ? '' : 'none'; }
    applyEditorBg();
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
  function applyEditorBg() {
    const es = $('#editorScroll'); const ed = $('#editor');
    if (!es) return;
    const presets = { white: '#ffffff', paper: '#f7f3ea', parchment: '#efe2c8', green: '#c7edcc', dark: '#26262b' };
    let color = null, ink = '';
    if (S.bg === 'custom') { color = (S.bgColor || '').trim(); }
    else if (presets[S.bg]) { color = presets[S.bg]; if (S.bg === 'dark') ink = '#e8e6e0'; }
    es.style.background = color || '';
    if (ed) ed.style.color = ink || '';
  }
  function setSeg(id, v) { $$('#' + id + ' button').forEach((b) => b.classList.toggle('active', b.dataset.v === v)); }
  function setRange(id, v, label, suffix) { const el = $('#' + id); if (el) el.value = v; const l = $('#' + label); if (l) l.textContent = v + (suffix || ''); }
  function onSettingChange(overrides) {
    overrides = overrides || {};
    S.theme = overrides.theme || segVal('setTheme');
    S.fontFamily = overrides.fontFamily || segVal('setFontFamily');
    S.bg = overrides.bg || segVal('setBg') || 'theme'; const bc = $('#setBgColor'); if (bc) S.bgColor = bc.value;
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

  /* ───────── 打字效果（视觉反馈，声音由「打字音效」插件提供） ───────── */
  let typingTimer = null, typingInd = null;
  function showTyping() {
    if (!typingInd) typingInd = $('#typingIndicator');
    if (typingInd) typingInd.classList.add('show');
    if (editor) editor.classList.add('typing');
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      if (typingInd) typingInd.classList.remove('show');
      if (editor) editor.classList.remove('typing');
    }, 700);
  }


  /* ───────── 抽屉 / 弹层 ───────── */
  function openDrawer(id) { const d = $('#' + id); if (d) d.classList.add('show'); const m = $('#drawerMask'); if (m) m.classList.add('show'); }
  function closeDrawer(id) { const d = $('#' + id); if (d) d.classList.remove('show'); if (!$('.drawer.show')) $('#drawerMask').classList.remove('show'); }
  function closePopup() { const p = $('#exportMenu'); if (p) p.classList.remove('show'); }
  function toggleOutline() { const p = $('#outlinePanel'); if (p) p.classList.toggle('hidden'); }

  let promptResolve = null, confirmResolve = null;
  function showPrompt(title, defaultValue) {
    return new Promise((res) => {
      promptResolve = res;
      const d = $('#promptDialog'), inp = $('#promptInput'), t = $('#promptTitle');
      if (t) t.textContent = title || '输入';
      if (inp) { inp.value = defaultValue || ''; inp.focus(); inp.select(); }
      openDrawer('promptDialog');
    });
  }
  function closePrompt(value) { closeDrawer('promptDialog'); if (promptResolve) { const r = promptResolve; promptResolve = null; r(value); } }
  function showConfirm(msg) {
    return new Promise((res) => {
      confirmResolve = res;
      const m = $('#confirmMsg'); if (m) m.textContent = msg || '确定执行此操作？';
      openDrawer('confirmDialog');
    });
  }
  function closeConfirm(result) { closeDrawer('confirmDialog'); if (confirmResolve) { const r = confirmResolve; confirmResolve = null; r(result); } }

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
    $('#btnSettings').addEventListener('click', () => { openDrawer('settingsDrawer'); applySettings(); });
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
      if (t.dataset.view === 'stats') renderStats();
    }));
    $('#btnNewChapter').addEventListener('click', newChapter);
    $('#btnNewVolume').addEventListener('click', newVolume);
    $('#btnDoneChapter').addEventListener('click', doneChapter);
    $('#doneNext').addEventListener('click', () => { const nx = nextChapterId(curChapterId); hideDoneBar(); if (nx) selectChapter(nx); else newChapter(); });
    $('#doneNew').addEventListener('click', () => { hideDoneBar(); newChapter(); });
    $('#doneStay').addEventListener('click', hideDoneBar);
    $('#tocSearch').addEventListener('input', (e) => { tocFilter = e.target.value; renderTOC(); });
    $('#tocTree').addEventListener('click', async (e) => {
      const ch = e.target.closest('.toc-chapter'); if (ch) { selectChapter(ch.dataset.id); return; }
      const act = e.target.closest('[data-act]');
      if (act && act.dataset.act === 'add-chap') { newChapterInVolume(act.dataset.id); return; }
      if (act && act.dataset.act === 'rename-vol') {
        const v = activeBook().volumes.find((x) => x.id === act.dataset.id);
        const name = await showPrompt('分卷名称', v.name);
        if (name != null) { v.name = name; renderTOC(); scheduleSave(); }
        return;
      }
      if (act && act.dataset.act === 'del-vol') { deleteVolume(act.dataset.id); return; }
      const nameEl = e.target.closest('.vol-name');
      if (nameEl) { const vol = nameEl.closest('.toc-volume'); if (vol) toggleVolume(vol.dataset.id); }
    });
    $('#tocTree').addEventListener('dragstart', onDragStart);
    $('#tocTree').addEventListener('dragover', onDragOver);
    $('#tocTree').addEventListener('dragleave', onDragLeave);
    $('#tocTree').addEventListener('drop', onDrop);

    // 自定义 prompt / confirm（Electron 不支持原生 window.prompt/confirm）
    $('#btnNewNote').addEventListener('click', () => openNote(null));
    $('#btnRefreshChars').addEventListener('click', refreshCharacters);
    const promptOk = $('#promptOk'), promptCancel = $('#promptCancel'), promptClose = $('#promptClose'), promptInput = $('#promptInput');
    if (promptOk) promptOk.addEventListener('click', () => closePrompt(promptInput ? promptInput.value : null));
    if (promptCancel) promptCancel.addEventListener('click', () => closePrompt(null));
    if (promptClose) promptClose.addEventListener('click', () => closePrompt(null));
    if (promptInput) promptInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); closePrompt(promptInput.value); } if (e.key === 'Escape') closePrompt(null); });
    const confirmOk = $('#confirmOk'), confirmCancel = $('#confirmCancel'), confirmClose = $('#confirmClose');
    if (confirmOk) confirmOk.addEventListener('click', () => closeConfirm(true));
    if (confirmCancel) confirmCancel.addEventListener('click', () => closeConfirm(false));
    if (confirmClose) confirmClose.addEventListener('click', () => closeConfirm(false));
    $('#noteList').addEventListener('click', (e) => {
      const chap = e.target.closest('.ci-chap');
      if (chap) { selectChapter(chap.dataset.id); return; }
      const act = e.target.closest('.ci-action');
      if (act && act.dataset.act === 'ignore') { const item = act.closest('.character-item'); if (item) ignoreCharacter(item.dataset.id); return; }
      const item = e.target.closest('.character-item');
      if (item) {
        const chaps = item.querySelector('.ci-chapters');
        if (chaps && !e.target.closest('.ci-action')) chaps.hidden = !chaps.hidden;
        return;
      }
      const c = e.target.closest('.note-card');
      if (c) openNote(c.dataset.id);
    });
    $('#noteSave').addEventListener('click', saveNote);
    $('#noteClose').addEventListener('click', () => closeDrawer('noteDrawer'));
    $('#noteDelete').addEventListener('click', deleteNote);
    $('#noteCat').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) { editingNoteCat = b.dataset.v; setSeg('noteCat', b.dataset.v); } });

    // 编辑器
    $('#editor').addEventListener('input', () => {
      const f = findChapter(curChapterId);
      if (f) { f.ch.html = editor.innerHTML; f.ch.words = countWords(editor.textContent); f.ch.updatedAt = Date.now(); }
      markNonEmpty(); updateWordsLive(); updateCursorInfo(); scheduleSave(); updateGoal();
      showTyping();
    });
    $('#editor').addEventListener('blur', () => { if (S && S.autoFormat) formatCurrentChapter(false); });

    // 正文右键菜单（选中文字后弹出：添加为人名 / 存为素材 / 查找此词）
    const editorMenu = $('#editorMenu');
    let editorMenuText = '';
    function hideEditorMenu() { if (editorMenu) editorMenu.classList.remove('show'); }
    if (editorMenu) {
      $('#editor').addEventListener('contextmenu', (e) => {
        const sel = window.getSelection();
        const text = sel ? sel.toString().trim() : '';
        if (!text) { hideEditorMenu(); return; }
        e.preventDefault();
        editorMenuText = text;
        editorMenu.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
        editorMenu.style.top = Math.min(e.clientY, window.innerHeight - 120) + 'px';
        editorMenu.classList.add('show');
      });
      editorMenu.addEventListener('click', (e) => {
        const it = e.target.closest('.ctx-item'); if (!it) return;
        const act = it.dataset.act; const text = editorMenuText; hideEditorMenu();
        if (act === 'add-char') addCharacterManual(text);
        else if (act === 'add-note') openNoteWithText(text);
        else if (act === 'find') { const fi = $('#findInput'); if (fi) fi.value = text; $('#findBar').classList.add('show'); findGo(1); }
      });
      document.addEventListener('mousedown', (e) => { if (!e.target.closest('#editorMenu')) hideEditorMenu(); });
      window.addEventListener('blur', hideEditorMenu);
      $('#editor').addEventListener('scroll', hideEditorMenu);
    }
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
    $('#setTheme').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) onSettingChange({ theme: b.dataset.v }); });
    $('#setFontFamily').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) onSettingChange({ fontFamily: b.dataset.v }); });
    $('#setBg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]'); if (!b) return;
      if (b.dataset.v === 'custom') {
        const picker = $('#setBgColor');
        if (picker) { picker.style.display = ''; picker.click(); }
      }
      onSettingChange({ bg: b.dataset.v });
    });
    $('#setBgColor').addEventListener('input', onSettingChange);
    $('#setBgColor').addEventListener('change', onSettingChange);
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
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        try { flushChapter(); } catch (er) {}
        const snapped = takeSnapshot(true);
        scheduleSave();
        toast(snapped ? '已保存并生成历史版本' : '已保存');
      }
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
    // 暴露全局对话框（供 store.js 等使用），Electron 下原生 prompt/confirm 不可用
    try { window.MoyeDialogs = { confirm: showConfirm, prompt: showPrompt }; } catch (e) {}
    // 测试/外部集成钩子（不影响正常使用）
    try { window.__moyeDb = db; window.__testRefreshCharacters = refreshCharacters; } catch (e) {}
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
    try { window.__moyeDb = db; window.__testRefreshCharacters = refreshCharacters; } catch (e) {}
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
