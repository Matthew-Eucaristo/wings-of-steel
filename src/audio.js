import { clamp } from './util.js';

// Fully procedural WebAudio: no samples. Noise + filters + oscillators.
export class Audio {
  constructor(game) {
    this.game = game; this.ctx = null; this.enabled = true; this.musicOn = true;
  }
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    // reverb send
    this.verb = ctx.createConvolver(); this.verb.buffer = this.impulse(2.6);
    this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.35;
    this.verb.connect(this.verbGain); this.verbGain.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // brown noise for rumble
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    // continuous wind + gas loops
    this.wind = this.loop(this.noise, 'bandpass', 600, 0.6);
    this.gasL = this.loop(this.noise, 'highpass', 2500, 0.5);
    this.music();
  }
  impulse(sec) {
    const ctx = this.ctx, len = ctx.sampleRate * sec, buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    return buf;
  }
  loop(buf, type, freq, q) {
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    return { src, f, g };
  }
  // spatial helper: returns [gainNode] connected to master with pan/attenuation
  out(pos, vol = 1, verb = 0.2, ref = 30) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let v = vol, pan = 0;
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
    if (verb > 0) { const s = ctx.createGain(); s.gain.value = verb; p.connect(s); s.connect(this.verb); }
    return g;
  }
  burst(dest, { buf, type = 'bandpass', f0 = 1000, f1 = f0, q = 1, dur = 0.3, att = 0.005, vol = 1, rate = 1 }) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = buf || this.noise; src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }
  tone(dest, { type = 'sine', f0 = 440, f1 = f0, dur = 0.2, vol = 0.3, att = 0.005 }) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  ok() { return this.ctx && this.enabled && this.ctx.state === 'running'; }

  hookFire(side) { if (!this.ok()) return; const o = this.out(null, 0.5, 0.05); this.burst(o, { type: 'highpass', f0: 3000, f1: 6000, dur: 0.12, vol: 0.5 }); this.tone(o, { type: 'square', f0: 220, f1: 90, dur: 0.06, vol: 0.12 }); this.burst(o, { f0: 2600, f1: 1400, q: 8, dur: 0.35, vol: 0.2, att: 0.03 }); }
  hookHit(pos, flesh) { if (!this.ok()) return; const o = this.out(pos, 0.9, 0.3, 20); if (flesh) this.burst(o, { type: 'lowpass', f0: 900, f1: 200, dur: 0.18, vol: 0.8 }); else { this.burst(o, { f0: 3200, f1: 1800, q: 3, dur: 0.12, vol: 0.9 }); this.tone(o, { type: 'triangle', f0: 1800, f1: 1500, dur: 0.15, vol: 0.08 }); } }
  hookRetract() { if (!this.ok()) return; const o = this.out(null, 0.25, 0); this.burst(o, { f0: 1500, f1: 3500, q: 6, dur: 0.25, vol: 0.25, att: 0.02 }); }
  jump() { if (!this.ok()) return; this.burst(this.out(null, 0.3, 0), { type: 'lowpass', f0: 600, f1: 200, dur: 0.12, vol: 0.4 }); }
  slash(speed) { if (!this.ok()) return; const o = this.out(null, 0.6 + Math.min(0.4, speed / 80), 0.1); this.burst(o, { f0: 1800, f1: 5200, q: 2, dur: 0.22, vol: 0.9, att: 0.03 }); this.tone(o, { type: 'sawtooth', f0: 3000, f1: 2400, dur: 0.18, vol: 0.03 }); }
  spin() { if (!this.ok()) return; const o = this.out(null, 0.7, 0.2); for (let i = 0; i < 4; i++) setTimeout(() => this.burst(o, { f0: 1500 + i * 400, f1: 5000, q: 2, dur: 0.16, vol: 0.7, att: 0.02 }), i * 90); }
  flesh(pos, big) { if (!this.ok()) return; const o = this.out(pos, big ? 1.4 : 0.9, 0.3, 25); this.burst(o, { type: 'lowpass', f0: 2200, f1: 300, dur: big ? 0.5 : 0.25, vol: 1 }); this.burst(o, { f0: 5000, f1: 7000, q: 1, dur: 0.08, vol: 0.5 }); this.burst(o, { type: 'highpass', f0: 1200, f1: 400, dur: big ? 1.6 : 0.6, vol: 0.25, att: 0.1 }); }
  clang(pos) { if (!this.ok()) return; const o = this.out(pos, 0.7, 0.4); this.tone(o, { type: 'triangle', f0: 2100, f1: 1900, dur: 0.4, vol: 0.15 }); this.burst(o, { f0: 4000, f1: 2500, q: 5, dur: 0.1, vol: 0.6 }); }
  bladeBreak() { if (!this.ok()) return; const o = this.out(null, 0.8, 0.3); this.tone(o, { type: 'square', f0: 3200, f1: 800, dur: 0.25, vol: 0.12 }); this.burst(o, { f0: 6000, f1: 2000, q: 2, dur: 0.3, vol: 0.6 }); }
  bladeSwap() { if (!this.ok()) return; const o = this.out(null, 0.6, 0.1); this.tone(o, { type: 'triangle', f0: 1400, f1: 1200, dur: 0.1, vol: 0.1 }); setTimeout(() => this.burst(o, { f0: 3000, f1: 5000, q: 3, dur: 0.18, vol: 0.5 }), 120); }
  click() { if (!this.ok()) return; this.tone(this.out(null, 0.3, 0), { type: 'square', f0: 300, f1: 200, dur: 0.05, vol: 0.1 }); }
  struggle() { if (!this.ok()) return; this.burst(this.out(null, 0.5, 0.2), { type: 'lowpass', f0: 500, f1: 150, dur: 0.15, vol: 0.6 }); }
  hurt() { if (!this.ok()) return; const o = this.out(null, 0.9, 0.2); this.burst(o, { buf: this.brown, type: 'lowpass', f0: 400, f1: 60, dur: 0.5, vol: 1.4 }); }
  land(v) { if (!this.ok()) return; this.burst(this.out(null, Math.min(1, v / 20), 0.1), { buf: this.brown, type: 'lowpass', f0: 500, f1: 80, dur: 0.25, vol: 1.2 }); }
  dash() { if (!this.ok()) return; const o = this.out(null, 0.7, 0.1); this.burst(o, { type: 'highpass', f0: 1200, f1: 3000, dur: 0.35, vol: 0.8, att: 0.01 }); }
  step(pos, size) { if (!this.ok()) return; const o = this.out(pos, 0.6 + size * 0.08, 0.5, 70); this.burst(o, { buf: this.brown, type: 'lowpass', f0: 260, f1: 40, dur: 0.7, vol: 1.6 }); this.tone(o, { f0: 55, f1: 30, dur: 0.5, vol: 0.5 }); }
  fall(pos, size) { if (!this.ok()) return; const o = this.out(pos, 1.6, 0.8, 90); this.burst(o, { buf: this.brown, type: 'lowpass', f0: 400, f1: 30, dur: 2.2, vol: 2.2, att: 0.02 }); this.tone(o, { f0: 50, f1: 22, dur: 1.6, vol: 0.9 }); }
  roar(pos, height, vol = 1) {
    if (!this.ok()) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this.out(pos, vol * 1.4, 0.7, 60);
    const base = 140 / Math.sqrt(height / 6), dur = 0.9 + vol * 0.8;
    for (const det of [1, 1.51, 2.02]) {
      const os = ctx.createOscillator(); os.type = 'sawtooth';
      os.frequency.setValueAtTime(base * det * 0.8, t); os.frequency.linearRampToValueAtTime(base * det * 1.15, t + dur * 0.3); os.frequency.linearRampToValueAtTime(base * det * 0.7, t + dur);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 4;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      os.connect(f); f.connect(g); g.connect(o); os.start(t); os.stop(t + dur + 0.05);
    }
    this.burst(o, { type: 'bandpass', f0: 500, f1: 300, q: 1, dur, vol: 0.4, att: 0.1 });
  }
  thunder() { if (!this.ok()) return; const o = this.out(null, 1.5, 1); this.burst(o, { buf: this.brown, type: 'lowpass', f0: 800, f1: 40, dur: 3, vol: 2.5, att: 0.01 }); this.burst(o, { type: 'highpass', f0: 2000, f1: 200, dur: 0.6, vol: 0.5 }); }

  update(dt) {
    if (!this.ok()) return;
    const p = this.game.player, t = this.ctx.currentTime;
    const s = p.speed;
    this.wind.g.gain.setTargetAtTime(clamp((s - 4) / 50, 0, 1) * 0.55 + 0.03, t, 0.1);
    this.wind.f.frequency.setTargetAtTime(300 + s * 25, t, 0.1);
    this.gasL.g.gain.setTargetAtTime(p.gasOn ? 0.22 : 0, t, 0.04);
    if (this.mus) this.mus.g.gain.setTargetAtTime(this.musicOn ? (this.game.intensity || 0) * 0.16 + 0.05 : 0, t, 0.8);
  }
  // sparse heroic drone + timpani pulse driven by combat intensity
  music() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0; g.connect(this.master);
    const s = ctx.createGain(); s.gain.value = 0.6; g.connect(s); s.connect(this.verb);
    const notes = [55, 82.4, 110, 130.8, 164.8];
    for (const n of notes) for (const det of [-3, 3]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = n; o.detune.value = det;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + Math.random() * 0.1;
      const lg = ctx.createGain(); lg.gain.value = 250; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
      const og = ctx.createGain(); og.gain.value = 0.05;
      o.connect(f); f.connect(og); og.connect(g); o.start();
    }
    this.mus = { g };
    let beat = 0;
    this.musTimer = setInterval(() => {
      if (!this.ok() || !this.musicOn) return;
      const I = this.game.intensity || 0;
      beat++;
      if (I > 0.25 && beat % 2 === 0) this.tone(g, { f0: 90, f1: 45, dur: 0.4, vol: 0.6 * I });
      if (I > 0.6 && beat % 4 === 1) this.burst(g, { buf: this.brown, type: 'lowpass', f0: 300, f1: 60, dur: 0.3, vol: 1.2 * I });
    }, 230);
  }
}
