import * as THREE from 'three';
import { PlayerModel } from './playerModel.js';
import { VFX_COLORS } from './vfx.js';
import { createRayHit } from './collision.js';
import { clamp, damp, closestPointOnSegment } from './util.js';
import { createPistolState, updatePistols, reloadPistols, firePistolShot } from './combat/weapons.ts';
import { createParkourState, updateParkour, tryLandingRoll } from './physics/parkour.ts';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _n = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _probeDir = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const near = [];

const _aimRayHit = createRayHit();
const _fleshRayHit = createRayHit();
const _wallRayHit = createRayHit();
const _sideRayHit = createRayHit();
const _spearRayHit = createRayHit();
const _mantleRayHit = createRayHit();

const PROBE_OFFSETS = [
  [0.11, 0.07],
  [0.23, 0.12],
  [0.36, 0.06],
  [0.05, 0.02],
  [0.18, -0.04],
];

const CLASSES = {
  light: { style: 'blades', cylinders: 2, blades: 4, spears: 2, speed: 1.12, steer: 1.2, thrust: 1.1, damage: 1.15 },
  balanced: { style: 'blades', cylinders: 4, blades: 6, spears: 3, speed: 1.0, steer: 1.05, thrust: 1.0, damage: 1.05 },
  gunslinger: { style: 'pistols', cylinders: 3, blades: 6, spears: 2, speed: 1.1, steer: 1.16, thrust: 1.08, damage: 1.1 },
  heavy: { style: 'siege', cylinders: 6, blades: 8, spears: 5, speed: 0.9, steer: 0.92, thrust: 0.95, damage: 1.0 },
};

export const TUNE = {
  gravity: 20.5,
  hookRange: 175,
  hookSpeed: 310,
  reelAccel: 58,
  reelMax: 52,
  swingPull: 22,
  swingPump: 13.5,
  boostRate: 0.62,
  boostFloor: 1.4,
  boostCap: 56,
  airSteer: 7.2,
  swingSteer: 26,
  runSpeed: 10.5,
  jump: 9.6,
  radius: 0.42,
  slashTime: 0.34,
  reach: 3.2,
};

class Hook {
  constructor(side) {
    this.side = side;
    this.state = 'none';
    this.tip = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.len = 0;
    this.joint = null;
    this.local = new THREE.Vector3();
    this.owner = null;
    this.house = null;
    this.t = 0;
    this.tension = 0;
    this.cool = false;
  }
  reset() {
    this.state = 'none';
    this.joint = null;
    this.owner = null;
    this.house = null;
    this.len = 0;
    this.t = 0;
    this.tension = 0;
    this.cool = false;
  }
}

export class Player {
  constructor(game, appearance) {
    this.game = game;
    this.model = new PlayerModel(game.scene, appearance);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.hooks = [new Hook(-1), new Hook(1)];
    this.cand = [
      { ok: false, point: new THREE.Vector3(), collider: null, surface: 'stone', lockOwner: null },
      { ok: false, point: new THREE.Vector3(), collider: null, surface: 'stone', lockOwner: null },
    ];
    this.spearShots = [];
    this.groundN = new THREE.Vector3(0, 1, 0);
    this.slashHits = new Set();
    this.vPrev = new THREE.Vector3();
    this.accS = new THREE.Vector3();
    this.impactN = new THREE.Vector3(0, 1, 0);
    this.wallN = new THREE.Vector3(0, 0, 1);
    this.hookMode = 'auto';
    this.reset();
  }

  reset() {
    const g = this.game;
    for (const s of this.spearShots) g.scene.remove(s.mesh);
    this.spearShots.length = 0;
    for (const h of this.hooks) h.reset();
    this.pos.copy(g.world.getArenaSpawn ? g.world.getArenaSpawn(g.arena) : g.world.playerSpawn);
    this.vel.set(0, 0, 0);
    this.vPrev.set(0, 0, 0);
    this.accS.set(0, 0, 0);
    this.quat.identity();
    this.grounded = false;
    this.groundN.set(0, 1, 0);
    this.hp = 100;
    this.gas = 100;
    this.blade = 100;
    this.dead = false;
    this.slashT = -1;
    this.slashHits.clear();
    this.spin = 0;
    this.charge = 0;
    this.dashCD = 0;
    this.invuln = 0;
    this.hurtAgo = 10;
    this.grabbedBy = null;
    this.struggle = 0;
    this.gasOn = false;
    this.reeling = false;
    this.gasSide = 0;
    this.braking = false;
    this.diving = false;
    this.wallRun = false;
    this.climbing = false;
    this.wallT = 0;
    this.climbT = 0;
    this.mantleCD = 0;
    this.impactT = 0;
    this.coyoteT = 0;
    this.spearCd = 0;
    this.spearRegenT = 0;
    this.autoCycleT = 0;
    this.slingCD = 0;
    this.execTarget = null;
    this.execLungeT = 0;
    this.canExecute = false;
    this.speed = 0;
    this.aim = null;
    this.lock = null;
    this.combo = 0;
    this.comboT = 0;
    this.airTime = 0;
    this.strikeSpeed = 0;
    this.smoothLat = 0;
    this.smoothFwd = 0;
    this.pistols = createPistolState(12, 8);
    this.parkour = createParkourState();
    this.mods = {
      bladeSaver: 1,
      gasSaver: 1,
      thrustBonus: 1,
      hookSpeedBonus: 1,
      hookRangeBonus: 0,
      damageBonus: 1,
      maxSpearBonus: 0,
      spinRateBonus: 1,
    };
    this.model.capeInit = false;
    this.model.setVisible(true);
    this.applyClass(g.playerClass || 'balanced', true);
  }

  applyClass(name, refill = false) {
    this.className = CLASSES[name] ? name : 'balanced';
    this.classDef = CLASSES[this.className];
    this.combatStyle = this.classDef.style || 'blades';
    if (refill) {
      this.gas = 100;
      this.blade = 100;
      this.gasCylinders = this.classDef.cylinders;
      this.bladeSets = this.classDef.blades;
      this.spears = this.classDef.spears + (this.mods?.maxSpearBonus || 0);
      this.gasReload = 0;
      this.spearRegenT = 0;
      this.pistols = createPistolState(12, 8);
    }
  }

  get maxSpears() { return this.classDef.spears + (this.mods?.maxSpearBonus || 0); }
  get maxRange() { return TUNE.hookRange + this.mods.hookRangeBonus; }
  get hooked() { return this.hooks[0].state === 'attached' || this.hooks[1].state === 'attached'; }
  get attachedCount() { return (this.hooks[0].state === 'attached' ? 1 : 0) + (this.hooks[1].state === 'attached' ? 1 : 0); }

  anchorOf(h, out) {
    if (h.joint) return out.copy(h.local).applyMatrix4(h.joint.matrixWorld);
    if (h.owner?.alive && h.owner.nape) return out.copy(h.owner.nape.c);
    return out.copy(h.target);
  }

  detachHouse(house) {
    for (let i = 0; i < 2; i++) {
      const h = this.hooks[i];
      if ((h.state === 'attached' || h.state === 'fly') && h.house === house) {
        this.game.vfx.sparks(h.tip, 12);
        this.release(h, true);
      }
    }
  }

