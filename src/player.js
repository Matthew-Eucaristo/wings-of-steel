import * as THREE from 'three';
import { PlayerModel } from './playerModel.js';
import { clamp, damp, lerp, closestPointOnSegment } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _n = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const near = [];
const CLASSES = {
  light: { cylinders: 2, blades: 4, spears: 1, speed: 1.12, steer: 1.15, thrust: 1.08, damage: 1.12 },
  balanced: { cylinders: 4, blades: 6, spears: 2, speed: 1, steer: 1, thrust: 1, damage: 1 },
  heavy: { cylinders: 6, blades: 8, spears: 4, speed: 0.86, steer: 0.82, thrust: 0.9, damage: 0.94 },
};

export const TUNE = {
  gravity: 21, hookRange: 160, hookSpeed: 260, reelAccel: 46, reelMax: 46, gasThrust: 34, dashImpulse: 15,
  airSteer: 9, swingSteer: 16, runSpeed: 10, jump: 9, radius: 0.42, slashTime: 0.34, reach: 2.6,
};

class Hook {
  constructor(side) { this.side = side; this.state = 'none'; this.tip = new THREE.Vector3(); this.target = new THREE.Vector3(); this.len = 0; this.joint = null; this.local = new THREE.Vector3(); this.owner = null; this.t = 0; this.tension = 0; }
}

export class Player {
  constructor(game) {
    this.game = game;
    this.model = new PlayerModel(game.scene);
    this.pos = game.world.playerSpawn.clone();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.hooks = [new Hook(-1), new Hook(1)];
    this.spearShots = [];
    this.grounded = false; this.groundN = new THREE.Vector3(0, 1, 0);
    this.hp = 100; this.gas = 100; this.blade = 100; this.dead = false;
    this.slashT = -1; this.slashHits = new Set(); this.spin = 0; this.charge = 0;
    this.dashCD = 0; this.invuln = 0; this.grabbedBy = null; this.struggle = 0;
    this.gasOn = false; this.speed = 0; this.aim = null; this.lock = null; this.hookMode = 'auto';
    this.combo = 0; this.comboT = 0; this.airTime = 0; this.lastImpact = 0;
    this.yawFace = 0;
    this.applyClass(game.playerClass || 'balanced', true);
  }

  applyClass(name, refill = false) {
    this.className = CLASSES[name] ? name : 'balanced';
    this.classDef = CLASSES[this.className];
    if (refill) {
      this.gas = 100; this.gasCylinders = this.classDef.cylinders; this.bladeSets = this.classDef.blades; this.spears = this.classDef.spears;
      this.gasReload = 0;
    }
  }

  get hooked() { return this.hooks.some((h) => h.state === 'attached'); }

  anchorOf(h, out) {
    if (h.joint) return out.copy(h.local).applyMatrix4(h.joint.matrixWorld);
    if (h.owner?.alive && h.owner.nape) return out.copy(h.owner.nape.c);
    return out.copy(h.target);
  }

  fire(h) {
    const g = this.game;
    const aim = this.aim;
    const cam = g.cam;
    if (!aim && !this.lock) { g.hud.flash('no-anchor'); g.audio.click(); return; }
    const from = this.model.gearPos(h.side, _v2);
    let hit;
    // combat soft-lock: a nearby centered titan can be hooked even when the raw crosshair sees sky
    if (this.lock) {
      _v3.subVectors(this.lock.nape.c, from); const nd = _v3.length();
      if (nd > 1e-3 && nd <= TUNE.hookRange) {
        _v3.divideScalar(nd);
        const flesh = g.world.col.raycast(from, _v3, nd + 2, { dynamics: true, inflate: 1.65 });
        if (flesh?.collider?.owner === this.lock) hit = flesh;
        else {
          const wall = g.world.col.raycast(from, _v3, nd - 0.5, { dynamics: false });
          if (!wall) hit = { point: this.lock.nape.c.clone(), collider: null, surface: 'flesh', lockOwner: this.lock };
        }
      }
    }
    if (this.hookMode === 'focus') {
      // otherwise both hooks share the exact crosshair anchor: strongest straight-line pull
      if (!hit) hit = aim;
    } else {
      // automatic navigation: each hook searches its half of the intended view for a useful independent anchor
      if (hit) { /* keep combat lock */ } else cam.camera.getWorldDirection(_v3);
      if (!hit) {
        _v3.addScaledVector(cam.right, h.side * 0.16).normalize();
        hit = g.world.col.raycast(cam.camera.position, _v3, TUNE.hookRange + 10, { dynamics: true, inflate: 1.15 });
      }
      if (hit && hit.point.distanceTo(this.pos) > TUNE.hookRange) hit = null;
      // a narrow street may have no side anchor; fall back to a small split around the valid crosshair hit
      if (!hit && !aim) { g.hud.flash('no-anchor'); g.audio.click(); return; }
      if (!hit) {
        const spread = clamp(aim.t * 0.07, 0.3, 4.5) * h.side;
        _v.copy(aim.point).addScaledVector(cam.right, spread);
        _v3.subVectors(_v, from);
        const dist = _v3.length();
        if (dist > 1e-3) _v3.divideScalar(dist);
        hit = g.world.col.raycast(from, _v3, dist + 3, { dynamics: true, inflate: 1.15 });
        if (!hit || hit.t > TUNE.hookRange) hit = aim;
      }
    }
    h.state = 'fly'; h.t = 0;
    h.tip.copy(from);
    h.target.copy(hit.point);
    h.joint = null; h.owner = hit.lockOwner || null;
    const c = hit.collider;
    if (c && c.owner && c.ja) {
      h.joint = c.ja; h.owner = c.owner;
      h.local.copy(hit.point);
      c.ja.worldToLocal(h.local);
    }
    h.surface = hit.surface;
    g.audio.hookFire(h.side);
  }

