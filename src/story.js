import { WALL_R } from './world.js';
import * as THREE from 'three';
import { Titan } from './titan.js';
import { clamp, lerp } from './util.js';

const $ = (id) => document.getElementById(id);
const V = (a) => new THREE.Vector3(...a);
const ease = (t) => t * t * (3 - 2 * t);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

const BREACH_T = 5.2, END_T = 15.6;
const CUTS = [4.2, 8.8, 12.2];
const CAPS = [
  [0.5, 3.9, 'DISTRIK HALVARD', 'Seratus tahun di balik tembok. Seratus tahun tanpa satu pun titan.'],
  [5.7, 8.6, 'GERBANG SELATAN', '…sampai hari ini.'],
  [9.1, 12.0, 'CELAH TERBUKA', 'Mereka masuk. Gerobak segel Korps Insinyur harus mencapai gerbang.'],
  [12.5, 15.3, 'SKUADRON SAYAP BAJA', 'Tiga rekan di udara. Satu komando. Kamu.'],
];
const STEPS = [
  { title: 'Lihat sekeliling', hint: 'Gerakkan <kbd>Mouse</kbd> untuk mengarahkan pandangan.', check: (s) => s.lookAmt > 550 },
  { title: 'Tembakkan kait', hint: 'Bidik bangunan sampai penanda kait aktif, lalu tahan <kbd>Q</kbd> / <kbd>E</kbd> atau <kbd>Klik Kanan</kbd> (dua kait).', check: (s, p) => p.hooked },
  { title: 'Tarik kabel', hint: 'Sambil menahan kait, tahan <kbd>Spasi</kbd> untuk menggulung kabel berkecepatan tinggi.', check: (s) => s.reelT > 0.65 },
  { title: 'Berayun beruntun', hint: 'Lepas kait di udara lalu kaitkan lagi ke titik berikutnya — <b>2×</b> tanpa menyentuh tanah.', check: (s) => s.airAttach >= 2 },
  { title: 'Jet gas & belokan', hint: 'Tahan <kbd>Shift</kbd> + <kbd>WASD</kbd> untuk berbelok tajam di udara (tap = dash). Tekan <kbd>T</kbd> untuk memerintah skuadron.', check: (s) => s.gasT > 0.45 || s.dashed },
  { title: 'Tebas tengkuk titan', hint: 'Titan terdeteksi! Dekati sampai muncul <b class="r">[KLIK] EKSEKUSI</b>, lalu tebas dengan <kbd>Klik Kiri</kbd>. Makin cepat, makin fatal.', enter: (st) => st.spawnTutorialTitan(), check: (s, p, g) => g.kills >= 1 },
];

export class Story {
  constructor(game) {
    this.game = game;
    this.phase = 'title';
    this.el = { bars: $('bars'), cap: $('cap'), fade: $('fade'), skip: $('skip'), tut: $('tut') };
  }
  get active() { return this.phase === 'intro'; }
  allowWaves() { return this.phase === 'play'; }

  reset(phase = 'title') {
    const g = this.game;
    this.removeColossus();
    if (this.introTitans) {
      for (const ti of this.introTitans) {
        const i = g.titans.indexOf(ti);
        if (i >= 0) g.titans.splice(i, 1);
        ti.dispose();
      }
      this.introTitans = [];
    }
    this.phase = phase;
    this.t = 0; this.breached = false; this.colGone = false; this.cap = null;
    this.step = -1; this.doneT = 0; this.s = null; this.endYaw = undefined;
    g.cam.override = null; g.cam.fovOverride = null;
    g.world.breachPlug.visible = phase === 'title';
    this.el.bars.classList.remove('on');
    this.el.skip.classList.add('hidden');
    this.el.cap.classList.remove('show');
    this.el.cap.innerHTML = '';
    this.el.fade.style.opacity = 0;
    this.el.tut.classList.add('hidden');
    this.el.tut.classList.remove('in', 'done');
  }

  begin(mode, withPrologue = false) {
    const g = this.game;
    g.audio.init();
    $('title').classList.add('hidden');
    if (mode === 'campaign' && withPrologue) {
      this.startIntro();
    } else if (mode === 'training') {
      g.beginPlay(true);
      this.toPlay(true);
      g.hud.radio('ARENA LATIHAN: Lewati cincin biru & latih tebasan pada titan sasaran!');
    } else {
      g.beginPlay(false);
      this.toPlay(true);
    }
  }

