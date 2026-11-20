import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { Titan } from './titan.js';
import { CameraRig } from './camera.js';
import { VFX } from './vfx.js';
import { Audio } from './audio.js';
import { HUD } from './hud.js';
import { Post } from './post.js';
import { Story } from './story.js';
import { clamp, damp, lerp, rand } from './util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

class Input {
  constructor(canvas, game) {
    this.keys = new Set(); this.edge = new Set();
    this.padKeys = new Set();
    this.mouse = { l: false, r: false, lPressed: false, dx: 0, dy: 0 };
    addEventListener('keydown', (e) => {
      if (['Space', 'Tab', 'KeyQ', 'KeyE'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.edge.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.l = this.mouse.r = false; });
    addEventListener('mousedown', (e) => {
      if (!game.locked) return;
      if (e.button === 0) { this.mouse.l = true; this.mouse.lPressed = true; }
      if (e.button === 2) this.mouse.r = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => { if (game.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
  }
  pollGamepad() {
    const p = navigator.getGamepads?.()[0];
    const next = new Set();
    if (p) {
      const ax = p.axes, bt = p.buttons, dead = 0.22;
      if (ax[0] < -dead) next.add('KeyA'); if (ax[0] > dead) next.add('KeyD');
      if (ax[1] < -dead) next.add('KeyW'); if (ax[1] > dead) next.add('KeyS');
      if (bt[6]?.value > 0.25) next.add('KeyQ'); if (bt[7]?.value > 0.25) next.add('KeyE');
      if (bt[4]?.pressed || bt[5]?.pressed) next.add('ShiftLeft');
      if (bt[0]?.pressed) next.add('Space');
      if (bt[1]?.pressed) next.add('KeyF');
      if (bt[3]?.pressed) next.add('KeyC');
      if (bt[12]?.pressed) next.add('KeyR');
      if (bt[13]?.pressed) next.add('KeyX');
      if (bt[9]?.pressed) next.add('Escape');
      this.mouse.dx += Math.abs(ax[2] || 0) > dead ? ax[2] * 17 : 0;
      this.mouse.dy += Math.abs(ax[3] || 0) > dead ? ax[3] * 14 : 0;
      const slash = !!bt[2]?.pressed;
      if (slash && !this.padSlash) this.mouse.lPressed = true;
      this.mouse.l = slash; this.padSlash = slash;
    }
    for (const k of next) if (!this.padKeys.has(k)) this.edge.add(k);
    this.padKeys = next;
  }
  key(c) { return this.keys.has(c) || this.padKeys.has(c); }
  pressed(c) { return this.edge.has(c); }
  endFrame() { this.edge.clear(); this.mouse.lPressed = false; this.mouse.dx = this.mouse.dy = 0; }
}

class Game {
  constructor() {
    const canvas = document.getElementById('c');
    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }));
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(innerWidth, innerHeight);
    this.quality = 2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    this.scene = new THREE.Scene();
    this.playerClass = 'balanced';
    this.world = new World(this.scene, renderer);
    this.world.gameRef = this;
    this.world.build();
    this.titans = [];
    this.cam = new CameraRig(this);
    this.input = new Input(canvas, this);
    this.audio = new Audio(this);
    this.vfx = new VFX(this);
    this.player = new Player(this);
    this.hud = new HUD(this);
    this.post = new Post(renderer, this.scene, this.cam.camera);
    this.story = new Story(this);
    this.TitanClass = Titan;
    this.stats = { maxSpeed: 0, bestCombo: 0, time: 0 };
    this.maxWave = 5;
    this.kills = 0; this.wave = 0; this.waveT = 3; this.timeScale = 1; this.slowT = 0; this.hitstop = 0; this.flash = 0; this.intensity = 0;
    this.running = false; this.locked = false; this.started = false; this.elapsed = 0;
    this.cam.yaw = Math.atan2(-this.player.pos.x, -this.player.pos.z);
    this.cam.target.copy(this.player.pos);
    addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); this.cam.resize(); this.post.resize(); });
    this.syncPause = () => document.getElementById('paused').classList.toggle('hidden', this.locked || !this.started || this.player.dead || this.won && !this.endless);
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; this.syncPause(); });
    // lock can be refused (e.g. re-requested right after Esc); show the resume overlay instead of a silently frozen game
    document.addEventListener('pointerlockerror', () => { this.locked = false; this.syncPause(); });
    const lock = () => canvas.requestPointerLock();
    this.lock = lock;
    for (const b of document.querySelectorAll('#classes button')) b.onclick = () => {
      this.playerClass = b.dataset.class;
      document.querySelectorAll('#classes button').forEach((x) => x.classList.toggle('selected', x === b));
      this.player.applyClass(this.playerClass, true);
    };
    document.getElementById('start').onclick = () => { lock(); this.story.begin(true); };
    document.getElementById('quick').onclick = () => { lock(); this.story.begin(false); };
    document.getElementById('cont').onclick = () => { this.endless = true; document.getElementById('win').classList.add('hidden'); this.hud.show(true); this.syncPause(); lock(); };
    document.getElementById('again').onclick = () => { this.restart(); lock(); };
    document.getElementById('paused').onclick = lock;
    document.getElementById('retry').onclick = () => { this.restart(); lock(); };
    canvas.addEventListener('click', () => { if (this.started && !this.locked && !this.player.dead) lock(); });
    document.getElementById('loading').textContent = '';
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.frame());
  }

  beginPlay(quiet) {
    this.started = true;
    document.getElementById('title').classList.add('hidden');
    this.hud.show(true);
    if (!quiet) this.hud.toast('BERSIAP<br><span style="font-size:18px">Titan menerobos Gerbang Selatan!</span>', 2.5);
  }

  restart() {
    this.endless = false; this.won = false; this.stats = { maxSpeed: 0, bestCombo: 0, time: 0 };
    document.getElementById('win').classList.add('hidden');
    for (const t of this.titans) t.dispose();
    this.titans = [];
    const old = this.player;
    this.scene.remove(old.model.root); this.scene.remove(old.model.cape);
    this.player = new Player(this);
    this.kills = 0; this.wave = 0; this.waveT = 2;
    document.getElementById('dead').classList.add('hidden');
    this.story.toPlay(true);
    this.hud.show(true);
    this.hud.toast('BERSIAP<br><span style="font-size:18px">Titan datang dalam hitungan detik</span>', 2);
    this.syncPause();
  }

  spawnWave() {
    this.wave++;
    const n = Math.min(2 + this.wave, 9);
    const pp = this.player.pos;
    const spawns = this.world.titanSpawns.slice().sort((a, b) => a.distanceToSquared(pp) - b.distanceToSquared(pp)).slice(0, 6);
    for (let i = 0; i < n; i++) {
      const base = spawns[Math.floor(Math.random() * spawns.length)];
      const pos = base.clone().add(new THREE.Vector3(rand(-20, 20), 0, rand(-20, 20)));
      const abn = this.wave >= 2 && Math.random() < 0.15 + this.wave * 0.05;
      this.titans.push(new Titan(this, pos, { type: abn ? 'abnormal' : 'normal', height: abn ? rand(10, 14) : (Math.random() < 0.2 ? 15 : rand(8, 13)) }));
    }
    // first wave: one wandering titan close to start so there's action right away
    if (this.wave === 1) {
      const p = this.player.pos;
      const d = new THREE.Vector3(-p.x, 0, -p.z).normalize();
      this.titans.push(new Titan(this, new THREE.Vector3(p.x + d.x * 55, 0, p.z + d.z * 55), { height: 9 }));
    }
    document.getElementById('wave').textContent = this.endless ? 'WAVE ' + this.wave : `WAVE ${this.wave} / ${this.maxWave}`;
    this.hud.toast(`WAVE ${this.wave}<br><span style="font-size:18px">${n + (this.wave === 1 ? 1 : 0)} titan mendekat</span>`, 2.2);
    this.audio.thunder();
    this.cam.shake(0.5);
  }

  // ---- events ----
  onHookHit(h) {
    const flesh = !!h.owner;
    this.audio.hookHit(h.tip, flesh);
    if (flesh) this.vfx.bloodSpray(h.tip, _v.set(0, 1, 0), 6, 0.5);
    else { this.vfx.sparks(h.tip, 8); this.vfx.dust(h.tip, 1, 4); }
  }
  onSlashHit(t, result, dmg, point) {
    const p = this.player;
    const dir = p.vel.clone().normalize();
    if (result === 'kill') {
      this.kills++; p.combo++; p.comboT = 6;
      this.vfx.napeKill(point, dir);
      this.audio.flesh(point, true);
      this.hud.pop(point, dmg, 'kill');
      const lbl = p.speed > 40 ? 'LEGENDARY' : p.spin > 0 ? 'SPIN SLASH!' : p.speed > 28 ? 'CLEAN KILL' : 'KILL';
      this.hud.toast(lbl, 1.2);
      this.hud.combo(p.combo);
      this.stats.bestCombo = Math.max(this.stats.bestCombo, p.combo);
      this.slowT = 0.9; this.hitstop = 0.08; this.flash = 0.35;
      this.cam.shake(0.7); this.cam.killCam = 0.9;
      t.root.updateMatrixWorld();
    } else if (result === 'nape') {
      this.vfx.bloodSpray(point, dir, 40, 1.1);
      this.audio.flesh(point, false);
      this.hud.pop(point, dmg);
      this.hud.toast('<span style="font-size:20px">Kurang cepat! Tambah momentum</span>', 0.9);
      this.hitstop = 0.06; this.cam.shake(0.35);
    } else if (result === 'deflect') {
      this.vfx.sparks(point, 10); this.audio.clang(point); this.hitstop = 0.03;
    } else {
      this.vfx.bloodSpray(point, dir, 28, 0.9);
      this.audio.flesh(point, false);
      const txt = { ankle: 'KAKI TERPOTONG', arm: 'LENGAN TERPOTONG', eyes: 'MATA BUTA' }[result] || dmg;
      this.hud.pop(point, txt, 'small');
      this.hitstop = 0.05; this.cam.shake(0.3);
    }
  }
  onTitanStep(t, i) {
    const f = t.ankles[i].getWorldPosition(_v);
    f.y = 0.2;
    this.vfx.dust(f, t.s * 2.5, 6);
    this.audio.step(f, t.height);
    const d = f.distanceTo(this.player.pos);
    this.cam.shake(clamp((t.height * 3 - d) / (t.height * 6), 0, 0.25));
  }
  onTitanFall(t) {
    const pos = t.head.getWorldPosition(_v); pos.y = 0.5;
    this.vfx.dust(pos, t.s * 6, 30);
    this.audio.fall(pos, t.height);
    this.cam.shake(clamp(1 - pos.distanceTo(this.player.pos) / 120, 0.1, 0.8));
    // the corpse's full length flattens what it lands on
    const feet = t.root.position;
    const dirV = _v2.set(Math.sin(t.fallDir), 0, Math.cos(t.fallDir));
    for (let i = 0; i < 4; i++) {
      _v.set(feet.x + dirV.x * t.height * i * 0.3, 0, feet.z + dirV.z * t.height * i * 0.3);
      const n = this.world.destroyNear(_v, t.s * 2.5);
      if (n) { this.vfx.dust(_v, t.s * 4, 16); this.audio.thunder(); }
    }
  }
  explode(pos, owner) {
    const R = 15;
    // visual + audio punch
    this.vfx.flash(pos, 9); this.vfx.burst(pos, _v.set(0, 1, 0), 60);
    this.vfx.sparks(pos, 26); this.vfx.dust(pos, 12, 30); this.vfx.steam(pos, 7, 2.5);
    this.audio.thunder(); this.audio.fall(pos, 8);
    this.cam.shake(clamp(1.4 - pos.distanceTo(this.player.pos) / 40, 0.3, 1.4));
    this.hitstop = 0.12; this.flash = 0.5;
    // titans caught in the blast
    for (const t of this.titans) {
      if (!t.alive) continue;
      const d = t.nape.c.distanceTo(pos);
      const bodyD = Math.min(d, t.root.position.distanceTo(pos));
      if (bodyD > R) continue;
      const dmg = Math.round(520 * (1 - bodyD / R) + 140);
      const r = t.hit('nape', dmg, t.nape.c.clone(), _v2.set(0, 1, 0));
      if (r.result === 'kill') this.onSlashHit(t, 'kill', dmg, t.nape.c.clone());
      else { this.vfx.bloodSpray(t.nape.c, _v2.set(0, 1, 0), 40, 1.1); this.hud.pop(t.nape.c, dmg); this.audio.flesh(t.nape.c, true); }
    }
    // flattened buildings
    const n = this.world.destroyNear(pos, 10);
    if (n) this.hud.toast(`<span style="font-size:18px">${n} RUMAH RATA</span>`, 0.8);
    // self-damage if too close
    const pd = this.player.pos.distanceTo(pos);
    if (pd < R * 0.55) {
      _v.copy(this.player.pos).sub(pos).normalize();
      this.player.knockback(_v, 18, 30 * (1 - pd / (R * 0.55)));
    }
  }
  onHouseDown(house, src) {
    this.world.destroyHouse(house);
    const p = _v.set(house.x, house.h * 0.5, house.z);
    this.vfx.dust(p, 10, 24); this.vfx.sparks(p, 10);
    this.audio.fall(p, 12);
    this.cam.shake(clamp(1 - p.distanceTo(this.player.pos) / 90, 0.15, 0.6));
  }
  onLand(v) { if (v > 6) { this.audio.land(v); this.vfx.dust(_v.copy(this.player.pos).setY(this.player.pos.y - 0.9), 0.8, 6); } if (v > 14) this.cam.shake(v / 80); }
  onCrash(v) { this.cam.shake(0.8); this.flash = 0.2; this.hud.toast('<span style="font-size:20px">TABRAKAN!</span>', 0.8); }
  onBump(v) { this.cam.shake(v / 120); }
  onDash(dir) { this.story.onDash(); this.audio.dash(); this.vfx.burst(this.player.pos, dir, 16); this.cam.shake(0.12); }
  onPlayerHurt(d) { this.hud.hurt(d); this.audio.hurt(); this.cam.shake(0.5); }
  onGrabbed() { this.audio.roar(this.player.pos, 10, 0.6); this.cam.shake(0.6); }
  onPlayerDeath(why) {
    const msg = { eaten: 'Dimakan titan.', crash: 'Menabrak dengan kecepatan terlalu tinggi.', swat: 'Terhempas tangan titan.' }[why] || '';
    setTimeout(() => {
      document.getElementById('deadwhy').textContent = msg;
      document.getElementById('deadstats').innerHTML = this.statsHTML();
      document.getElementById('dead').classList.remove('hidden');
      this.hud.show(false);
      document.exitPointerLock();
    }, why === 'eaten' ? 400 : 1600);
    if (why === 'eaten') { this.vfx.bloodSpray(this.player.pos, _v.set(0, 1, 0), 60, 0.8); this.player.model.setVisible(false); }
  }

  statsHTML() {
    const s = this.stats, m = Math.floor(s.time / 60), sec = Math.floor(s.time % 60);
    return `<span>Titan <b>${this.kills}</b></span><span>Wave <b>${this.wave}</b></span><span>Kecepatan maks <b>${Math.round(s.maxSpeed)} m/s</b></span><span>Combo terbaik <b>${s.bestCombo}×</b></span><span>Waktu <b>${m}:${String(sec).padStart(2, '0')}</b></span>`;
  }
  victory() {
    this.won = true;
    document.getElementById('winstats').innerHTML = this.statsHTML();
    document.getElementById('win').classList.remove('hidden');
    this.hud.show(false);
    this.audio.thunder();
    document.exitPointerLock();
  }

  setQuality(q) {
    this.quality = q;
    const pr = [0.6, 1.0, 1.5][q];
    this.post.maxPR = pr;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, pr));
    this.post.resize();
    this.post.bloom.enabled = q > 0;
    this.world.sun.castShadow = q > 0;
    const ms = q > 1 ? 4096 : 2048, sh = this.world.sun.shadow;
    if (sh.mapSize.x !== ms) { sh.mapSize.set(ms, ms); if (sh.map) { sh.map.dispose(); sh.map = null; } }
    this.hud.toast(`<span style="font-size:20px">Grafis: ${['RENDAH', 'SEDANG', 'TINGGI'][q]}</span>`, 1.2);
  }

  frame() {
    const raw = this.clock.getDelta();
    const rdt = Math.min(raw, 1 / 20);
    if (this.frozen) return;
    if (this.started && !this.manualQuality) {
      this.fpsAvg = lerp(this.fpsAvg || 60, 1 / Math.max(raw, 1e-3), 0.02);
      this.lowT = this.fpsAvg < 32 ? (this.lowT || 0) + raw : 0;
      if (this.lowT > 4 && this.quality > 0) { this.setQuality(this.quality - 1); this.lowT = 0; this.fpsAvg = 45; }
    }
    if (this.input.pressed('KeyG')) { this.manualQuality = true; this.setQuality((this.quality + 2) % 3); }
    this.step(rdt);
    this.post.render(this.elapsed);
    this.input.endFrame();
  }

  // deterministic stepping for automated tests: game.sim(seconds)
  sim(sec, dt = 1 / 60, each) {
    this.frozen = true;
    for (let t = 0; t < sec; t += dt) { if (each) each(this); this.step(dt); this.input.endFrame(); }
    this.post.render(this.elapsed);
  }

  step(rdt) {
    this.elapsed += rdt;
    const inp = this.input;
    inp.pollGamepad();
    if (this.locked) this.cam.look(inp.mouse.dx, inp.mouse.dy);
    // time dilation: hitstop + kill slow-motion
    let ts = 1;
    if (this.hitstop > 0) { this.hitstop -= rdt; ts = 0.04; }
    else if (this.slowT > 0) { this.slowT -= rdt; ts = 0.28 + (1 - clamp(this.slowT / 0.9, 0, 1)) * 0.72; }
    this.timeScale = damp(this.timeScale, ts, 25, rdt);
    const paused = this.started && !this.locked && !this.player.dead && !(this.won && !this.endless);
    const dt = paused ? 0 : rdt * this.timeScale;
    if (inp.pressed('KeyH')) document.getElementById('help').classList.toggle('hidden');
    for (const [k, f] of [['BracketLeft', 0.85], ['BracketRight', 1.18]]) if (inp.pressed(k)) {
      this.cam.sens = clamp(this.cam.sens * f, 0.0006, 0.008); localStorage.setItem('odm-sens', this.cam.sens);
      this.hud.toast(`<span style="font-size:20px">Sensitivitas mouse ${(this.cam.sens / 0.0022).toFixed(2)}x</span>`, 1);
    }
    if (inp.pressed('KeyF')) {
      const p = this.player;
      p.hookMode = p.hookMode === 'focus' ? 'auto' : 'focus';
      this.hud.toast(p.hookMode === 'focus' ? 'KAIT: FOKUS<br><span style="font-size:16px">dua kabel ke satu titik</span>' : 'KAIT: OTOMATIS<br><span style="font-size:16px">jangkar dipilih mengikuti arah pandang</span>', 1.2);
    }
    if (inp.pressed('KeyV')) {
      this.cam.fp = !this.cam.fp;
      this.hud.toast(`<span style="font-size:20px">Kamera: ${this.cam.fp ? 'ORANG PERTAMA' : 'ORANG KETIGA'}</span>`, 1.2);
    }
    if (inp.pressed('KeyM')) this.audio.musicOn = !this.audio.musicOn;
    if (dt > 0) {
      if (this.started) {
        const alive = this.titans.filter((t) => t.alive).length;
        this.stats.time += dt; this.stats.maxSpeed = Math.max(this.stats.maxSpeed, this.player.speed);
        if (alive === 0 && this.story.allowWaves()) {
          if (this.wave >= this.maxWave && !this.endless && !this.won) this.victory();
          else if (!this.won || this.endless) { this.waveT -= dt; if (this.waveT <= 0) { this.spawnWave(); this.waveT = 6; } }
        }
      }
      this.world.col.dynamics.length = 0;
      for (const t of this.titans) if (t.alive || t.deadT < 8) for (const c of t.parts) this.world.col.dynamics.push(c);
      if (this.started) this.player.update(dt);
      else this.player.animate(dt);
      for (const t of this.titans) t.update(dt);
      for (let i = this.titans.length - 1; i >= 0; i--) if (this.titans[i].remove) { this.titans[i].dispose(); this.titans.splice(i, 1); }
      this.world.update(dt);
      this.vfx.update(dt, rdt);
    }
    this.story.update(rdt);
    if (!this.started && !this.story.active) { this.cam.yaw += rdt * 0.06; this.cam.pitch = 0.08 + Math.sin(this.elapsed * 0.15) * 0.06; }
    this.cam.update(dt, rdt);
    this.world.followShadow(this.player.pos);
    // music intensity from nearby threat
    let near = 999;
    for (const t of this.titans) if (t.alive) near = Math.min(near, t.root.position.distanceTo(this.player.pos));
    this.intensity = damp(this.intensity, clamp(1 - near / 120, 0, 1), 1, rdt);
    this.audio.update(rdt);
    if (this.started) this.hud.update(rdt);
    const u = this.post.u;
    u.uSpeed.value = damp(u.uSpeed.value, clamp((this.player.speed - 15) / 45, 0, 1), 5, rdt);
    u.uHurt.value = this.hud.hurtT;
    this.flash = Math.max(0, this.flash - rdt * 2.5);
    u.uFlash.value = this.flash * this.flash;
    u.uSlow.value = damp(u.uSlow.value, this.slowT > 0 ? 1 : 0, 8, rdt);
  }
}

window.THREE = THREE;
window.game = new Game();