  release(h) {
    if (h.state === 'none' || h.state === 'ret') return;
    // cable whips back into the gear instead of vanishing
    h.state = 'ret'; h.t = 0; h.joint = null; h.owner = null; h.tension = 0; h.bend = null;
    this.game.audio.hookRetract(h.side);
  }

  updateAim() {
    const g = this.game, cam = g.cam.camera;
    cam.getWorldDirection(_n);
    const hit = g.world.col.raycast(cam.position, _n, TUNE.hookRange + 20, { dynamics: true, inflate: 1.2 });
    if (hit) {
      // must be within range from player too
      const d = hit.point.distanceTo(this.pos);
      hit.t = d;
      this.aim = d <= TUNE.hookRange ? hit : null;
    } else this.aim = null;
    // nape lock-on for HUD and slash assist
    let best = null, bestS = 0.88;
    // hysteresis: once the nape is acquired, keep it while it remains near the centre instead of flickering off
    if (this.lock?.alive && this.lock.state !== 'emerge') {
      _v.subVectors(this.lock.nape.c, cam.position);
      const d = _v.length(), s = d > 0 ? _v.dot(_n) / d : -1;
      if (d <= 160 && s > 0.78) { best = this.lock; bestS = s + 0.04; }
    }
    for (const t of g.titans) {
      if (!t.alive || t.state === 'emerge') continue;
      _v.subVectors(t.nape.c, cam.position);
      const d = _v.length();
      if (d > 160) continue;
      // sticky lock: the current target keeps priority so the marker doesn't flicker between titans
      const s = _v.dot(_n) / d + (t === this.lock ? 0.04 : 0);
      if (s > bestS) { bestS = s; best = t; }
    }
    this.lock = best;
  }

  grab(t) {
    this.grabbedBy = t; this.struggle = 0;
    for (const h of this.hooks) this.release(h);
    this.vel.set(0, 0, 0);
    this.game.onGrabbed();
  }
  releaseGrab(t) {
    if (this.grabbedBy !== t) return;
    this.grabbedBy = null; this.invuln = 1.6;
    _v.set(Math.sin(t.heading), 0.9, Math.cos(t.heading));
    this.vel.copy(_v).multiplyScalar(14);
  }
  eaten(t) { this.grabbedBy = null; this.hp = 0; this.die('eaten'); }
  knockback(dir, spd, dmg) {
    if (this.invuln > 0) return;
    this.vel.addScaledVector(dir, spd); this.damage(dmg, 'swat'); this.invuln = 1;
  }
  damage(d, why) {
    if (this.dead) return;
    this.hp -= d; this.game.onPlayerHurt(d);
    if (this.hp <= 0) { this.hp = 0; this.die(why); }
  }
  die(why) { if (this.dead) return; this.dead = true; for (const h of this.hooks) this.release(h); this.game.onPlayerDeath(why); }