  startIntro() {
    const g = this.game;
    this.phase = 'intro'; this.t = 0; this.breached = false; this.introTitans = [];
    this.removeColossus(); this.colGone = false;
    g.world.breachPlug.visible = true;
    this.el.bars.classList.add('on'); this.el.skip.classList.remove('hidden');
    g.cam.override = (cam) => this.shot(cam);
  }
  shot(cam) {
    const g = this.game, t = this.t, p = g.player;
    const seg = (t0, t1) => ease(clamp((t - t0) / (t1 - t0), 0, 1));
    let fov = 55;
    if (t < CUTS[0]) {
      const k = seg(0, CUTS[0]);
      cam.position.lerpVectors(V([70, 95, 40]), V([42, 78, 150]), k);
      cam.lookAt(0, 30, 380);
    } else if (t < CUTS[1]) {
      const k = seg(CUTS[0], CUTS[1]);
      cam.position.lerpVectors(V([-22, 16, 296]), V([-16, 13, 310]), k);
      cam.lookAt(_a.set(0, lerp(30, 34, k), 380));
      fov = 62;
    } else if (t < CUTS[2]) {
      const k = seg(CUTS[1], CUTS[2]);
      const ti = this.introTitans[0];
      cam.position.lerpVectors(V([20, 2.5, 318]), V([13, 3.2, 327]), k);
      if (ti) ti.head.getWorldPosition(_a); else _a.set(0, 12, 355);
      cam.lookAt(_a);
      fov = 58;
    } else {
      const k = seg(CUTS[2], END_T - 0.2);
      const f = _b.set(Math.sin(this.endYaw), 0, Math.cos(this.endYaw));
      const r = _c.set(-f.z, 0, f.x);
      const th = k * Math.PI, rad = lerp(5.5, 4.6, k);
      cam.position.copy(p.pos).addScaledVector(f, Math.cos(th) * rad).addScaledVector(r, Math.sin(th) * rad + 0.55 * k);
      cam.position.y += lerp(0.4, 0.9, k);
      cam.lookAt(_a.copy(p.pos).addScaledVector(f, 10 * k * k * k).add({ x: 0, y: lerp(0.5, 1.5, k), z: 0 }));
      fov = lerp(50, g.cam.baseFov, k);
    }
    g.cam.fovOverride = fov;
  }
  spawnColossus() {
    const c = new Titan(this.game, new THREE.Vector3(0, 0, WALL_R + 24), { height: 90, passive: true, tone: '#7d4c40' });
    c.heading = c.wanderH = Math.PI; c.root.rotation.y = Math.PI;
    c.setState('wander'); c.body.position.y = 0;
    this.colossus = c;
  }
  removeColossus() {
    if (this.colossus) { this.colossus.dispose(); this.colossus = null; }
  }
  breach() {
    const g = this.game, v = g.vfx;
    this.breached = true;
    g.world.breachPlug.visible = false;
    for (let i = 0; i < 16; i++) v.dust(_a.set((Math.random() - 0.5) * 36, Math.random() * 52, 378 + Math.random() * 10), 9, 18);
    for (let i = 0; i < 6; i++) v.sparks(_a.set((Math.random() - 0.5) * 30, 10 + Math.random() * 40, 376), 20);
    g.flash = 0.45; g.cam.shake(1.1);
    g.audio.thunder(); g.audio.fall(_a.set(0, 0, 370), 20);
    g.audio.roar(_a.set(0, 10, 360), 15, 1.3, 0.5);
    const spots = [[0, 358, 14], [-13, 350, 11], [11, 346, 12]];
    for (const [x, z, h] of spots) {
      const ti = new Titan(g, new THREE.Vector3(x, 0, z), { height: h, passive: true });
      ti.heading = Math.PI + (Math.random() - 0.5) * 0.4; ti.wanderH = ti.heading;
      g.titans.push(ti); this.introTitans.push(ti);
    }
  }
  endIntro() {
    const g = this.game;
    this.removeColossus();
    for (const ti of this.introTitans) { const i = g.titans.indexOf(ti); if (i >= 0) g.titans.splice(i, 1); ti.dispose(); }
    this.introTitans = [];
    g.world.breachPlug.visible = false;
    g.cam.override = null; g.cam.fovOverride = null;
    g.cam.yaw = this.endYaw; g.cam.pitch = -0.05; g.cam.target.copy(g.player.pos);
    this.el.bars.classList.remove('on'); this.el.skip.classList.add('hidden');
    this.el.cap.classList.remove('show'); this.el.fade.style.opacity = 0;
    g.beginPlay(true);
    this.startTutorial();
  }

