import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { Titan } from './titan.js';
import { CameraRig } from './camera.js';
import { VFX } from './vfx.js';
import { Audio } from './audio.js';
import { HUD } from './hud.js';
import { Post } from './post.js';
import { clamp, damp, lerp, rand } from './util.js';

const _v = new THREE.Vector3();

class Input {
  constructor(canvas, game) {
    this.keys = new Set(); this.edge = new Set();
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
  key(c) { return this.keys.has(c); }
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
    this.world = new World(this.scene, renderer);
    this.world.build();
    this.titans = [];
    this.cam = new CameraRig(this);
    this.input = new Input(canvas, this);
    this.audio = new Audio(this);
    this.vfx = new VFX(this);
    this.player = new Player(this);
    this.hud = new HUD(this);
    this.post = new Post(renderer, this.scene, this.cam.camera);
    this.kills = 0; this.wave = 0; this.waveT = 3; this.timeScale = 1; this.slowT = 0; this.hitstop = 0; this.flash = 0; this.intensity = 0;
    this.running = false; this.locked = false; this.started = false; this.elapsed = 0;
    this.cam.yaw = Math.atan2(-this.player.pos.x, -this.player.pos.z);
    this.cam.target.copy(this.player.pos);
    addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); this.cam.resize(); this.post.resize(); });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      document.getElementById('paused').classList.toggle('hidden', this.locked || !this.started || this.player.dead);
    });
    const lock = () => canvas.requestPointerLock();
    document.getElementById('start').onclick = () => { this.started = true; this.audio.init(); document.getElementById('title').classList.add('hidden'); this.hud.show(true); lock(); this.hud.toast('BERSIAP<br><span style="font-size:18px">Titan menerobos tembok!</span>', 2.5); };
    document.getElementById('paused').onclick = lock;
    document.getElementById('retry').onclick = () => { this.restart(); lock(); };
    canvas.addEventListener('click', () => { if (this.started && !this.locked && !this.player.dead) lock(); });
    document.getElementById('loading').textContent = '';
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.frame());
  }

  restart() {
    for (const t of this.titans) t.dispose();
    this.titans = [];
    const old = this.player;
    this.scene.remove(old.model.root); this.scene.remove(old.model.cape);
    this.player = new Player(this);
    this.kills = 0; this.wave = 0; this.waveT = 2;
    document.getElementById('dead').classList.add('hidden');
    this.hud.show(true);
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
    document.getElementById('wave').textContent = 'WAVE ' + this.wave;
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
  }
  onLand(v) { if (v > 6) { this.audio.land(v); this.vfx.dust(_v.copy(this.player.pos).setY(this.player.pos.y - 0.9), 0.8, 6); } if (v > 14) this.cam.shake(v / 80); }
  onCrash(v) { this.cam.shake(0.8); this.flash = 0.2; this.hud.toast('<span style="font-size:20px">TABRAKAN!</span>', 0.8); }
  onBump(v) { this.cam.shake(v / 120); }
  onDash(dir) { this.audio.dash(); this.vfx.burst(this.player.pos, dir, 16); this.cam.shake(0.12); }
  onPlayerHurt(d) { this.hud.hurt(d); this.audio.hurt(); this.cam.shake(0.5); }
  onGrabbed() { this.audio.roar(this.player.pos, 10, 0.6); this.cam.shake(0.6); }
  onPlayerDeath(why) {
    const msg = { eaten: 'Dimakan titan.', crash: 'Menabrak dengan kecepatan terlalu tinggi.', swat: 'Terhempas tangan titan.' }[why] || '';
    setTimeout(() => {
      document.getElementById('deadwhy').textContent = msg;
      document.getElementById('deadstats').textContent = `Titan dibunuh: ${this.kills} · Wave: ${this.wave}`;
      document.getElementById('dead').classList.remove('hidden');
      this.hud.show(false);
      document.exitPointerLock();
    }, why === 'eaten' ? 400 : 1600);
    if (why === 'eaten') { this.vfx.bloodSpray(this.player.pos, _v.set(0, 1, 0), 60, 0.8); this.player.model.setVisible(false); }
  }

  setQuality(q) {
    this.quality = q;
    const pr = [0.6, 1.0, 1.5][q];
    this.post.maxPR = pr;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, pr));
    this.post.resize();
    this.post.bloom.enabled = q > 0;
    this.world.sun.castShadow = q > 0;
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
    if (this.locked) this.cam.look(inp.mouse.dx, inp.mouse.dy);
    // time dilation: hitstop + kill slow-motion
    let ts = 1;
    if (this.hitstop > 0) { this.hitstop -= rdt; ts = 0.04; }
    else if (this.slowT > 0) { this.slowT -= rdt; ts = 0.28 + (1 - clamp(this.slowT / 0.9, 0, 1)) * 0.72; }
    this.timeScale = damp(this.timeScale, ts, 25, rdt);
    const paused = this.started && !this.locked && !this.player.dead;
    const dt = paused ? 0 : rdt * this.timeScale;
    if (inp.pressed('KeyH')) document.getElementById('help').classList.toggle('hidden');
    for (const [k, f] of [['BracketLeft', 0.85], ['BracketRight', 1.18]]) if (inp.pressed(k)) {
      this.cam.sens = clamp(this.cam.sens * f, 0.0006, 0.008); localStorage.setItem('odm-sens', this.cam.sens);
      this.hud.toast(`<span style="font-size:20px">Sensitivitas mouse ${(this.cam.sens / 0.0022).toFixed(2)}x</span>`, 1);
    }
    if (inp.pressed('KeyM')) this.audio.musicOn = !this.audio.musicOn;
    if (dt > 0) {
      if (this.started) {
        const alive = this.titans.filter((t) => t.alive).length;
        if (alive === 0) { this.waveT -= dt; if (this.waveT <= 0) { this.spawnWave(); this.waveT = 6; } }
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
    if (!this.started) { this.cam.yaw += rdt * 0.05; }
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
