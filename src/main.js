import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { APPEARANCE_PRESETS, DEFAULT_APPEARANCE } from './playerModel.js';
import { Titan } from './titan.js';
import { Engineers } from './engineers.js';
import { Squad } from './squad.js';
import { CameraRig } from './camera.js';
import { VFX, VFX_COLORS } from './vfx.js';
import { Audio } from './audio.js';
import { HUD } from './hud.js';
import { Post } from './post.js';
import { Story } from './story.js';
import { createRayHit } from './collision.js';
import { clamp, damp, lerp, rand, easeOutQuart, loadPrefs, savePrefs } from './util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _boulderHit = createRayHit();

const UPGRADE_POOL = [
  { id: 'blade', title: 'Baja Ultra-Keras', desc: 'Ketahanan pedang +30% & daya tebas +15%', apply: (p) => { p.mods.bladeSaver *= 0.72; p.mods.damageBonus *= 1.15; } },
  { id: 'turbine', title: 'Turbin Vektor Ganda', desc: 'Dorongan jet & kelincahan belok +18%', apply: (p) => { p.mods.thrustBonus *= 1.18; } },
  { id: 'hook', title: 'Pelontar Reaksi Cepat', desc: 'Kecepatan kait +28% & jangkauan +25m', apply: (p) => { p.mods.hookSpeedBonus *= 1.28; p.mods.hookRangeBonus += 25; } },
  { id: 'spear', title: 'Rak Rudal Tambahan', desc: '+2 kapasitas Rudal Petir & isi penuh sekarang', apply: (p) => { p.mods.maxSpearBonus += 2; p.spears = p.maxSpears; } },
  { id: 'valve', title: 'Katup Hemat Gas', desc: 'Konsumsi gas -25% & +1 silinder cadangan', apply: (p) => { p.mods.gasSaver *= 0.75; p.gasCylinders = Math.min(6, p.gasCylinders + 1); p.gas = 100; } },
  { id: 'spin', title: 'Teknik Putaran Levi', desc: 'Pengisian serangan putar +45% lebih cepat', apply: (p) => { p.mods.spinRateBonus *= 1.45; } },
];

