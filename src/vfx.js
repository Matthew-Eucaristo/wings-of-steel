import * as THREE from 'three';
import { Particles, Ribbon } from './particles.js';
import { smokeSprite, glowSprite } from './textures.js';
import { rand, clamp } from './util.js';

const C = (h) => new THREE.Color(h);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _d = new THREE.Vector3();
const STEAM = C('#f2eee8'), STEAM_E = C('#c9c4bf'), GAS = C('#ffffff'), GAS_E = C('#d8dde2');
const BLOOD = C('#a0100c'), BLOOD_E = C('#4a0404'), SPARK = C('#fff2c0'), SPARK_E = C('#ff7a1a');
const DUST = C('#b9a88c'), DUST_E = C('#8a7c68'), SLASH = C('#bfe6ff'), HOT = C('#ff9a5a');

export class VFX {
  constructor(game) {
    this.game = game;
    const scene = game.scene, fog = scene.fog;
    const smoke = smokeSprite(), glow = glowSprite();
    this.smoke = new Particles(scene, { max: 4000, texture: smoke, lit: true, fog });
    this.add = new Particles(scene, { max: 2500, texture: glow, additive: true, lit: false, fog });
    this.blood = new Particles(scene, { max: 1500, texture: glow, lit: true, fog });
    this.cables = [0, 1].map(() => new Ribbon(scene, 24, { color: 0x2a2826, opacity: 1, fog }));
    this.trails = [0, 1].map(() => new Ribbon(scene, 18, { color: 0xd8f0ff, additive: true, opacity: 0.9, fog }));
    this.trailPts = [[], []];
    this.cablePts = [0, 1].map(() => Array.from({ length: 24 }, () => new THREE.Vector3()));
    this.streakT = 0;
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
      // tight exhaust jet that blooms late, so the trail reads as a stream and doesn't fog the camera
      _d.copy(dir).multiplyScalar(-rand(9, 16) * strength).add(_v.set(rand(-0.6, 0.6), rand(-0.6, 0.6), rand(-0.6, 0.6)));
      this.smoke.spawn(p, _d, { life: rand(0.35, 0.8), size0: 0.18, size1: rand(0.9, 1.6) * strength, color: GAS, colorEnd: GAS_E, alpha: 0.28, drag: 3.5, buoy: 0.4, fadeIn: 0.04 });
    }
  }
  burst(p, dir, n = 40) {
    for (let i = 0; i < n; i++) {
      _d.set(rand(-1, 1), rand(-0.6, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 14)).addScaledVector(dir, rand(0, 0.5));
      this.smoke.spawn(p, _d, { life: rand(0.8, 1.6), size0: 0.5, size1: rand(3, 5), color: GAS, colorEnd: GAS_E, alpha: 0.28, drag: 4, buoy: 0.3 });
    }
  }
  bloodSpray(p, dir, n = 30, big = 1) {
    for (let i = 0; i < n; i++) {
      _d.copy(dir).normalize().multiplyScalar(rand(4, 16) * big).add(_v.set(rand(-4, 4), rand(-1, 6), rand(-4, 4)));
      this.blood.spawn(p, _d, { life: rand(0.6, 1.4), size0: rand(0.22, 0.5) * big, size1: 0.12, color: BLOOD, colorEnd: BLOOD_E, alpha: 1, drag: 0.4, buoy: -1.2, stretch: 0.09, fadeIn: 0.01 });
    }
    // blood instantly evaporates as steam (titan biology)
    for (let i = 0; i < n * 0.18; i++) this.steam(_v.copy(p).add(_v2.set(rand(-1, 1), rand(-1, 1), rand(-1, 1))), 1.2 * big, 2);
  }
  sparks(p, n = 14, col = SPARK) {
    for (let i = 0; i < n; i++) {
      _d.set(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(rand(5, 18));
      this.add.spawn(p, _d, { life: rand(0.15, 0.45), size0: rand(0.06, 0.14), size1: 0.01, color: col, colorEnd: SPARK_E, alpha: 1, drag: 2, buoy: -2, stretch: 0.03, fadeIn: 0.0 });
    }
  }
  flash(p, size = 3, col = SLASH) {
    this.add.spawn(p, _d.set(0, 0, 0), { life: 0.14, size0: size, size1: size * 1.8, color: col, alpha: 1, drag: 0, fadeIn: 0 });
  }
  dust(p, size = 4, n = 12) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      _d.set(Math.cos(a) * rand(2, 6) * size * 0.3, rand(0.3, 2), Math.sin(a) * rand(2, 6) * size * 0.3);
      this.smoke.spawn(_v.copy(p).add(_v2.set(Math.cos(a) * size * 0.3, 0.2, Math.sin(a) * size * 0.3)), _d, { life: rand(1.2, 2.6), size0: size * 0.4, size1: size * rand(1, 1.8), color: DUST, colorEnd: DUST_E, alpha: 0.35, drag: 1.4, buoy: 0.2, fadeIn: 0.1 });
    }
  }
  napeKill(p, dir) {
    this.flash(p, 6, HOT);
    this.bloodSpray(p, dir, 90, 1.6);
    this.sparks(p, 30, SLASH);
    // wound vents a rising column instead of one opaque ball over the head
    for (let i = 0; i < 14; i++) this.steam(_v.copy(p).add(_v2.set(rand(-1, 1), rand(0, 2.5), rand(-1, 1))), 2.2, 3.2);
    for (let i = 0; i < 6; i++) this.wisp(_v.copy(p).add(_v2.set(rand(-0.6, 0.6), rand(0, 1), rand(-0.6, 0.6))), 2.5);
  }

  update(dt, rdt) {
    const g = this.game, p = g.player, cam = g.cam.camera;
    const wind = g.world.windDir;
    this.smoke.update(dt, wind); this.add.update(dt, wind); this.blood.update(dt, wind);
    // cables
    for (let i = 0; i < 2; i++) {
      const h = p.hooks[i], rb = this.cables[i];
      if (h.state === 'none') { rb.hide(); continue; }
      const from = p.model.gearPos(h.side, _v);
      const pts = this.cablePts[i];
      const n = pts.length;
      const L = from.distanceTo(h.tip);
      const ret = h.state === 'ret';
      const slack = h.state === 'fly' ? 0.25 : ret ? 1.2 : clamp(1 - h.tension * 0.2, 0, 1) * 0.06;
      const t = performance.now() * 0.001;
      for (let k = 0; k < n; k++) {
        const u = k / (n - 1);
        pts[k].lerpVectors(from, h.tip, u);
        const sag = Math.sin(u * Math.PI) * L * slack * 0.08;
        pts[k].y -= sag;
        if (h.state === 'fly') pts[k].x += Math.sin(u * 20 - t * 40) * 0.08 * Math.sin(u * Math.PI);
        else if (ret) { const w = Math.sin(u * 9 - t * 55) * 0.25 * Math.sin(u * Math.PI); pts[k].x += w; pts[k].z += w * 0.6; }
      }
      rb.set(pts, cam.position, (k, nn) => 0.06 + (k === nn - 1 ? 0.08 : 0), 1);
      if (h.state === 'fly' && Math.random() < 0.5) this.add.spawn(h.tip, _d.set(0, 0, 0), { life: 0.08, size0: 0.25, size1: 0.1, color: SPARK, alpha: 0.8 });
    }
    // blade trails while slashing or fast
    const swinging = p.slashT >= 0 || p.spin > 0 || p.charge > 0.45;
    for (let i = 0; i < 2; i++) {
      const tr = this.trailPts[i];
      if (swinging && p.blade > 0) {
        const tip = p.model.bladeTip(i, new THREE.Vector3());
        tr.unshift(tip);
        if (tr.length > 11) tr.pop();
      } else if (tr.length) tr.pop();
      if (tr.length > 1) {
        // first person: the trail sweeps right past the lens, so keep it a thin streak instead of a whiteout
        const fpk = this.game.cam.isFP() ? 0.3 : 1;
        this.trails[i].set(tr, cam.position, (k, n) => 0.32 * fpk * (1 - k / n), (k, n) => (1 - k / n) ** 1.6 * 0.7 * fpk);
      }
      else this.trails[i].hide();
    }
    // gas exhaust
    if (p.gasOn) for (const s of [-1, 1]) {
      const gp = p.model.gearPos(s, _v2);
      _d.copy(p.vel).normalize();
      if (p.braking) _d.negate();
      if (this.game.cam.isFP()) gp.addScaledVector(cam.getWorldDirection(_v), -1.2);
      this.gas(gp, _d.lengthSq() ? _d : _v.set(0, 1, 0), 0.7);
    }
    // wind streaks at high speed
    const sp = p.speed;
    if (sp > 22) {
      this.streakT += rdt * (sp - 20) * 3;
      while (this.streakT > 1) {
        this.streakT -= 1;
        _v.copy(cam.position).add(_v2.set(rand(-6, 6), rand(-4, 4), rand(-6, 6))).addScaledVector(p.vel, 0.25);
        _d.copy(p.vel).multiplyScalar(-0.15);
        this.add.spawn(_v, _d, { life: 0.25, size0: 0.04, size1: 0.02, color: GAS, alpha: clamp((sp - 22) / 30, 0, 0.35), drag: 0, stretch: 0.12, fadeIn: 0.05 });
      }
    }
  }
}
