import { WALL_R } from './world.js';
import * as THREE from 'three';
import { Titan } from './titan.js';
import { clamp, lerp, formatKey } from './util.js';

const $ = (id) => document.getElementById(id);
const V = (a) => new THREE.Vector3(...a);
const ease = (t) => t * t * (3 - 2 * t);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

const BREACH_T = 4.6, END_T = 14.4;
const CUTS = [3.7, 8.2, 11.4];
const CAPS = [
  [0.4, 3.4, 'HALVARD DISTRICT', 'A century behind the walls. A century of borrowed peace.'],
  [5.0, 7.9, 'THE SOUTH GATE', '…until the sky split open.'],
  [8.5, 11.1, 'BREACH DETECTED', 'Titans are pouring through. Escort the Engineer Convoy to seal the gate.'],
  [11.7, 14.1, 'WINGS OF STEEL', 'Three wings at your flank. Draw blades and hold the line.'],
];

function makeSteps(g) {
  const k = (act) => formatKey(g.prefs?.binds?.[act]);
  return [
    {
      title: 'Survey the District',
      hint: 'Move the <kbd>MOUSE</kbd> to scan the rooftops and horizons.',
      check: (s) => s.lookAmt > 480,
    },
    {
      title: 'Fire ODM Grapples',
      hint: `Aim at a building and hold <kbd>${k('hookL')}</kbd> / <kbd>${k('hookR')}</kbd> or <kbd>RMB</kbd> (dual cables).`,
      check: (s, p) => p.hooked,
    },
    {
      title: 'Winch Reel & Pendulum Swing',
      hint: `Hold <kbd>${k('reel')}</kbd> while anchored to winch forward and build swing speed.`,
      check: (s) => s.reelT > 0.55,
    },
    {
      title: 'Chain Rooftop Swings',
      hint: 'Release mid-air and grapple a fresh anchor <b>2×</b> without touching the ground.',
      check: (s) => s.airAttach >= 2,
    },
    {
      title: 'Momentum Vector Boost',
      hint: `While swinging, hold <kbd>${k('boost')}</kbd> + steer to amplify and curve your momentum.`,
      check: (s) => s.gasT > 0.4 || s.dashed,
    },
    {
      title: 'Sever the Nape',
      hint: 'Target acquired! Close in until <b class="r">[LMB] EXECUTE</b> appears, then slash at high speed.',
      enter: (st) => st.spawnTutorialTitan(),
      check: (s, p, gm) => gm.kills >= 1,
    },
  ];
}

