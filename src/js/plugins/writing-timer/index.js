/* 写作计时 / 番茄钟插件。
 * - 工具栏「计时」按钮打开面板：开始/暂停/重置，显示本次时长、本次新增字数、平均速度（字/分）。
 * - 监听 save / chapterChange 计算字数增量；番茄钟 25 分钟专注 + 5 分钟休息，到点 toast 提醒。
 * - 每日累计（时长/字数）持久化到 db.plugins，面板显示今日统计。 */
(function () {
  'use strict';

  function bookWords(book) {
    let n = 0;
    if (book && book.volumes) book.volumes.forEach((v) => v.chapters.forEach((c) => { n += (c.words || 0); }));
    return n;
  }
  function fmtDur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(ss).padStart(2, '0');
  }
  function dateKey(d) { const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }

  window.MoyePlugins.register({
    id: 'writing-timer',
    name: '写作计时',
    activate(ctx) {
      this._ctx = ctx;
      const KEY = 'writingTimer.';
      // 运行态
      this.running = false;
      this.startTs = 0;
      this.accMs = 0;          // 已累计专注时长
      this.baseWords = 0;      // 计时开始时的字数
      this.curWords = 0;
      this.tick = null;
      this.pomo = false;
      this.pomoEnd = 0;
      this.pomoPhase = '';
      // 读取今日累计
      const dk = dateKey(new Date());
      this.todayKey = KEY + 'day.' + dk;
      this.today = ctx.getSetting(this.todayKey, { ms: 0, words: 0 });

      this.onSave = () => this.refresh();
      ctx.on('save', this.onSave);
      ctx.on('chapterChange', this.onSave);

      this.curWords = bookWords(ctx.getActiveBook());

      ctx.ui.addToolbarButton({
        label: '计时', title: '写作计时 / 番茄钟',
        onClick: () => this.open()
      });
    },

    snapshotDay() {
      const t = this.today;
      this._ctx.setSetting(this.todayKey, { ms: t.ms, words: t.words });
    },

    totalMs() { return this.accMs + (this.running ? Date.now() - this.startTs : 0); },

    refresh() {
      const ctx = this._ctx;
      const w = bookWords(ctx.getActiveBook());
      this.curWords = w;
      const delta = Math.max(0, w - this.baseWords);
      const ms = this.totalMs();
      const speed = ms > 0 ? Math.round(delta / (ms / 60000)) : 0;
      const el = this._panelEls;
      if (!el) return;
      el.dur.textContent = fmtDur(ms);
      el.add.textContent = '+' + delta + ' 字';
      el.spd.textContent = speed + ' 字/分';
      el.today.textContent = fmtDur(this.today.ms) + ' · +' + this.today.words + ' 字';
    },

    open() {
      const ctx = this._ctx;
      ctx.ui.openModal({
        title: '写作计时',
        render: (body) => {
          const wrap = document.createElement('div');
          wrap.innerHTML =
            '<div style="display:flex;gap:18px;align-items:baseline;margin-bottom:10px">' +
            '<div><div style="font-size:30px;font-weight:700" id="wtDur">00:00</div><div class="muted" style="font-size:12px">本次专注</div></div>' +
            '<div><div style="font-size:18px" id="wtAdd">+0 字</div><div class="muted" style="font-size:12px">本次新增</div></div>' +
            '<div><div style="font-size:18px" id="wtSpd">0 字/分</div><div class="muted" style="font-size:12px">平均速度</div></div>' +
            '</div>' +
            '<div class="tool-row" style="margin-bottom:10px">' +
            '<button class="mini-btn primary" id="wtStart">开始</button>' +
            '<button class="mini-btn" id="wtReset">重置</button>' +
            '<label class="set-check" style="margin-left:8px"><input type="checkbox" id="wtPomo"> 番茄钟 25/5</label>' +
            '</div>' +
            '<div id="wtPomoState" class="muted" style="font-size:12px;min-height:16px;margin-bottom:10px"></div>' +
            '<div class="muted" style="font-size:12px">今日累计：<span id="wtToday">—</span></div>';
          body.appendChild(wrap);
          const dur = wrap.querySelector('#wtDur');
          const add = wrap.querySelector('#wtAdd');
          const spd = wrap.querySelector('#wtSpd');
          const todayEl = wrap.querySelector('#wtToday');
          const pomoState = wrap.querySelector('#wtPomoState');
          this._panelEls = { dur, add, spd, today: todayEl };
          this.refresh();

          const startBtn = wrap.querySelector('#wtStart');
          const resetBtn = wrap.querySelector('#wtReset');
          const pomoCb = wrap.querySelector('#wtPomo');

          startBtn.addEventListener('click', () => {
            if (this.running) {
              // 暂停：结算
              this.accMs += Date.now() - this.startTs;
              this.running = false;
              startBtn.textContent = '开始';
              this.stopPomo();
              pomoState.textContent = '';
              this.settleDay();
            } else {
              this.running = true;
              this.startTs = Date.now();
              this.baseWords = bookWords(ctx.getActiveBook());
              startBtn.textContent = '暂停';
              if (pomoCb.checked) this.startPomo(pomoState);
            }
          });

          resetBtn.addEventListener('click', () => {
            this.running = false; this.accMs = 0; this.startTs = 0;
            this.baseWords = bookWords(ctx.getActiveBook());
            this.stopPomo(); pomoState.textContent = '';
            startBtn.textContent = '开始';
            this.refresh();
          });

          pomoCb.addEventListener('change', () => {
            if (pomoCb.checked && this.running) this.startPomo(pomoState);
            else if (!pomoCb.checked) { this.stopPomo(); pomoState.textContent = ''; }
          });
        }
      });
    },

    startPomo(stateEl) {
      this.pomo = true; this.pomoPhase = 'focus'; this.pomoEnd = Date.now() + 25 * 60 * 1000;
      if (stateEl) stateEl.textContent = '番茄钟：专注中，25 分钟后休息';
      this.pomoTimer = setInterval(() => {
        const left = this.pomoEnd - Date.now();
        if (left <= 0) {
          if (this.pomoPhase === 'focus') {
            this._ctx.toast('专注结束，休息 5 分钟 ☕');
            this.pomoPhase = 'break'; this.pomoEnd = Date.now() + 5 * 60 * 1000;
            if (stateEl) stateEl.textContent = '番茄钟：休息中，5 分钟后继续';
          } else {
            this._ctx.toast('休息结束，继续写吧 ✍️');
            this.pomoPhase = 'focus'; this.pomoEnd = Date.now() + 25 * 60 * 1000;
            if (stateEl) stateEl.textContent = '番茄钟：专注中，25 分钟后休息';
          }
        }
      }, 1000);
    },
    stopPomo() {
      this.pomo = false;
      if (this.pomoTimer) { clearInterval(this.pomoTimer); this.pomoTimer = null; }
    },

    settleDay() {
      const delta = Math.max(0, this.curWords - this.baseWords);
      this.today.ms += this.accMs;
      this.today.words += delta;
      this.snapshotDay();
    },

    deactivate() {
      if (this.running) this.settleDay();
      this.stopPomo();
      if (this._ctx && this.onSave) this._ctx.off('save', this.onSave);
      if (this._ctx && this.onSave) this._ctx.off('chapterChange', this.onSave);
    }
  });
})();