  update(dt) {
    const g = this.game, inp = g.input;
    this.dashCD -= dt; this.invuln -= dt; this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 0;
    this.updateAim();
    if (this.grabbedBy) return this.updateGrabbed(dt);
    if (this.dead) { this.physics(dt, false); this.animate(dt); return; }

    // hooks: Q/E or RMB (both)
    const want = [inp.key('KeyQ') || inp.mouse.r, inp.key('KeyE') || inp.mouse.r];
    for (let i = 0; i < 2; i++) {
      const h = this.hooks[i];
      if (want[i] && (h.state === 'none' || h.state === 'ret') && !h.cool) { this.fire(h); h.cool = true; }
      if (!want[i]) { h.cool = false; this.release(h); }
    }
    // slash / spin charge
    const m = inp.mouse;
    if (m.lPressed && this.slashT < 0 && this.spin <= 0) this.startSlash();
    if (m.l && !this.grounded && this.speed > 14 && this.slashT < 0) this.charge = Math.min(1, this.charge + dt * 2.2);
    if (!m.l && this.charge > 0) {
      if (this.charge > 0.45 && this.blade > 0) { this.spin = 0.55 + this.charge * 0.35; this.slashHits.clear(); g.audio.spin(); }
      this.charge = 0;
    }
    if (inp.pressed('KeyR')) this.swapBlades();
    if (inp.pressed('KeyX')) this.fireSpear();
    this.spearCd = Math.max(0, (this.spearCd || 0) - dt);
    this.updateSpears(dt);

    for (const h of this.hooks) this.updateHook(h, dt);
    const sub = 3;
    for (let i = 0; i < sub; i++) this.physics(dt / sub, true);
    this.combat(dt);
    this.depot(dt);
    this.animate(dt);
  }

  updateHook(h, dt) {
    if (h.state === 'none') return;
    if (h.state === 'ret') {
      const from = this.model.gearPos(h.side, _v);
      _v2.subVectors(from, h.tip);
      const d = _v2.length(), step = (90 + h.t * 900) * dt;
      h.t += dt;
      if (d <= step || h.t > 0.6) { h.state = 'none'; }
      else h.tip.addScaledVector(_v2, step / d);
      return;
    }
    if (h.owner && (h.owner.remove || (!h.owner.alive && h.owner.deadT > 10))) { this.release(h); return; }
    const tgt = this.anchorOf(h, _v);
    if (h.state === 'fly') {
      h.t += dt;
      _v2.subVectors(tgt, h.tip);
      const d = _v2.length();
      const step = TUNE.hookSpeed * dt;
      if (d <= step) {
        h.tip.copy(tgt); h.state = 'attached';
        h.len = h.tip.distanceTo(this.pos);
        // the cable catches with a real 3D tug. Overhead anchors lift immediately, even before gas/reel.
        _v3.subVectors(tgt, this.pos); const al = _v3.length();
        if (al > 1e-3) {
          _v3.divideScalar(al);
          const away = this.vel.dot(_v3);
          if (away < 0) this.vel.addScaledVector(_v3, -away * 0.45);
          this.vel.addScaledVector(_v3, 2.8);
          if (_v3.y > 0.2) this.grounded = false;
        }
        this.game.onHookHit(h);
      } else h.tip.addScaledVector(_v2, step / d);
    } else h.tip.copy(tgt);
  }