export class Story {
  constructor(game) {
    this.game = game;
    this.phase = 'title';
    this.wantTutorial = false;
    this.steps = [];
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

  begin(mode, withCutscene = false, withTutorial = false) {
    const g = this.game;
    g.audio.init();
    this.wantTutorial = !!withTutorial;
    $('title').classList.add('hidden');
    $('deploy').classList.add('hidden');
    if (mode === 'campaign' && withCutscene) {
      this.startIntro();
    } else if (mode === 'training') {
      g.beginPlay(true);
      this.toPlay(true);
      g.hud.radio('PROVING GROUNDS: Swing through the aerial rings and practice nape executions.');
    } else if (withTutorial) {
      g.beginPlay(true);
      this.startTutorial();
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
    g.squad.reset(true);
    this.el.bars.classList.add('on'); this.el.skip.classList.remove('hidden');
    g.cam.override = (cam) => this.shot(cam);
  }

  shot(cam) {
    const g = this.game, t = this.t, p = g.player;
    const seg = (t0, t1) => ease(clamp((t - t0) / (t1 - t0), 0, 1));
    let fov = 54;
    if (t < CUTS[0]) {
      const k = seg(0, CUTS[0]);
      cam.position.lerpVectors(V([76, 92, 30]), V([38, 72, 155]), k);
      cam.lookAt(0, 28, 380);
    } else if (t < CUTS[1]) {
      const k = seg(CUTS[0], CUTS[1]);
      cam.position.lerpVectors(V([-24, 15, 294]), V([-15, 13, 312]), k);
      cam.lookAt(_a.set(0, lerp(28, 38, k), 380));
      fov = 60;
    } else if (t < CUTS[2]) {
      const k = seg(CUTS[1], CUTS[2]);
      const ti = this.introTitans[0];
      cam.position.lerpVectors(V([22, 4.5, 314]), V([13, 5.2, 326]), k);
      if (ti) ti.head.getWorldPosition(_a); else _a.set(0, 12, 355);
      cam.lookAt(_a);
      fov = 56;
    } else {
      const k = seg(CUTS[2], END_T - 0.15);
      const f = _b.set(Math.sin(this.endYaw), 0, Math.cos(this.endYaw));
      const r = _c.set(-f.z, 0, f.x);
      const th = k * Math.PI * 0.92;
      const rad = lerp(5.2, 0.35, k * k);
      cam.position.copy(p.pos)
        .addScaledVector(f, Math.cos(th) * rad)
        .addScaledVector(r, Math.sin(th) * rad * (1 - k));
      cam.position.y += lerp(0.55, 0.72, k);
      cam.lookAt(_a.copy(p.pos).addScaledVector(f, lerp(1, 24, k * k)).add({ x: 0, y: lerp(0.55, 0.72, k), z: 0 }));
      fov = lerp(50, g.cam.baseFov, k);
    }
    g.cam.fovOverride = fov;
  }

  spawnColossus() {
    const c = new Titan(this.game, new THREE.Vector3(0, 0, WALL_R + 24), { height: 90, passive: true, tone: '#7d4438' });
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
    for (let i = 0; i < 14; i++) v.dust(_a.set((Math.random() - 0.5) * 34, Math.random() * 48, 378 + Math.random() * 10), 8.5, 14);
    for (let i = 0; i < 5; i++) v.sparks(_a.set((Math.random() - 0.5) * 28, 10 + Math.random() * 38, 376), 16);
    g.world.spawnBreachDebris?.();
    g.flash = 0.38; g.cam.shake(1.0);
    g.audio.thunder(); g.audio.fall(_a.set(0, 0, 370), 20);
    g.audio.roar(_a.set(0, 10, 360), 15, 1.25, 0.45);
    const spots = [[0, 358, 14], [-13, 350, 11], [11, 346, 12.5]];
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
    g.cam.yaw = this.endYaw ?? 0; g.cam.pitch = -0.04; g.cam.target.copy(g.player.pos);
    this.cap = null;
    this.el.bars.classList.remove('on');
    this.el.skip.classList.add('hidden');
    this.el.cap.classList.remove('show');
    this.el.cap.innerHTML = '';
    this.el.fade.style.opacity = 0;
    g.beginPlay(this.wantTutorial);
    if (this.wantTutorial) this.startTutorial();
    else {
      this.toPlay(false);
      g.hud.radio('CAPT. RENO: Breach confirmed at South Gate! Wingmen airborne — escort the Convoy!');
    }
  }

  startTutorial() {
    this.phase = 'tut'; this.step = -1;
    this.steps = makeSteps(this.game);
    this.s = { lookAmt: 0, reelT: 0, airAttach: 0, gasT: 0, dashed: false, prevAtt: 0 };
    this.el.tut.classList.remove('hidden');
    $('wave').textContent = 'FIELD TRAINING';
    this.next();
  }

  next() {
    this.step++;
    if (this.step >= this.steps.length) { this.finishTutorial(); return; }
    const st = this.steps[this.step];
    this.el.tut.innerHTML = `<small>TRAINING ${this.step + 1}/${this.steps.length}</small><h3>${st.title}</h3><p>${st.hint}</p>` +
      `<div class="dots">${this.steps.map((_, i) => `<i class="${i < this.step ? 'd' : i === this.step ? 'c' : ''}"></i>`).join('')}</div><em><kbd>ENTER</kbd> Skip Training</em>`;
    this.el.tut.classList.remove('done'); void this.el.tut.offsetWidth; this.el.tut.classList.add('in');
    $('obj').textContent = 'Training: ' + st.title;
    if (st.enter) st.enter(this);
    this.doneT = 0;
  }

  spawnTutorialTitan() {
    const g = this.game, p = g.player;
    const f = g.cam.forwardFlat;
    const pos = new THREE.Vector3(p.pos.x + f.x * 48, 0, p.pos.z + f.z * 48);
    const ti = new Titan(g, pos, { height: 9.5, instant: true });
    ti.heading = Math.atan2(p.pos.x - pos.x, p.pos.z - pos.z);
    g.titans.push(ti);
    g.audio.roar(pos, 9.5, 0.9);
  }

  finishTutorial() {
    const g = this.game;
    this.el.tut.classList.add('hidden');
    g.hud.toast('OPERATION LIVE<br><span style="font-size:17px">Escort the Engineer Convoy to seal the South Gate!</span>', 2.4);
    this.toPlay(false);
  }

  toPlay(quick) {
    const g = this.game;
    this.phase = 'play';
    this.el.tut.classList.add('hidden');
    g.squad.reset(g.mode !== 'training');
    g.waveT = quick ? 1.5 : 2.8;
    if (g.mode === 'training') {
      $('wave').textContent = 'PROVING GROUNDS';
      $('obj').textContent = 'Fly through aerial rings and practice executions on sparring Titans.';
    } else if (g.mode === 'endless') {
      $('wave').textContent = g.wave ? `WAVE ${g.wave}` : 'ENDLESS DEFENSE';
      $('obj').textContent = 'Defend Halvard District against escalating Titan waves.';
    } else {
      $('wave').textContent = g.wave ? `PHASE ${g.wave} / ${g.maxWave}` : 'OPERATION SOUTH GATE';
      $('obj').textContent = 'Escort the Engineer Convoy until the South Gate is sealed.';
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
        if (this.breached && Math.random() < rdt * 24) {
          c.head.getWorldPosition(_a);
          g.vfx.steam(_a.add(_b.set((Math.random() - 0.5) * 14, (Math.random() - 0.3) * 10, (Math.random() - 0.5) * 8)), 8.5, 2.8);
        }
        if (t >= CUTS[1]) { this.removeColossus(); this.colGone = true; }
      }
      if (this.breached && t < CUTS[2] && Math.random() < rdt * 32) {
        g.vfx.steam(_a.set((Math.random() - 0.5) * 32, Math.random() * 44, 372 + Math.random() * 12), 6.5, 2.8);
      }
      let fade = t < 0.7 ? 1 - t / 0.7 : 0;
      for (const cut of CUTS) fade = Math.max(fade, 1 - Math.abs(t - cut) / 0.2);
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
        g.hud.toast('<span style="font-size:18px">Training skipped — Operation live!</span>', 1.3);
        return;
      }
      s.lookAmt += Math.abs(inp.mouse.dx) + Math.abs(inp.mouse.dy);
      const att = p.attachedCount;
      if (att && inp.action('reel')) s.reelT += rdt;
      if (p.grounded) s.airAttach = 0;
      else if (att > s.prevAtt) s.airAttach++;
      s.prevAtt = att;
      if (inp.action('boost')) s.gasT += rdt;
      if (this.doneT > 0) {
        this.doneT -= rdt;
        if (this.doneT <= 0) this.next();
      } else if (this.steps[this.step]?.check(s, p, g)) {
        this.el.tut.classList.add('done');
        g.audio.click();
        this.doneT = this.step === this.steps.length - 1 ? 1.1 : 0.75;
      }
    }
  }
}
