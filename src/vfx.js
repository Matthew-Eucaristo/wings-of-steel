import * as THREE from 'three';
import { Particles, Ribbon, ShockwavePool } from './particles.js';
import { smokeSprite, glowSprite } from './textures.js';
import { rand, clamp, lerp } from './util.js';

const C = (h) => new THREE.Color(h);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const STEAM = C('#f2eee8'), STEAM_E = C('#c9c4bf'), GAS = C('#ffffff'), GAS_E = C('#d8dde2');
const BLOOD = C('#a80e0a'), BLOOD_E = C('#420303'), SPARK = C('#fff2c0'), SPARK_E = C('#ff7a1a');
const DUST = C('#b9a88c'), DUST_E = C('#8a7c68'), SLASH = C('#bfe6ff'), HOT = C('#ff9a5a');
const HIT_FLASH = C('#fff4df'), KILL_FLASH = C('#ffe2b0'), IMPACT_FLASH = C('#d9efff');
const ARMOR_C = C('#ffd29a'), ARMOR_E = C('#9c6838');
const ROCKET_FIRE = C('#ffaa44'), ROCKET_FIRE_E = C('#ff3810');
const FLARE_GREEN = C('#5aff9c'), FLARE_GREEN_E = C('#1e8a52');
const FLARE_RED = C('#ff5438'), FLARE_RED_E = C('#9e1c10');
const FLARE_GOLD = C('#ffd86b'), FLARE_GOLD_E = C('#b57c18');

export const VFX_COLORS = { HIT_FLASH, KILL_FLASH, IMPACT_FLASH, SLASH, HOT, SPARK, ARMOR_C };

export class VFX {
  constructor(game) {
    this.game = game;
    const scene = game.scene, fog = scene.fog;
    const smoke = smokeSprite(), glow = glowSprite();
    this.smoke = new Particles(scene, { max: 4200, texture: smoke, lit: true, fog });
    this.add = new Particles(scene, { max: 2600, texture: glow, additive: true, lit: false, fog });
    this.blood = new Particles(scene, { max: 2000, texture: glow, lit: true, fog });
    this.waves = new ShockwavePool(scene, 32);
    this.bladeAura = new THREE.Color('#7ac8ff');
    this.cables = [0, 1].map(() => new Ribbon(scene, 24, { color: 0x2a2826, opacity: 1, fog }));
    this.trails = [0, 1].map(() => new Ribbon(scene, 16, { color: 0xe6f6ff, color2: 0x7ac4ff, additive: true, opacity: 0.92, fog }));
    this.trailPool = [0, 1].map(() => Array.from({ length: 16 }, () => new THREE.Vector3()));
    this.trailHead = [0, 0];
    this.trailLen = [0, 0];
    this.trailSlice = [[], []];
    this.cablePts = [0, 1].map(() => Array.from({ length: 24 }, () => new THREE.Vector3()));
    this.streakT = 0;
    this.flares = [];
    this.limbs = [];
    this.limbPool = [];
    this.buildBloodPools(scene);
  }