  startTutorial() {
    this.phase = 'tut'; this.step = -1;
    this.s = { lookAmt: 0, reelT: 0, airAttach: 0, gasT: 0, dashed: false, prevAtt: 0 };
    this.el.tut.classList.remove('hidden');
    $('wave').textContent = 'PELATIHAN';
    this.next();
  }
  next() {
    this.step++;
    if (this.step >= STEPS.length) { this.finishTutorial(); return; }
    const st = STEPS[this.step];
    this.el.tut.innerHTML = `<small>PELATIHAN ${this.step + 1}/${STEPS.length}</small><h3>${st.title}</h3><p>${st.hint}</p>` +
      `<div class="dots">${STEPS.map((_, i) => `<i class="${i < this.step ? 'd' : i === this.step ? 'c' : ''}"></i>`).join('')}</div><em><kbd>Enter</kbd> lewati pelatihan</em>`;
    this.el.tut.classList.remove('done'); void this.el.tut.offsetWidth; this.el.tut.classList.add('in');
    $('obj').textContent = 'Pelatihan: ' + st.title;
    if (st.enter) st.enter(this);
    this.doneT = 0;
  }
  spawnTutorialTitan() {
    const g = this.game, p = g.player;
    const f = g.cam.forwardFlat;
    const pos = new THREE.Vector3(p.pos.x + f.x * 48, 0, p.pos.z + f.z * 48);
    const ti = new Titan(g, pos, { height: 9.5 });
    ti.heading = Math.atan2(p.pos.x - pos.x, p.pos.z - pos.z);
    g.titans.push(ti);
    g.audio.roar(pos, 9.5, 0.9);
  }
  finishTutorial() {
    const g = this.game;
    this.el.tut.classList.add('hidden');
    g.hud.toast('OPERASI DIMULAI<br><span style="font-size:18px">Kawal Regu Insinyur menutup Gerbang Selatan!</span>', 2.8);
    this.toPlay(false);
  }
  toPlay(quick) {
    const g = this.game;
    this.phase = 'play';
    this.el.tut.classList.add('hidden');
    g.waveT = quick ? 1.5 : 3.2;
    if (g.mode === 'training') {
      $('wave').textContent = 'ARENA LATIHAN';
      $('obj').textContent = 'Lewati cincin udara & tebas titan sasaran (Rudal Petir [X] untuk Titan Lapis).';
    } else if (g.mode === 'endless') {
      $('wave').textContent = g.wave ? `GELOMBANG ${g.wave}` : ' PERTAHANAN';
      $('obj').textContent = 'Pertahankan keutuhan Distrik Halvard selama mungkin.';
    } else {
      $('wave').textContent = g.wave ? `FASE ${g.wave} / ${g.maxWave}` : 'OPERASI SEGEL';
      $('obj').textContent = 'Lindungi Regu Insinyur hingga Gerbang Selatan tertutup.';
    }
  }
  onDash() { if (this.s) this.s.dashed = true; }

  update(rdt) {
    const g = this.game, inp = g.input;
    if (this.phase === 'intro') {
      this.t += rdt;
      const t = this.t;
      if (this.endYaw === undefined) { const p = g.player.pos; this.endYaw = Math.atan2(-p.x, 380 - p.z); }
      if (!this.breached && t >= BREACH_T) this.breach();
      if (!this.colossus && !this.colGone && t >= CUTS[0] && t < CUTS[1]) this.spawnColossus();
      const c = this.colossus;
      if (c) {
        c.heading = c.wanderH = Math.PI;
        c.update(rdt); c.root.position.set(0, 0, WALL_R + 24); c.speed = 0;
        if (this.breached && Math.random() < rdt * 25) {
          c.head.getWorldPosition(_a);
          g.vfx.steam(_a.add(_b.set((Math.random() - 0.5) * 14, (Math.random() - 0.3) * 10, (Math.random() - 0.5) * 8)), 9, 3);
        }
        if (t >= CUTS[1]) { this.removeColossus(); this.colGone = true; }
      }
      if (this.breached && t < CUTS[2] && Math.random() < rdt * 40) g.vfx.steam(_a.set((Math.random() - 0.5) * 34, Math.random() * 45, 372 + Math.random() * 12), 7, 3);
      let fade = t < 0.8 ? 1 - t / 0.8 : 0;
      for (const cut of CUTS) fade = Math.max(fade, 1 - Math.abs(t - cut) / 0.22);
      this.el.fade.style.opacity = clamp(fade, 0, 1);
      const cap = CAPS.find((cc) => t >= cc[0] && t <= cc[1]);
      if (cap !== this.cap) {
        this.cap = cap;
        if (cap) this.el.cap.innerHTML = `<h3>${cap[2]}</h3><p>${cap[3]}</p>`;
        this.el.cap.classList.toggle('show', !!cap);
      }
      const skip = t > 0.5 && (inp.pressed('Space') || inp.pressed('Enter') || inp.mouse.lPressed);
      if (t >= END_T || skip) this.endIntro();
      return;
    }
    if (this.phase === 'tut' && g.started && !g.player.dead) {
      const p = g.player, s = this.s;
      if (inp.pressed('Enter')) {
        this.toPlay(false);
        g.hud.toast('<span style="font-size:20px">Pelatihan dilewati — Operasi dimulai!</span>', 1.4);
        return;
      }
      s.lookAmt += Math.abs(inp.mouse.dx) + Math.abs(inp.mouse.dy);
      const att = p.attachedCount;
      if (att && inp.key('Space')) s.reelT += rdt;
      if (p.grounded) s.airAttach = 0;
      else if (att > s.prevAtt) s.airAttach++;
      s.prevAtt = att;
      if (inp.key('ShiftLeft') || inp.key('ShiftRight')) s.gasT += rdt;
      if (this.doneT > 0) {
        this.doneT -= rdt;
        if (this.doneT <= 0) this.next();
      } else if (STEPS[this.step].check(s, p, g)) {
        this.el.tut.classList.add('done');
        g.audio.click();
        this.doneT = this.step === STEPS.length - 1 ? 1.2 : 0.8;
      }
    }
  }
}
