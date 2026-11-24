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
import { STORY_CHAPTERS, ARENAS, WEATHERS, defaultProgress, isChapterUnlocked, isCosmeticUnlocked, unlockHint } from './progression.js';
import { MultiplayerClient } from './net/multiplayer.js';
import { ShifterAbilities } from './entities/shifters.ts';
import { CannonController } from './combat/cannonControl.ts';
import { clamp, damp, lerp, rand, easeOutQuart, loadPrefs, savePrefs, DEFAULT_BINDS, BIND_LABELS, formatKey } from './util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _boulderHit = createRayHit();

const UPGRADE_POOL = [
  { id: 'blade', title: 'Ultrahard Steel', desc: 'Blade durability +30% & slash damage +15%', apply: (p) => { p.mods.bladeSaver *= 0.72; p.mods.damageBonus *= 1.15; } },
  { id: 'turbine', title: 'Dual Vector Turbine', desc: 'Momentum boost & air turn agility +18%', apply: (p) => { p.mods.thrustBonus *= 1.18; } },
  { id: 'hook', title: 'High-Torque Winch', desc: 'Cable speed +28% & grapple range +25m', apply: (p) => { p.mods.hookSpeedBonus *= 1.28; p.mods.hookRangeBonus += 25; } },
  { id: 'spear', title: 'Ordnance Rack', desc: '+2 Thunder Spear capacity & full restock', apply: (p) => { p.mods.maxSpearBonus += 2; p.spears = p.maxSpears; } },
  { id: 'valve', title: 'Pressure Regulator', desc: 'Gas consumption -25% & +1 spare canister', apply: (p) => { p.mods.gasSaver *= 0.75; p.gasCylinders = Math.min(6, p.gasCylinders + 1); p.gas = 100; } },
  { id: 'spin', title: 'Spiral Mastery', desc: 'Spiral Slash charge rate +45%', apply: (p) => { p.mods.spinRateBonus *= 1.45; } },
];