  computeCandidate(idx) {
    const g = this.game, cam = g.cam;
    const side = idx === 0 ? -1 : 1;
    const out = this.cand[idx];
    out.ok = false;
    out.collider = null;
    out.lockOwner = null;
    const range = this.maxRange;
    const from = this.model.gearPos(side, _v2);

    if (this.lock) {
      const aimAtStatic = this.aim && !this.aim.collider?.owner && this.aim.surface !== 'ground' && this.aim.t < 95;
      _v3.subVectors(this.lock.nape.c, cam.camera.position);
      const lockD = _v3.length();
      const aimDotLock = lockD > 1e-3 ? _v3.divideScalar(lockD).dot(cam.forward) : 0;
      const preferStructure = aimAtStatic && aimDotLock < 0.93;
      if (!preferStructure) {
        const sideOffset = side * 0.65 * this.lock.s;
        _v4.copy(this.lock.nape.c).addScaledVector(cam.rightFlat, sideOffset);
        _v3.subVectors(_v4, from);
        const nd = _v3.length();
        if (nd > 2 && nd <= range) {
          _v3.divideScalar(nd);
          const flesh = g.world.col.raycast(from, _v3, nd + 3, { dynamics: true, inflate: 1.8 }, _fleshRayHit);
          if (flesh?.collider?.owner === this.lock) {
            out.ok = true;
            out.point.copy(flesh.point);
            out.collider = flesh.collider;
            out.surface = flesh.surface;
            return;
          }
          const wall = g.world.col.raycast(from, _v3, nd - 0.5, { dynamics: false }, _wallRayHit);
          if (!wall) {
            out.ok = true;
            out.point.copy(this.lock.nape.c);
            out.surface = 'flesh';
            out.lockOwner = this.lock;
            return;
          }
        }
      }
    }

    if (this.hookMode === 'focus') {
      if (this.aim) {
        out.ok = true;
        out.point.copy(this.aim.point);
        out.collider = this.aim.collider;
        out.surface = this.aim.surface;
      }
      return;
    }

    const camPos = cam.camera.position;
    cam.camera.getWorldDirection(_v3);
    const otherAnchor = this.hooks[1 - idx].state === 'attached'
      ? this.anchorOf(this.hooks[1 - idx], _v4)
      : idx === 1 && this.cand[0].ok
        ? this.cand[0].point
        : null;

    let bestScore = -1e9;
    for (let k = 0; k < PROBE_OFFSETS.length; k++) {
      const [ox, oy] = PROBE_OFFSETS[k];
      _probeDir.copy(_v3)
        .addScaledVector(cam.right, side * ox)
        .addScaledVector(UP, oy)
        .normalize();
      const hit = g.world.col.raycast(camPos, _probeDir, range + 14, { dynamics: true, inflate: 1.25 }, _sideRayHit);
      if (!hit) continue;
      const d = hit.point.distanceTo(this.pos);
      if (d < 4.5 || d > range) continue;

      const elev = clamp(hit.point.y - this.pos.y, -18, 34);
      const isGround = hit.surface === 'ground';
      const isFlesh = hit.surface === 'flesh' || !!hit.collider?.owner;
      const distScore = 18 - Math.abs(d - 56) * 0.22;
      let score = distScore + elev * 1.15 - k * 2.4;
      if (isGround) score -= 48;
      if (isFlesh) score += 12;
      if (otherAnchor && hit.point.distanceTo(otherAnchor) < 9) score -= 22;

      if (score > bestScore) {
        bestScore = score;
        out.ok = true;
        out.point.copy(hit.point);
        out.collider = hit.collider;
        out.surface = hit.surface;
      }
    }

    if (!out.ok && this.aim && this.aim.t >= 4 && this.aim.t <= range) {
      out.ok = true;
      out.point.copy(this.aim.point);
      out.collider = this.aim.collider;
      out.surface = this.aim.surface;
    }
  }

  fire(h) {
    const g = this.game;
    const idx = h.side < 0 ? 0 : 1;
    this.computeCandidate(idx);
    const cand = this.cand[idx];
    if (!cand.ok) { g.hud.flash('no-anchor'); g.audio.click(); return; }
    const from = this.model.gearPos(h.side, _v2);
    let pairSource = null;
    let targetPt = cand.point;
    let col = cand.collider;
    let surf = cand.surface;
    let lockOwn = cand.lockOwner;

    if (this.hookMode === 'focus') {
      const other = this.hooks[1 - idx];
      if (other.state === 'fly' || other.state === 'attached') {
        const otherAnchor = this.anchorOf(other, _v3);
        if (targetPt.distanceTo(otherAnchor) > 28) {
          pairSource = other;
          targetPt = otherAnchor;
          col = null;
          surf = 'stone';
          lockOwn = other.owner || null;
        }
      }
    }

    h.state = 'fly';
    h.t = 0;
    h.tip.copy(from);
    h.target.copy(targetPt);
    h.joint = pairSource?.joint || null;
    h.owner = pairSource?.owner || lockOwn || null;
    h.house = pairSource?.house || col?.house || null;
    if (pairSource?.joint) h.local.copy(pairSource.local);
    if (col && col.owner && col.ja) {
      h.joint = col.ja;
      h.owner = col.owner;
      h.local.copy(targetPt);
      col.ja.worldToLocal(h.local);
    }
    h.surface = surf;
    g.audio.hookFire(h.side);
    g.cam.shake(0.03);
    g.cam.impactFov = Math.max(g.cam.impactFov, 0.55);
  }

  release(h, forced = false) {
    if (h.state === 'none' || h.state === 'ret') return;
    if (!forced && h.state === 'attached' && h.tension > 0.35 && this.attachedCount === 1 && !this.grounded && this.slingCD <= 0) {
      const sp = this.vel.length();
      if (sp > 16 && this.vel.y > 1.0) {
        this.vel.multiplyScalar(1 + Math.min(0.14, sp / 340));
        this.vel.y += 3.8;
        this.slingCD = 0.65;
        this.game.onSlingshot(this.pos, this.vel);
      }
    }
    h.state = 'ret';
    h.t = 0;
    h.joint = null;
    h.owner = null;
    h.house = null;
    h.tension = 0;
    this.game.audio.hookRetract(h.side);
  }

  updateAim() {
    const g = this.game, cam = g.cam.camera;
    const range = this.maxRange;
    cam.getWorldDirection(_n);
    const hit = g.world.col.raycast(cam.position, _n, range + 20, { dynamics: true, inflate: 1.25 }, _aimRayHit);
    if (hit) {
      const d = hit.point.distanceTo(this.pos);
      hit.t = d;
      this.aim = d <= range ? hit : null;
    } else this.aim = null;

    let best = null, bestS = -1;
    const lockScore = (t) => {
      _v.subVectors(t.nape.c, cam.position);
      const d = _v.length();
      const pd = t.nape.c.distanceTo(this.pos);
      if (d < 1e-3 || pd > range) return { d: pd, s: -1, thresh: 0.85 };
      let s = _v.dot(_n) / d;
      const below = this.pos.y < t.nape.c.y - 2.0 && pd < 135;
      if (below || pd < 45) {
        _v2.set(t.root.position.x, t.root.position.y + (t.nape.c.y - t.root.position.y) * 0.65, t.root.position.z).sub(cam.position);
        const db = _v2.length();
        if (db > 1e-3) s = Math.max(s, _v2.dot(_n) / db);
      }
      const thresh = pd < 24 ? 0.42 : pd < 48 ? 0.62 : below ? 0.76 : 0.83;
      const closeBoost = pd < 38 ? (38 - pd) * 0.0045 : 0;
      return { d: pd, s: s + closeBoost, thresh };
    };

    if (this.lock?.alive && this.lock.state !== 'emerge') {
      const r = lockScore(this.lock);
      if (r.d <= range && r.s > r.thresh - 0.16) { best = this.lock; bestS = r.s + 0.07; }
    }
    for (let i = 0; i < g.titans.length; i++) {
      const t = g.titans[i];
      if (!t.alive || t.state === 'emerge') continue;
      const r = lockScore(t);
      if (r.d > range || r.s < r.thresh) continue;
      const s = r.s + (t === this.lock ? 0.07 : 0);
      if (s > bestS) { bestS = s; best = t; }
    }
    this.lock = best;
    const lockDist = best ? best.nape.c.distanceTo(this.pos) : Infinity;
    this.canExecute = !!(best && lockDist < 28 && this.blade > 0 && best.armor <= 0);
    this.computeCandidate(0);
    this.computeCandidate(1);
  }