  buildBloodPools(scene) {
    this.poolCap = 48;
    this.poolGeo = new THREE.CircleGeometry(1, 14);
    this.poolGeo.rotateX(-Math.PI / 2);
    this.poolMat = new THREE.MeshStandardMaterial({
      color: '#6e0806',
      roughness: 0.25,
      metalness: 0.1,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.poolItems = [];
    for (let i = 0; i < this.poolCap; i++) {
      const m = new THREE.Mesh(this.poolGeo, this.poolMat);
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      this.poolItems.push({ m, t: 0, dur: 14, maxR: 2, active: false });
    }
    this.poolCursor = 0;
  }

  bloodPool(pos, radius = 2.4) {
    const slot = this.poolItems[this.poolCursor];
    this.poolCursor = (this.poolCursor + 1) % this.poolCap;
    slot.active = true;
    slot.t = 0;
    slot.dur = 13 + rand(0, 4);
    slot.maxR = radius * rand(0.85, 1.25);
    slot.m.position.set(pos.x + rand(-0.6, 0.6), 0.05, pos.z + rand(-0.6, 0.6));
    slot.m.rotation.y = rand(0, 6.28);
    slot.m.scale.setScalar(0.2);
    slot.m.visible = true;
  }

  setBladeColor(primary, secondary) {
    this.bladeAura.set(primary);
    for (let i = 0; i < 2; i++) {
      this.trails[i].mat.uniforms.uColor.value.set(secondary || '#ffffff');
      this.trails[i].mat.uniforms.uColor2.value.set(primary);
    }
  }

  steam(p, size, life) {
    _d.set(rand(-1, 1), rand(0.5, 2), rand(-1, 1)).multiplyScalar(size * 0.6);
    this.smoke.spawn(p, _d, { life: life * rand(0.7, 1.3), size0: size * 0.6, size1: size * 2.6, color: STEAM, colorEnd: STEAM_E, alpha: 0.45, drag: 0.8, buoy: 1.8, fadeIn: 0.2 });
  }
  wisp(p, s) {
    _d.set(rand(-0.3, 0.3), 1, rand(-0.3, 0.3));
    this.smoke.spawn(p, _d, { life: 2.2, size0: 0.6 * s, size1: 2.4 * s, color: STEAM, colorEnd: STEAM_E, alpha: 0.12, drag: 0.5, buoy: 1.2, fadeIn: 0.3 });
  }
  gas(p, dir, strength = 1) {
    for (let i = 0; i < 2; i++) {
      _d.copy(dir).multiplyScalar(-rand(9, 16) * strength).add(_v.set(rand(-0.6, 0.6), rand(-0.6, 0.6), rand(-0.6, 0.6)));
      this.smoke.spawn(p, _d, { life: rand(0.35, 0.8), size0: 0.18, size1: rand(0.9, 1.6) * strength, color: GAS, colorEnd: GAS_E, alpha: 0.28, drag: 3.5, buoy: 0.4, fadeIn: 0.04 });
    }
  }
  rocketExhaust(p, dir) {
    _d.copy(dir).multiplyScalar(-rand(8, 18)).add(_v.set(rand(-1.2, 1.2), rand(-1.2, 1.2), rand(-1.2, 1.2)));
    this.add.spawn(p, _d, { life: 0.14, size0: 0.65, size1: 0.15, color: ROCKET_FIRE, colorEnd: ROCKET_FIRE_E, alpha: 0.95, drag: 2.5, fadeIn: 0 });
    this.smoke.spawn(p, _d, { life: rand(0.55, 1.1), size0: 0.35, size1: 2.1, color: STEAM, colorEnd: DUST_E, alpha: 0.42, drag: 2.2, buoy: 0.8, fadeIn: 0.04 });
  }
  burst(p, dir, n = 40) {
    for (let i = 0; i < n; i++) {
      _d.set(rand(-1, 1), rand(-0.6, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 14)).addScaledVector(dir, rand(0, 0.5));
      this.smoke.spawn(p, _d, { life: rand(0.8, 1.6), size0: 0.5, size1: rand(3, 5), color: GAS, colorEnd: GAS_E, alpha: 0.28, drag: 4, buoy: 0.3 });
    }
  }
  bloodSpray(p, dir, n = 30, big = 1) {
    const hasDir = dir && dir.lengthSq() > 1e-6;
    for (let i = 0; i < n; i++) {
      if (hasDir) _d.copy(dir).normalize().multiplyScalar(rand(5, 19) * big);
      else _d.set(0, rand(2, 9) * big, 0);
      _d.add(_v.set(rand(-4.5, 4.5), rand(-1, 6.5), rand(-4.5, 4.5)));
      this.blood.spawn(p, _d, { life: rand(0.65, 1.45), size0: rand(0.24, 0.54) * big, size1: 0.12, color: BLOOD, colorEnd: BLOOD_E, alpha: 1, drag: 0.38, buoy: -1.35, stretch: 0.1, fadeIn: 0.01 });
    }
    const sc = Math.ceil(n * 0.18);
    for (let i = 0; i < sc; i++) this.steam(_v.copy(p).add(_v2.set(rand(-1, 1), rand(-1, 1), rand(-1, 1))), 1.2 * big, 2);
  }
  severedLimb(p, dir, scale = 1.4) {
    if (!this.limbGeo) this.limbGeo = new THREE.CapsuleGeometry(0.28, 1.5, 4, 8);
    if (!this.limbMat) this.limbMat = new THREE.MeshStandardMaterial({ color: '#9c786c', roughness: 0.72, emissive: '#4a0806', emissiveIntensity: 0.25 });
    let item = this.limbPool.pop();
    if (!item) {
      const m = new THREE.Mesh(this.limbGeo, this.limbMat);
      m.castShadow = true;
      this.game.scene.add(m);
      item = { m, v: new THREE.Vector3(), rv: new THREE.Vector3(), t: 0, bleedT: 0 };
    }
    item.m.visible = true;
    item.m.position.copy(p);
    item.m.scale.setScalar(scale);
    item.m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
    const hasDir = dir && dir.lengthSq() > 1e-4;
    if (hasDir) item.v.copy(dir).normalize().multiplyScalar(11);
    else item.v.set(rand(-5, 5), 6, rand(-5, 5));
    item.v.y = Math.max(item.v.y, 7);
    item.rv.set(rand(-7, 7), rand(-7, 7), rand(-7, 7));
    item.t = 5.5;
    item.bleedT = 0;
    this.limbs.push(item);
    this.bloodSpray(p, dir, 48, 1.25);
    this.bloodPool(p, 2.2 * scale);
  }
  sparks(p, n = 14, col = SPARK) {
    for (let i = 0; i < n; i++) {
      _d.set(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(rand(5, 18));
      this.add.spawn(p, _d, { life: rand(0.15, 0.45), size0: rand(0.06, 0.14), size1: 0.01, color: col, colorEnd: SPARK_E, alpha: 1, drag: 2, buoy: -2, stretch: 0.03, fadeIn: 0.0 });
    }
  }
  flash(p, size = 3, col = SLASH) {
    this.add.spawn(p, _d.set(0, 0, 0), { life: 0.11, size0: size * 0.65, size1: size * 1.45, color: col, alpha: 0.85, drag: 0, fadeIn: 0 });
  }
  slashArc(pos, quat, scale = 2.6, col = null) {
    _q.copy(quat);
    this.waves.spawn(pos, _q, { s0: scale * 0.6, s1: scale * 1.55, dur: 0.17, color: col || this.bladeAura, arc: true });
  }
  doubleCrossSlash(pos, quat, scale = 4.2) {
    _q.copy(quat);
    _q2.setFromAxisAngle(_v.set(0, 0, 1), 0.72);
    _q.multiply(_q2);
    this.waves.spawn(pos, _q, { s0: scale * 0.45, s1: scale * 1.65, dur: 0.24, color: this.bladeAura, arc: true });
    _q.copy(quat);
    _q2.setFromAxisAngle(_v.set(0, 0, 1), -0.72);
    _q.multiply(_q2);
    this.waves.spawn(pos, _q, { s0: scale * 0.45, s1: scale * 1.65, dur: 0.24, color: KILL_FLASH, arc: true });
  }
  impactRing(pos, dir, radius = 6, col = KILL_FLASH, dur = 0.24) {
    const n = dir && dir.lengthSq() > 1e-4 ? _v.copy(dir).normalize() : _v.set(0, 0, 1);
    this.waves.spawn(pos, n, { s0: radius * 0.18, s1: radius, dur, color: col, arc: false });
  }
  armorShatter(p, dir) {
    this.sparks(p, 32, ARMOR_C);
    this.impactRing(p, dir, 6.5, ARMOR_C, 0.24);
    this.debris(p, 11, 12);
    for (let i = 0; i < 16; i++) {
      _d.set(rand(-1, 1), rand(-0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(6, 18));
      this.smoke.spawn(p, _d, { life: rand(0.5, 1.1), size0: 0.35, size1: 1.4, color: ARMOR_C, colorEnd: ARMOR_E, alpha: 0.55, drag: 2.2, buoy: -1.5, fadeIn: 0.02 });
    }
  }
  dust(p, size = 4, n = 12) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      _d.set(Math.cos(a) * rand(2, 6) * size * 0.3, rand(0.3, 2), Math.sin(a) * rand(2, 6) * size * 0.3);
      this.smoke.spawn(_v.copy(p).add(_v2.set(Math.cos(a) * size * 0.3, 0.2, Math.sin(a) * size * 0.3)), _d, { life: rand(1.2, 2.6), size0: size * 0.4, size1: size * rand(1, 1.8), color: DUST, colorEnd: DUST_E, alpha: 0.35, drag: 1.4, buoy: 0.2, fadeIn: 0.1 });
    }
  }
  napeKill(p, dir, quat = null) {
    this.flash(p, 4.6, HOT);
    this.impactRing(p, dir, 9.5, KILL_FLASH, 0.3);
    if (quat) this.doubleCrossSlash(p, quat, 4.4);
    this.bloodSpray(p, dir, 105, 1.7);
    this.bloodPool(p, 3.6);
    this.sparks(p, 36, this.bladeAura);
    for (let i = 0; i < 16; i++) this.steam(_v.copy(p).add(_v2.set(rand(-1, 1), rand(0, 2.5), rand(-1, 1))), 2.3, 3.3);
    for (let i = 0; i < 6; i++) this.wisp(_v.copy(p).add(_v2.set(rand(-0.6, 0.6), rand(0, 1), rand(-0.6, 0.6))), 2.5);
  }
  signalFlare(pos, kind = 'red') {
    const col = kind === 'green' ? FLARE_GREEN : kind === 'gold' ? FLARE_GOLD : FLARE_RED;
    const colE = kind === 'green' ? FLARE_GREEN_E : kind === 'gold' ? FLARE_GOLD_E : FLARE_RED_E;
    this.flares.push({
      pos: pos.clone(),
      vel: new THREE.Vector3(rand(-1.5, 1.5), 42, rand(-1.5, 1.5)),
      col,
      colE,
      t: 0,
      dur: 6.5,
      emitT: 0,
    });
  }
  cannonShot(from, to) {
    _d.subVectors(to, from);
    const dist = _d.length();
    if (dist > 1e-3) _d.divideScalar(dist);
    this.flash(from, 4.5, HOT);
    this.sparks(from, 16, SPARK);
    for (let i = 0; i < 10; i++) {
      _v2.copy(_d).multiplyScalar(rand(6, 18)).add(_v.set(rand(-2, 2), rand(-1, 2.5), rand(-2, 2)));
      this.smoke.spawn(from, _v2, { life: rand(1.0, 2.1), size0: 1.1, size1: 4.2, color: STEAM, colorEnd: DUST_E, alpha: 0.5, drag: 2.0, buoy: 1.1, fadeIn: 0.05 });
    }
    const steps = Math.min(24, Math.max(6, Math.floor(dist / 8)));
    for (let s = 1; s <= steps; s++) {
      _v.lerpVectors(from, to, s / steps);
      this.add.spawn(_v, _v2.copy(_d).multiplyScalar(8), { life: 0.22, size0: 0.35, size1: 0.08, color: KILL_FLASH, colorEnd: SPARK_E, alpha: 0.85, drag: 2, stretch: 0.08, fadeIn: 0 });
    }
  }

  debris(p, n = 10, power = 8) {
    this._debris ||= { pool: [], live: [] };
    const D = this._debris;
    if (!this.debrisGeo) this.debrisGeo = new THREE.BoxGeometry(1, 1, 1);
    if (!this.debrisMats) {
      this.debrisMats = [
        new THREE.MeshStandardMaterial({ color: 0x7a6a55, roughness: 0.95 }),
        new THREE.MeshStandardMaterial({ color: 0x4a3424, roughness: 0.92 }),
        new THREE.MeshStandardMaterial({ color: 0x8a8078, roughness: 0.9 }),
      ];
    }
    for (let i = 0; i < n; i++) {
      let item = D.pool.pop();
      if (!item) {
        const m = new THREE.Mesh(this.debrisGeo, this.debrisMats[i % 3]);
        m.castShadow = true;
        this.game.scene.add(m);
        item = { m, v: new THREE.Vector3(), rv: new THREE.Vector3(), t: 0 };
      }
      const m = item.m;
      m.material = this.debrisMats[i % 3];
      m.visible = true;
      m.position.set(p.x + rand(-1, 1), p.y + rand(0, 2), p.z + rand(-1, 1));
      const sc = rand(0.15, 0.85);
      m.scale.set(sc * rand(0.6, 1.6), sc, sc * rand(0.6, 1.6));
      m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      item.v.set(rand(-1, 1), rand(0.4, 1.4), rand(-1, 1)).multiplyScalar(power * rand(0.5, 1.2));
      item.rv.set(rand(-6, 6), rand(-6, 6), rand(-6, 6));
      item.t = rand(2.0, 3.2);
      D.live.push(item);
    }
  }

  clear() {
    this.smoke.clear();
    this.add.clear();
    this.blood.clear();
    this.waves.clear();
    this.flares.length = 0;
    for (let i = 0; i < 2; i++) {
      this.cables[i].hide();
      this.trails[i].hide();
      this.trailLen[i] = 0;
    }
    for (let i = 0; i < this.poolItems.length; i++) {
      this.poolItems[i].active = false;
      this.poolItems[i].m.visible = false;
    }
    for (let i = this.limbs.length - 1; i >= 0; i--) {
      this.limbs[i].m.visible = false;
      this.limbPool.push(this.limbs[i]);
    }
    this.limbs.length = 0;
    if (this._debris) {
      for (let i = this._debris.live.length - 1; i >= 0; i--) {
        const d = this._debris.live[i];
        d.m.visible = false;
        this._debris.pool.push(d);
      }
      this._debris.live.length = 0;
    }
  }

  update(dt, rdt) {
    const g = this.game, p = g.player, cam = g.cam.camera;
    const wind = g.world.windDir;
    const vfxDt = lerp(dt, rdt, 0.68);
    if (this._debris) {
      for (let i = this._debris.live.length - 1; i >= 0; i--) {
        const d = this._debris.live[i];
        d.t -= dt;
        d.v.y -= 22 * dt;
        d.m.position.addScaledVector(d.v, dt);
        d.m.rotation.x += d.rv.x * dt; d.m.rotation.y += d.rv.y * dt; d.m.rotation.z += d.rv.z * dt;
        if (d.m.position.y < 0.2) { d.m.position.y = 0.2; d.v.multiplyScalar(0.3); d.rv.multiplyScalar(0.4); }
        if (d.t <= 0) { d.m.visible = false; this._debris.pool.push(d); this._debris.live.splice(i, 1); }
      }
    }
    for (let i = this.limbs.length - 1; i >= 0; i--) {
      const lm = this.limbs[i];
      lm.t -= dt;
      lm.v.y -= 21 * dt;
      lm.m.position.addScaledVector(lm.v, dt);
      lm.m.rotation.x += lm.rv.x * dt;
      lm.m.rotation.z += lm.rv.z * dt;
      if (lm.m.position.y < 0.35) {
        lm.m.position.y = 0.35;
        lm.v.multiplyScalar(0.25);
        lm.rv.multiplyScalar(0.3);
      }
      lm.bleedT += dt;
      if (lm.bleedT > 0.08) {
        lm.bleedT = 0;
        this.steam(lm.m.position, 0.9, 1.4);
      }
      if (lm.t <= 0) {
        lm.m.visible = false;
        this.limbPool.push(lm);
        this.limbs.splice(i, 1);
      }
    }
    for (let i = 0; i < this.poolItems.length; i++) {
      const pl = this.poolItems[i];
      if (!pl.active) continue;
      pl.t += dt;
      if (pl.t >= pl.dur) {
        pl.active = false;
        pl.m.visible = false;
        continue;
      }
      const grow = Math.min(1, pl.t / 0.45);
      const shrink = pl.t > pl.dur - 4 ? (pl.dur - pl.t) / 4 : 1;
      pl.m.scale.setScalar(Math.max(0.05, pl.maxR * grow * shrink));
      if (Math.random() < dt * 1.4) this.wisp(pl.m.position, 0.7);
    }
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.t += dt;
      if (f.t >= f.dur) { this.flares.splice(i, 1); continue; }
      f.vel.y = Math.max(3.5, f.vel.y - 14 * dt);
      f.pos.addScaledVector(f.vel, dt);
      f.emitT += dt;
      while (f.emitT >= 0.035) {
        f.emitT -= 0.035;
        this.add.spawn(f.pos, _d.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)), { life: 0.14, size0: 1.6, size1: 0.5, color: f.col, alpha: 0.95, drag: 2, fadeIn: 0 });
        this.smoke.spawn(f.pos, _d.set(rand(-0.8, 0.8), rand(0.5, 2.2), rand(-0.8, 0.8)), { life: 3.4, size0: 0.9, size1: 4.8, color: f.col, colorEnd: f.colE, alpha: 0.48, drag: 1.1, buoy: 1.4, fadeIn: 0.08 });
      }
    }
    this.smoke.update(dt, wind);
    this.add.update(vfxDt, wind);
    this.blood.update(dt, wind);
    this.waves.update(vfxDt);
    const tNow = g.elapsed;
    for (let i = 0; i < 2; i++) {
      const h = p.hooks[i], rb = this.cables[i];
      if (h.state === 'none') { rb.hide(); continue; }
      const from = p.model.gearPos(h.side, _v);
      const pts = this.cablePts[i];
      const n = pts.length;
      const L = from.distanceTo(h.tip);
      const ret = h.state === 'ret';
      const slack = h.state === 'fly' ? 0.25 : ret ? 1.2 : clamp(1 - h.tension * 0.2, 0, 1) * 0.06;
      for (let k = 0; k < n; k++) {
        const u = k / (n - 1);
        pts[k].lerpVectors(from, h.tip, u);
        const sag = Math.sin(u * Math.PI) * L * slack * 0.08;
        pts[k].y -= sag;
        if (h.state === 'fly') pts[k].x += Math.sin(u * 20 - tNow * 40) * 0.08 * Math.sin(u * Math.PI);
        else if (ret) { const w = Math.sin(u * 9 - tNow * 55) * 0.25 * Math.sin(u * Math.PI); pts[k].x += w; pts[k].z += w * 0.6; }
      }
      rb.set(pts, cam.position, (k, nn) => 0.06 + (k === nn - 1 ? 0.08 : 0), 1);
      if (h.state === 'fly' && Math.random() < 0.5) this.add.spawn(h.tip, _d.set(0, 0, 0), { life: 0.08, size0: 0.25, size1: 0.1, color: SPARK, alpha: 0.8 });
    }
    const swinging = p.slashT >= 0 || p.spin > 0 || p.charge > 0.35;
    for (let i = 0; i < 2; i++) {
      const pool = this.trailPool[i];
      const slice = this.trailSlice[i];
      if (swinging && p.blade > 0 && dt > 0) {
        const head = (this.trailHead[i] - 1 + pool.length) % pool.length;
        this.trailHead[i] = head;
        p.model.bladeTip(i, pool[head]);
        this.trailLen[i] = Math.min(13, this.trailLen[i] + 1);
      } else if (this.trailLen[i] > 0 && rdt > 0) {
        this.trailLen[i]--;
      }
      const len = this.trailLen[i];
      if (len > 1) {
        slice.length = len;
        for (let k = 0; k < len; k++) slice[k] = pool[(this.trailHead[i] + k) % pool.length];
        const fpk = g.cam.isFP() ? 0.36 : 1;
        this.trails[i].set(slice, cam.position, (k, nn) => 0.36 * fpk * (1 - k / nn), (k, nn) => Math.pow(1 - k / nn, 1.5) * 0.82 * fpk);
      } else {
        this.trails[i].hide();
      }
    }
    if (p.gasOn && dt > 0) {
      for (const s of [-1, 1]) {
        if (p.gasSide && s !== p.gasSide) continue;
        const gp = p.model.gearPos(s, _v2);
        _d.copy(p.vel).normalize();
        if (p.braking) _d.negate();
        if (g.cam.isFP()) gp.addScaledVector(cam.getWorldDirection(_v), -1.2);
        this.gas(gp, _d.lengthSq() ? _d : _v.set(0, 1, 0), 0.7);
      }
    }
    const sp = p.speed;
    if (sp > 20 && dt > 0) {
      this.streakT += rdt * (sp - 18) * 2.8;
      while (this.streakT > 1) {
        this.streakT -= 1;
        _v.copy(cam.position).add(_v2.set(rand(-6, 6), rand(-4, 4), rand(-6, 6))).addScaledVector(p.vel, 0.25);
        _d.copy(p.vel).multiplyScalar(-0.15);
        this.add.spawn(_v, _d, { life: 0.22, size0: 0.04, size1: 0.02, color: GAS, alpha: clamp((sp - 20) / 28, 0, 0.38), drag: 0, stretch: 0.12, fadeIn: 0.05 });
      }
    }
  }
}