class Input {
  constructor(canvas, game) {
    this.game = game;
    this.keys = new Set();
    this.edge = new Set();
    this.padKeys = new Set();
    this.padActions = new Set();
    this.padEdge = new Set();
    this.rebinding = null;
    this.mouse = { l: false, r: false, lPressed: false, dx: 0, dy: 0 };
    addEventListener('keydown', (e) => {
      if (this.rebinding) {
        e.preventDefault();
        e.stopPropagation();
        this.rebinding(e.code);
        return;
      }
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
    const nextK = new Set();
    const nextA = new Set();
    if (p) {
      const ax = p.axes, bt = p.buttons, dead = 0.22;
      if (ax[0] < -dead) nextA.add('left'); if (ax[0] > dead) nextA.add('right');
      if (ax[1] < -dead) nextA.add('forward'); if (ax[1] > dead) nextA.add('back');
      if (bt[6]?.value > 0.25) nextA.add('hookL'); if (bt[7]?.value > 0.25) nextA.add('hookR');
      if (bt[4]?.pressed || bt[5]?.pressed) nextA.add('boost');
      if (bt[0]?.pressed) nextA.add('reel');
      if (bt[1]?.pressed) nextA.add('hookMode');
      if (bt[3]?.pressed) nextA.add('reloadGas');
      if (bt[12]?.pressed) nextA.add('reloadBlade');
      if (bt[13]?.pressed) nextA.add('spear');
      if (bt[15]?.pressed) nextA.add('command');
      if (bt[9]?.pressed) nextK.add('Escape');
      if (this.game.pendingUpgrades) {
        if (bt[14]?.pressed) nextK.add('Digit1');
        if (bt[13]?.pressed) { nextA.delete('spear'); nextK.add('Digit2'); }
        if (bt[15]?.pressed) { nextA.delete('command'); nextK.add('Digit3'); }
      }
      this.mouse.dx += Math.abs(ax[2] || 0) > dead ? ax[2] * 17 : 0;
      this.mouse.dy += Math.abs(ax[3] || 0) > dead ? ax[3] * 14 : 0;
      const slash = !!bt[2]?.pressed;
      if (slash && !this.padSlash) this.mouse.lPressed = true;
      this.mouse.l = slash; this.padSlash = slash;
    }
    for (const k of nextK) if (!this.padKeys.has(k)) this.edge.add(k);
    for (const a of nextA) if (!this.padActions.has(a)) this.padEdge.add(a);
    this.padKeys = nextK;
    this.padActions = nextA;
  }
  key(c) { return this.keys.has(c) || this.padKeys.has(c); }
  pressed(c) { return this.edge.has(c); }
  action(name) {
    const code = this.game.prefs?.binds?.[name] || DEFAULT_BINDS[name];
    if (this.keys.has(code) || this.padActions.has(name)) return true;
    if (name === 'boost' && code === 'ShiftLeft' && this.keys.has('ShiftRight')) return true;
    return false;
  }
  actionPressed(name) {
    const code = this.game.prefs?.binds?.[name] || DEFAULT_BINDS[name];
    if (this.edge.has(code) || this.padEdge.has(name)) return true;
    if (name === 'boost' && code === 'ShiftLeft' && this.edge.has('ShiftRight')) return true;
    return false;
  }
  endFrame() { this.edge.clear(); this.padEdge.clear(); this.mouse.lPressed = false; this.mouse.dx = this.mouse.dy = 0; }
}

class Game {
  constructor() {
    this.prefs = loadPrefs({
      quality: 2,
      sensMult: 1.0,
      fov: 75,
      volume: 0.8,
      musicVol: 0.65,
      sfxVol: 0.9,
      invertY: false,
      music: true,
      shake: true,
      showFps: false,
      fpDefault: true,
      autoCycle: true,
      introCutscene: true,
      fieldTutorial: false,
      bestKills: 0,
      bestWave: 0,
      bestRank: '',
      appearance: { ...DEFAULT_APPEARANCE },
      binds: { ...DEFAULT_BINDS },
      progress: defaultProgress(),
    });
    this.prefs.appearance = { ...DEFAULT_APPEARANCE, ...(this.prefs.appearance || {}) };
    this.prefs.progress = { ...defaultProgress(), ...(this.prefs.progress || {}) };

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
    this.arena = 'town';
    this.weather = 'dusk';
    this.chapterIdx = 0;
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
    this.net = new MultiplayerClient(this);
    this.shifters = new ShifterAbilities(this);
    this.cannon = new CannonController(this);
    this.TitanClass = Titan;

    this.stats = { maxSpeed: 0, bestCombo: 0, time: 0 };
    this.maxWave = 5;
    this.kills = 0;
    this.wave = 0;
    this.waveT = 2.4;
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
      const guideOpen = !document.getElementById('guide').classList.contains('hidden');
      const hide = settingsOpen || guideOpen || this.locked || !this.started || this.story.active || this.player.dead || (this.won && !this.endless);
      document.getElementById('paused').classList.toggle('hidden', hide);
      if (this.hud?.el?.hud) this.hud.el.hud.classList.toggle('dim', !hide || settingsOpen);
      if (!hide && this.hud?.el?.help) this.hud.el.help.classList.add('hidden');
    };
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; this.syncPause(); });
    document.addEventListener('pointerlockerror', () => { this.locked = false; this.syncPause(); });
    const lock = () => { try { const p = canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); } catch {} };
    this.lock = lock;

    const deployEl = document.getElementById('deploy');
    const titleEl = document.getElementById('title');
    const guideEl = document.getElementById('guide');
    const optIntro = document.getElementById('opt-intro');
    const optTut = document.getElementById('opt-tut');

    const renderDeployOptions = () => {
      const isCamp = this.mode === 'campaign';
      document.getElementById('pane-campaign').classList.toggle('active', isCamp);
      document.getElementById('pane-arena').classList.toggle('active', !isCamp);
      document.querySelectorAll('#modes button').forEach((x) => {
        const active = x.dataset.mode === this.mode;
        x.classList.toggle('active', active);
        x.classList.toggle('selected', active);
      });

      const chList = document.getElementById('chapter-list');
      chList.innerHTML = '';
      STORY_CHAPTERS.forEach((ch, idx) => {
        const unlocked = isChapterUnlocked(this.prefs.progress, idx);
        const rank = this.prefs.progress.chapterRanks?.[ch.id] || '';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chapter-card' + (this.chapterIdx === idx ? ' selected' : '') + (!unlocked ? ' locked' : '');
        b.innerHTML = `<span class="ch-num">CH. ${ch.num}</span>${rank ? `<span class="ch-rank">${rank}</span>` : ''}<b>${ch.title}</b><small>${unlocked ? ch.subtitle : `Clear Chapter ${STORY_CHAPTERS[idx - 1].num} to unlock`}</small><div class="ch-rew">${unlocked ? 'Reward: ' + ch.unlockReward.label : 'LOCKED'}</div>`;
        b.onclick = () => {
          if (!unlocked) return;
          this.chapterIdx = idx;
          this.arena = ch.arena;
          this.weather = ch.weather;
          this.maxWave = ch.waves;
          this.world.applyAtmosphere(this.weather);
          renderDeployOptions();
        };
        chList.appendChild(b);
      });

      const arList = document.getElementById('arena-list');
      arList.innerHTML = '';
      for (const ar of ARENAS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.classList.toggle('selected', this.arena === ar.id);
        b.innerHTML = `<b>${ar.name}</b><small>${ar.desc}</small>`;
        b.onclick = () => { this.arena = ar.id; renderDeployOptions(); };
        arList.appendChild(b);
      }

      const wList = document.getElementById('weather-list');
      wList.innerHTML = '';
      for (const w of WEATHERS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = w.name;
        b.classList.toggle('selected', this.weather === w.id);
        b.onclick = () => { this.weather = w.id; this.world.applyAtmosphere(this.weather); renderDeployOptions(); };
        wList.appendChild(b);
      }

      optIntro.textContent = `INTRO CUTSCENE: ${this.prefs.introCutscene ? 'ON' : 'OFF'}`;
      optIntro.classList.toggle('toggle-on', !!this.prefs.introCutscene);
      optTut.textContent = `FIELD TUTORIAL: ${this.prefs.fieldTutorial ? 'ON' : 'OFF'}`;
      optTut.classList.toggle('toggle-on', !!this.prefs.fieldTutorial);
    };
    this.renderDeployOptions = renderDeployOptions;

    document.getElementById('openplay').onclick = () => {
      this.audio.init();
      renderDeployOptions();
      titleEl.classList.add('hidden');
      deployEl.classList.remove('hidden');
    };
    document.getElementById('closedeploy').onclick = () => {
      deployEl.classList.add('hidden');
      titleEl.classList.remove('hidden');
    };
    document.getElementById('openguide').onclick = () => {
      this.audio.init();
      guideEl.classList.remove('hidden');
    };
    document.getElementById('closeguide').onclick = () => {
      guideEl.classList.add('hidden');
    };
    optIntro.onclick = () => { this.prefs.introCutscene = !this.prefs.introCutscene; savePrefs(this.prefs); renderDeployOptions(); };
    optTut.onclick = () => { this.prefs.fieldTutorial = !this.prefs.fieldTutorial; savePrefs(this.prefs); renderDeployOptions(); };

    for (const b of document.querySelectorAll('#modes button')) {
      b.onclick = () => {
        this.mode = b.dataset.mode;
        this.endless = this.mode === 'endless';
        if (this.mode === 'campaign') {
          const ch = STORY_CHAPTERS[this.chapterIdx] || STORY_CHAPTERS[0];
          this.arena = ch.arena;
          this.weather = ch.weather;
          this.maxWave = ch.waves;
          this.world.applyAtmosphere(this.weather);
        }
        renderDeployOptions();
      };
    }
    for (const b of document.querySelectorAll('#classes button')) {
      b.onclick = () => {
        this.playerClass = b.dataset.class;
        document.querySelectorAll('#classes button').forEach((x) => x.classList.toggle('selected', x === b));
        this.player.applyClass(this.playerClass, true);
      };
    }

    document.getElementById('start').onclick = () => {
      const ch = STORY_CHAPTERS[this.chapterIdx] || STORY_CHAPTERS[0];
      if (this.mode === 'campaign') {
        this.arena = ch.arena;
        this.weather = ch.weather;
        this.maxWave = ch.waves;
      }
      this.startSession(this.mode === 'campaign' && !!this.prefs.introCutscene && this.chapterIdx === 0, this.mode === 'campaign' && !!this.prefs.fieldTutorial);
      lock();
    };

    this.bindStorybookUI();
    this.bindMultiplayerUI();
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

  bindStorybookUI() {
    const modal = document.getElementById('storybook');
    const tabsEl = document.getElementById('story-tabs');
    const pageEl = document.getElementById('story-page');
    const playBtn = document.getElementById('story-deploy');
    let sel = 0;

    const render = () => {
      tabsEl.innerHTML = '';
      STORY_CHAPTERS.forEach((ch, idx) => {
        const unlocked = isChapterUnlocked(this.prefs.progress, idx);
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = `CH. ${ch.num}${unlocked ? '' : ' 🔒'}`;
        b.classList.toggle('active', idx === sel);
        b.onclick = () => { sel = idx; render(); };
        tabsEl.appendChild(b);
      });
      const ch = STORY_CHAPTERS[sel];
      const unlocked = isChapterUnlocked(this.prefs.progress, sel);
      const cleared = this.prefs.progress.chaptersCleared.includes(ch.id);
      const rank = this.prefs.progress.chapterRanks?.[ch.id];
      const arenaName = ARENAS.find((a) => a.id === ch.arena)?.name || ch.arena;
      const weatherName = WEATHERS.find((w) => w.id === ch.weather)?.name || ch.weather;
      if (unlocked) {
        pageEl.innerHTML = `
          <div class="st-meta"><span>CHAPTER ${ch.num} · ${arenaName} · ${weatherName}</span><span>${ch.loreDate}${rank ? ` · RANK ${rank}` : ''}</span></div>
          <h3>${ch.loreTitle}</h3>
          <blockquote>${ch.loreQuote}</blockquote>
          <p>${ch.loreBody}</p>
          <div class="st-reward">${cleared ? 'UNLOCKED REWARD: ' : 'CLEAR REWARD: '}${ch.unlockReward.label}</div>`;
        playBtn.classList.remove('hidden');
      } else {
        pageEl.innerHTML = `
          <div class="st-meta"><span>CHAPTER ${ch.num} · ARCHIVE SEALED</span><span>CLASSIFIED</span></div>
          <h3>${ch.title}</h3>
          <p>Complete Chapter ${STORY_CHAPTERS[sel - 1].num} (${STORY_CHAPTERS[sel - 1].title}) to unseal this chapter's War Chronicle and unlock deployment.</p>
          <div class="st-reward">LOCKED REWARD: ${ch.unlockReward.label}</div>`;
        playBtn.classList.add('hidden');
      }
    };

    document.getElementById('openstory').onclick = () => {
      this.audio.init();
      render();
      modal.classList.remove('hidden');
    };
    document.getElementById('closestory').onclick = () => modal.classList.add('hidden');
    playBtn.onclick = () => {
      const ch = STORY_CHAPTERS[sel];
      this.mode = 'campaign';
      this.chapterIdx = sel;
      this.arena = ch.arena;
      this.weather = ch.weather;
      this.maxWave = ch.waves;
      modal.classList.add('hidden');
      this.startSession(sel === 0 && !!this.prefs.introCutscene, false);
      this.lock();
    };
  }

  bindMultiplayerUI() {
    const modal = document.getElementById('multiplayer');
    const callsignEl = document.getElementById('mp-callsign');
    const roomEl = document.getElementById('mp-room');
    const urlEl = document.getElementById('mp-url');
    const statusEl = document.getElementById('mp-status');
    const coopBtn = document.getElementById('mp-coop');
    const pvpBtn = document.getElementById('mp-pvp');
    let netMode = 'coop';

    const syncMode = () => {
      coopBtn.classList.toggle('toggle-on', netMode === 'coop');
      pvpBtn.classList.toggle('toggle-on', netMode === 'pvp');
    };
    coopBtn.onclick = () => { netMode = 'coop'; syncMode(); };
    pvpBtn.onclick = () => { netMode = 'pvp'; syncMode(); };

    this.net.onStatus = (text, ok, peerCount) => {
      statusEl.textContent = ok ? `${text} · ${peerCount} remote scout${peerCount === 1 ? '' : 's'} online` : text;
      statusEl.classList.toggle('ok', ok);
    };

    document.getElementById('openmp').onclick = () => {
      this.audio.init();
      syncMode();
      modal.classList.remove('hidden');
    };
    document.getElementById('closemp').onclick = () => modal.classList.add('hidden');
    document.getElementById('mp-connect').onclick = () => {
      this.net.connect(urlEl.value.trim(), roomEl.value.trim(), callsignEl.value.trim(), netMode);
    };
    document.getElementById('mp-launch').onclick = () => {
      modal.classList.add('hidden');
      this.mode = 'endless';
      this.startSession(false, false);
      this.lock();
    };
  }

  bindCustomizeUI() {
    const panel = document.getElementById('customize');
    const titleEl = document.getElementById('title');
    const rotSlider = document.getElementById('cust-rot');
    const unlockHintEl = document.getElementById('cust-unlock-hint');
    const fullBtn = document.getElementById('cust-full');
    const faceBtn = document.getElementById('cust-face');
    const A = this.prefs.appearance;

    const ctabs = [...document.querySelectorAll('#cust-tabs button')];
    const cpanes = [...panel.querySelectorAll('.cust-pane')];
    const switchCTab = (tab) => {
      ctabs.forEach((b) => b.classList.toggle('active', b.dataset.ctab === tab));
      cpanes.forEach((p) => p.classList.toggle('active', p.dataset.cpane === tab));
      if (tab === 'face' || tab === 'hair') {
        this.cam.wardrobeZoom = 1.32;
        fullBtn.classList.remove('toggle-on');
        faceBtn.classList.add('toggle-on');
      } else {
        this.cam.wardrobeZoom = 2.45;
        fullBtn.classList.add('toggle-on');
        faceBtn.classList.remove('toggle-on');
      }
    };
    ctabs.forEach((b) => { b.onclick = () => switchCTab(b.dataset.ctab); });
    fullBtn.onclick = () => { this.cam.wardrobeZoom = 2.45; fullBtn.classList.add('toggle-on'); faceBtn.classList.remove('toggle-on'); };
    faceBtn.onclick = () => { this.cam.wardrobeZoom = 1.32; faceBtn.classList.add('toggle-on'); fullBtn.classList.remove('toggle-on'); };

    let dragging = false, lastX = 0;
    const canvas = document.getElementById('c');
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.cam.customizing) return;
      dragging = true; lastX = e.clientX;
    });
    addEventListener('pointermove', (e) => {
      if (!dragging || !this.cam.customizing) return;
      const dx = e.clientX - lastX; lastX = e.clientX;
      this.cam.wardrobeAngle += dx * 0.01;
      rotSlider.value = clamp(this.cam.wardrobeAngle, -3.14, 3.14);
    });
    addEventListener('pointerup', () => { dragging = false; });
    canvas.addEventListener('wheel', (e) => {
      if (!this.cam.customizing) return;
      this.cam.wardrobeZoom = clamp(this.cam.wardrobeZoom + e.deltaY * 0.0018, 1.25, 3.25);
    }, { passive: true });

    const buildChips = (containerId, list, prop) => {
      const el = document.getElementById(containerId);
      el.innerHTML = '';
      for (const item of list) {
        const unlocked = !item.unlockKey || isCosmeticUnlocked(this.prefs.progress, item.unlockKey);
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = unlocked ? item.label : `${item.label} 🔒`;
        b.classList.toggle('selected', A[prop] === item.id);
        b.classList.toggle('locked', !unlocked);
        b.onclick = () => {
          if (!unlocked) {
            unlockHintEl.textContent = `Unlock: ${unlockHint(item.unlockKey)}`;
            this.audio.click();
            return;
          }
          unlockHintEl.textContent = '';
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
        const unlocked = !item.unlockKey || isCosmeticUnlocked(this.prefs.progress, item.unlockKey);
        const b = document.createElement('button');
        b.type = 'button';
        b.title = unlocked ? item.label : `${item.label} — Unlock: ${unlockHint(item.unlockKey)}`;
        b.style.background = item.id;
        b.classList.toggle('selected', A[prop] === item.id);
        b.classList.toggle('locked', !unlocked);
        b.onclick = () => {
          if (!unlocked) {
            unlockHintEl.textContent = `Unlock ${item.label}: ${unlockHint(item.unlockKey)}`;
            this.audio.click();
            return;
          }
          unlockHintEl.textContent = '';
          A[prop] = item.id;
          this.applyAppearance();
          savePrefs(this.prefs);
          [...el.children].forEach((c, i) => c.classList.toggle('selected', list[i].id === A[prop]));
        };
        el.appendChild(b);
      }
    };

    const refresh = () => {
      unlockHintEl.textContent = '';
      buildSwatches('cust-skin', APPEARANCE_PRESETS.skinTones, 'skinTone');
      buildSwatches('cust-eye', APPEARANCE_PRESETS.eyeColors, 'eyeColor');
      buildChips('cust-expr', APPEARANCE_PRESETS.expressions, 'expression');
      buildChips('cust-acc', APPEARANCE_PRESETS.accessories, 'accessory');
      buildChips('cust-hairstyle', APPEARANCE_PRESETS.hairStyles, 'hairStyle');
      buildSwatches('cust-haircolor', APPEARANCE_PRESETS.hairColors, 'hairColor');
      buildSwatches('cust-jacket', APPEARANCE_PRESETS.jacketColors, 'jacketColor');
      buildChips('cust-cape', APPEARANCE_PRESETS.capeStyles, 'capeStyle');
      buildSwatches('cust-scarf', APPEARANCE_PRESETS.scarfColors, 'scarfColor');
      buildChips('cust-pants', APPEARANCE_PRESETS.pantsThemes, 'pantsTheme');
      buildChips('cust-rig', APPEARANCE_PRESETS.rigFinishes, 'rigFinish');
      buildSwatches('cust-aura', APPEARANCE_PRESETS.bladeAuras, 'bladeAura');
      buildChips('cust-crest', APPEARANCE_PRESETS.crests, 'crest');
    };

    document.getElementById('opencust').onclick = () => {
      this.audio.init();
      refresh();
      titleEl.classList.add('hidden');
      panel.classList.remove('hidden');
      this.cam.customizing = true;
      this.cam.wardrobeZoom = 2.45;
      this.cam.wardrobeAngle = +rotSlider.value;
      fullBtn.classList.add('toggle-on');
      faceBtn.classList.remove('toggle-on');
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
    const musVolR = document.getElementById('musvol-range');
    const sfxVolR = document.getElementById('sfxvol-range');
    const invBtn = document.getElementById('invy-btn');
    const musBtn = document.getElementById('music-btn');
    const shakeBtn = document.getElementById('shake-btn');
    const viewBtn = document.getElementById('view-btn');
    const autoCycleBtn = document.getElementById('autocycle-btn');
    const fpsBtn = document.getElementById('fps-btn');
    const bindList = document.getElementById('bind-list');

    const tabs = [...document.querySelectorAll('#settings-tabs button')];
    const panes = [...modal.querySelectorAll('.tab-pane')];
    const switchTab = (tab) => {
      this.input.rebinding = null;
      tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
      panes.forEach((p) => p.classList.toggle('active', p.dataset.pane === tab));
    };
    tabs.forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });

    const renderBinds = () => {
      bindList.innerHTML = '';
      for (const [action, label] of BIND_LABELS) {
        const row = document.createElement('div');
        row.className = 'bind-row';
        const span = document.createElement('span');
        span.textContent = label;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bind-key';
        btn.textContent = formatKey(this.prefs.binds[action]);
        btn.onclick = () => {
          [...bindList.querySelectorAll('.bind-key')].forEach((x) => x.classList.remove('listening'));
          btn.classList.add('listening');
          btn.textContent = 'PRESS KEY…';
          this.input.rebinding = (code) => {
            this.input.rebinding = null;
            if (code !== 'Escape') {
              const prev = this.prefs.binds[action];
              for (const k of Object.keys(this.prefs.binds)) {
                if (this.prefs.binds[k] === code) this.prefs.binds[k] = prev;
              }
              this.prefs.binds[action] = code;
              savePrefs(this.prefs);
              this.hud.syncBindHints();
            }
            renderBinds();
          };
        };
        row.append(span, btn);
        bindList.appendChild(row);
      }
    };

    const syncModal = () => {
      document.querySelectorAll('#qual-btns button').forEach((b) => b.classList.toggle('selected', +b.dataset.q === this.prefs.quality));
      sensR.value = this.prefs.sensMult;
      document.getElementById('sens-val').textContent = Number(this.prefs.sensMult).toFixed(2) + '×';
      fovR.value = this.prefs.fov;
      document.getElementById('fov-val').textContent = this.prefs.fov + '°';
      volR.value = Math.round(this.prefs.volume * 100);
      document.getElementById('vol-val').textContent = Math.round(this.prefs.volume * 100) + '%';
      musVolR.value = Math.round(this.prefs.musicVol * 100);
      document.getElementById('musvol-val').textContent = Math.round(this.prefs.musicVol * 100) + '%';
      sfxVolR.value = Math.round(this.prefs.sfxVol * 100);
      document.getElementById('sfxvol-val').textContent = Math.round(this.prefs.sfxVol * 100) + '%';
      invBtn.textContent = `INVERT Y-AXIS: ${this.prefs.invertY ? 'ON' : 'OFF'}`;
      invBtn.classList.toggle('toggle-on', !!this.prefs.invertY);
      musBtn.textContent = `COMBAT SOUNDTRACK: ${this.prefs.music ? 'ON' : 'OFF'}`;
      musBtn.classList.toggle('toggle-on', !!this.prefs.music);
      shakeBtn.textContent = `CAMERA SHAKE: ${this.prefs.shake ? 'ON' : 'OFF'}`;
      shakeBtn.classList.toggle('toggle-on', !!this.prefs.shake);
      viewBtn.textContent = `CAMERA: ${this.prefs.fpDefault ? 'FIRST-PERSON' : 'THIRD-PERSON'}`;
      viewBtn.classList.toggle('toggle-on', !!this.prefs.fpDefault);
      autoCycleBtn.textContent = `AUTO-CYCLE CABLES: ${this.prefs.autoCycle ? 'ON' : 'OFF'}`;
      autoCycleBtn.classList.toggle('toggle-on', !!this.prefs.autoCycle);
      fpsBtn.textContent = `FPS COUNTER: ${this.prefs.showFps ? 'ON' : 'OFF'}`;
      fpsBtn.classList.toggle('toggle-on', !!this.prefs.showFps);
      renderBinds();
    };

    const open = (e) => {
      if (e) e.stopPropagation();
      this.audio.init();
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
    musVolR.oninput = () => { this.prefs.musicVol = +musVolR.value / 100; this.applyPrefs(false); syncModal(); };
    sfxVolR.oninput = () => { this.prefs.sfxVol = +sfxVolR.value / 100; this.applyPrefs(false); syncModal(); };
    invBtn.onclick = () => { this.prefs.invertY = !this.prefs.invertY; this.applyPrefs(false); syncModal(); };
    musBtn.onclick = () => { this.prefs.music = !this.prefs.music; this.applyPrefs(false); syncModal(); };
    shakeBtn.onclick = () => { this.prefs.shake = !this.prefs.shake; this.applyPrefs(false); syncModal(); };
    viewBtn.onclick = () => { this.prefs.fpDefault = !this.prefs.fpDefault; this.cam.fp = this.prefs.fpDefault; this.applyPrefs(false); syncModal(); };
    autoCycleBtn.onclick = () => { this.prefs.autoCycle = !this.prefs.autoCycle; this.applyPrefs(false); syncModal(); };
    fpsBtn.onclick = () => { this.prefs.showFps = !this.prefs.showFps; this.applyPrefs(false); syncModal(); };
    document.getElementById('reset-binds').onclick = () => {
      this.input.rebinding = null;
      this.prefs.binds = { ...DEFAULT_BINDS };
      savePrefs(this.prefs);
      this.hud.syncBindHints();
      renderBinds();
    };
    document.getElementById('closesettings').onclick = () => {
      this.input.rebinding = null;
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
    this.cam.fp = this.prefs.fpDefault !== false;
    this.audio.musicOn = !!this.prefs.music;
    this.audio.setVolume(this.prefs.volume);
    this.audio.setMusicVolume(this.prefs.musicVol ?? 0.65);
    this.audio.setSfxVolume(this.prefs.sfxVol ?? 0.9);
    const fpsEl = document.getElementById('fps');
    if (fpsEl) fpsEl.classList.toggle('hidden', !this.prefs.showFps);
    this.hud?.syncBindHints();
    this.setQuality(this.prefs.quality, showToast);
    savePrefs(this.prefs);
  }

  updateBestBanner() {
    const el = document.getElementById('bestbanner');
    if (!el) return;
    if (this.prefs.bestKills > 0) {
      el.textContent = `BEST RECORD · RANK ${this.prefs.bestRank || 'B'} · ${this.prefs.bestKills} TITANS · PHASE ${this.prefs.bestWave}`;
    } else {
      el.textContent = 'SURVEY CORPS SPECIAL OPERATIONS SQUADRON';
    }
  }

  startSession(withCutscene = false, withTutorial = false) {
    this.cam.customizing = false;
    document.getElementById('customize').classList.add('hidden');
    document.getElementById('deploy').classList.add('hidden');
    document.getElementById('storybook').classList.add('hidden');
    document.getElementById('multiplayer').classList.add('hidden');
    this.endless = this.mode === 'endless';
    this.won = false;
    this.stats = { maxSpeed: 0, bestCombo: 0, time: 0 };
    this.kills = 0;
    this.wave = 0;
    this.world.applyAtmosphere(this.weather || 'dusk');
    this.clearTransientState();
    const ch = STORY_CHAPTERS[this.chapterIdx] || STORY_CHAPTERS[0];
    this.engineers.reset(this.mode === 'campaign' && !ch.convoy ? 'endless' : this.mode);
    this.squad.reset(false);
    this.story.begin(this.mode, withCutscene, withTutorial);
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
    b.struck = false;
    b.minDist = Infinity;
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
      const pDist = p.pos.distanceTo(b.pos);
      if (!p.dead && p.invuln <= 0 && pDist < b.r + 1.4) {
        _v2.subVectors(p.pos, b.pos).setY(0.5).normalize();
        p.knockback(_v2, 16, 14);
        p.invuln = Math.max(p.invuln, 0.6);
        b.struck = true;
        hit = true;
      }
      b.minDist = Math.min(b.minDist ?? Infinity, pDist);
      b.m.position.copy(b.pos);
      b.m.rotation.x += b.rv.x * dt;
      b.m.rotation.y += b.rv.y * dt;
      if (b.mark) b.mark.material.opacity = 0.4 + Math.sin(b.age * 9) * 0.18 + Math.min(0.3, b.age * 0.06);
      if (Math.random() < dt * 14) this.vfx.dust(b.pos, b.r * 1.1, 2);

      if (hit || b.age > 6) {
        this.vfx.dust(b.pos, b.r * 3.8, 14);
        this.vfx.debris(b.pos, 7, 10);
        this.vfx.impactRing(b.pos, _v.set(0, 1, 0), b.r * 4.2, VFX_COLORS.ARMOR_C, 0.25);
        this.audio.fall(b.pos, 8);
        this.world.destroyNear(b.pos, b.r * 3.5, 145, b.vel);
        this.cam.shake(clamp(0.75 - b.pos.distanceTo(p.pos) / 90, 0.08, 0.5));
        if (!b.struck && b.minDist < 9) {
          this.hud.pop(p.pos, 'CLOSE CALL!', 'small');
          p.gas = Math.min(100, p.gas + 5);
        }
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
    this.shifters.clear();
    this.cannon.reset();
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
    document.getElementById('deploy').classList.add('hidden');
    document.getElementById('dead').classList.add('hidden');
    document.getElementById('win').classList.add('hidden');
    this.hud.show(true);
    if (!quiet) {
      const msg = this.mode === 'endless'
        ? 'DEFENSE LIVE<br><span style="font-size:17px">Survey Corps squadron airborne!</span>'
        : 'OPERATION LIVE<br><span style="font-size:17px">Escort the Engineer Convoy to the South Gate!</span>';
      this.hud.toast(msg, 2.2);
    }
    this.syncPause();
  }

  restart() {
    this.won = false;
    this.endless = this.mode === 'endless';
    this.started = true;
    this.stats = { maxSpeed: 0, bestCombo: 0, time: 0 };
    document.getElementById('title').classList.add('hidden');
    document.getElementById('deploy').classList.add('hidden');
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
        ? 'PROVING GROUNDS<br><span style="font-size:17px">Swing through aerial rings &amp; practice nape strikes</span>'
        : 'ENGAGE<br><span style="font-size:17px">Squadron airborne · Titans inbound from the breach</span>',
      1.8,
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
    document.getElementById('deploy').classList.add('hidden');
    document.getElementById('guide').classList.add('hidden');
    document.getElementById('storybook').classList.add('hidden');
    document.getElementById('multiplayer').classList.add('hidden');
    this.arena = 'town';
    this.weather = 'dusk';
    this.world.applyAtmosphere('dusk');
    this.player.pos.copy(this.world.playerSpawn);
    this.hud.show(false);
    this.updateBestBanner();
    document.getElementById('title').classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    this.syncPause();
  }

  spawnTrainingTargets() {
    const spots = [
      [-28, 60, 'sprinter', 8.5],
      [0, 68, 'normal', 13],
      [28, 86, 'tank', 18],
      [-18, 96, 'crawler', 7.5],
      [0, 120, 'armored', 20],
    ];
    for (const [x, z, type, h] of spots) {
      const ti = new Titan(this, new THREE.Vector3(x, 0, z), { type, height: h, passive: true, instant: true });
      this.titans.push(ti);
    }
  }

  pickFarSpawnPoint() {
    const convoy = this.engineers.activeConvoy ? this.engineers.convoyPos : null;
    const pPos = this.player.pos;
    if (this.arena === 'forest') {
      for (let attempt = 0; attempt < 20; attempt++) {
        const a = Math.PI + rand(-1.0, 1.0);
        const r = rand(235, 345);
        const x = Math.sin(a) * r, z = Math.cos(a) * r;
        if (Math.hypot(x - pPos.x, z - pPos.z) < 72) continue;
        return new THREE.Vector3(x, 0, z);
      }
      return new THREE.Vector3(rand(-90, 90), 0, -240);
    }
    for (let attempt = 0; attempt < 24; attempt++) {
      const fromBreach = this.arena === 'ramparts' ? Math.random() < 0.78 : Math.random() < 0.48;
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
    const ch = STORY_CHAPTERS[this.chapterIdx] || STORY_CHAPTERS[0];
    const isBossWave = (this.mode === 'campaign' && this.wave === this.maxWave && !!ch.boss) || (this.mode === 'endless' && this.wave % 3 === 0);
    const n = Math.min(8 + this.wave * 2, 18);
    for (let i = 0; i < n; i++) {
      const pos = this.pickFarSpawnPoint();
      const roll = Math.random();
      let type = 'normal';
      if (roll < 0.2) type = 'sprinter';
      else if (roll < 0.34) type = 'crawler';
      else if (this.wave >= 2 && roll < 0.56) type = 'abnormal';
      else if (this.wave >= 2 && roll > 0.8) type = 'tank';
      this.titans.push(new Titan(this, pos, { type }));
    }
    if (isBossWave) {
      const bossPos = this.pickFarSpawnPoint();
      const endlessCycle = ['armored', 'beast', 'warhammer', 'founder'];
      const bossType = this.mode === 'campaign' && typeof ch.boss === 'string'
        ? ch.boss
        : endlessCycle[Math.floor((this.wave / 3 - 1) % endlessCycle.length)] || 'armored';
      const ti = new Titan(this, bossPos, { type: bossType });
      this.titans.push(ti);
      this.hud.radio(`PRIORITY ALERT: ${ti.label.toUpperCase()} detected! Engage with Thunder Spears, Cannons, or Focus Fire!`);
    }
    const label = this.mode === 'endless' ? `WAVE ${this.wave}` : `PHASE ${this.wave} / ${this.maxWave}`;
    document.getElementById('wave').textContent = label;
    const totalAdded = n + (isBossWave ? 1 : 0);
    this.hud.toast(`${label}<br><span style="font-size:17px">${totalAdded} Titans inbound${isBossWave ? ' · ARMORED TITAN DETECTED!' : ''}</span>`, 2.2);
    this.audio.horn();
    this.cam.shake(0.4);
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
    this.hud.toast(`EQUIPPED: ${chosen.title}`, 1.2);
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
    else { this.vfx.sparks(h.tip, 7); this.vfx.dust(h.tip, 1, 3); }
    this.cam.shake(flesh ? 0.06 : 0.045);
    this.cam.impactFov = Math.max(this.cam.impactFov, 0.75);
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
      const lbl = p.speed > 40 ? 'LIGHTNING EXECUTION!' : p.spin > 0 ? 'SPIRAL SEVER!' : p.combo >= 3 ? 'UNSTOPPABLE!' : 'CLEAN SEVER!';
      this.hud.toast(lbl, 1.15);
      this.hud.combo(p.combo);
      if (p.combo >= 3) this.audio.comboSting(p.combo);
      this.hud.killFeed(`<b>YOU</b> eliminated <em>${t.label}</em>${p.combo >= 2 ? ` · ${p.combo}×` : ''}`);
      this.stats.bestCombo = Math.max(this.stats.bestCombo, p.combo);
      this.triggerImpact(0.11, 0.008, 0.36, 0.18, 0.85);
      this.flash = 0.2;
      if (this.cam.isFP()) this.bloodMist = 0.58;
      this.cam.shake(0.55);
      this.cam.hitJolt(0.95, 0.12);
      this.cam.triggerExecution(point);
      this.engineers.onNearKill(point);
      t.root.updateMatrixWorld();
    } else if (result === 'armor-break') {
      this.vfx.armorShatter(point, dir);
      this.audio.armorShatter(point);
      this.hud.pop(point, 'ARMOR BROKEN!', 'kill');
      this.hud.hitmarker('kill');
      this.hud.toast('<span style="font-size:19px;color:#ffe29a">NAPE ARMOR SHATTERED — EXECUTE NOW!</span>', 1.4);
      this.triggerImpact(0.105, 0.01, 0.32, 0.22, 0.82);
      this.flash = 0.18;
      this.cam.hitJolt(0.88, 0.12);
    } else if (result === 'armor') {
      this.vfx.sparks(point, 20, VFX_COLORS.ARMOR_C);
      this.vfx.flash(point, 1.8, VFX_COLORS.ARMOR_C);
      this.audio.steelClash(point);
      this.hud.pop(point, `-${dmg} ARMOR`, 'small');
      this.hud.hitmarker('armor');
      this.hud.toast('<span style="font-size:17px;color:#ffd996">Reinforced armor! Fire Thunder Spear or Focus Order</span>', 1.0);
      this.triggerImpact(0.05, 0.03, 0.12, 0.55, 0.45);
      this.cam.hitJolt(0.5, 0.08);
    } else if (result === 'nape') {
      this.vfx.flash(point, 2.0, VFX_COLORS.HIT_FLASH);
      this.vfx.bloodSpray(point, dir, 30, 1.0);
      this.vfx.impactRing(point, dir, 3.6, VFX_COLORS.HIT_FLASH, 0.18);
      this.audio.flesh(point, false);
      this.hud.pop(point, dmg);
      this.hud.hitmarker('hit');
      this.triggerImpact(0.075, 0.02, 0.18, 0.38, 0.62);
      this.cam.hitJolt(0.68, 0.09);
    } else if (result === 'deflect') {
      this.vfx.sparks(point, 18);
      this.audio.steelClash(point);
      this.hud.pop(point, 'GUARDED!', 'small');
      this.hud.hitmarker('armor');
      this.triggerImpact(0.04, 0.05, 0.1, 0.65, 0.35);
    } else {
      this.vfx.flash(point, 1.8, VFX_COLORS.HIT_FLASH);
      this.vfx.bloodSpray(point, dir, 26, 0.95);
      this.audio.flesh(point, false);
      const txt = { ankle: 'TENDON SEVERED!', arm: 'ARM SEVERED!', eyes: 'BLINDED!' }[result] || dmg;
      this.hud.pop(point, txt, 'small');
      if (result === 'ankle') {
        this.hud.toast('<span style="font-size:17px;color:#ffd996">Titan crippled — nape exposed!</span>', 1.3);
      }
      this.hud.hitmarker('hit');
      this.triggerImpact(0.082, 0.018, 0.2, 0.35, 0.68);
      this.cam.hitJolt(0.72, 0.1);
    }
  }

  onTitanStep(t, i) {
    const f = t.ankles[i].getWorldPosition(_v);
    f.y = 0.2;
    this.vfx.dust(f, t.s * 2.4, 5);
    this.audio.step(f, t.height);
    const d = f.distanceTo(this.player.pos);
    this.cam.shake(clamp((t.height * 3 - d) / (t.height * 6), 0, 0.2));
  }

  onTitanFall(t) {
    const pos = t.head.getWorldPosition(_v); pos.y = 0.5;
    this.vfx.dust(pos, t.s * 5.5, 22);
    this.audio.fall(pos, t.height);
    this.cam.shake(clamp(1 - pos.distanceTo(this.player.pos) / 120, 0.1, 0.68));
    const feet = t.root.position;
    const dirV = _v2.set(Math.sin(t.fallDir), 0, Math.cos(t.fallDir));
    for (let i = 0; i < 4; i++) {
      _v.set(feet.x + dirV.x * t.height * i * 0.3, 0, feet.z + dirV.z * t.height * i * 0.3);
      const n = this.world.destroyNear(_v, t.s * 2.5, 190, dirV);
      if (n) { this.vfx.dust(_v, t.s * 3.8, 12); this.audio.thunder(); }
    }
    const pp = this.player.pos;
    if (!this.player.dead && pp.y < t.height * 0.45 && this.player.invuln <= 0) {
      const along = clamp((pp.x - feet.x) * dirV.x + (pp.z - feet.z) * dirV.z, 0, t.height);
      const latD = Math.hypot(pp.x - (feet.x + dirV.x * along), pp.z - (feet.z + dirV.z * along));
      if (latD < t.s * 2.4) {
        _v.subVectors(pp, feet).setY(0.6).normalize();
        this.player.vel.addScaledVector(_v, 14);
        this.cam.shake(0.35);
        this.hud.pop(pp, 'SHOCKWAVE!', 'small');
      }
    }
  }

  explode(pos) {
    const R = 19;
    this.vfx.flash(pos, 5.8, VFX_COLORS.KILL_FLASH);
    this.vfx.impactRing(pos, _v.set(0, 1, 0), 11.5, VFX_COLORS.KILL_FLASH, 0.3);
    this.vfx.burst(pos, _v.set(0, 1, 0), 40);
    this.vfx.sparks(pos, 26);
    this.vfx.dust(pos, 10, 22);
    this.vfx.steam(pos, 6.5, 2.4);
    this.audio.thunder();
    this.audio.fall(pos, 10);
    this.cam.shake(clamp(1.2 - pos.distanceTo(this.player.pos) / 45, 0.28, 1.1));
    this.triggerImpact(0.1, 0.012, 0.28, 0.26, 0.8);
    this.flash = 0.24;

    for (let i = this.boulders.length - 1; i >= 0; i--) {
      if (this.boulders[i].pos.distanceTo(pos) < R) {
        this.vfx.debris(this.boulders[i].pos, 8, 12);
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
        this.vfx.bloodSpray(t.nape.c, _v2.set(0, 1, 0), 28, 1.0);
        this.hud.pop(t.nape.c, r.armorDmg || dmg);
        this.audio.flesh(t.nape.c, true);
      }
    }
    const n = this.world.destroyNear(pos, 9.5, 220);
    if (n) this.hud.toast(`<span style="font-size:17px">${n} STRUCTURE${n > 1 ? 'S' : ''} COLLAPSED</span>`, 0.9);
    const pd = this.player.pos.distanceTo(pos);
    if (pd < R * 0.42) {
      _v.copy(this.player.pos).sub(pos).normalize();
      this.player.knockback(_v, 16, 18 * (1 - pd / (R * 0.42)));
    }
  }

  onHouseCollapse(house) {
    this.player?.detachHouse?.(house);
    this.squad?.detachHouse?.(house);
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
    for (const h of this.player.hooks) this.player.release(h, true);
    this.onPlayerDeath(reason, 'OPERATION FAILED');
  }

  onHouseDown(house) {
    const p = _v.set(house.x, house.h * 0.5, house.z);
    this.cam.shake(clamp(1 - p.distanceTo(this.player.pos) / 90, 0.14, 0.5));
  }

  onLand(v) {
    if (v > 6) {
      this.audio.land(v);
      this.vfx.dust(_v.copy(this.player.pos).setY(this.player.pos.y - 0.9), 0.8, 5);
    }
    if (v > 14) this.cam.shake(v / 90);
  }
  onCrash() { this.cam.shake(0.65); this.flash = 0.14; this.hud.toast('<span style="font-size:19px">HEAVY IMPACT!</span>', 0.8); }
  onBump(v) { this.cam.shake(v / 120); }
  onSlingshot(pos, vel) {
    _v.copy(vel).normalize();
    this.vfx.impactRing(pos, _v, 2.8, VFX_COLORS.SLASH, 0.2);
    this.vfx.burst(pos, _v.negate(), 6);
    this.audio.dash();
    this.cam.impactFov = Math.max(this.cam.impactFov, 2.6);
    this.cam.shake(0.07);
  }
  activeAttackers() {
    let n = 0;
    for (let i = 0; i < this.titans.length; i++) {
      const s = this.titans[i].state;
      if (this.titans[i].alive && (s === 'swipe' || s === 'slam' || s === 'reach' || s === 'throw' || s === 'leap')) n++;
    }
    return n;
  }
  onDash(dir) { this.story.onDash(); this.audio.dash(); this.vfx.burst(this.player.pos, dir, 12); this.cam.shake(0.09); this.cam.impactFov = Math.max(this.cam.impactFov, 1.5); }
  onPlayerHurt(d) { this.hud.hurt(d); this.audio.hurt(); this.cam.shake(0.38); }
  onGrabbed() { this.audio.roar(this.player.pos, 10, 0.6); this.cam.shake(0.5); }

  recordScore(rank = '') {
    let changed = false;
    const pr = this.prefs.progress;
    if (this.kills > 0) { pr.totalKills += this.kills; changed = true; }
    if (this.stats.bestCombo > (pr.bestStreak || 0)) { pr.bestStreak = this.stats.bestCombo; changed = true; }
    if (this.stats.maxSpeed > (pr.peakSpeed || 0)) { pr.peakSpeed = Math.round(this.stats.maxSpeed); changed = true; }
    if (this.kills > (this.prefs.bestKills || 0)) { this.prefs.bestKills = this.kills; changed = true; }
    if (this.wave > (this.prefs.bestWave || 0)) { this.prefs.bestWave = this.wave; changed = true; }
    const rankOrder = { '': 0, C: 1, B: 2, A: 3, S: 4 };
    if ((rankOrder[rank] || 0) > (rankOrder[this.prefs.bestRank] || 0)) { this.prefs.bestRank = rank; pr.bestRank = rank; changed = true; }
    if (changed) savePrefs(this.prefs);
  }

  onPlayerDeath(why, customTitle = 'KILLED IN ACTION') {
    const msg = {
      eaten: 'Devoured by a Titan.',
      crash: 'Fatal high-velocity structural impact.',
      swat: 'Overwhelmed by Titan strike.',
      convoy: 'The Engineer Convoy was destroyed before sealing the South Gate.',
      district: 'Halvard District fell under the Titan assault.',
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
      this.vfx.bloodSpray(this.player.pos, _v.set(0, 1, 0), 36, 0.8);
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
    return `<span>Titans <b>${this.kills}</b></span><span>Phase <b>${this.wave}</b></span><span>District Integrity <b>${dist}%</b></span><span>Peak Speed <b>${Math.round(s.maxSpeed)} m/s</b></span><span>Best Streak <b>${s.bestCombo}×</b></span><span>Time <b>${m}:${String(sec).padStart(2, '0')}</b></span>`;
  }

  victory() {
    this.won = true;
    this.engineers.sealProgress = 1;
    this.world.setSealProgress(1);
    const rank = this.computeRank();
    if (this.mode === 'campaign') {
      const ch = STORY_CHAPTERS[this.chapterIdx];
      if (ch) {
        if (!this.prefs.progress.chaptersCleared.includes(ch.id)) this.prefs.progress.chaptersCleared.push(ch.id);
        this.prefs.progress.chapterRanks[ch.id] = rank;
      }
    }
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
      this.hud.toast(`<span style="font-size:18px">Graphics: ${['LOW', 'MEDIUM', 'HIGH'][q]}</span>`, 1.0);
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

    if (inp.actionPressed('help')) document.getElementById('help').classList.toggle('hidden');
    if (inp.actionPressed('interact') && this.started && !this.player.dead) {
      this.cannon.toggleMount();
    }
    if (inp.actionPressed('viewToggle') && this.started) {
      this.cam.fp = !this.cam.fp;
      this.hud.toast(`<span style="font-size:18px">CAMERA: ${this.cam.fp ? 'FIRST-PERSON' : 'THIRD-PERSON'}</span>`, 0.9);
    }
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
        this.hud.toast(`<span style="font-size:18px">Sensitivity ${this.prefs.sensMult.toFixed(2)}×</span>`, 0.9);
      }
    }
    if (inp.actionPressed('hookMode')) {
      const p = this.player;
      p.hookMode = p.hookMode === 'focus' ? 'auto' : 'focus';
      this.hud.toast(p.hookMode === 'focus' ? 'GRAPPLE: FOCUS<br><span style="font-size:15px">Pinpoint reticle anchoring</span>' : 'GRAPPLE: SMART<br><span style="font-size:15px">Elevated left/right anchor assist</span>', 1.1);
    }
    if (inp.pressed('KeyM')) {
      this.prefs.music = !this.prefs.music;
      this.audio.musicOn = this.prefs.music;
      savePrefs(this.prefs);
      this.hud.toast(`<span style="font-size:18px">Soundtrack: ${this.audio.musicOn ? 'ON' : 'OFF'}</span>`, 0.9);
    }

    if (dt > 0) {
      if (this.started) {
        let alive = 0;
        for (let i = 0; i < this.titans.length; i++) if (this.titans[i].alive) alive++;
        if (alive === 0 && this._prevAlive > 0 && this.wave > 0 && !this.player.dead && this.story.allowWaves()) {
          const label = this.mode === 'endless' ? `WAVE ${this.wave} CLEARED` : `PHASE ${this.wave} CLEARED`;
          this.hud.toast(`<span style="font-size:21px;color:#9effc4">${label}</span>`, 1.7);
          this.audio.comboSting(3);
          this.triggerImpact(0.24, 0.35, 0.45, 1, 0);
        }
        this._prevAlive = alive;
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
            if (this.waveT <= 0) { this.spawnWave(); this.waveT = this.mode === 'training' ? 2.5 : 4.8; }
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
        if (!this.cannon.mounted) this.player.update(dt);
        else this.player.animate(dt);
        this.cannon.update(dt);
        this.engineers.update(dt);
        this.squad.update(dt);
        this.shifters.update(dt);
        this.updateBoulders(dt);
        this.net.update(dt);
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
      this.cam.yaw += rdt * 0.055;
      this.cam.pitch = 0.06 + Math.sin(this.elapsed * 0.14) * 0.05;
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
    u.uSpeed.value = damp(u.uSpeed.value, clamp((this.player.speed - 16) / 44, 0, 1), 5, rdt);
    u.uHurt.value = this.hud.hurtT;
    this.flash = Math.max(0, this.flash - rdt * 3.5);
    u.uFlash.value = this.flash * this.flash;
    this.impactPulse = Math.max(0, this.impactPulse - rdt * 4.5);
    u.uImpact.value = this.impactPulse;
    this.bloodMist = Math.max(0, this.bloodMist - rdt * 1.1);
    u.uBlood.value = this.cam.isFP() ? this.bloodMist : 0;
  }
}

window.THREE = THREE;
window.game = new Game();