  grab(t) {
    this.grabbedBy = t; this.struggle = 0;
    for (const h of this.hooks) this.release(h, true);
    this.vel.set(0, 0, 0);
    this.game.onGrabbed();
  }
  releaseGrab(t) {
    if (this.grabbedBy !== t) return;
    this.grabbedBy = null; this.invuln = 2.0;
    _v.set(Math.sin(t.heading), 0.95, Math.cos(t.heading));
    this.vel.copy(_v).multiplyScalar(15);
  }
  eaten() { this.grabbedBy = null; this.hp = 0; this.die('eaten'); }
  knockback(dir, spd, dmg) {
    if (this.invuln > 0 || this.execLungeT > 0) return;
    this.game.hud.damageFrom(_v.copy(this.pos).addScaledVector(dir, -10));
    this.vel.addScaledVector(dir, spd);
    this.damage(dmg, 'swat');
    this.invuln = 1.0;
  }
  damage(d, why) {
    if (this.dead || d <= 0) return;
    this.hurtAgo = 0;
    if (this.game.mode === 'training') {
      this.hp = Math.max(30, this.hp - d * 0.35);
      this.game.onPlayerHurt(d * 0.35);
      return;
    }
    this.hp -= d;
    this.game.onPlayerHurt(d);
    if (this.hp <= 0) { this.hp = 0; this.die(why); }
  }
  die(why) {
    if (this.dead) return;
    this.dead = true;
    for (const h of this.hooks) this.release(h, true);
    this.game.onPlayerDeath(why);
  }

  update(dt) {
    const g = this.game, inp = g.input;
    this.dashCD -= dt;
    this.slingCD -= dt;
    this.invuln -= dt;
    this.comboT -= dt;
    this.hurtAgo += dt;
    if (this.hurtAgo > 3.8 && !this.dead && this.hp < 100) {
      this.hp = Math.min(100, this.hp + dt * 4.5);
    }
    if (this.spears <= 0 && !this.dead) {
      this.spearRegenT += dt;
      if (this.spearRegenT >= 20) {
        this.spearRegenT = 0;
        this.spears = 1;
        g.hud.toast('<span style="font-size:17px;color:#ffb482">THUNDER SPEAR RESUPPLIED (+1)</span>', 1.1);
        g.audio.bladeSwap();
      }
    } else {
      this.spearRegenT = 0;
    }

    if (this.comboT <= 0) this.combo = 0;
    this.updateAim();
    if (this.grabbedBy) return this.updateGrabbed(dt);
    if (this.dead) { this.physics(dt, false); this.animate(dt); return; }

    const want0 = inp.action('hookL') || inp.mouse.r;
    const want1 = inp.action('hookR') || inp.mouse.r;
    this.autoCycleT = Math.max(0, this.autoCycleT - dt);
    const autoCycleOn = g.prefs.autoCycle !== false;
    if (autoCycleOn && this.hookMode === 'auto' && want0 && want1 && this.speed > 7 && this.autoCycleT <= 0 && (!this.lock || this.pos.distanceTo(this.lock.nape.c) > 85)) {
      if (this.hooks[0].state === 'attached' && this.hooks[1].state === 'attached') {
        const mx = (inp.action('right') ? 1 : 0) - (inp.action('left') ? 1 : 0);
        const mz = (inp.action('forward') ? 1 : 0) - (inp.action('back') ? 1 : 0);
        _v4.copy(g.cam.forward);
        if (mx || mz) _v4.addScaledVector(g.cam.rightFlat, mx * 0.85).addScaledVector(g.cam.forwardFlat, mz * 0.85);
        _v4.normalize();
        let worst = null, worstScore = Infinity, worstDist = 0;
        for (let i = 0; i < 2; i++) {
          const h = this.hooks[i];
          _v3.subVectors(this.anchorOf(h, _v), this.pos);
          const d = _v3.length();
          const score = d > 0 ? _v3.divideScalar(d).dot(_v4) : -1;
          if (score < worstScore) { worstScore = score; worstDist = d; worst = h; }
        }
        if (worst && (worstScore < 0.25 || worstDist < 7)) {
          worst.state = 'none'; worst.joint = null; worst.owner = null; worst.house = null; worst.cool = false; worst.tension = 0;
          this.fire(worst); worst.cool = true;
          this.autoCycleT = 0.24; g.cam.shake(0.02);
        }
      }
    }
    for (let i = 0; i < 2; i++) {
      const h = this.hooks[i];
      const w = i === 0 ? want0 : want1;
      if (w && (h.state === 'none' || h.state === 'ret') && !h.cool) { this.fire(h); h.cool = true; }
      if (!w) { h.cool = false; this.release(h); }
    }

    const m = inp.mouse;
    updatePistols(this, dt);
    if (this.combatStyle === 'pistols') {
      if (m.lPressed || (m.l && this.pistols.fireCd <= 0)) firePistolShot(this);
      if (inp.actionPressed('reloadBlade')) reloadPistols(this);
    } else {
      if (m.lPressed && this.slashT < 0 && this.spin <= 0) this.startSlash();
      if (m.l && !this.grounded && this.speed > 11 && this.slashT < 0) {
        this.charge = Math.min(1, this.charge + dt * 2.5 * this.mods.spinRateBonus);
      }
      if (!m.l && this.charge > 0) {
        if (this.charge > 0.4 && this.blade > 0) {
          this.spin = 0.6 + this.charge * 0.36;
          this.slashHits.clear();
          g.audio.spin();
          g.vfx.slashArc(this.pos, this.quat, 3.0);
        }
        this.charge = 0;
      }
      if (inp.actionPressed('reloadBlade')) this.swapBlades();
    }
    if (inp.actionPressed('spear')) this.handleSpearInput();
    if (inp.actionPressed('command')) g.squad?.issueCommand();
    updateParkour(this, dt, true);
    this.spearCd = Math.max(0, this.spearCd - dt);
    this.updateSpears(dt);

    if (this.execLungeT > 0) {
      this.execLungeT -= dt;
      if (this.execTarget?.alive) {
        _v.copy(this.execTarget.nape.c).addScaledVector(UP, 0.75 * this.execTarget.s).sub(this.pos);
        const d = _v.length();
        if (d > 0.7) {
          _v.divideScalar(d);
          const targetSpd = Math.max(this.vel.length(), 36);
          _v2.copy(_v).multiplyScalar(targetSpd);
          this.vel.lerp(_v2, 1 - Math.exp(-15 * dt));
          this.gasOn = true;
        }
      } else {
        this.execLungeT = 0;
      }
    }

    for (let i = 0; i < 2; i++) this.updateHook(this.hooks[i], dt);
    this.strikeSpeed = Math.max(this.vel.length(), (this.strikeSpeed || 0) - dt * 32);
    const sub = 3;
    for (let i = 0; i < sub; i++) {
      this.strikeSpeed = Math.max(this.strikeSpeed, this.vel.length());
      this.physics(dt / sub, true);
    }
    this.combat(dt);
    this.depot(dt);
    this.animate(dt);
  }

