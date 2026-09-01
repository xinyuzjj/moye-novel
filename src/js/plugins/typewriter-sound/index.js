/* 打字音效插件：写作时实时合成键盘声，6 种音色可选，带音量调节与试听。
 * 音效全部用 Web Audio 现场合成，不需要任何音频文件，也不联网。
 * 监听 #editor 的 keydown 事件；设置存 db.plugins（ctx.getSetting / ctx.setSetting）。
 */
(function () {
  'use strict';

  const PRESETS = {
    mech:       { name: '机械键盘',   desc: '清脆的咔哒声，带一点低频“thock”。' },
    typewriter: { name: '老式打字机', desc: '厚重的铛铛声，回车带一声清脆的铃。' },
    soft:       { name: '柔和',       desc: '安静绵软的滴答，适合深夜码字。' },
    wood:       { name: '木鱼',       desc: '清脆的木质敲击声。' },
    rain:       { name: '雨滴',       desc: '细密的雨声水滴，沙沙作响。' },
    retro:      { name: '复古游戏',   desc: '8-bit 方波音，敲起来像老游戏机。' }
  };

  function noiseBuffer(ac, dur) {
    const n = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) { const env = Math.pow(1 - i / n, 3); d[i] = (Math.random() * 2 - 1) * env; }
    return buf;
  }

  window.MoyePlugins.register({
    id: 'typewriter-sound',
    name: '打字音效',
    activate(ctx) {
      this._ctx = ctx;
      this.enabled = ctx.getSetting('tsEnabled', true);
      this.preset = ctx.getSetting('tsPreset', 'mech');
      this.volume = (ctx.getSetting('tsVolume', 60) || 60) / 100;
      this.audioCtx = null;
      this.master = null;
      this._onKey = (e) => this.onKey(e);
      this._ensure = () => this.ensureAudio();

      ctx.ui.addSettingsSection({
        title: '打字音效',
        render: (c) => this.renderSettings(c)
      });

      const ed = document.getElementById('editor');
      if (ed) ed.addEventListener('keydown', this._onKey);
      // 任意一次用户手势后解锁 AudioContext（浏览器/Electron 自动播放策略）
      document.addEventListener('keydown', this._ensure, { once: true });
      document.addEventListener('pointerdown', this._ensure, { once: true });
    },

    renderSettings(c) {
      const ctx = this._ctx;

      // 启用开关
      const enRow = document.createElement('label');
      enRow.className = 'set-check';
      enRow.innerHTML = '<input type="checkbox" id="tsEnabled"' + (this.enabled ? ' checked' : '') + '> 启用打字音效';
      c.appendChild(enRow);
      enRow.querySelector('#tsEnabled').addEventListener('change', (e) => {
        this.enabled = e.target.checked;
        ctx.setSetting('tsEnabled', this.enabled);
        if (this.enabled) this.ensureAudio();
      });

      // 音效预设（seg 分段按钮）
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.style.margin = '8px 0';
      Object.keys(PRESETS).forEach((k) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.v = k;
        b.textContent = PRESETS[k].name;
        if (k === this.preset) b.classList.add('active');
        b.addEventListener('click', () => {
          this.preset = k;
          ctx.setSetting('tsPreset', k);
          seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.v === k));
          hint.textContent = PRESETS[k].desc;
        });
        seg.appendChild(b);
      });
      c.appendChild(seg);
      const hint = document.createElement('div');
      hint.className = 'muted';
      hint.style.cssText = 'font-size:12px;margin:2px 0 8px;line-height:1.5';
      hint.textContent = PRESETS[this.preset].desc;
      c.appendChild(hint);

      // 音量
      const volRow = document.createElement('div');
      volRow.className = 'tool-row';
      volRow.style.marginTop = '4px';
      const volPct = Math.round(this.volume * 100);
      volRow.innerHTML =
        '<span class="muted" style="font-size:12px">音量</span>' +
        '<input type="range" id="tsVol" min="0" max="100" value="' + volPct + '" style="flex:1">' +
        '<b id="tsVolVal" style="font-size:12px;width:36px;text-align:right">' + volPct + '</b>';
      c.appendChild(volRow);
      const volInput = volRow.querySelector('#tsVol');
      const volVal = volRow.querySelector('#tsVolVal');
      volInput.addEventListener('input', () => {
        this.volume = (+volInput.value) / 100;
        volVal.textContent = volInput.value;
        if (this.master) this.master.gain.value = this.volume * 0.95;
        ctx.setSetting('tsVolume', +volInput.value);
      });

      // 试听
      const tryBtn = document.createElement('button');
      tryBtn.className = 'mini-btn primary';
      tryBtn.textContent = '试听一下';
      tryBtn.style.marginTop = '8px';
      tryBtn.addEventListener('click', () => {
        this.ensureAudio();
        this.play('KeyA', 'KeyA');
        setTimeout(() => this.play('Space', 'Space'), 90);
        setTimeout(() => this.play('Enter', 'Enter'), 180);
      });
      c.appendChild(tryBtn);
    },

    ensureAudio() {
      if (this.audioCtx) {
        if (this.audioCtx.state === 'suspended') { try { this.audioCtx.resume(); } catch (e) {} }
        return;
      }
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AC();
        this.master = this.audioCtx.createGain();
        this.master.gain.value = (this.volume || 0.6) * 0.95;
        this.master.connect(this.audioCtx.destination);
      } catch (e) { this.audioCtx = null; }
    },

    onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!this.enabled) return;
      this.ensureAudio();
      this.play(e.key, e.code);
    },

    play(key, code) {
      if (!this.audioCtx || !this.master) return;
      const isEnter = key === 'Enter';
      const isBack = key === 'Backspace';
      const isSpace = key === ' ';
      const isChar = (key && key.length === 1) || (code && /^Key|^Digit|^Numpad|^Period|^Comma/.test(code));
      if (!isEnter && !isBack && !isSpace && !isChar) return;
      const k = { isEnter, isBack, isSpace };
      const p = this.preset || 'mech';
      if (p === 'mech') this._mech(k);
      else if (p === 'typewriter') this._typewriter(k);
      else if (p === 'soft') this._soft(k);
      else if (p === 'wood') this._wood(k);
      else if (p === 'rain') this._rain(k);
      else if (p === 'retro') this._retro(k);
      else this._mech(k);
    },

    /* ───── 机械键盘：噪声脉冲 + 低频 thock ───── */
    _mech(k) {
      const ac = this.audioCtx, t = ac.currentTime;
      const src = ac.createBufferSource(); src.buffer = noiseBuffer(ac, 0.045);
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = 1800 + Math.random() * 1000; bp.Q.value = 0.9;
      const g = ac.createGain(); g.gain.value = 0.85;
      src.connect(bp); bp.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + 0.05);
      const o = ac.createOscillator(); o.type = 'triangle';
      o.frequency.value = (k.isEnter ? 150 : k.isSpace ? 120 : 165) + Math.random() * 30;
      const og = ac.createGain();
      og.gain.setValueAtTime(0.5, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      o.connect(og); og.connect(this.master);
      o.start(t); o.stop(t + 0.06);
      if (k.isEnter) this._bell(t);
    },

    /* ───── 老式打字机：更沉的咔哒 + 回车铃 ───── */
    _typewriter(k) {
      const ac = this.audioCtx, t = ac.currentTime;
      const src = ac.createBufferSource(); src.buffer = noiseBuffer(ac, 0.06);
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = 700 + Math.random() * 400; bp.Q.value = 2;
      const g = ac.createGain(); g.gain.value = 0.95;
      src.connect(bp); bp.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + 0.065);
      const o = ac.createOscillator(); o.type = 'square';
      o.frequency.value = (k.isEnter ? 200 : 180) + Math.random() * 25;
      const og = ac.createGain();
      og.gain.setValueAtTime(0.6, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      o.connect(og); og.connect(this.master);
      o.start(t); o.stop(t + 0.08);
      if (k.isEnter) this._bell(t);
    },

    _bell(t) {
      const ac = this.audioCtx;
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = 1180;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.35);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.4);
    },

    /* ───── 柔和：正弦滴答 ───── */
    _soft(k) {
      const ac = this.audioCtx, t = ac.currentTime;
      const o = ac.createOscillator(); o.type = 'sine';
      const base = k.isEnter ? 880 : k.isSpace ? 520 : 660 + Math.floor(Math.random() * 120);
      o.frequency.value = base;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.07);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.09);
    },

    /* ───── 木鱼：木质短促敲击 ───── */
    _wood(k) {
      const ac = this.audioCtx, t = ac.currentTime;
      const o = ac.createOscillator(); o.type = 'triangle';
      o.frequency.value = (k.isEnter ? 500 : k.isSpace ? 380 : 440) + Math.random() * 80;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.7, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.05);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.07);
    },

    /* ───── 雨滴：高频滤波噪声水滴 ───── */
    _rain(k) {
      const ac = this.audioCtx, t = ac.currentTime;
      const src = ac.createBufferSource(); src.buffer = noiseBuffer(ac, 0.05);
      const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400;
      const g = ac.createGain(); g.gain.value = 0.65;
      src.connect(hp); hp.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + 0.05);
    },

    /* ───── 复古游戏：8-bit 方波 ───── */
    _retro(k) {
      const ac = this.audioCtx, t = ac.currentTime;
      const scale = [523, 587, 659, 784, 880];
      const o = ac.createOscillator(); o.type = 'square';
      o.frequency.value = k.isEnter ? 1046 : scale[Math.floor(Math.random() * scale.length)];
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.06);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.08);
    },

    deactivate() {
      try { document.getElementById('editor').removeEventListener('keydown', this._onKey); } catch (e) {}
      try { document.removeEventListener('keydown', this._ensure); document.removeEventListener('pointerdown', this._ensure); } catch (e) {}
      try { if (this.audioCtx) this.audioCtx.close(); } catch (e) {}
      this.audioCtx = null; this.master = null;
    }
  });
})();