class Input {
  constructor(canvas, game) {
    this.keys = new Set();
    this.edge = new Set();
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
      if (bt[15]?.pressed) next.add('KeyT');
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
    this.prefs = loadPrefs({
      quality: 2,
      sensMult: 1.0,
      fov: 72,
      volume: 0.8,
      invertY: false,
      music: true,
      shake: true,
      showFps: false,
      bestKills: 0,
      bestWave: 0,
      bestRank: '',
      appearance: { ...DEFAULT_APPEARANCE },
    });
    this.prefs.appearance = { ...DEFAULT_APPEARANCE, ...(this.prefs.appearance || {}) };

    const canvas = document.getElementById('c');
    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }));
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.mode = 'campaign';
    this.playerClass = 'balanced';
    this.world = new World(this.scene, renderer);
    this.world.gameRef = this;
    this.world.build();
    this.titans = [];
    this.boulders = [];
    this.boulderPool = [];
    this.cam = new CameraRig(this);
    this.input = new Input(canvas, this);
    this.audio = new Audio(this);
    this.vfx = new VFX(this);
    this.player = new Player(this, this.prefs.appearance);
    this.engineers = new Engineers(this);
    this.squad = new Squad(this);
    this.squad.reset(false);
    this.hud = new HUD(this);
    this.post = new Post(renderer, this.scene, this.cam.camera);
    this.story = new Story(this);
    this.TitanClass = Titan;

    this.stats = { maxSpeed: 0, bestCombo: 0, time: 0 };
    this.maxWave = 5;
    this.kills = 0;
    this.wave = 0;
    this.waveT = 2.5;
    this.timeScale = 1;
    this.hitstopT = 0;
    this.hitstopScale = 1;
    this.rampT = 0;
    this.rampDur = 0.001;
    this.rampFrom = 1;
    this.impactPulse = 0;
    this.bloodMist = 0;
    this.flash = 0;
    this.intensity = 0;
    this.pendingUpgrades = null;
    this.started = false;
    this.locked = false;
    this.won = false;
    this.endless = false;
    this.elapsed = 0;

    this.cam.yaw = Math.atan2(-this.player.pos.x, -this.player.pos.z);
    this.cam.target.copy(this.player.pos);
    this.applyPrefs(false);
    this.applyAppearance();
    this.updateBestBanner();

    addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); this.cam.resize(); this.post.resize(); });

    this.syncPause = () => {
      const settingsOpen = !document.getElementById('settings').classList.contains('hidden');
      const hide = settingsOpen || this.locked || !this.started || this.story.active || this.player.dead || (this.won && !this.endless);
      document.getElementById('paused').classList.toggle('hidden', hide);
      if (this.hud?.el?.hud) this.hud.el.hud.classList.toggle('dim', !hide || settingsOpen);
      if (!hide && this.hud?.el?.help) this.hud.el.help.classList.add('hidden');
    };
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; this.syncPause(); });
    document.addEventListener('pointerlockerror', () => { this.locked = false; this.syncPause(); });
    const lock = () => { try { const p = canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); } catch {} };
    this.lock = lock;

    for (const b of document.querySelectorAll('#modes button')) {
      b.onclick = () => {
        this.mode = b.dataset.mode;
        this.endless = this.mode === 'endless';
        document.querySelectorAll('#modes button').forEach((x) => x.classList.toggle('selected', x === b));
        document.getElementById('prologue').classList.toggle('hidden', this.mode !== 'campaign');
      };
    }
    for (const b of document.querySelectorAll('#classes button')) {
      b.onclick = () => {
        this.playerClass = b.dataset.class;
        document.querySelectorAll('#classes button').forEach((x) => x.classList.toggle('selected', x === b));
        this.player.applyClass(this.playerClass, true);
      };
    }

    document.getElementById('start').onclick = () => { this.startSession(false); lock(); };
    document.getElementById('prologue').onclick = () => { this.mode = 'campaign'; this.startSession(true); lock(); };
    document.getElementById('cont').onclick = () => {
      this.mode = 'endless';
      this.endless = true;
      document.getElementById('win').classList.add('hidden');
      this.hud.show(true);
      this.story.toPlay(false);
      this.offerUpgrades();
      this.syncPause();
      lock();
    };
    document.getElementById('again').onclick = () => { this.restart(); lock(); };
    document.getElementById('winmenu').onclick = () => this.returnToMenu();
    document.getElementById('retry').onclick = () => { this.restart(); lock(); };
    document.getElementById('deadmenu').onclick = () => this.returnToMenu();
    document.getElementById('resume').onclick = (e) => { e.stopPropagation(); lock(); };
    document.getElementById('prestart').onclick = (e) => { e.stopPropagation(); this.restart(); lock(); };
    document.getElementById('pmenu').onclick = (e) => { e.stopPropagation(); this.returnToMenu(); };
    document.getElementById('paused').onclick = (e) => { if (e.target.closest('button')) return; lock(); };
    canvas.addEventListener('click', () => {
      const settingsOpen = !document.getElementById('settings').classList.contains('hidden');
      if (!settingsOpen && this.started && !this.locked && !this.player.dead && !(this.won && !this.endless)) lock();
    });

    this.bindSettingsUI();
    this.bindCustomizeUI();
    document.getElementById('loading').textContent = '';
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.frame());
  }

  applyAppearance() {
    const app = this.prefs.appearance;
    this.player.model.applyAppearance(app);
    const aura = APPEARANCE_PRESETS.bladeAuras.find((a) => a.id === app.bladeAura) || APPEARANCE_PRESETS.bladeAuras[0];
    this.vfx.setBladeColor(aura.id, aura.trail2);
  }

  bindCustomizeUI() {
    const panel = document.getElementById('customize');
    const titleEl = document.getElementById('title');
    const rotSlider = document.getElementById('cust-rot');
    const A = this.prefs.appearance;

    const buildChips = (containerId, list, prop) => {
      const el = document.getElementById(containerId);
      el.innerHTML = '';
      for (const item of list) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = item.label;
        b.classList.toggle('selected', A[prop] === item.id);
        b.onclick = () => {
          A[prop] = item.id;
          this.applyAppearance();
          savePrefs(this.prefs);
          [...el.children].forEach((c, i) => c.classList.toggle('selected', list[i].id === A[prop]));
        };
        el.appendChild(b);
      }
    };

    const buildSwatches = (containerId, list, prop) => {
      const el = document.getElementById(containerId);
      el.innerHTML = '';
      for (const item of list) {
        const b = document.createElement('button');
        b.type = 'button';
        b.title = item.label;
        b.style.background = item.id;
        b.classList.toggle('selected', A[prop] === item.id);
        b.onclick = () => {
          A[prop] = item.id;
          this.applyAppearance();
          savePrefs(this.prefs);
          [...el.children].forEach((c, i) => c.classList.toggle('selected', list[i].id === A[prop]));
        };
        el.appendChild(b);
      }
    };

    const refresh = () => {
      buildChips('cust-hairstyle', APPEARANCE_PRESETS.hairStyles, 'hairStyle');
      buildSwatches('cust-haircolor', APPEARANCE_PRESETS.hairColors, 'hairColor');
      buildChips('cust-cape', APPEARANCE_PRESETS.capeStyles, 'capeStyle');
      buildSwatches('cust-scarf', APPEARANCE_PRESETS.scarfColors, 'scarfColor');
      buildSwatches('cust-jacket', APPEARANCE_PRESETS.jacketColors, 'jacketColor');
      buildSwatches('cust-aura', APPEARANCE_PRESETS.bladeAuras, 'bladeAura');
    };

    document.getElementById('opencust').onclick = () => {
      refresh();
      titleEl.classList.add('hidden');
      panel.classList.remove('hidden');
      this.cam.customizing = true;
      this.cam.wardrobeAngle = +rotSlider.value;
    };
    rotSlider.oninput = () => { this.cam.wardrobeAngle = +rotSlider.value; };
    document.getElementById('closecust').onclick = () => {
      savePrefs(this.prefs);
      panel.classList.add('hidden');
      titleEl.classList.remove('hidden');
      this.cam.customizing = false;
    };
  }

  bindSettingsUI() {
    const modal = document.getElementById('settings');
    const sensR = document.getElementById('sens-range');
    const fovR = document.getElementById('fov-range');
    const volR = document.getElementById('vol-range');
    const invBtn = document.getElementById('invy-btn');
    const musBtn = document.getElementById('music-btn');
    const shakeBtn = document.getElementById('shake-btn');
    const fpsBtn = document.getElementById('fps-btn');

    const syncModal = () => {
      document.querySelectorAll('#qual-btns button').forEach((b) => b.classList.toggle('selected', +b.dataset.q === this.prefs.quality));
      sensR.value = this.prefs.sensMult;
      document.getElementById('sens-val').textContent = Number(this.prefs.sensMult).toFixed(2) + '×';
      fovR.value = this.prefs.fov;
      document.getElementById('fov-val').textContent = this.prefs.fov + '°';
      volR.value = Math.round(this.prefs.volume * 100);
      document.getElementById('vol-val').textContent = Math.round(this.prefs.volume * 100) + '%';
      invBtn.textContent = `BALIK SUMBU Y: ${this.prefs.invertY ? 'AKTIF' : 'MATI'}`;
      musBtn.textContent = `MUSIK TEMPUR: ${this.prefs.music ? 'AKTIF' : 'MATI'}`;
      shakeBtn.textContent = `GOYANGAN KAMERA: ${this.prefs.shake ? 'AKTIF' : 'MATI'}`;
      fpsBtn.textContent = `FPS: ${this.prefs.showFps ? 'AKTIF' : 'MATI'}`;
    };

    const open = (e) => {
      if (e) e.stopPropagation();
      syncModal();
      modal.classList.remove('hidden');
      if (document.pointerLockElement) document.exitPointerLock();
      this.syncPause();
    };
    document.getElementById('opensettings').onclick = open;
    document.getElementById('psettings').onclick = open;

    for (const b of document.querySelectorAll('#qual-btns button')) {
      b.onclick = () => {
        this.prefs.quality = +b.dataset.q;
        this.manualQuality = true;
        this.applyPrefs(true);
        syncModal();
      };
    }
    sensR.oninput = () => { this.prefs.sensMult = +sensR.value; this.applyPrefs(false); syncModal(); };
    fovR.oninput = () => { this.prefs.fov = +fovR.value; this.applyPrefs(false); syncModal(); };
    volR.oninput = () => { this.prefs.volume = +volR.value / 100; this.applyPrefs(false); syncModal(); };
    invBtn.onclick = () => { this.prefs.invertY = !this.prefs.invertY; this.applyPrefs(false); syncModal(); };
    musBtn.onclick = () => { this.prefs.music = !this.prefs.music; this.applyPrefs(false); syncModal(); };
    shakeBtn.onclick = () => { this.prefs.shake = !this.prefs.shake; this.applyPrefs(false); syncModal(); };
    fpsBtn.onclick = () => { this.prefs.showFps = !this.prefs.showFps; this.applyPrefs(false); syncModal(); };
    document.getElementById('closesettings').onclick = () => {
      savePrefs(this.prefs);
      modal.classList.add('hidden');
      if (this.started && !this.player.dead && !(this.won && !this.endless)) this.lock();
      this.syncPause();
    };
  }

  applyPrefs(showToast = false) {
    this.cam.sens = 0.0022 * this.prefs.sensMult;
    this.cam.baseFov = this.prefs.fov;
    this.cam.invertY = !!this.prefs.invertY;
    this.audio.musicOn = !!this.prefs.music;
    this.audio.setVolume(this.prefs.volume);
    const fpsEl = document.getElementById('fps');
    if (fpsEl) fpsEl.classList.toggle('hidden', !this.prefs.showFps);
    this.setQuality(this.prefs.quality, showToast);
    savePrefs(this.prefs);
  }

  updateBestBanner() {
    const el = document.getElementById('bestbanner');
    if (!el) return;
    if (this.prefs.bestKills > 0) {
      el.textContent = `REKOR TERBAIK: Peringkat ${this.prefs.bestRank || 'B'} · ${this.prefs.bestKills} Titan · Gelombang ${this.prefs.bestWave}`;
    } else {
      el.textContent = 'MISI: Pimpin Skuadron Pengintai & kawal Regu Insinyur menutup Gerbang Selatan';
    }
  }

  startSession(withPrologue) {
    this.cam.customizing = false;
    document.getElementById('customize').classList.add('hidden');
    this.endless = this.mode === 'endless';
    this.won = false;
    this.stats = { maxSpeed: 0, bestCombo: 0, time: 0 };
    this.kills = 0;
    this.wave = 0;
    this.clearTransientState();
    this.engineers.reset(this.mode);
    this.squad.reset(false);
    this.story.begin(this.mode, withPrologue);
  }

  clearBoulders() {
    for (let i = this.boulders.length - 1; i >= 0; i--) {
      this.boulders[i].m.visible = false;
      if (this.boulders[i].mark) { this.boulders[i].mark.visible = false; this.boulders[i].mark = null; }
      this.boulderPool.push(this.boulders[i]);
    }
    this.boulders.length = 0;
  }

  spawnBoulder(from, targetPos, radius = 1.4) {
    if (!this.boulderGeo) this.boulderGeo = new THREE.DodecahedronGeometry(1, 1);
    if (!this.boulderMat) this.boulderMat = new THREE.MeshStandardMaterial({ color: '#6e655a', roughness: 0.94 });
    let b = this.boulderPool.pop();
    if (!b) {
      const m = new THREE.Mesh(this.boulderGeo, this.boulderMat);
      m.castShadow = true;
      this.scene.add(m);
      b = { m, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rv: new THREE.Vector3(), r: 1, age: 0 };
    }
    b.r = radius;
    b.age = 0;
    b.pos.copy(from);
    b.m.position.copy(from);
    b.m.rotation.set(0, 0, 0);
    b.m.scale.setScalar(radius);
    b.m.visible = true;
    const dx = targetPos.x - from.x, dy = targetPos.y - from.y, dz = targetPos.z - from.z;
    const distH = Math.max(10, Math.hypot(dx, dz));
    const flightT = clamp(distH / 46, 0.7, 2.6);
    b.vel.set(dx / flightT, (dy + 0.5 * 18 * flightT * flightT) / flightT, dz / flightT);
    b.rv.set(rand(-5, 5), rand(-5, 5), rand(-5, 5));
    this.boulders.push(b);
    if (!this.boulderMarks) {
      this.boulderMarkGeo = new THREE.RingGeometry(0.72, 1, 36);
      this.boulderMarkGeo.rotateX(-Math.PI / 2);
      this.boulderMarks = [];
      for (let i = 0; i < 12; i++) {
        const m = new THREE.Mesh(this.boulderMarkGeo, new THREE.MeshBasicMaterial({ color: 0xff4526, transparent: true, opacity: 0, depthWrite: false }));
        m.visible = false;
        m.renderOrder = 3;
        this.scene.add(m);
        this.boulderMarks.push(m);
      }
    }
    const vy = b.vel.y, py = b.pos.y;
    const tLand = (vy + Math.sqrt(Math.max(0, vy * vy + 36 * py))) / 18;
    b.mark = this.boulderMarks.find((m) => !m.visible) || null;
    if (b.mark) {
      b.mark.position.set(b.pos.x + b.vel.x * tLand, 0.12, b.pos.z + b.vel.z * tLand);
      b.mark.scale.setScalar(b.r * 4.5);
      b.mark.visible = true;
    }
  }

  updateBoulders(dt) {
    const p = this.player;
    for (let i = this.boulders.length - 1; i >= 0; i--) {
      const b = this.boulders[i];
      b.age += dt;
      b.vel.y -= 18 * dt;
      const stepLen = b.vel.length() * dt;
      let hit = false;
      if (stepLen > 0) {
        _v.copy(b.vel).normalize();
        const rHit = this.world.col.raycast(b.pos, _v, stepLen + b.r * 0.6, { dynamics: false }, _boulderHit);
        if (rHit) {
          b.pos.copy(rHit.point);
          hit = true;
        } else {
          b.pos.addScaledVector(_v, stepLen);
        }
      }
      if (b.pos.y <= b.r * 0.6) { b.pos.y = b.r * 0.6; hit = true; }
      if (!p.dead && p.pos.distanceTo(b.pos) < b.r + 1.4) {
        _v2.subVectors(p.pos, b.pos).setY(0.5).normalize();
        p.knockback(_v2, 16, 14);
        hit = true;
      }
      b.m.position.copy(b.pos);
      b.m.rotation.x += b.rv.x * dt;
      b.m.rotation.y += b.rv.y * dt;
      if (b.mark) b.mark.material.opacity = 0.4 + Math.sin(b.age * 9) * 0.18 + Math.min(0.3, b.age * 0.06);
      if (Math.random() < dt * 16) this.vfx.dust(b.pos, b.r * 1.2, 2);

      if (hit || b.age > 6) {
        this.vfx.dust(b.pos, b.r * 4, 18);
        this.vfx.debris(b.pos, 8, 10);
        this.vfx.impactRing(b.pos, _v.set(0, 1, 0), b.r * 4.5, VFX_COLORS.ARMOR_C, 0.25);
        this.audio.fall(b.pos, 8);
        this.world.destroyNear(b.pos, b.r * 3.5);
        this.cam.shake(clamp(0.8 - b.pos.distanceTo(p.pos) / 90, 0.08, 0.55));
        b.m.visible = false;
        if (b.mark) { b.mark.visible = false; b.mark = null; }
        this.boulderPool.push(b);
        this.boulders.splice(i, 1);
      }
    }
  }

  clearTransientState() {
    if (this.deathTimer) { clearTimeout(this.deathTimer); this.deathTimer = null; }
    this.hitstopT = 0;
    this.hitstopScale = 1;
    this.rampT = 0;
    this.timeScale = 1;
    this.impactPulse = 0;
    this.bloodMist = 0;
    this.flash = 0;
    this.intensity = 0;
    this.pendingUpgrades = null;
    const u = this.post.u;
    u.uImpact.value = 0; u.uFlash.value = 0; u.uHurt.value = 0; u.uSpeed.value = 0; u.uBlood.value = 0;
    for (const t of this.titans) t.dispose();
    this.titans = [];
    this.clearBoulders();
    this.vfx.clear();
    this.world.resetDestruction();
    this.player.reset();
    this.applyAppearance();
    this.cam.yaw = Math.atan2(-this.player.pos.x, -this.player.pos.z);
    this.cam.pitch = -0.05;
    this.cam.target.copy(this.player.pos);
    this.cam.killCam = 0;
    this.cam.execT = 0;
    this.cam.impactFov = 0;
    this.cam.trauma = 0;
    this.cam.hitJoltT = 0;
    this.hud.reset();
  }

  beginPlay(quiet) {
    this.started = true;
    document.getElementById('title').classList.add('hidden');
    document.getElementById('dead').classList.add('hidden');
    document.getElementById('win').classList.add('hidden');
    this.hud.show(true);
    if (!quiet) {
      const msg = this.mode === 'endless'
        ? 'PERTAHANAN DIMULAI<br><span style="font-size:18px">Skuadron Pengintai siap di udara!</span>'
        : 'OPERASI DIMULAI<br><span style="font-size:18px">Kawal Konvoi Insinyur ke Gerbang Selatan!</span>';
      this.hud.toast(msg, 2.4);
    }
    this.syncPause();
  }

  restart() {
    this.won = false;
    this.endless = this.mode === 'endless';
    this.started = true;
    this.stats = { maxSpeed: 0, bestCombo: 0, time: 0 };
    document.getElementById('title').classList.add('hidden');
    document.getElementById('win').classList.add('hidden');
    document.getElementById('dead').classList.add('hidden');
    this.story.reset('play');
    this.clearTransientState();
    this.engineers.reset(this.mode);
    this.squad.reset(this.mode !== 'training');
    this.kills = 0;
    this.wave = 0;
    this.waveT = 1.6;
    this.story.toPlay(true);
    this.hud.show(true);
    this.hud.toast(
      this.mode === 'training'
        ? 'ARENA LATIHAN<br><span style="font-size:18px">Lewati cincin biru & latih eksekusi</span>'
        : 'BERSIAP<br><span style="font-size:18px">Skuadron mengudara · Titan mendekat dari jauh</span>',
      1.9,
    );
    this.syncPause();
  }

  returnToMenu() {
    this.started = false;
    this.won = false;
    this.stats = { maxSpeed: 0, bestCombo: 0, time: 0 };
    this.kills = 0;
    this.wave = 0;
    this.waveT = 3;
    this.story.reset('title');
    this.clearTransientState();
    this.engineers.reset(this.mode);
    this.squad.reset(false);
    document.getElementById('dead').classList.add('hidden');
    document.getElementById('win').classList.add('hidden');
    document.getElementById('paused').classList.add('hidden');
    document.getElementById('settings').classList.add('hidden');
    document.getElementById('customize').classList.add('hidden');
    this.hud.show(false);
    this.updateBestBanner();
    document.getElementById('title').classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    this.syncPause();
  }

  spawnTrainingTargets() {
    const spots = [
      [-26, 62, 'sprinter', 8.5],
      [0, 68, 'normal', 13],
      [28, 86, 'tank', 18],
      [0, 118, 'armored', 20],
    ];
    for (const [x, z, type, h] of spots) {
      const ti = new Titan(this, new THREE.Vector3(x, 0, z), { type, height: h, passive: true, instant: true });
      this.titans.push(ti);
    }
  }

  pickFarSpawnPoint() {
    const convoy = this.engineers.activeConvoy ? this.engineers.convoyPos : null;
    const pPos = this.player.pos;
    for (let attempt = 0; attempt < 24; attempt++) {
      const fromBreach = Math.random() < 0.48;
      const a = fromBreach ? rand(-0.55, 0.55) : rand(-2.4, 2.4);
      const r = fromBreach ? rand(315, 362) : rand(248, 345);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (convoy && Math.hypot(x - convoy.x, z - convoy.z) < 135) continue;
      if (Math.hypot(x - pPos.x, z - pPos.z) < 88) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(rand(-140, 140), 0, -260);
  }

  spawnWave() {
    if (this.mode === 'training') {
      this.spawnTrainingTargets();
      return;
    }
    this.wave++;
    if (this.wave > 1) {
      this.engineers.districtHP = Math.min(100, this.engineers.districtHP + 8);
      this.engineers.convoyHP = Math.min(100, this.engineers.convoyHP + 15);
      this.offerUpgrades();
    }
    const isBossWave = (this.mode === 'campaign' && this.wave === this.maxWave) || (this.mode === 'endless' && this.wave % 4 === 0);
    const n = Math.min(6 + this.wave * 2, 16);
    for (let i = 0; i < n; i++) {
      const pos = this.pickFarSpawnPoint();
      const roll = Math.random();
      let type = 'normal';
      if (roll < 0.28) type = 'sprinter';
      else if (this.wave >= 2 && roll < 0.48) type = 'abnormal';
      else if (this.wave >= 2 && roll > 0.82) type = 'tank';
      this.titans.push(new Titan(this, pos, { type }));
    }
    if (isBossWave) {
      const bossPos = this.pickFarSpawnPoint();
      this.titans.push(new Titan(this, bossPos, { type: 'armored', height: 20.5 }));
      this.hud.radio('PERINGATAN DARURAT: TITAN LAPIS muncul di kejauhan! Hancurkan zirahnya dengan Rudal Petir [X] atau Perintah Skuadron [T]!');
    }
    const label = this.mode === 'endless' ? `GELOMBANG ${this.wave}` : `FASE ${this.wave} / ${this.maxWave}`;
    document.getElementById('wave').textContent = label;
    const totalAdded = n + (isBossWave ? 1 : 0);
    this.hud.toast(`${label}<br><span style="font-size:18px">${totalAdded} titan mendekat dari luar distrik${isBossWave ? ' · TITAN LAPIS!' : ''}</span>`, 2.3);
    this.audio.horn();
    this.cam.shake(0.45);
  }

  offerUpgrades() {
    if (this.mode === 'training') return;
    const pool = UPGRADE_POOL.slice();
    const picks = [];
    while (picks.length < 3 && pool.length) {
      const idx = Math.floor(Math.random() * pool.length);
      picks.push(pool.splice(idx, 1)[0]);
    }
    this.pendingUpgrades = picks;
    this.hud.showUpgrades(picks);
  }

  pickUpgrade(index) {
    if (!this.pendingUpgrades || index < 0 || index >= this.pendingUpgrades.length) return;
    const chosen = this.pendingUpgrades[index];
    chosen.apply(this.player);
    this.pendingUpgrades = null;
    this.hud.showUpgrades(null);
    this.audio.bladeSwap();
    this.hud.toast(`AKTIF: ${chosen.title}`, 1.3);
  }

  triggerImpact(freezeDur, freezeScale, rampDur, rampFrom, pulse) {
    if (freezeDur > this.hitstopT) {
      this.hitstopT = freezeDur;
      this.hitstopScale = freezeScale;
    } else if (this.hitstopT > 0) {
      this.hitstopScale = Math.min(this.hitstopScale, freezeScale);
    }
    if (rampDur > this.rampT) {
      this.rampT = rampDur;
      this.rampDur = rampDur;
      this.rampFrom = rampFrom;
    }
    this.impactPulse = Math.max(this.impactPulse, pulse);
  }

  onHookHit(h) {
    const flesh = !!h.owner;
    this.audio.hookHit(h.tip, flesh);
    if (flesh) this.vfx.bloodSpray(h.tip, _v.set(0, 1, 0), 6, 0.5);
    else { this.vfx.sparks(h.tip, 8); this.vfx.dust(h.tip, 1, 4); }
    this.cam.shake(flesh ? 0.07 : 0.055);
    this.cam.impactFov = Math.max(this.cam.impactFov, 0.9);
  }

  onSlashHit(t, result, dmg, point) {
    const p = this.player;
    const dir = _v2.copy(p.vel);
    if (dir.lengthSq() > 1e-4) dir.normalize(); else dir.set(0, 0, 1);

    if (result === 'kill') {
      this.kills++;
      p.combo++;
      p.comboT = 7.0;
      this.vfx.napeKill(point, dir, this.cam.camera.quaternion);
      this.audio.flesh(point, true);
      this.hud.pop(point, dmg, 'kill');
      this.hud.hitmarker('kill');
      const lbl = p.speed > 40 ? 'EKSEKUSI DEWA!' : p.spin > 0 ? 'TEBASAN PUTAR!' : p.combo >= 3 ? 'PEMBANTAIAN!' : 'EKSEKUSI BERSIH!';
      this.hud.toast(lbl, 1.25);
      this.hud.combo(p.combo);
      if (p.combo >= 3) this.audio.comboSting(p.combo);
      this.hud.killFeed(`<b>KAMU</b> mengeksekusi <em>Titan ${t.label}</em>${p.combo >= 2 ? ` · ${p.combo}×` : ''}`);
      this.stats.bestCombo = Math.max(this.stats.bestCombo, p.combo);
      this.triggerImpact(0.135, 0.006, 0.44, 0.16, 1.0);
      this.flash = 0.26;
      if (this.cam.isFP()) this.bloodMist = 0.82;
      this.cam.shake(0.65);
      this.cam.hitJolt(1.15, 0.14);
      this.cam.triggerExecution(point);
      this.engineers.onNearKill(point);
      t.root.updateMatrixWorld();
    } else if (result === 'armor-break') {
      this.vfx.armorShatter(point, dir);
      this.audio.armorShatter(point);
      this.hud.pop(point, 'ZIRAH PECAH!', 'kill');
      this.hud.hitmarker('kill');
      this.hud.toast('<span style="font-size:21px;color:#ffe29a">ZIRAH TENGKUK HANCUR — EKSEKUSI SEKARANG!</span>', 1.5);
      this.triggerImpact(0.125, 0.008, 0.36, 0.2, 0.95);
      this.flash = 0.22;
      this.cam.hitJolt(1.0, 0.13);
    } else if (result === 'armor') {
      this.vfx.sparks(point, 20, VFX_COLORS.ARMOR_C);
      this.vfx.flash(point, 2.0, VFX_COLORS.ARMOR_C);
      this.audio.clang(point);
      this.hud.pop(point, `-${dmg} ZIRAH`, 'small');
      this.hud.hitmarker('armor');
      this.hud.toast('<span style="font-size:18px;color:#ffd996">Zirah keras! Tembak Rudal Petir [X] atau Perintah [T]</span>', 1.1);
      this.triggerImpact(0.055, 0.03, 0.12, 0.55, 0.5);
      this.cam.hitJolt(0.55, 0.08);
    } else if (result === 'nape') {
      this.vfx.flash(point, 2.4, VFX_COLORS.HIT_FLASH);
      this.vfx.bloodSpray(point, dir, 44, 1.15);
      this.vfx.impactRing(point, dir, 4.2, VFX_COLORS.HIT_FLASH, 0.2);
      this.audio.flesh(point, false);
      this.hud.pop(point, dmg);
      this.hud.hitmarker('hit');
      this.triggerImpact(0.085, 0.018, 0.2, 0.36, 0.72);
      this.cam.hitJolt(0.75, 0.1);
    } else if (result === 'deflect') {
      this.vfx.sparks(point, 14);
      this.audio.clang(point);
      this.hud.hitmarker('armor');
      this.triggerImpact(0.04, 0.05, 0.1, 0.65, 0.38);
    } else {
      this.vfx.flash(point, 2.2, VFX_COLORS.HIT_FLASH);
      this.vfx.bloodSpray(point, dir, 36, 1.05);
      this.audio.flesh(point, false);
      const txt = { ankle: 'TENDON PUTUS!', arm: 'TANGAN PUTUS!', eyes: 'MATA BUTA!' }[result] || dmg;
      this.hud.pop(point, txt, 'small');
      this.hud.hitmarker('hit');
      this.triggerImpact(0.095, 0.015, 0.22, 0.32, 0.78);
      this.cam.hitJolt(0.82, 0.11);
    }
  }

  onTitanStep(t, i) {
    const f = t.ankles[i].getWorldPosition(_v);
    f.y = 0.2;
    this.vfx.dust(f, t.s * 2.5, 6);
    this.audio.step(f, t.height);
    const d = f.distanceTo(this.player.pos);
    this.cam.shake(clamp((t.height * 3 - d) / (t.height * 6), 0, 0.22));
  }

  onTitanFall(t) {
    const pos = t.head.getWorldPosition(_v); pos.y = 0.5;
    this.vfx.dust(pos, t.s * 6, 28);
    this.audio.fall(pos, t.height);
    this.cam.shake(clamp(1 - pos.distanceTo(this.player.pos) / 120, 0.1, 0.75));
    const feet = t.root.position;
    const dirV = _v2.set(Math.sin(t.fallDir), 0, Math.cos(t.fallDir));
    for (let i = 0; i < 4; i++) {
      _v.set(feet.x + dirV.x * t.height * i * 0.3, 0, feet.z + dirV.z * t.height * i * 0.3);
      const n = this.world.destroyNear(_v, t.s * 2.5);
      if (n) { this.vfx.dust(_v, t.s * 4, 14); this.audio.thunder(); }
    }
  }

  explode(pos) {
    const R = 19;
    this.vfx.flash(pos, 7.2, VFX_COLORS.KILL_FLASH);
    this.vfx.impactRing(pos, _v.set(0, 1, 0), 13.5, VFX_COLORS.KILL_FLASH, 0.34);
    this.vfx.burst(pos, _v.set(0, 1, 0), 56);
    this.vfx.sparks(pos, 34);
    this.vfx.dust(pos, 12, 28);
    this.vfx.steam(pos, 7.5, 2.6);
    this.audio.thunder();
    this.audio.fall(pos, 10);
    this.cam.shake(clamp(1.35 - pos.distanceTo(this.player.pos) / 45, 0.32, 1.3));
    this.triggerImpact(0.115, 0.01, 0.32, 0.24, 0.94);
    this.flash = 0.32;

    for (let i = this.boulders.length - 1; i >= 0; i--) {
      if (this.boulders[i].pos.distanceTo(pos) < R) {
        this.vfx.debris(this.boulders[i].pos, 10, 14);
        this.boulders[i].m.visible = false;
        this.boulderPool.push(this.boulders[i]);
        this.boulders.splice(i, 1);
      }
    }

    for (let i = 0; i < this.titans.length; i++) {
      const t = this.titans[i];
      if (!t.alive) continue;
      const d = t.nape.c.distanceTo(pos);
      const bodyD = Math.min(d, t.root.position.distanceTo(pos));
      if (bodyD > R) continue;
      const dmg = Math.round(720 * (1 - bodyD / R) + 260);
      const r = t.hit('nape', dmg, t.nape.c.clone(), _v2.set(0, 1, 0), 0, { explosive: true });
      if (r.result === 'kill' || r.result === 'armor-break') {
        this.onSlashHit(t, r.result, r.armorDmg || dmg, t.nape.c.clone());
      } else {
        t.stagger(3.5);
        this.vfx.bloodSpray(t.nape.c, _v2.set(0, 1, 0), 40, 1.15);
        this.hud.pop(t.nape.c, r.armorDmg || dmg);
        this.audio.flesh(t.nape.c, true);
      }
    }
    const n = this.world.destroyNear(pos, 9.5);
    if (n) this.hud.toast(`<span style="font-size:18px">${n} BANGUNAN HANCUR</span>`, 0.8);
    const pd = this.player.pos.distanceTo(pos);
    if (pd < R * 0.42) {
      _v.copy(this.player.pos).sub(pos).normalize();
      this.player.knockback(_v, 16, 18 * (1 - pd / (R * 0.42)));
    }
  }

  onDistrictDamage(amount) {
    if (this.mode === 'training' || !this.started || !this.story.allowWaves()) return;
    this.engineers.districtHP = Math.max(0, this.engineers.districtHP - amount * 0.34);
    if (this.engineers.districtHP <= 0) {
      this.onMissionFail('district');
    }
  }

  onMissionFail(reason) {
    if (this.player.dead) return;
    this.player.dead = true;
    for (const h of this.player.hooks) this.player.release(h);
    this.onPlayerDeath(reason, 'OPERASI GAGAL');
  }

  onHouseDown(house) {
    this.world.destroyHouse(house);
    const p = _v.set(house.x, house.h * 0.5, house.z);
    this.vfx.dust(p, 10, 22);
    this.vfx.sparks(p, 10);
    this.audio.fall(p, 12);
    this.cam.shake(clamp(1 - p.distanceTo(this.player.pos) / 90, 0.14, 0.55));
  }

  onLand(v) {
    if (v > 6) {
      this.audio.land(v);
      this.vfx.dust(_v.copy(this.player.pos).setY(this.player.pos.y - 0.9), 0.8, 6);
    }
    if (v > 14) this.cam.shake(v / 85);
  }
  onCrash() { this.cam.shake(0.75); this.flash = 0.16; this.hud.toast('<span style="font-size:20px">TABRAKAN KERAS!</span>', 0.8); }
  onBump(v) { this.cam.shake(v / 120); }
  onSlingshot(pos, vel) {
    _v.copy(vel).normalize();
    this.vfx.impactRing(pos, _v, 3.2, VFX_COLORS.SLASH, 0.22);
    this.vfx.burst(pos, _v.negate(), 8);
    this.audio.dash();
    this.cam.impactFov = Math.max(this.cam.impactFov, 3.2);
    this.cam.shake(0.08);
  }
  activeAttackers() {
    let n = 0;
    for (let i = 0; i < this.titans.length; i++) {
      const s = this.titans[i].state;
      if (this.titans[i].alive && (s === 'swipe' || s === 'slam' || s === 'reach' || s === 'throw')) n++;
    }
    return n;
  }
  onDash(dir) { this.story.onDash(); this.audio.dash(); this.vfx.burst(this.player.pos, dir, 16); this.cam.shake(0.11); this.cam.impactFov = Math.max(this.cam.impactFov, 1.8); }
  onPlayerHurt(d) { this.hud.hurt(d); this.audio.hurt(); this.cam.shake(0.45); }
  onGrabbed() { this.audio.roar(this.player.pos, 10, 0.6); this.cam.shake(0.55); }

  recordScore(rank = '') {
    let changed = false;
    if (this.kills > (this.prefs.bestKills || 0)) { this.prefs.bestKills = this.kills; changed = true; }
    if (this.wave > (this.prefs.bestWave || 0)) { this.prefs.bestWave = this.wave; changed = true; }
    const rankOrder = { '': 0, C: 1, B: 2, A: 3, S: 4 };
    if ((rankOrder[rank] || 0) > (rankOrder[this.prefs.bestRank] || 0)) { this.prefs.bestRank = rank; changed = true; }
    if (changed) savePrefs(this.prefs);
  }

  onPlayerDeath(why, customTitle = 'KAMU GUGUR') {
    const msg = {
      eaten: 'Dimangsa titan.',
      crash: 'Menghantam struktur pada kecepatan ekstrem.',
      swat: 'Terhempas serangan titan.',
      convoy: 'Gerobak Regu Insinyur hancur sebelum Gerbang Selatan tertutup.',
      district: 'Distrik Halvard runtuh diterjang gelombang titan.',
    }[why] || '';
    this.recordScore('C');
    if (this.deathTimer) clearTimeout(this.deathTimer);
    this.deathTimer = setTimeout(() => {
      this.deathTimer = null;
      if (!this.started || !this.player.dead) return;
      document.getElementById('deadtitle').textContent = customTitle;
      document.getElementById('deadwhy').textContent = msg;
      document.getElementById('deadstats').innerHTML = this.statsHTML();
      document.getElementById('dead').classList.remove('hidden');
      document.getElementById('paused').classList.add('hidden');
      this.hud.show(false);
      if (document.pointerLockElement) document.exitPointerLock();
    }, why === 'eaten' ? 400 : 1200);
    if (why === 'eaten') {
      this.vfx.bloodSpray(this.player.pos, _v.set(0, 1, 0), 60, 0.8);
      this.player.model.setVisible(false);
    }
  }

  computeRank() {
    const dist = this.engineers.districtHP;
    const conv = this.engineers.convoyHP;
    const score = dist * 0.55 + conv * 0.3 + Math.min(20, this.stats.bestCombo * 3);
    return score >= 86 ? 'S' : score >= 70 ? 'A' : score >= 50 ? 'B' : 'C';
  }

  statsHTML() {
    const s = this.stats, m = Math.floor(s.time / 60), sec = Math.floor(s.time % 60);
    const dist = Math.round(this.engineers.districtHP);
    return `<span>Titan <b>${this.kills}</b></span><span>Fase <b>${this.wave}</b></span><span>Keutuhan Distrik <b>${dist}%</b></span><span>Laju Puncak <b>${Math.round(s.maxSpeed)} m/s</b></span><span>Combo <b>${s.bestCombo}×</b></span><span>Waktu <b>${m}:${String(sec).padStart(2, '0')}</b></span>`;
  }

  victory() {
    this.won = true;
    this.engineers.sealProgress = 1;
    this.world.setSealProgress(1);
    const rank = this.computeRank();
    this.recordScore(rank);
    document.getElementById('winrank').textContent = rank;
    document.getElementById('winstats').innerHTML = this.statsHTML();
    document.getElementById('win').classList.remove('hidden');
    this.hud.show(false);
    this.syncPause();
    this.audio.fanfare();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  setQuality(q, showToast = true) {
    this.quality = q;
    this.prefs.quality = q;
    const pr = [0.7, 1.0, 1.5][q] || 1.0;
    this.post.maxPR = pr;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, pr));
    this.post.resize();
    this.post.bloom.enabled = q > 0;
    this.world.sun.castShadow = q > 0;
    const ms = q > 1 ? 2048 : 1024, sh = this.world.sun.shadow;
    if (sh.mapSize.x !== ms) {
      sh.mapSize.set(ms, ms);
      if (sh.map) { sh.map.dispose(); sh.map = null; }
    }
    if (showToast && this.hud) {
      this.hud.toast(`<span style="font-size:20px">Grafis: ${['RENDAH', 'SEDANG', 'TINGGI'][q]}</span>`, 1.1);
    }
  }

  frame() {
    const raw = this.clock.getDelta();
    const rdt = Math.min(raw, 1 / 20);
    if (this.frozen) return;
    if (this.started && !this.manualQuality) {
      this.fpsAvg = lerp(this.fpsAvg || 60, 1 / Math.max(raw, 1e-3), 0.02);
      this.lowT = this.fpsAvg < 32 ? (this.lowT || 0) + raw : 0;
      if (this.lowT > 4 && this.quality > 0) { this.setQuality(this.quality - 1, true); this.lowT = 0; this.fpsAvg = 45; }
    }
    if (this.input.pressed('KeyG')) { this.manualQuality = true; this.setQuality((this.quality + 2) % 3, true); savePrefs(this.prefs); }
    this.step(rdt);
    this.post.render(this.elapsed);
    this.input.endFrame();
  }

  sim(sec, dt = 1 / 60, each, renderEach = false) {
    this.frozen = true;
    for (let t = 0; t < sec; t += dt) {
      if (each) each(this, t);
      this.step(dt);
      if (renderEach) this.post.render(this.elapsed);
      this.input.endFrame();
    }
    if (!renderEach) this.post.render(this.elapsed);
  }

  step(rdt) {
    this.elapsed += rdt;
    const inp = this.input;
    inp.pollGamepad();
    if (this.locked) this.cam.look(inp.mouse.dx, inp.mouse.dy);

    if (this.hitstopT > 0) {
      this.hitstopT = Math.max(0, this.hitstopT - rdt);
      this.timeScale = this.hitstopScale;
    } else if (this.rampT > 0) {
      this.rampT = Math.max(0, this.rampT - rdt);
      const p = 1 - clamp(this.rampT / Math.max(0.001, this.rampDur), 0, 1);
      this.timeScale = lerp(this.rampFrom, 1.0, easeOutQuart(p));
    } else {
      this.timeScale = 1.0;
    }

    const paused = this.started && !this.locked && !this.player.dead && !(this.won && !this.endless);
    const dt = paused ? 0 : rdt * this.timeScale;

    if (inp.pressed('KeyH')) document.getElementById('help').classList.toggle('hidden');
    if (this.pendingUpgrades) {
      if (inp.pressed('Digit1')) this.pickUpgrade(0);
      else if (inp.pressed('Digit2')) this.pickUpgrade(1);
      else if (inp.pressed('Digit3')) this.pickUpgrade(2);
    }
    for (const [k, f] of [['BracketLeft', 0.85], ['BracketRight', 1.18]]) {
      if (inp.pressed(k)) {
        this.prefs.sensMult = clamp(this.prefs.sensMult * f, 0.3, 2.5);
        this.cam.sens = 0.0022 * this.prefs.sensMult;
        savePrefs(this.prefs);
        this.hud.toast(`<span style="font-size:20px">Sensitivitas ${this.prefs.sensMult.toFixed(2)}×</span>`, 1);
      }
    }
    if (inp.pressed('KeyF')) {
      const p = this.player;
      p.hookMode = p.hookMode === 'focus' ? 'auto' : 'focus';
      this.hud.toast(p.hookMode === 'focus' ? 'KAIT: FOKUS<br><span style="font-size:16px">dua kabel ke satu titik bidik</span>' : 'KAIT: OTOMATIS<br><span style="font-size:16px">jangkar kiri/kanan pintar</span>', 1.1);
    }
    if (inp.pressed('KeyV')) {
      this.cam.fp = !this.cam.fp;
      this.hud.toast(`<span style="font-size:20px">Kamera: ${this.cam.fp ? 'POV ORANG PERTAMA' : 'ORANG KETIGA'}</span>`, 1.1);
    }
    if (inp.pressed('KeyM')) {
      this.prefs.music = !this.prefs.music;
      this.audio.musicOn = this.prefs.music;
      savePrefs(this.prefs);
      this.hud.toast(`<span style="font-size:20px">Musik: ${this.audio.musicOn ? 'AKTIF' : 'MATI'}</span>`, 1);
    }

    if (dt > 0) {
      if (this.started) {
        let alive = 0;
        for (let i = 0; i < this.titans.length; i++) if (this.titans[i].alive) alive++;
        this.stats.time += dt;
        this.stats.maxSpeed = Math.max(this.stats.maxSpeed, this.player.speed);
        if (alive === 0 && this.story.allowWaves()) {
          if (this.mode === 'campaign' && this.wave >= this.maxWave && !this.won) {
            if (this.engineers.sealProgress >= 0.99) this.victory();
            else {
              this.engineers.sealProgress = Math.min(1, this.engineers.sealProgress + dt * 0.25);
              this.world.setSealProgress(this.engineers.sealProgress);
              if (this.engineers.sealProgress >= 0.99) this.victory();
            }
          } else if (!this.won || this.endless || this.mode === 'training') {
            this.waveT -= dt;
            if (this.waveT <= 0) { this.spawnWave(); this.waveT = this.mode === 'training' ? 2.5 : 5.0; }
          }
        }
      }
      this.world.col.dynamics.length = 0;
      for (let i = 0; i < this.titans.length; i++) {
        const t = this.titans[i];
        if (t.alive || t.deadT < 8) {
          for (let k = 0; k < t.parts.length; k++) this.world.col.dynamics.push(t.parts[k]);
        }
      }
      if (this.started) {
        this.player.update(dt);
        this.engineers.update(dt);
        this.squad.update(dt);
        this.updateBoulders(dt);
      } else {
        this.player.animate(dt);
      }
      for (let i = 0; i < this.titans.length; i++) this.titans[i].update(dt);
      for (let i = this.titans.length - 1; i >= 0; i--) {
        if (this.titans[i].remove) { this.titans[i].dispose(); this.titans.splice(i, 1); }
      }
      this.world.update(dt);
      this.vfx.update(dt, rdt);
    } else if (!paused && this.hitstopT > 0) {
      this.vfx.update(0, rdt);
    }

    this.story.update(rdt);
    if (!this.started && !this.story.active && !this.cam.customizing) {
      this.cam.yaw += rdt * 0.06;
      this.cam.pitch = 0.08 + Math.sin(this.elapsed * 0.15) * 0.06;
    }
    this.cam.update(dt, rdt);
    this.world.followShadow(this.player.pos);

    let near = 999;
    for (let i = 0; i < this.titans.length; i++) {
      const t = this.titans[i];
      if (t.alive) near = Math.min(near, t.root.position.distanceTo(this.player.pos));
    }
    this.intensity = damp(this.intensity, clamp(1 - near / 120, 0, 1), 1.2, rdt);
    this.audio.update(rdt, this.started && !paused);
    if (this.started) this.hud.update(rdt);

    const u = this.post.u;
    u.uSpeed.value = damp(u.uSpeed.value, clamp((this.player.speed - 15) / 45, 0, 1), 5, rdt);
    u.uHurt.value = this.hud.hurtT;
    this.flash = Math.max(0, this.flash - rdt * 3.2);
    u.uFlash.value = this.flash * this.flash;
    this.impactPulse = Math.max(0, this.impactPulse - rdt * 4.2);
    u.uImpact.value = this.impactPulse;
    this.bloodMist = Math.max(0, this.bloodMist - rdt * 0.85);
    u.uBlood.value = this.cam.isFP() ? this.bloodMist : 0;
  }
}

window.THREE = THREE;
window.game = new Game();