  updateHook(h, dt) {
    if (h.state === 'none') return;
    if (h.state === 'ret') {
      const from = this.model.gearPos(h.side, _v);
      _v2.subVectors(from, h.tip);
      const d = _v2.length(), step = (105 + h.t * 980) * dt;
      h.t += dt;
      if (d <= step || h.t > 0.5) h.state = 'none';
      else h.tip.addScaledVector(_v2, step / d);
      return;
    }
    if (h.owner && (h.owner.remove || (!h.owner.alive && h.owner.deadT > 10))) { this.release(h, true); return; }
    if (h.house && h.house.dead) { this.release(h, true); return; }
    const tgt = this.anchorOf(h, _v);
    if (h.state === 'fly') {
      h.t += dt;
      _v2.subVectors(tgt, h.tip);
      const d = _v2.length();
      const step = TUNE.hookSpeed * this.mods.hookSpeedBonus * dt;
      if (d <= step) {
        h.tip.copy(tgt);
        h.state = 'attached';
        h.len = h.tip.distanceTo(this.pos);
        _v3.subVectors(tgt, this.pos);
        const al = _v3.length();
        if (al > 1e-3) {
          _v3.divideScalar(al);
          const away = this.vel.dot(_v3);
          if (away < 0) this.vel.addScaledVector(_v3, -away * 0.55);
          this.vel.addScaledVector(_v3, 4.2);
          if (_v3.y > 0.16) this.grounded = false;
        }
        this.game.onHookHit(h);
      } else h.tip.addScaledVector(_v2, step / d);
    } else h.tip.copy(tgt);
  }

  handleSpearInput() {
    const g = this.game;
    const latched = this.spearShots.find((s) => s.fuse > 0 || s.age > 0.14);
    if (latched) {
      g.scene.remove(latched.mesh);
      g.explode(latched.pos, latched.owner);
      const idx = this.spearShots.indexOf(latched);
      if (idx >= 0) this.spearShots.splice(idx, 1);
      return;
    }
    this.fireSpear();
  }

  fireSpear() {
    const g = this.game;
    if (this.spears <= 0) {
      const rem = Math.max(1, Math.ceil(20 - this.spearRegenT));
      g.hud.toast(`<span style="font-size:17px">NO SPEARS — Supply Depot or Resupply in ${rem}s</span>`, 1.1);
      g.audio.click();
      return;
    }
    if (this.spearCd > 0) return;
    this.spears--;
    this.spearCd = 0.45;
    this.model.triggerSpearAnim();

    let lockTarget = this.lock?.alive ? this.lock : null;
    if (!lockTarget && this.aim?.collider?.owner?.alive) lockTarget = this.aim.collider.owner;
    const dir = lockTarget
      ? _v.subVectors(lockTarget.nape.c, this.pos).setY(0.25).normalize()
      : this.aim
        ? _v.copy(this.aim.point).sub(this.pos).normalize()
        : _v.copy(g.cam.forward);

    const mesh = new THREE.Mesh(
      Player.spearGeo || (Player.spearGeo = (() => {
        const g2 = new THREE.CylinderGeometry(0.055, 0.07, 1.85, 8);
        g2.rotateX(Math.PI / 2);
        return g2;
      })()),
      Player.spearMat || (Player.spearMat = new THREE.MeshStandardMaterial({ color: '#383430', emissive: '#ff6428', emissiveIntensity: 1.0, roughness: 0.4 })),
    );
    mesh.position.copy(this.pos).addScaledVector(dir, 1.3).add(_v2.set(0, -0.15, 0));
    mesh.lookAt(_v2.copy(mesh.position).add(dir));
    g.scene.add(mesh);
    this.spearShots.push({
      pos: mesh.position.clone(),
      vel: dir.clone().multiplyScalar(68).addScaledVector(this.vel, 0.3),
      mesh,
      fuse: -1,
      age: 0,
      beepT: 0,
      homingTarget: lockTarget,
      owner: null,
      anchor: new THREE.Vector3(),
      ja: null,
      local: new THREE.Vector3(),
    });
    g.audio.rocketLaunch();
    g.cam.shake(0.2);
    g.cam.impactFov = Math.max(g.cam.impactFov, 1.5);
    g.vfx.burst(this.pos, _v3.copy(dir).negate(), 8);
    this.vel.addScaledVector(dir, -2.0);
  }

  updateSpears(dt) {
    const g = this.game;
    for (let i = this.spearShots.length - 1; i >= 0; i--) {
      const s = this.spearShots[i];
      s.age += dt;
      if (s.fuse >= 0) {
        s.fuse -= dt;
        s.beepT -= dt;
        if (s.ja && s.owner?.alive) s.pos.copy(s.local).applyMatrix4(s.ja.matrixWorld);
        else if (s.owner?.alive) s.pos.copy(s.anchor);
        if (s.beepT <= 0 && s.fuse > 0.04) {
          s.beepT = Math.max(0.07, s.fuse * 0.28);
          g.audio.fuseBeep(s.pos, 1 + (0.65 - s.fuse));
          g.vfx.flash(s.pos, 1.5, VFX_COLORS.KILL_FLASH);
        }
        if (s.fuse <= 0) {
          g.scene.remove(s.mesh);
          g.explode(s.pos, s.owner);
          this.spearShots.splice(i, 1);
        } else s.mesh.position.copy(s.pos);
        continue;
      }

      s.vel.y -= 3.5 * dt;
      let best = s.homingTarget?.alive ? s.homingTarget : null;
      if (!best) {
        let bd = 42;
        _v.copy(s.vel).normalize();
        for (let k = 0; k < g.titans.length; k++) {
          const t = g.titans[k];
          if (!t.alive) continue;
          _v2.subVectors(t.nape.c, s.pos);
          const d = _v2.length();
          if (d < bd && d > 1e-3 && _v2.dot(_v) / d > 0.42) { bd = d; best = t; }
        }
      }
      if (best) {
        _v2.copy(best.nape.c).sub(s.pos).normalize();
        const sp = Math.min(82, s.vel.length() + 28 * dt);
        s.vel.normalize().lerp(_v2, Math.min(1, 11 * dt)).normalize().multiplyScalar(sp);
      }

      _v.copy(s.vel).normalize();
      g.vfx.rocketExhaust(s.pos, _v);

      const len = s.vel.length() * dt;
      if (len > 0) {
        const hit = g.world.col.raycast(s.pos, _v, len, { dynamics: true, inflate: 1.8 }, _spearRayHit);
        if (hit) {
          s.pos.copy(hit.point);
          if (hit.collider?.owner) {
            s.owner = hit.collider.owner;
            s.anchor.copy(hit.point);
            s.fuse = 0.58;
            s.beepT = 0;
            if (hit.collider.ja) {
              s.ja = hit.collider.ja;
              s.local.copy(hit.point);
              s.ja.worldToLocal(s.local);
            }
            s.mesh.position.copy(s.pos);
            g.vfx.sparks(s.pos, 14);
            g.hud.toast('<span style="font-size:17px;color:#ffb878">SPEAR LATCHED — PRESS SPEAR KEY TO DETONATE!</span>', 0.65);
          } else {
            g.scene.remove(s.mesh); g.explode(hit.point, null); this.spearShots.splice(i, 1); continue;
          }
        } else s.pos.addScaledVector(_v, len);
      }
      s.mesh.position.copy(s.pos);
      s.mesh.lookAt(_v2.copy(s.pos).add(s.vel));
      if (s.pos.y < 0.3 || s.age > 5) {
        g.scene.remove(s.mesh); g.explode(s.pos, null); this.spearShots.splice(i, 1);
      }
    }
  }