  fireSpear() {
    const g = this.game;
    if (this.spears <= 0) { g.hud.toast('<span style="font-size:18px">BOM HABIS — depot hijau</span>', 0.8); g.audio.click(); return; }
    if (this.spearCd > 0) return;
    this.spears--; this.spearCd = 0.7;
    const dir = this.aim ? _v.copy(this.aim.point).sub(this.pos).normalize() : _v.copy(this.game.cam.forward);
    const mesh = new THREE.Mesh(Player.spearGeo || (Player.spearGeo = (() => {
      const g2 = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6); g2.rotateX(Math.PI / 2); return g2;
    })()), Player.spearMat || (Player.spearMat = new THREE.MeshStandardMaterial({ color: '#3a3630', emissive: '#ff5226', emissiveIntensity: 0.7, roughness: 0.5 })));
    mesh.position.copy(this.pos).addScaledVector(dir, 1.2).add(_v2.set(0, -0.2, 0));
    mesh.lookAt(_v2.copy(mesh.position).add(dir));
    g.scene.add(mesh);
    this.spearShots.push({ pos: mesh.position.clone(), vel: dir.clone().multiplyScalar(55).addScaledVector(this.vel, 0.35), mesh, fuse: -1 });
    g.audio.dash(); g.cam.shake(0.2);
    g.vfx.gas(this.pos, dir.clone().negate(), 1.4); // recoil puff
    this.vel.addScaledVector(dir, -3.5); // recoil
  }

  updateSpears(dt) {
    const g = this.game;
    for (let i = this.spearShots.length - 1; i >= 0; i--) {
      const s = this.spearShots[i];
      if (s.fuse >= 0) {
        s.fuse -= dt;
        if (s.owner && s.owner.alive) s.pos.copy(s.anchor);
        if (s.fuse <= 0) { g.scene.remove(s.mesh); g.explode(s.pos, s.owner); this.spearShots.splice(i, 1); }
        else s.mesh.position.copy(s.pos);
        continue;
      }
      s.vel.y -= 8 * dt;
      // soft-lock: once close and roughly on-target, home onto the nearest titan
      if (!s.locked) {
        let best = null, bd = 14;
        for (const t of g.titans) {
          if (!t.alive) continue;
          const d = s.pos.distanceTo(t.nape.c);
          if (d < bd) { bd = d; best = t; }
        }
        if (best) {
          _v2.copy(best.nape.c).sub(s.pos).normalize();
          const sp = s.vel.length();
          s.vel.normalize().lerp(_v2, Math.min(1, 7 * dt)).normalize().multiplyScalar(sp);
        }
      }
      const len = s.vel.length() * dt;
      if (len > 0) {
        _v.copy(s.vel).normalize();
        const hit = g.world.col.raycast(s.pos, _v, len, { dynamics: true, inflate: 1.6 });
        if (hit) {
          s.pos.copy(hit.point);
          if (hit.collider?.owner) {
            s.owner = hit.collider.owner; s.anchor = hit.point.clone(); s.fuse = 0.85;
            if (hit.collider.ja) { s.ja = hit.collider.ja; s.local = hit.point.clone(); s.ja.worldToLocal(s.local); }
            s.mesh.position.copy(s.pos); g.vfx.sparks(s.pos, 8);
          } else {
            g.scene.remove(s.mesh); g.explode(hit.point, null); this.spearShots.splice(i, 1); continue;
          }
        } else s.pos.addScaledVector(_v, len);
      }
      s.mesh.position.copy(s.pos);
      s.mesh.lookAt(_v2.copy(s.pos).add(s.vel));
      if (s.pos.y < 0.3) { g.scene.remove(s.mesh); g.explode(s.pos, null); this.spearShots.splice(i, 1); }
    }
  }

  physics(dt, control) {
    const g = this.game, inp = g.input, cam = g.cam;
    const v = this.vel, p = this.pos;
    const fwd = _v3.copy(cam.forwardFlat);
    const mx = control ? (inp.key('KeyD') ? 1 : 0) - (inp.key('KeyA') ? 1 : 0) : 0;
    const mz = control ? (inp.key('KeyW') ? 1 : 0) - (inp.key('KeyS') ? 1 : 0) : 0;
    const wish = new THREE.Vector3().addScaledVector(fwd, mz).addScaledVector(cam.rightFlat, mx);
    if (wish.lengthSq() > 1) wish.normalize();
    const reel = control && inp.key('Space');
    const gasHeld = control && (inp.key('ShiftLeft') || inp.key('ShiftRight'));
    let gasUse = 0;
    this.gasOn = false;
    if (this.gasReload > 0) {
      this.gasReload -= dt;
      if (this.gasReload <= 0) {
        this.gas = 100; this.gasCylinders = Math.max(1, this.gasCylinders - 1);
        g.hud.toast('<span style="font-size:18px">SILINDER GAS TERPASANG</span>', 0.7);
      }
    } else if (control && (inp.pressed('KeyC') || this.gas <= 0) && this.gasCylinders > 1 && this.gas < 95) {
      this.gas = 0; this.gasReload = this.className === 'light' ? 0.75 : this.className === 'heavy' ? 1.25 : 1;
      g.hud.toast('<span style="font-size:18px">MENGGANTI SILINDER GAS…</span>', this.gasReload);
    }
    const att = this.hooks.filter((h) => h.state === 'attached');
    // cables and active gas provide support force; freefall keeps full gravity
    const gravityScale = att.length ? 0.68 : (gasHeld && this.gas > 0 && !this.grounded ? 0.65 : 1);
    v.y -= TUNE.gravity * gravityScale * dt;
    this.coyoteT = this.grounded ? 0.12 : Math.max(0, (this.coyoteT || 0) - dt);
    if (this.grounded && !att.length) {
      // running
      const sp = TUNE.runSpeed * this.classDef.speed * (gasHeld && this.gas > 0 ? 1.6 : 1);
      const tx = wish.x * sp, tz = wish.z * sp;
      const k = wish.lengthSq() > 0 ? 14 : (Math.hypot(v.x, v.z) > 14 ? 1.5 : 8);
      v.x = damp(v.x, tx, k, dt); v.z = damp(v.z, tz, k, dt);
      if (control && inp.pressed('Space', true)) { v.y = TUNE.jump; this.grounded = false; g.audio.jump(); }
    } else {
      const lowSpeedAssist = 1 + clamp((12 - v.length()) / 12, 0, 1) * 0.8;
      v.addScaledVector(wish, (att.length ? TUNE.swingSteer : TUNE.airSteer) * lowSpeedAssist * this.classDef.steer * dt);
      if (control && this.coyoteT > 0 && inp.pressed('Space', true) && !att.length) {
        v.y = TUNE.jump; this.coyoteT = 0; g.audio.jump();
      }
    }
    // wall moves: run along it, climb it facing in, kick off with Space
    this.wallRun = false; this.climbing = false;
    if (this.wallT > 0) this.wallT -= dt;
    if (this.grounded) this.climbT = 0;
    if (this.wallT > 0 && control && !this.grabbedBy) {
      const n = this.wallN;
      if (!this.grounded && inp.pressed('Space', true)) {
        // kick-off: push away from the wall and up, keeping some momentum along it
        const vn = v.dot(n); if (vn < 0) v.addScaledVector(n, -vn);
        v.addScaledVector(n, 11); v.y = Math.max(v.y, 0) + 8;
        this.wallT = 0; g.audio.jump(); g.cam.shake(0.15);
      } else if (mz > 0) {
        const into = -(wish.x * n.x + wish.z * n.z);
        if (into > 0.7 && (this.climbT || 0) < 1.4) {
          // climb: run straight up the face for a short burst
          this.climbing = true; this.climbT = (this.climbT || 0) + dt;
          v.y = damp(v.y, 9, 8, dt);
          v.x = damp(v.x, -n.x * 2, 6, dt); v.z = damp(v.z, -n.z * 2, 6, dt);
        } else {
          const along = Math.hypot(v.x - n.x * v.dot(n), v.z - n.z * v.dot(n));
          if (along > 4 && !this.grounded) {
            // wall-run: most of gravity cancelled while moving fast along the face
            this.wallRun = true;
            v.y += TUNE.gravity * 0.75 * dt; if (v.y < -3) v.y = damp(v.y, -3, 6, dt);
            v.addScaledVector(n, -4 * dt);
          }
        }
      }
    }
    // gas boost: thrust along camera look (or wish) while airborne
    const brake = gasHeld && mz < 0 && mx === 0 && !this.grounded && Math.hypot(v.x, v.z) > 1.5;
    this.braking = brake && this.gas > 0; this.diving = false;
    if (this.braking) {
      // air brake: retro-burst against the velocity, never reversing it
      // kills horizontal momentum; only softens a fall so it can't be used to hover
      const rate = TUNE.gasThrust * 1.4 * dt, hs = Math.hypot(v.x, v.z);
      if (hs > 1e-3) { const k = Math.max(0, hs - rate) / hs; v.x *= k; v.z *= k; }
      if (v.y < 0) v.y += Math.min(-v.y, rate * 0.35);
      else v.y = Math.max(0, v.y - rate);
      gasUse += 5.5 * dt; this.gasOn = true;
    } else if (gasHeld && this.gas > 0 && !this.grounded && !att.length && inp.key('Space')) {
      // Shift+Space: vertical power-dive, steerable with WASD
      _v.copy(wish).multiplyScalar(0.35); _v.y = -1; _v.normalize();
      v.addScaledVector(_v, TUNE.gasThrust * this.classDef.thrust * 1.3 * dt);
      gasUse += 5 * dt; this.gasOn = true; this.diving = true;
    } else if (gasHeld && this.gas > 0 && (!this.grounded || att.length)) {
      const dir = wish.lengthSq() > 0.01 ? _v.copy(wish).addScaledVector(cam.forward, 0.5) : _v.copy(cam.forward);
      dir.y = Math.max(dir.y, 0.32); dir.normalize();
      v.addScaledVector(dir, TUNE.gasThrust * this.classDef.thrust * dt);
      gasUse += 4.5 * dt; this.gasOn = true;
    }
    if (control && inp.pressed('ShiftLeft', true) && this.dashCD <= 0 && this.gas > 3 && !this.grounded) {
      const dir = wish.lengthSq() > 0.01 ? _v.copy(wish) : _v.copy(cam.forward);
      dir.y += 0.12; dir.normalize();
      v.addScaledVector(dir, TUNE.dashImpulse * this.classDef.speed); this.dashCD = 0.4; gasUse += 2; g.onDash(dir);
    }
    // cables
    for (const h of att) {
      // lightweight rope constraint: at most one bend point, scanned only 8x/sec
      h.bendScan = (h.bendScan || 0) - dt;
      if (h.bendScan <= 0) {
        h.bendScan = 0.125;
        _v4.subVectors(this.anchorOf(h, _v), p);
        const lineLen = _v4.length();
        if (lineLen > 2) {
          _v4.divideScalar(lineLen);
          const hit = g.world.col.raycast(p, _v4, lineLen - 0.8, { dynamics: false });
          if (hit && hit.collider) (h.bend ||= new THREE.Vector3()).copy(hit.point).addScaledVector(hit.normal, 0.12);
          else h.bend = null;
        }
      }
      const a = h.bend ? _v.copy(h.bend) : this.anchorOf(h, _v);
      _n.subVectors(a, p);
      const dist = _n.length();
      if (dist < 1e-3) continue;
      _n.divideScalar(dist);
      // spring-driven ODM spool: every attached cable pulls along its actual 3D direction; Space is the powered reel
      const rangePull = dist > 120 ? clamp(1 - (dist - 120) / 80, 0.5, 1) : 1;
      v.addScaledVector(_n, 24 * rangePull * dt / att.length * (att.length > 1 ? 1.2 : 1));
      if (reel && this.gas > 0) {
        const vr = v.dot(_n);
        if (vr < TUNE.reelMax) v.addScaledVector(_n, TUNE.reelAccel * rangePull * this.classDef.thrust * dt / att.length * (att.length > 1 ? 1.35 : 1));
        gasUse += 3.2 * dt / att.length; this.gasOn = true;
        // ease off close to the anchor so reeling into a wall doesn't splat you
        if (dist < 7 && vr > 0) v.addScaledVector(_n, -vr * Math.min(1, dt * (7 - dist) * 1.5));
      }
      // rope only pulls (inextensible), slowly winches in for tension
      h.len = Math.min(h.len, dist);
      // passive winch keeps every cable pulling along its full 3D angle; Space adds powered reel acceleration
      h.len = Math.max(1.5, h.len - dt * (reel ? 3.5 : 2.2));
      h.tension = 0;
      if (dist > h.len) {
        const vr = v.dot(_n);
        if (vr < 0) { v.addScaledVector(_n, -vr); h.tension = -vr; }
        p.addScaledVector(_n, (dist - h.len) * 0.8);
      }
      if (dist < 2.2 && this.grounded === false && h.owner == null) h.len = Math.max(h.len, 2);
    }
    this.gas = Math.max(0, this.gas - gasUse);
    // quadratic air drag (gentle — keep momentum)
    const sp = v.length();
    if (!this.grounded) v.multiplyScalar(1 - Math.min(0.5, 0.00055 * sp * dt * 60) * dt * 2);
    if (sp > 55) v.multiplyScalar(1 - Math.min(0.5, (sp - 55) * 0.03 * dt));
    p.addScaledVector(v, dt);
    this.collide(dt);
  }

  collide(dt) {
    const g = this.game, p = this.pos, v = this.vel;
    const col = g.world.col;
    const wasGround = this.grounded;
    this.grounded = false;
    col.nearby(p, near);
    for (const c of col.dynamics) near.push(c);
    const r = TUNE.radius;
    let maxHit = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let s = 0; s < 2; s++) {
        const cy = s === 0 ? -0.5 : 0.25;
        _v.set(p.x, p.y + cy, p.z);
        // ground plane
        if (_v.y < r) {
          const pen = r - _v.y; p.y += pen; _v.y += pen;
          const vn = v.y;
          if (vn < 0) { maxHit = Math.max(maxHit, -vn); v.y = 0; this.applyFriction(UP, -vn, dt); }
          this.grounded = true; this.groundN.copy(UP);
        }
        for (const c of near) {
          const pen = c.sphere(_v, r, _n);
          if (pen > 0) {
            p.addScaledVector(_n, pen); _v.addScaledVector(_n, pen);
            const vn = v.dot(_n);
            if (vn < 0) {
              maxHit = Math.max(maxHit, -vn * (c.owner ? 0.4 : 1));
              v.addScaledVector(_n, -vn * (c.owner ? 1.1 : 1.0));
              this.applyFriction(_n, -vn, dt);
            }
            if (_n.y > 0.55) { this.grounded = true; this.groundN.copy(_n); }
            // remember the last wall touched for wall-run / climb / kick-off
            else if (Math.abs(_n.y) < 0.35 && !c.owner) { (this.wallN ||= new THREE.Vector3()).copy(_n); this.wallT = 0.2; }
          }
        }
      }
    }
    if (this.grounded && !wasGround) { this.game.onLand(maxHit); this.airTime = 0; }
    if (!this.grounded) this.airTime += dt;
    // crashing into stuff at very high speed hurts (realism)
    if (maxHit > 46 && this.invuln <= 0) { this.damage(Math.round((maxHit - 46) * 1.6), 'crash'); this.game.onCrash(maxHit); this.invuln = 0.4; }
    else if (maxHit > 16 && !this.grounded) this.game.onBump(maxHit);
  }

  applyFriction(n, vn, dt) {
    const v = this.vel;
    const tan = _v2.copy(v).addScaledVector(n, -v.dot(n));
    const ts = tan.length();
    if (ts < 1e-4) return;
    const fr = this.grounded && n.y > 0.55 ? (Math.hypot(v.x, v.z) > 14 ? 0.03 : 0.12) : 0.04;
    v.addScaledVector(tan, -Math.min(1, fr * vn / ts * 4 + 0.0));
  }

  startSlash() {
    if (this.blade <= 0) { this.game.hud.flash('blades'); this.game.audio.click(); return; }
    this.slashT = 0; this.slashHits.clear(); this.slashSide = -this.slashSide || 1;
    this.game.audio.slash(this.speed);
    // slash assist: small pull toward locked nape when close
    if (this.lock) {
      _v.subVectors(this.lock.nape.c, this.pos);
      const d = _v.length();
      if (d < 20) this.vel.addScaledVector(_v.normalize(), clamp((20 - d) * 0.8, 0, 10));
    }
  }

  combat(dt) {
    const g = this.game;
    if (this.slashT >= 0) {
      this.slashT += dt / TUNE.slashTime;
      if (this.slashT > 1) this.slashT = -1;
    }
    if (this.spin > 0) this.spin -= dt;
    const active = (this.slashT > 0.22 && this.slashT < 0.85) || this.spin > 0;
    if (!active || this.blade <= 0) return;
    const reach = TUNE.reach * (this.spin > 0 ? 1.35 : 1);
    for (const t of g.titans) {
      if (!t.alive || this.slashHits.has(t)) continue;
      // nape first
      const dN = t.nape.c.distanceTo(this.pos);
      const relV = this.vel.length();
      if (dN < t.nape.r + reach) {
        this.slashHits.add(t);
        // approach angle bonus: hitting from behind/above
        _v.subVectors(t.nape.c, this.pos).normalize();
        const back = _v2.set(-Math.sin(t.heading), 0, -Math.cos(t.heading));
        const angle = clamp(-_v.dot(back) * 0.5 + 0.5, 0, 1);
        let dmg = 90 + relV * relV * 0.55 + relV * 6;
        dmg *= (this.spin > 0 ? 1.6 : 1) * (0.75 + angle * 0.5);
        dmg = Math.round(dmg * this.classDef.damage);
        const r = t.hit('nape', dmg, t.nape.c, this.vel);
        this.useBlade(r.result === 'kill' ? 14 : 9);
        g.onSlashHit(t, r.result, dmg, t.nape.c.clone());
        continue;
      }
      // limbs
      let best = null, bestD = reach;
      for (const c of t.parts) {
        closestPointOnSegment(this.pos, c.a, c.b, _v);
        const d = _v.distanceTo(this.pos) - c.r;
        if (d < bestD) { bestD = d; best = c; _v3.copy(_v); }
      }
      if (best && best.part !== 'torso') {
        this.slashHits.add(t);
        const dmg = Math.round((60 + relV * 8) * this.classDef.damage);
        const r = t.hit(best.part, dmg, _v3, this.vel, best.side);
        this.useBlade(6);
        g.onSlashHit(t, r.result, dmg, _v3.clone());
      }
    }
  }

  useBlade(n) {
    this.blade = Math.max(0, this.blade - n);
    if (this.blade <= 0) { this.game.hud.flash('blades'); this.game.audio.bladeBreak(); }
  }
  swapBlades() {
    if (this.bladeSets <= 0 || this.blade >= 100) return;
    this.bladeSets--; this.blade = 100; this.game.audio.bladeSwap(); this.game.hud.flash('swap');
  }

  depot(dt) {
    for (const d of this.game.world.depots) {
      if (Math.hypot(this.pos.x - d.pos.x, this.pos.z - d.pos.z) < d.radius && Math.abs(this.pos.y - d.pos.y) < 4) {
        const before = this.gas + this.gasCylinders * 100 + this.bladeSets + this.hp;
        this.gas = Math.min(100, this.gas + dt * 45);
        this.gasCylinders = this.classDef.cylinders; this.gasReload = 0;
        this.spears = this.classDef.spears;
        this.hp = Math.min(100, this.hp + dt * 10);
        if (this.bladeSets < this.classDef.blades && (this._dt = (this._dt || 0) + dt) > 0.35) { this._dt = 0; this.bladeSets++; }
        if (this.blade < 100 && this.bladeSets > 0 && this.blade <= 0) this.swapBlades();
        if (this.gas + this.gasCylinders * 100 + this.bladeSets + this.hp > before + 0.01) this.game.hud.resupply(d.name);
      }
    }
  }

  updateGrabbed(dt) {
    const t = this.grabbedBy;
    t.handPos(t.grabSide, this.pos);
    this.vel.set(0, 0, 0);
    const inp = this.game.input;
    if (inp.mouse.lPressed || inp.pressed('Space') ) { this.struggle += 0.14; this.game.audio.struggle(); this.game.cam.shake(0.25); }
    this.struggle = Math.max(0, this.struggle - dt * 0.12);
    if (this.struggle >= 1 && this.blade > 0) {
      // cut free: sever the fingers
      this.useBlade(25);
      t.armCut[t.grabSide] = 8;
      this.game.onSlashHit(t, 'arm', 80, this.pos.clone());
      this.releaseGrab(t);
      t.setState('chase'); t.cooldown = 3;
    }
    this.animate(dt);
  }

  animate(dt) {
    const v = this.vel;
    this.speed = v.length();
    const att = this.hooks.filter((h) => h.state === 'attached');
    // orientation: grounded => upright facing motion; air => align with velocity, up toward cables
    const fwd = _v.set(v.x, this.grounded ? 0 : v.y * 0.6, v.z);
    if (fwd.lengthSq() < 0.5) fwd.copy(this.game.cam.forwardFlat);
    fwd.normalize();
    const fpView = this.game.cam.isFP();
    const leanDir = fpView ? _v4.copy(fwd) : fwd;
    if (fpView && !this.grabbedBy) fwd.copy(this.game.cam.forwardFlat);
    // body aligns with the felt force (cable tension, thrust, centripetal pull) and leans into speed
    if (dt > 0) {
      if (!this.vPrev) { this.vPrev = v.clone(); this.accS = new THREE.Vector3(); }
      _v3.subVectors(v, this.vPrev).divideScalar(dt);
      if (_v3.lengthSq() > 40000) _v3.setLength(200);
      this.accS.lerp(_v3, 1 - Math.exp(-10 * dt));
      this.vPrev.copy(v);
    }
    let up = _v2.copy(UP);
    if (!this.grounded && this.accS) {
      const f = _v3.copy(this.accS); f.y += TUNE.gravity;
      const fl = f.length();
      up.multiplyScalar(0.55);
      if (fl > 1e-3) up.addScaledVector(f, Math.min(fl / TUNE.gravity, 1.8) * 0.75 / fl);
      up.addScaledVector(leanDir, clamp(this.speed / 32, 0, 0.85));
      if (up.lengthSq() < 1e-4) up.set(0, 1, 0);
      up.normalize();
      // first person: drop fore/aft pitch (keep the sideways lean for camera roll) so the viewmodel arms stay in front of the lens
      if (fpView) { up.addScaledVector(fwd, -up.dot(fwd)); if (up.lengthSq() < 1e-4) up.set(0, 1, 0); up.normalize(); }
    }
    if (this.grabbedBy) { fwd.set(Math.sin(this.grabbedBy.heading), 0, Math.cos(this.grabbedBy.heading)).negate(); up.copy(UP); }
    // climbing faces the wall; wall-running leans slightly away from it
    else if (this.climbing && this.wallN) { fwd.set(-this.wallN.x, 0, -this.wallN.z).normalize(); up.copy(UP); }
    else if (this.wallRun && this.wallN) { up.copy(UP).addScaledVector(this.wallN, 0.4).normalize(); }
    // orthonormalize
    const right = _n.crossVectors(up, fwd);
    if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
    right.normalize();
    const f2 = _v3.crossVectors(right, up).normalize();
    _m.makeBasis(right, up, f2);
    _q.setFromRotationMatrix(_m);
    this.quat.slerp(_q, 1 - Math.exp(-(this.grounded ? 18 : 9) * dt));
    _v.set(0, this.grounded ? -0.05 : 0, 0).add(this.pos);
    this.model.update(dt, _v, this.quat, {
      grounded: this.grounded && !att.length, speed: this.grounded ? Math.hypot(v.x, v.z) : this.speed, vel: v,
      wall: this.climbing ? 'climb' : this.wallRun ? 'run' : null,
      hooked: att.length > 0, spin: this.spin > 0 || this.charge > 0.45, slashT: this.slashT, grabbed: !!this.grabbedBy, fp: fpView, pitch: this.game.cam.pitch,
    });
  }
}
