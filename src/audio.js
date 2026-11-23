import { clamp } from './util.js';

export class Audio {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.enabled = true;
    this.musicOn = true;
    this.masterVol = 0.8;
    this.sfxVol = 1.0;
    this.beatAcc = 0;
    this.beatStep = 0;
  }
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.masterVol;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(2.4);
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.32;
    this.verb.connect(this.verbGain);
    this.verbGain.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }
    this.wind = this.loop(this.noise, 'bandpass', 600, 0.6);
    this.gasL = this.loop(this.noise, 'highpass', 2500, 0.5);
    this.spinL = this.loop(this.noise, 'bandpass', 900, 4);
    this.music();
  }
  setVolume(v) {
    this.masterVol = clamp(v, 0, 1);
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.masterVol, this.ctx.currentTime, 0.04);
  }
  impulse(sec) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }
  loop(buf, type, freq, q) {
    const ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    return { src, f, g };
  }
  out(pos, vol = 1, verb = 0.2, ref = 30) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let v = vol * this.sfxVol, pan = 0;
    if (pos) {
      const cam = this.game.cam;
      const dx = pos.x - cam.camera.position.x, dy = pos.y - cam.camera.position.y, dz = pos.z - cam.camera.position.z;
      const d = Math.hypot(dx, dy, dz);
      v *= ref / (ref + d);
      pan = clamp((dx * cam.right.x + dz * cam.right.z) / (d + 1), -1, 1) * 0.8;
    }
    g.gain.value = v;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    g.connect(p); p.connect(this.master);
    if (verb > 0) {
      const s = ctx.createGain(); s.gain.value = verb;
      p.connect(s); s.connect(this.verb);
    }
    return g;
  }
  burst(dest, { buf, type = 'bandpass', f0 = 1000, f1 = f0, q = 1, dur = 0.3, att = 0.005, vol = 1, rate = 1, delay = 0 }) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = buf || this.noise; src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(20, f0), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random() * 1.2);
    src.stop(t + dur + 0.05);
  }
  tone(dest, { type = 'sine', f0 = 440, f1 = f0, dur = 0.2, vol = 0.3, att = 0.005, delay = 0 }) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  ok() { return !!(this.ctx && this.enabled && this.ctx.state === 'running'); }

  hookFire() {
    if (!this.ok()) return;
    const o = this.out(null, 0.5, 0.05);
    this.burst(o, { type: 'highpass', f0: 3000, f1: 6000, dur: 0.12, vol: 0.5 });
    this.tone(o, { type: 'square', f0: 220, f1: 90, dur: 0.06, vol: 0.12 });
    this.burst(o, { f0: 2600, f1: 1400, q: 8, dur: 0.32, vol: 0.2, att: 0.03 });
  }
  hookHit(pos, flesh) {
    if (!this.ok()) return;
    const o = this.out(pos, 0.9, 0.3, 22);
    if (flesh) this.burst(o, { type: 'lowpass', f0: 900, f1: 200, dur: 0.18, vol: 0.8 });
    else {
      this.burst(o, { f0: 3200, f1: 1800, q: 3, dur: 0.12, vol: 0.9 });
      this.tone(o, { type: 'triangle', f0: 1800, f1: 1500, dur: 0.15, vol: 0.08 });
    }
  }
  hookRetract() {
    if (!this.ok()) return;
    const o = this.out(null, 0.25, 0);
    this.burst(o, { f0: 1500, f1: 3500, q: 6, dur: 0.22, vol: 0.24, att: 0.02 });
  }
  jump() {
    if (!this.ok()) return;
    this.burst(this.out(null, 0.3, 0), { type: 'lowpass', f0: 600, f1: 200, dur: 0.12, vol: 0.4 });
  }
  slash(speed) {
    if (!this.ok()) return;
    const o = this.out(null, 0.6 + Math.min(0.4, speed / 80), 0.1);
    this.burst(o, { f0: 1800, f1: 5400, q: 2, dur: 0.2, vol: 0.9, att: 0.02 });
    this.tone(o, { type: 'sawtooth', f0: 3200, f1: 2300, dur: 0.16, vol: 0.04 });
  }
  spin() {
    if (!this.ok()) return;
    const o = this.out(null, 0.7, 0.2);
    for (let i = 0; i < 4; i++) {
      this.burst(o, { f0: 1500 + i * 400, f1: 5200, q: 2, dur: 0.15, vol: 0.7, att: 0.02, delay: i * 0.085 });
    }
  }
  hitImpact(heavy) {
    if (!this.ok()) return;
    const o = this.out(null, heavy ? 1.35 : 0.85, 0.22);
    this.tone(o, { type: 'sine', f0: heavy ? 140 : 165, f1: 26, dur: heavy ? 0.38 : 0.18, vol: heavy ? 0.95 : 0.55, att: 0.001 });
    this.burst(o, { buf: this.brown, type: 'lowpass', f0: 420, f1: 48, dur: heavy ? 0.32 : 0.14, vol: heavy ? 1.1 : 0.5, att: 0.001 });
    this.burst(o, { f0: 4400, f1: 950, q: 2.2, dur: 0.11, vol: heavy ? 0.9 : 0.5, att: 0.001 });
    if (heavy) {
      this.tone(o, { type: 'triangle', f0: 2600, f1: 1200, dur: 0.24, vol: 0.18, att: 0.002 });
      this.burst(o, { type: 'highpass', f0: 2400, f1: 6200, dur: 0.26, vol: 0.55, att: 0.01, delay: 0.11 });
    }
  }
  flesh(pos, big) {
    if (!this.ok()) return;
    const o = this.out(pos, big ? 1.35 : 0.9, 0.3, 28);
    this.burst(o, { type: 'lowpass', f0: 2200, f1: 300, dur: big ? 0.48 : 0.24, vol: 1 });
    this.burst(o, { f0: 5000, f1: 7000, q: 1, dur: 0.08, vol: 0.5 });
    this.burst(o, { type: 'highpass', f0: 1200, f1: 400, dur: big ? 1.4 : 0.55, vol: 0.25, att: 0.08 });
    this.hitImpact(big);
  }
  limbSever(pos) {
    if (!this.ok()) return;
    const o = this.out(pos, 1.15, 0.35, 30);
    this.burst(o, { type: 'lowpass', f0: 1800, f1: 180, dur: 0.42, vol: 1.1, att: 0.002 });
    this.burst(o, { f0: 3600, f1: 900, q: 2.5, dur: 0.14, vol: 0.8 });
    this.hitImpact(false);
  }
  rocketLaunch() {
    if (!this.ok()) return;
    const o = this.out(null, 1.0, 0.28);
    this.burst(o, { buf: this.brown, type: 'lowpass', f0: 680, f1: 120, dur: 0.45, vol: 1.2, att: 0.003 });
    this.burst(o, { type: 'bandpass', f0: 1600, f1: 4800, q: 3.5, dur: 0.55, vol: 0.85, att: 0.01 });
    this.tone(o, { type: 'sawtooth', f0: 520, f1: 1680, dur: 0.35, vol: 0.14, att: 0.01 });
  }
  fuseBeep(pos, pitch = 1) {
    if (!this.ok()) return;
    const o = this.out(pos, 0.65, 0.15, 45);
    this.tone(o, { type: 'square', f0: 1650 * pitch, f1: 1850 * pitch, dur: 0.06, vol: 0.16, att: 0.002 });
  }
  boulderThrow(pos) {
    if (!this.ok()) return;
    const o = this.out(pos, 1.2, 0.5, 80);
    this.burst(o, { buf: this.brown, type: 'lowpass', f0: 360, f1: 60, dur: 0.85, vol: 1.7, att: 0.01 });
  }
  clang(pos) {
    if (!this.ok()) return;
    const o = this.out(pos, 0.8, 0.4);
    this.tone(o, { type: 'triangle', f0: 2200, f1: 1850, dur: 0.38, vol: 0.18 });
    this.tone(o, { type: 'sine', f0: 3420, f1: 3100, dur: 0.25, vol: 0.1 });
    this.burst(o, { f0: 4200, f1: 2400, q: 5, dur: 0.1, vol: 0.65 });
  }
  armorShatter(pos) {
    if (!this.ok()) return;
    const o = this.out(pos, 1.25, 0.45, 35);
    this.burst(o, { buf: this.brown, type: 'lowpass', f0: 620, f1: 65, dur: 0.65, vol: 1.5, att: 0.004 });
    this.tone(o, { type: 'sawtooth', f0: 1450, f1: 420, dur: 0.32, vol: 0.18 });
    this.burst(o, { f0: 4800, f1: 1400, q: 2.2, dur: 0.26, vol: 0.85 });
    this.hitImpact(true);
  }
  cannonBoom(pos) {
    if (!this.ok()) return;
    const o = this.out(pos, 1.4, 0.75, 85);
    this.burst(o, { buf: this.brown, type: 'lowpass', f0: 520, f1: 38, dur: 1.4, vol: 1.9, att: 0.004 });
    this.tone(o, { type: 'sine', f0: 88, f1: 28, dur: 0.65, vol: 0.65, att: 0.004 });
  }
  flareLaunch() {
    if (!this.ok()) return;
    const o = this.out(null, 0.7, 0.35);
    this.burst(o, { type: 'bandpass', f0: 1400, f1: 3800, q: 6, dur: 0.55, vol: 0.58, att: 0.02 });
    this.tone(o, { type: 'sine', f0: 950, f1: 2450, dur: 0.5, vol: 0.16, att: 0.03 });
  }
  squadAck() {
    if (!this.ok()) return;
    const o = this.out(null, 0.45, 0.1);
    this.tone(o, { type: 'triangle', f0: 660, f1: 880, dur: 0.09, vol: 0.14 });
    this.tone(o, { type: 'triangle', f0: 880, f1: 1120, dur: 0.11, vol: 0.14, delay: 0.08 });
  }
  horn() {
    if (!this.ok()) return;
    const o = this.out(null, 0.75, 0.65);
    this.tone(o, { type: 'sawtooth', f0: 196, f1: 196, dur: 1.1, vol: 0.12, att: 0.15 });
    this.tone(o, { type: 'triangle', f0: 293.7, f1: 294, dur: 1.2, vol: 0.14, att: 0.18 });
  }
  bladeBreak() {
    if (!this.ok()) return;
    const o = this.out(null, 0.8, 0.3);
    this.tone(o, { type: 'square', f0: 3200, f1: 800, dur: 0.25, vol: 0.12 });
    this.burst(o, { f0: 6000, f1: 2000, q: 2, dur: 0.3, vol: 0.6 });
  }
  alarm() {
    if (!this.ok()) return;
    const o = this.out(null, 0.55, 0.3);
    for (let i = 0; i < 3; i++) {
      this.tone(o, { type: 'square', f0: 620, f1: 620, dur: 0.16, vol: 0.09, delay: i * 0.44 });
      this.tone(o, { type: 'square', f0: 470, f1: 470, dur: 0.16, vol: 0.09, delay: i * 0.44 + 0.2 });
    }
  }
  bladeSwap() {
    if (!this.ok()) return;
    const o = this.out(null, 0.6, 0.1);
    this.tone(o, { type: 'triangle', f0: 1400, f1: 1200, dur: 0.1, vol: 0.1 });
    this.burst(o, { f0: 3000, f1: 5000, q: 3, dur: 0.18, vol: 0.5, delay: 0.11 });
  }
  click() {
    if (!this.ok()) return;
    this.tone(this.out(null, 0.3, 0), { type: 'square', f0: 340, f1: 220, dur: 0.045, vol: 0.09 });
  }
  struggle() {
    if (!this.ok()) return;
    this.burst(this.out(null, 0.5, 0.2), { type: 'lowpass', f0: 500, f1: 150, dur: 0.15, vol: 0.6 });
  }
  hurt() {
    if (!this.ok()) return;
    const o = this.out(null, 0.9, 0.2);
    this.burst(o, { buf: this.brown, type: 'lowpass', f0: 400, f1: 60, dur: 0.5, vol: 1.4 });
  }
  land(v) {
    if (!this.ok()) return;
    this.burst(this.out(null, Math.min(1, v / 20), 0.1), { buf: this.brown, type: 'lowpass', f0: 500, f1: 80, dur: 0.25, vol: 1.2 });
  }
  dash() {
    if (!this.ok()) return;
    const o = this.out(null, 0.7, 0.1);
    this.burst(o, { type: 'highpass', f0: 1200, f1: 3000, dur: 0.32, vol: 0.78, att: 0.01 });
  }
  step(pos, size) {
    if (!this.ok()) return;
    const o = this.out(pos, 0.6 + size * 0.08, 0.5, 70);
    this.burst(o, { buf: this.brown, type: 'lowpass', f0: 260, f1: 40, dur: 0.7, vol: 1.6 });
    this.tone(o, { f0: 55, f1: 30, dur: 0.5, vol: 0.5 });
  }
  fall(pos, size) {
    if (!this.ok()) return;
    const o = this.out(pos, 1.6, 0.8, 90);
    this.burst(o, { buf: this.brown, type: 'lowpass', f0: 400, f1: 30, dur: 2.2, vol: 2.2, att: 0.02 });
    this.tone(o, { f0: 50, f1: 22, dur: 1.6, vol: 0.9 });
  }
  roar(pos, height, vol = 1, delay = 0) {
    if (!this.ok()) return;
    const ctx = this.ctx, t = ctx.currentTime + delay, o = this.out(pos, vol * 1.4, 0.7, 60);
    const base = 140 / Math.sqrt(height / 6), dur = 0.9 + vol * 0.8;
    for (const det of [1, 1.51, 2.02]) {
      const os = ctx.createOscillator(); os.type = 'sawtooth';
      os.frequency.setValueAtTime(base * det * 0.8, t);
      os.frequency.linearRampToValueAtTime(base * det * 1.15, t + dur * 0.3);
      os.frequency.linearRampToValueAtTime(base * det * 0.7, t + dur);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      os.connect(f); f.connect(g); g.connect(o); os.start(t); os.stop(t + dur + 0.05);
    }
    this.burst(o, { type: 'bandpass', f0: 500, f1: 300, q: 1, dur, vol: 0.4, att: 0.1, delay });
  }
  thunder() {
    if (!this.ok()) return;
    const o = this.out(null, 1.5, 1);
    this.burst(o, { buf: this.brown, type: 'lowpass', f0: 800, f1: 40, dur: 3, vol: 2.5, att: 0.01 });
    this.burst(o, { type: 'highpass', f0: 2000, f1: 200, dur: 0.6, vol: 0.5 });
  }
  whoosh(pos, size = 1) {
    if (!this.ok()) return;
    const o = this.out(pos, 0.9, 0.35, 42);
    this.burst(o, { type: 'bandpass', f0: 240, f1: 950, q: 0.9, dur: 0.34, vol: Math.min(1.5, 0.55 * size + 0.4), att: 0.045 });
    this.burst(o, { buf: this.brown, type: 'lowpass', f0: 460, f1: 130, dur: 0.42, vol: 0.9, att: 0.02 });
  }
  fanfare() {
    if (!this.ok()) return;
    const o = this.out(null, 0.95, 0.6);
    const seq = [196, 247, 294, 392, 494];
    seq.forEach((f, i) => {
      const long = i === seq.length - 1;
      this.tone(o, { type: 'sawtooth', f0: f, f1: f * 1.005, dur: long ? 1.5 : 0.42, vol: 0.1, att: 0.02, delay: i * 0.13 });
      this.tone(o, { type: 'triangle', f0: f * 0.5, f1: f * 0.5, dur: long ? 1.5 : 0.42, vol: 0.13, att: 0.02, delay: i * 0.13 });
    });
    this.burst(o, { f0: 3200, f1: 6200, q: 2, dur: 0.55, vol: 0.3, att: 0.05, delay: seq.length * 0.13 });
  }
  comboSting(n) {
    if (!this.ok()) return;
    const o = this.out(null, 0.4, 0.25);
    const base = 700 + Math.min(n, 10) * 90;
    this.tone(o, { type: 'triangle', f0: base, f1: base * 1.5, dur: 0.12, vol: 0.15 });
    this.tone(o, { type: 'triangle', f0: base * 1.25, f1: base * 1.9, dur: 0.15, vol: 0.11, delay: 0.07 });
  }
  empty() {
    if (!this.ok()) return;
    const o = this.out(null, 0.35, 0);
    this.tone(o, { type: 'square', f0: 220, f1: 140, dur: 0.05, vol: 0.1 });
    this.burst(o, { type: 'highpass', f0: 4200, f1: 2600, dur: 0.11, vol: 0.13 });
  }
  refill(pos) {
    if (!this.ok()) return;
    const o = this.out(pos, 0.5, 0.3, 26);
    this.burst(o, { type: 'bandpass', f0: 2000, f1: 4400, q: 4, dur: 0.42, vol: 0.42, att: 0.05 });
    this.tone(o, { type: 'sine', f0: 880, f1: 1320, dur: 0.32, vol: 0.1, att: 0.02 });
  }
  heartbeat() {
    if (!this.ok()) return;
    const o = this.out(null, 0.7, 0.05);
    this.tone(o, { type: 'sine', f0: 62, f1: 34, dur: 0.15, vol: 0.8, att: 0.002 });
    this.tone(o, { type: 'sine', f0: 55, f1: 30, dur: 0.13, vol: 0.6, att: 0.002, delay: 0.17 });
  }

  update(rdt, active = true) {
    if (!this.ok()) return;
    const p = this.game.player, t = this.ctx.currentTime;
    const s = active ? p.speed : 0;
    this.wind.g.gain.setTargetAtTime(active ? (clamp((s - 4) / 50, 0, 1) * 0.55 + 0.03) * this.sfxVol : 0.01, t, 0.1);
    this.wind.f.frequency.setTargetAtTime(300 + s * 25, t, 0.1);
    this.gasL.g.gain.setTargetAtTime(active && p.gasOn ? 0.22 * this.sfxVol : 0, t, 0.04);
    if (this.spinL) {
      const ch = active && !p.dead ? p.charge || 0 : 0;
      this.spinL.g.gain.setTargetAtTime(ch > 0.05 ? ch * 0.22 * this.sfxVol : 0, t, 0.08);
      this.spinL.f.frequency.setTargetAtTime(650 + ch * 2400, t, 0.08);
    }
    if (active && !p.dead && p.hp < 30 && p.hp > 0) {
      this.heartAcc = (this.heartAcc || 0) + rdt;
      if (this.heartAcc >= 0.55 + (p.hp / 30) * 0.55) { this.heartAcc = 0; this.heartbeat(); }
    } else this.heartAcc = 0;
    this.groanT = (this.groanT ?? 10) - rdt;
    if (this.groanT <= 0) {
      this.groanT = 9 + Math.random() * 9;
      const ts = this.game.titans;
      if (active && ts.length) {
        const far = ts[(Math.random() * ts.length) | 0];
        if (far.alive && far.root.position.distanceTo(p.pos) > 55) this.roar(far.root.position, far.height, 0.13);
      }
    }
    const I = active ? (this.game.intensity || 0) : 0;
    if (this.mus) {
      this.mus.g.gain.setTargetAtTime(this.musicOn && active ? I * 0.16 + 0.045 : 0, t, 0.5);
    }
    if (this.musicOn && active && this.mus) {
      this.beatAcc += rdt;
      if (this.beatAcc >= 0.23) {
        this.beatAcc -= 0.23;
        this.beatStep++;
        if (I > 0.22 && this.beatStep % 2 === 0) this.tone(this.mus.g, { f0: 90, f1: 45, dur: 0.38, vol: 0.58 * I });
        if (I > 0.58 && this.beatStep % 4 === 1) this.burst(this.mus.g, { buf: this.brown, type: 'lowpass', f0: 300, f1: 60, dur: 0.28, vol: 1.15 * I });
      }
    }
  }

  music() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0; g.connect(this.master);
    const s = ctx.createGain(); s.gain.value = 0.6; g.connect(s); s.connect(this.verb);
    const notes = [55, 82.4, 110, 130.8, 164.8];
    for (const n of notes) {
      for (const det of [-3, 3]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = n; o.detune.value = det;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + Math.random() * 0.1;
        const lg = ctx.createGain(); lg.gain.value = 250; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
        const og = ctx.createGain(); og.gain.value = 0.05;
        o.connect(f); f.connect(og); og.connect(g); o.start();
      }
    }
    this.mus = { g };
  }
}