  physics(dt, control) {
    const g = this.game, inp = g.input, cam = g.cam;
    const v = this.vel, p = this.pos;
    const fwd = _v3.copy(cam.forwardFlat);
    const mx = control ? (inp.action('right') ? 1 : 0) - (inp.action('left') ? 1 : 0) : 0;
    const mz = control ? (inp.action('forward') ? 1 : 0) - (inp.action('back') ? 1 : 0) : 0;
    _wish.set(0, 0, 0).addScaledVector(fwd, mz).addScaledVector(cam.rightFlat, mx);
    if (_wish.lengthSq() > 1) _wish.normalize();

    const reel = control && inp.action('reel');
    const reelPressed = control && inp.actionPressed('reel');
    const gasHeld = control && inp.action('boost');
    const gasPressed = control && inp.actionPressed('boost');
    let gasUse = 0;
    this.gasOn = false;
    this.reeling = false;
    this.gasSide = 0;
    this.rising = false;

    this.mantleCD = Math.max(0, this.mantleCD - dt);
    this.impactT = Math.max(0, this.impactT - dt);

    if (control && this.impactT > 0 && reelPressed && this.impactN) {
      const kick = clamp((this.impactSpeed || 18) * 0.58, 10, 19);
      v.addScaledVector(this.impactN, kick);
      if (this.impactN.y < 0.5) v.y = Math.max(v.y, 5.5);
      this.grounded = false; this.coyoteT = 0; this.impactT = 0;
      g.vfx.burst(p, this.impactN, 10); g.audio.jump(); g.cam.shake(0.14); g.cam.impactFov = Math.max(g.cam.impactFov, 2.0);
    }

    if (this.gasReload > 0) {
      this.gasReload -= dt;
      if (this.gasReload <= 0) {
        this.gas = 100; this.gasCylinders = Math.max(1, this.gasCylinders - 1);
        g.hud.toast('<span style="font-size:17px">GAS CANISTER LOCKED</span>', 0.7);
      }
    } else if (control && (inp.actionPressed('reloadGas') || this.gas <= 0) && this.gasCylinders > 1 && this.gas < 95) {
      this.gas = 0; this.gasReload = this.className === 'light' ? 0.65 : this.className === 'heavy' ? 1.05 : 0.85;
      g.hud.toast('<span style="font-size:17px">SWAPPING GAS CANISTER…</span>', this.gasReload);
    }

    const attCount = this.attachedCount;
    const lockDist = this.lock?.alive ? this.pos.distanceTo(this.lock.nape.c) : Infinity;
    const combatBoost = gasHeld && lockDist < 90 && mz >= 0;
    const gravityScale = this.execLungeT > 0 ? 0.14 : attCount ? 0.62 : (gasHeld && this.gas > 0 && v.length() > 14 ? 0.84 : 1.0);
    v.y -= TUNE.gravity * gravityScale * dt;
    this.coyoteT = this.grounded ? 0.15 : Math.max(0, this.coyoteT - dt);

    if (this.grounded && !attCount) {
      const sp = TUNE.runSpeed * this.classDef.speed * (gasHeld && this.gas > 0 ? 1.38 : 1);
      const tx = _wish.x * sp, tz = _wish.z * sp;
      const k = _wish.lengthSq() > 0 ? 14 : (Math.hypot(v.x, v.z) > 14 ? 1.6 : 9);
      v.x = damp(v.x, tx, k, dt); v.z = damp(v.z, tz, k, dt);
      if (reelPressed) {
        v.y = TUNE.jump; this.grounded = false; g.audio.jump(); g.cam.shake(0.04); g.cam.impactFov = Math.max(g.cam.impactFov, 1.0);
      }
    } else {
      const steerForce = attCount ? TUNE.swingSteer : TUNE.airSteer;
      v.addScaledVector(_wish, steerForce * this.classDef.steer * dt);
      if (this.coyoteT > 0 && reelPressed && !attCount) {
        v.y = TUNE.jump; this.coyoteT = 0; g.audio.jump(); g.cam.shake(0.04); g.cam.impactFov = Math.max(g.cam.impactFov, 1.0);
      }
    }

    this.wallRun = false; this.climbing = false;
    if (this.wallT > 0) this.wallT -= dt;
    if (this.grounded) this.climbT = 0;
    if (this.wallT > 0 && control && !this.grabbedBy) {
      const n = this.wallN;
      if (!this.grounded && reelPressed) {
        const vn = v.dot(n); if (vn < 0) v.addScaledVector(n, -vn);
        v.addScaledVector(n, 11.5); v.y = Math.max(v.y, 0) + 8.8;
        this.wallT = 0; g.audio.jump(); g.cam.shake(0.14);
      } else if (mz > 0) {
        const into = -(_wish.x * n.x + _wish.z * n.z);
        if (into > 0.7 && this.climbT < 1.5) {
          this.climbing = true; this.climbT += dt;
          v.y = damp(v.y, 9.5, 8, dt);
          v.x = damp(v.x, -n.x * 2, 6, dt); v.z = damp(v.z, -n.z * 2, 6, dt);
        } else {
          const along = Math.hypot(v.x - n.x * v.dot(n), v.z - n.z * v.dot(n));
          if (along > 4 && !this.grounded) {
            this.wallRun = true;
            v.y += TUNE.gravity * 0.78 * dt; if (v.y < -3) v.y = damp(v.y, -3, 6, dt);
            v.addScaledVector(n, -4 * dt);
          }
        }
      }
    }

    const thrustMult = this.classDef.thrust * this.mods.thrustBonus;
    const brake = gasHeld && mz < 0 && mx === 0 && !this.grounded && Math.hypot(v.x, v.z) > 1.5;
    this.braking = brake && this.gas > 0;
    this.diving = false;

    if (this.braking) {
      const rate = 56 * dt, hs = Math.hypot(v.x, v.z);
      if (hs > 1e-3) { const k = Math.max(0, hs - rate) / hs; v.x *= k; v.z *= k; }
      if (v.y < 0) v.y += Math.min(-v.y, rate * 0.45);
      else v.y = Math.max(0, v.y - rate);
      gasUse += 4.5 * dt; this.gasOn = true;
    } else if (gasHeld && this.gas > 0 && !this.grounded && !attCount && reel) {
      _v.copy(_wish).multiplyScalar(0.42); _v.y = -1; _v.normalize();
      const curSpd = v.length();
      const targetSpd = Math.min(TUNE.boostCap * this.classDef.speed, curSpd + (curSpd * 0.5 + 14) * thrustMult * dt);
      if (curSpd > 2) {
        _v2.copy(v).divideScalar(curSpd).lerp(_v, 1 - Math.exp(-4.5 * dt)).normalize();
        v.copy(_v2).multiplyScalar(targetSpd);
      } else {
        v.addScaledVector(_v, 16 * dt);
      }
      gasUse += 4.2 * dt; this.gasOn = true; this.diving = true;
    } else if (gasHeld && this.gas > 0 && (!this.grounded || attCount)) {
      let dir;
      if (combatBoost && mx === 0) {
        const t = this.lock;
        const front = _v2.set(Math.sin(t.heading), 0, Math.cos(t.heading));
        const fromTitan = _v3.subVectors(p, t.root.position); fromTitan.y = 0;
        const frontApproach = fromTitan.dot(front) > 0.15 * Math.max(1, fromTitan.length()) && lockDist > 12;
        if (frontApproach) {
          const side = _v4.set(front.z, 0, -front.x);
          if (fromTitan.dot(side) < 0) side.negate();
          _v.copy(t.nape.c).addScaledVector(side, 6.5 * t.s); _v.y += 1.6 * t.s;
          dir = _v.sub(p);
        } else dir = _v.subVectors(t.nape.c, p);
      } else {
        dir = _v.copy(cam.forward);
        if (_wish.lengthSq() > 0.01) dir.addScaledVector(_wish, 1.35);
        dir.y = clamp(dir.y, -0.55, 0.42);
      }
      dir.normalize();
      if (mx !== 0) this.gasSide = -mx;

      const curSpd = v.length();
      const horizSpd = Math.hypot(v.x, v.z);
      const driveSpd = attCount ? curSpd : horizSpd;
      const maxSpd = TUNE.boostCap * this.classDef.speed * this.mods.thrustBonus;
      const turnRate = (mx !== 0 || mz !== 0 ? 4.8 : 3.4) * this.classDef.steer;
      if (driveSpd > 6.0 && curSpd > 1.2) {
        _v2.copy(v).divideScalar(curSpd).lerp(dir, 1 - Math.exp(-turnRate * dt)).normalize();
        const multGain = Math.max(0, driveSpd - 5.0) * TUNE.boostRate * thrustMult;
        const nextSpd = Math.min(maxSpd, curSpd + (multGain + TUNE.boostFloor) * dt);
        v.copy(_v2).multiplyScalar(nextSpd);
      } else {
        v.addScaledVector(dir, TUNE.boostFloor * 2.2 * dt);
      }
      gasUse += 5.2 * dt; this.gasOn = true;
    }

    if (gasHeld && this.gas <= 0 && !this.grounded) {
      this.gasDryT = (this.gasDryT || 0) - dt;
      if (this.gasDryT <= 0) { this.gasDryT = 0.55; g.audio.empty(); }
    }

    if (gasPressed && this.dashCD <= 0 && this.gas > 4 && !this.grounded) {
      let dir;
      if (combatBoost && mx === 0 && mz >= 0) {
        const t = this.lock;
        const front = _v2.set(Math.sin(t.heading), 0, Math.cos(t.heading));
        const fromTitan = _v3.subVectors(p, t.root.position); fromTitan.y = 0;
        if (fromTitan.dot(front) > 0.15 * Math.max(1, fromTitan.length()) && lockDist > 12) {
          const side = _v4.set(front.z, 0, -front.x);
          if (fromTitan.dot(side) < 0) side.negate();
          _v.copy(t.nape.c).addScaledVector(side, 6.5 * t.s); _v.y += 1.6 * t.s;
          dir = _v.sub(p);
        } else dir = _v.subVectors(t.nape.c, p);
      } else {
        dir = _wish.lengthSq() > 0.01 ? _v.copy(_wish).addScaledVector(cam.forward, 0.35) : _v.copy(cam.forward);
        dir.y = clamp(dir.y + 0.08, -0.35, 0.36);
      }
      dir.normalize();
      const curSpd = v.length();
      const boostedSpd = Math.min(TUNE.boostCap * this.classDef.speed, Math.max(curSpd * 1.16, curSpd + 5.5));
      if (curSpd > 1) {
        _v2.copy(v).divideScalar(curSpd).lerp(dir, 0.65).normalize();
        v.copy(_v2).multiplyScalar(boostedSpd);
      } else {
        v.copy(dir).multiplyScalar(6.5);
      }
      this.dashCD = 0.42; gasUse += 2.6; g.onDash(dir);
    }

    for (let i = 0; i < 2; i++) {
      const h = this.hooks[i];
      if (h.state !== 'attached') continue;
      const a = this.anchorOf(h, _v);
      _n.subVectors(a, p);
      const dist = _n.length();
      if (dist < 1e-3) continue;
      _n.divideScalar(dist);
      const rangePull = dist > 125 ? clamp(1 - (dist - 125) / 80, 0.55, 1) : 1;

      const basePull = (attCount > 1 ? TUNE.swingPull * 1.25 : TUNE.swingPull * 0.85) * rangePull / attCount;
      v.addScaledVector(_n, basePull * dt);

      if (attCount === 1 && !this.grounded && _n.y > 0.12) {
        const vr = v.dot(_n);
        _v2.copy(v).addScaledVector(_n, -vr);
        const tanSpd = _v2.length();
        if (tanSpd > 2.5 && tanSpd < 44) {
          _v2.divideScalar(tanSpd);
          v.addScaledVector(_v2, TUNE.swingPump * clamp(_n.y * 1.4, 0.25, 1.0) * dt);
        }
      }

      if (reel) {
        const vr = v.dot(_n);
        this.reeling = true;
        const maxReel = TUNE.reelMax * this.mods.thrustBonus;
        if (vr < maxReel) {
          v.addScaledVector(_n, TUNE.reelAccel * rangePull * thrustMult * dt / attCount * (attCount > 1 ? 1.32 : 1.05));
        }
        if (vr > 26 && this.gas > 0) {
          gasUse += 1.0 * dt / attCount;
          this.gasOn = true;
        }
        if (dist < 7 && vr > 0) v.addScaledVector(_n, -vr * Math.min(1, dt * (7 - dist) * 1.4));
      }

      h.len = Math.min(h.len, dist);
      h.len = Math.max(1.8, h.len - dt * (reel ? 4.8 : attCount > 1 ? 2.4 : 1.2));
      h.tension = 0;
      if (dist > h.len) {
        const vr = v.dot(_n);
        if (vr < 0) {
          v.addScaledVector(_n, -vr);
          h.tension = -vr;
        }
        p.addScaledVector(_n, (dist - h.len) * 0.82);
      }
      if (dist < 2.2 && !this.grounded && h.owner == null) h.len = Math.max(h.len, 2.0);
    }

    if (g.mode === 'training') gasUse *= 0.25;
    this.gas = Math.max(0, this.gas - gasUse * this.mods.gasSaver);
    const sp = v.length();
    if (!this.grounded) v.multiplyScalar(1 - Math.min(0.4, 0.00042 * sp * dt * 60) * dt * 2);
    if (sp > 64) v.multiplyScalar(1 - Math.min(0.5, (sp - 64) * 0.03 * dt));
    p.addScaledVector(v, dt);

    const r2d = Math.hypot(p.x, p.z);
    if (r2d > 386) {
      const nx = p.x / r2d, nz = p.z / r2d;
      v.x -= nx * ((r2d - 386) * 6 + 22) * dt;
      v.z -= nz * ((r2d - 386) * 6 + 22) * dt;
      if (r2d > 430) { p.x = nx * 430; p.z = nz * 430; }
      if (g.elapsed - (this._oobWarn || -9) > 4) {
        this._oobWarn = g.elapsed;
        g.hud.toast('<span style="font-size:18px">RETURN TO THE COMBAT ZONE!</span>', 1.3);
      }
    }
    this.collide(dt);
  }

  collide(dt) {
    const g = this.game, p = this.pos, v = this.vel;
    const col = g.world.col;
    const wasGround = this.grounded;
    this.grounded = false;
    col.nearby(p, near);
    for (let i = 0; i < col.dynamics.length; i++) {
      const c = col.dynamics[i];
      if (!c.owner || c.owner.root.position.distanceToSquared(p) < 3600) near.push(c);
    }
    const r = TUNE.radius;
    let maxHit = 0;
    let hitHouse = null;
    for (let pass = 0; pass < 2; pass++) {
      for (let s = 0; s < 2; s++) {
        const cy = s === 0 ? -0.5 : 0.25;
        _v.set(p.x, p.y + cy, p.z);
        if (_v.y < r) {
          const pen = r - _v.y; p.y += pen; _v.y += pen;
          const vn = v.y;
          if (vn < 0) { if (-vn > maxHit) { maxHit = -vn; this.impactN.copy(UP); } v.y = 0; this.applyFriction(UP, -vn); }
          this.grounded = true; this.groundN.copy(UP);
        }
        for (let i = 0; i < near.length; i++) {
          const c = near[i];
          const pen = c.sphere(_v, r, _n);
          if (pen > 0) {
            p.addScaledVector(_n, pen); _v.addScaledVector(_n, pen);
            const vn = v.dot(_n);
            if (vn < 0) {
              const attackingFlesh = c.owner && (this.slashT >= 0 || this.spin > 0 || this.execLungeT > 0);
              const impact = -vn * (c.owner ? 0.4 : 1);
              if (impact > maxHit) {
                maxHit = impact;
                this.impactN.copy(_n);
                if (c.house) hitHouse = c.house;
              }
              v.addScaledVector(_n, -vn * (attackingFlesh ? 0.45 : c.owner ? 1.05 : 1.0));
              if (!attackingFlesh) this.applyFriction(_n, -vn);
            }
            if (_n.y > 0.55) { this.grounded = true; this.groundN.copy(_n); }
            else if (Math.abs(_n.y) < 0.35 && !c.owner) {
              this.wallN.copy(_n); this.wallT = 0.24;
              if (this.mantleCD <= 0 && g.input.action('forward') && (v.y > 0.5 || this.hooked)) {
                _v3.copy(p).addScaledVector(_n, 0.25); _v3.y += 1.45;
                _v4.copy(_n).negate();
                const upper = col.raycast(_v3, _v4, 1.25, { dynamics: false }, _mantleRayHit);
                if (!upper) {
                  p.y += 0.65; p.addScaledVector(_n, -0.55);
                  v.y = Math.max(v.y, 4.8); v.addScaledVector(_n, -2.5);
                  this.mantleCD = 0.35; g.cam.shake(0.04); g.cam.impactFov = Math.max(g.cam.impactFov, 0.7);
                }
              }
            }
          }
        }
      }
    }
    let rolled = false;
    if (this.grounded && !wasGround) {
      rolled = tryLandingRoll(this, maxHit);
      g.onLand(rolled ? maxHit * 0.35 : maxHit);
      this.airTime = 0;
    }
    if (maxHit > 19 && this.impactN && !rolled) {
      this.impactT = 0.3; this.impactSpeed = maxHit;
      g.cam.impactFov = Math.max(g.cam.impactFov, clamp(maxHit * 0.04, 0.8, 2.2));
      g.vfx.sparks(p, Math.min(12, Math.floor(maxHit * 0.28)));
    }
    if (hitHouse && maxHit > 26) {
      _v2.copy(this.impactN).negate();
      g.world.damageHouse(hitHouse, p, _v2, maxHit * 1.85);
    }
    if (!this.grounded) this.airTime += dt;

    const effHit = rolled ? maxHit * 0.2 : maxHit;
    if (effHit > 25 && this.invuln <= 0) {
      const crashDmg = effHit <= 42
        ? Math.round((effHit - 23) * 0.85)
        : Math.round(16 + (effHit - 42) * 1.5);
      this.damage(crashDmg, 'crash');
      if (effHit > 38) g.onCrash(effHit);
      else g.onBump(effHit);
      this.invuln = 0.55;
    } else if (effHit > 15 && !this.grounded) {
      g.onBump(effHit);
    }
  }

  applyFriction(n, vn) {
    const v = this.vel;
    const tan = _v2.copy(v).addScaledVector(n, -v.dot(n));
    const ts = tan.length();
    if (ts < 1e-4) return;
    const fr = this.grounded && n.y > 0.55 ? (Math.hypot(v.x, v.z) > 14 ? 0.03 : 0.12) : 0.04;
    v.addScaledVector(tan, -Math.min(1, fr * vn / ts * 4));
  }

  startSlash() {
    if (this.blade <= 0) {
      if (this.bladeSets > 0) this.swapBlades();
      else { this.game.hud.flash('blades'); this.game.audio.click(); return; }
    }
    this.slashT = 0;
    this.slashHits.clear();
    this.slashSide = -this.slashSide || 1;
    this.game.audio.slash(this.speed);
    _v.copy(this.pos).addScaledVector(this.game.cam.forward, 1.4);
    this.game.vfx.slashArc(_v, this.game.cam.camera.quaternion, 2.2);
    if (this.lock?.alive) {
      _v.subVectors(this.lock.nape.c, this.pos);
      const d = _v.length();
      if (d < 28 && d > 0.6) {
        this.execTarget = this.lock;
        this.execLungeT = clamp(d / 44, 0.14, 0.34);
        _v.divideScalar(d);
        const boostSpd = Math.max(this.vel.length() + 8, 34);
        _v2.copy(_v).multiplyScalar(boostSpd);
        this.vel.lerp(_v2, 0.6);
        this.strikeSpeed = Math.max(this.strikeSpeed, boostSpd);
      }
    }
  }

  combat(dt) {
    const g = this.game;
    if (this.slashT >= 0) {
      this.slashT += dt / TUNE.slashTime;
      if (this.slashT > 1) this.slashT = -1;
    }
    if (this.spin > 0) this.spin -= dt;
    const active = (this.slashT > 0.1 && this.slashT < 0.92) || this.spin > 0 || this.execLungeT > 0;
    if (!active || this.blade <= 0) return;
    const reach = TUNE.reach * (this.spin > 0 ? 1.45 : this.execLungeT > 0 ? 1.32 : 1);
    const relV = Math.max(this.vel.length(), this.strikeSpeed || 0);
    for (let i = 0; i < g.titans.length; i++) {
      const t = g.titans[i];
      if (!t.alive || this.slashHits.has(t)) continue;
      const dN = t.nape.c.distanceTo(this.pos);
      if (dN < t.nape.r + reach) {
        this.slashHits.add(t);
        this.execLungeT = 0;
        _v.subVectors(t.nape.c, this.pos).setY(0.3).normalize();
        const back = _v2.set(-Math.sin(t.heading), 0, -Math.cos(t.heading));
        const angle = clamp(-_v.dot(back) * 0.5 + 0.5, 0, 1);
        let dmg = 145 + relV * relV * 0.62 + relV * 8;
        dmg *= (this.spin > 0 ? 1.7 : 1) * (0.85 + angle * 0.45);
        dmg = Math.round(dmg * this.classDef.damage * this.mods.damageBonus);
        const heavy = relV > 28 || this.spin > 0;
        const r = t.hit('nape', dmg, t.nape.c, this.vel, 0, { heavy });
        this.useBlade(r.result === 'kill' ? 11 : r.result === 'armor' ? 14 : 8);
        if (r.result === 'kill') {
          this.gas = Math.min(100, this.gas + 16);
          this.hp = Math.min(100, this.hp + 10);
          t.head.getWorldPosition(_v2);
          _v.subVectors(this.pos, _v2).setY(0);
          if (_v.lengthSq() > 1e-4) {
            _v.normalize();
            const into = this.vel.dot(_v);
            if (into < 0) this.vel.addScaledVector(_v, -into * 0.85);
          }
          if (!this.grounded) this.vel.y = Math.max(this.vel.y, 9);
        }
        g.onSlashHit(t, r.result, r.armorDmg || dmg, t.nape.c.clone());
        continue;
      }
      let best = null, bestD = reach;
      for (let k = 0; k < t.parts.length; k++) {
        const c = t.parts[k];
        closestPointOnSegment(this.pos, c.a, c.b, _v);
        const d = _v.distanceTo(this.pos) - c.r;
        if (d < bestD) { bestD = d; best = c; _v3.copy(_v); }
      }
      if (best && best.part !== 'torso') {
        this.slashHits.add(t);
        const dmg = Math.round((85 + relV * 9) * this.classDef.damage * this.mods.damageBonus);
        const r = t.hit(best.part, dmg, _v3, this.vel, best.side);
        this.useBlade(5);
        g.onSlashHit(t, r.result, dmg, _v3.clone());
      }
    }
  }

  useBlade(n) {
    if (this.game.mode === 'training') n *= 0.2;
    this.blade = Math.max(0, this.blade - n * this.mods.bladeSaver);
    if (this.blade <= 0) { this.game.hud.flash('blades'); this.game.audio.bladeBreak(); }
  }
  swapBlades() {
    if (this.bladeSets <= 0 || this.blade >= 100) return;
    this.bladeSets--;
    this.blade = 100;
    this.model.triggerReloadAnim();
    this.game.audio.bladeSwap();
    this.game.hud.flash('swap');
  }

  depot(dt) {
    const maxSp = this.maxSpears;
    for (let i = 0; i < this.game.world.depots.length; i++) {
      const d = this.game.world.depots[i];
      if (Math.hypot(this.pos.x - d.pos.x, this.pos.z - d.pos.z) < d.radius && Math.abs(this.pos.y - d.pos.y) < 5) {
        const before = this.gas + this.gasCylinders * 100 + this.bladeSets + this.hp + this.spears * 20;
        this.gas = Math.min(100, this.gas + dt * 55);
        this.gasCylinders = this.classDef.cylinders;
        this.gasReload = 0;
        this.spears = maxSp;
        this.spearRegenT = 0;
        this.hp = Math.min(100, this.hp + dt * 18);
        if (this.bladeSets < this.classDef.blades && (this._dt = (this._dt || 0) + dt) > 0.3) { this._dt = 0; this.bladeSets++; }
        if (this.blade <= 0 && this.bladeSets > 0) this.swapBlades();
        else this.blade = Math.min(100, this.blade + dt * 40);
        if (this.gas + this.gasCylinders * 100 + this.bladeSets + this.hp + this.spears * 20 > before + 0.01) {
          this.game.hud.resupply(d.name);
          this._refillT = (this._refillT || 0) - dt;
          if (this._refillT <= 0) { this._refillT = 0.9; this.game.audio.refill(d.pos); }
        }
      }
    }
  }

  updateGrabbed(dt) {
    const t = this.grabbedBy;
    t.handPos(t.grabSide, this.pos);
    this.vel.set(0, 0, 0);
    const inp = this.game.input;
    if (inp.mouse.lPressed || inp.actionPressed('reel')) {
      this.struggle += 0.26;
      this.game.audio.struggle();
      this.game.cam.shake(0.22);
    }
    this.struggle = Math.max(0, this.struggle - dt * 0.08);
    if (this.struggle >= 1 && (this.blade > 0 || this.bladeSets > 0)) {
      if (this.blade <= 0) this.swapBlades();
      this.useBlade(18);
      t.hit('arm', 150, this.pos, UP, t.grabSide === 1 ? 1 : -1);
      this.game.onSlashHit(t, 'arm', 120, this.pos.clone());
      this.releaseGrab(t);
      t.setState('chase'); t.cooldown = 3.2;
    }
    this.animate(dt);
  }

  animate(dt) {
    const v = this.vel;
    this.speed = v.length();
    const att = this.hooked;
    const fwd = _v.set(v.x, this.grounded ? 0 : v.y * 0.55, v.z);
    if (fwd.lengthSq() < 0.5) fwd.copy(this.game.cam.forwardFlat);
    fwd.normalize();
    const fpView = this.game.cam.isFP();
    const leanDir = fpView ? _v4.copy(fwd) : fwd;
    if (fpView && !this.grabbedBy) fwd.copy(this.game.cam.forwardFlat);
    if (dt > 0) {
      _v3.subVectors(v, this.vPrev).divideScalar(dt);
      if (_v3.lengthSq() > 40000) _v3.setLength(200);
      this.accS.lerp(_v3, 1 - Math.exp(-7.5 * dt));
      this.vPrev.copy(v);
    }
    const up = _v2.copy(UP);
    if (!this.grounded) {
      const f = _v3.copy(this.accS); f.y += TUNE.gravity;
      const fl = f.length();
      up.multiplyScalar(0.62);
      if (fl > 1e-3) up.addScaledVector(f, Math.min(fl / TUNE.gravity, 1.5) * 0.65 / fl);
      up.addScaledVector(leanDir, clamp(this.speed / 36, 0, 0.72));
      if (up.lengthSq() < 1e-4) up.set(0, 1, 0);
      up.normalize();
      if (fpView) { up.addScaledVector(fwd, -up.dot(fwd)); if (up.lengthSq() < 1e-4) up.set(0, 1, 0); up.normalize(); }
    }
    if (this.grabbedBy) { fwd.set(Math.sin(this.grabbedBy.heading), 0, Math.cos(this.grabbedBy.heading)).negate(); up.copy(UP); }
    else if (this.climbing && this.wallN) { fwd.set(-this.wallN.x, 0, -this.wallN.z).normalize(); up.copy(UP); }
    else if (this.wallRun && this.wallN) { up.copy(UP).addScaledVector(this.wallN, 0.4).normalize(); }
    const right = _n.crossVectors(up, fwd);
    if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
    right.normalize();
    const f2 = _v3.crossVectors(right, up).normalize();
    _m.makeBasis(right, up, f2);
    _q.setFromRotationMatrix(_m);
    this.quat.slerp(_q, 1 - Math.exp(-(this.grounded ? 14 : 7.5) * dt));
    _v.set(0, this.grounded ? -0.05 : 0, 0).add(this.pos);
    const rawLat = v.dot(this.game.cam.rightFlat);
    const rawFwd = v.dot(this.game.cam.forwardFlat);
    this.smoothLat = damp(this.smoothLat || 0, rawLat, 7.5, dt);
    this.smoothFwd = damp(this.smoothFwd || 0, rawFwd, 7.5, dt);
    this.model.update(dt, _v, this.quat, {
      grounded: this.grounded && !att,
      speed: this.grounded ? Math.hypot(v.x, v.z) : this.speed,
      vel: v,
      latVel: this.smoothLat,
      fwdVel: this.smoothFwd,
      lookSwayX: this.game.cam.swayYaw || 0,
      lookSwayY: this.game.cam.swayPitch || 0,
      charge: this.charge,
      wall: this.climbing ? 'climb' : this.wallRun ? 'run' : null,
      hooked: att,
      spin: this.spin > 0 || this.charge > 0.4,
      slashT: this.slashT,
      slashSide: this.slashSide || 1,
      grabbed: !!this.grabbedBy,
      invuln: this.invuln,
      fp: fpView,
      pitch: this.game.cam.pitch,
      spears: this.spears,
      blade: this.blade,
    });
  }
}
