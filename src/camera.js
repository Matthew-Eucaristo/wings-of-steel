import * as THREE from 'three';
import { clamp, damp, lerp } from './util.js';
import { createRayHit } from './collision.js';

const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _execPos = new THREE.Vector3();
const _camHit = createRayHit();
const _reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

export class CameraRig {
  constructor(game) {
    this.game = game;
    this.baseFov = 75;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, innerWidth / innerHeight, 0.1, 4000);
    this.yaw = Math.PI;
    this.pitch = -0.08;
    this.invertY = false;
    this.forward = new THREE.Vector3();
    this.forwardFlat = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.rightFlat = new THREE.Vector3();
    this.dist = 4.5;
    this.fov = 75;
    this.trauma = 0;
    this.hitJoltT = 0;
    this.hitJoltDur = 0.12;
    this.hitJoltAmp = 0;
    this.roll = 0;
    this.fpRoll = 0;
    this.fpKick = 0;
    this.swayYaw = 0;
    this.swayPitch = 0;
    this.t = 0;
    this.fp = true;
    this.target = new THREE.Vector3();
    this.sens = 0.0022;
    this.killCam = 0;
    this.execT = 0;
    this.execDur = 0.52;
    this.execSide = 1;
    this.execNape = new THREE.Vector3();
    this.customizing = false;
    this.wardrobeAngle = 0.28;
    this.wardrobeZoom = 2.45;
    this.wardrobeFocusY = 0.25;
    this.impactFov = 0;
    this.wardrobeLights = null;
    this.computeAxes();
  }
  ensureWardrobeLights() {
    if (this.wardrobeLights) return;
    const g = new THREE.Group();
    const key = new THREE.PointLight('#ffe8cc', 4.5, 10, 1.5);
    const rim = new THREE.PointLight('#88beff', 3.2, 10, 1.5);
    g.add(key, rim);
    g.visible = false;
    this.game.scene.add(g);
    this.wardrobeLights = { group: g, key, rim };
  }
  look(dx, dy) {
    const sy = dx * this.sens;
    const sp = dy * this.sens * (this.invertY ? 1 : -1);
    this.yaw -= sy;
    this.pitch = clamp(this.pitch + sp, -1.45, 1.35);
    this.swayYaw = clamp(this.swayYaw - sy * 0.45, -0.22, 0.22);
    this.swayPitch = clamp(this.swayPitch + sp * 0.45, -0.18, 0.18);
  }
  shake(a) {
    if (_reducedMotion.matches) return;
    this.trauma = Math.min(1.15, this.trauma + a * (this.game.prefs.shake ? 1 : 0.25));
  }
  hitJolt(amp = 0.75, dur = 0.12) {
    if (_reducedMotion.matches) amp = 0;
    if (!this.game.prefs.shake) amp *= 0.25;
    this.hitJoltAmp = Math.max(this.hitJoltAmp, amp);
    this.hitJoltT = Math.max(this.hitJoltT, dur);
    this.hitJoltDur = Math.max(0.05, dur);
  }
  triggerExecution(napePos) {
    this.execNape.copy(napePos);
    this.execDur = 0.52;
    this.execT = this.execDur;
    this.execSide = -this.execSide || 1;
    this.killCam = 0.8;
  }
  computeAxes() {
    const cp = Math.cos(this.pitch);
    this.forward.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    this.forwardFlat.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.rightFlat.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    this.right.copy(this.rightFlat);
  }
  update(dt, rdt) {
    const p = this.game.player;
    this.t += rdt;
    this.swayYaw = damp(this.swayYaw, 0, 9.5, rdt);
    this.swayPitch = damp(this.swayPitch, 0, 9.5, rdt);
    this.computeAxes();
    const cam = this.camera;

    if (this.customizing && !this.game.started) {
      this.ensureWardrobeLights();
      const pPos = p.pos;
      const faceYaw = Math.atan2(this.forwardFlat.x, this.forwardFlat.z);
      const a = faceYaw + this.wardrobeAngle;
      const rad = clamp(this.wardrobeZoom, 1.25, 3.3);
      const faceMode = rad < 1.9;
      const focusY = pPos.y + (faceMode ? 0.72 : -0.02);
      const camY = focusY + rad * (faceMode ? 0.04 : 0.1);
      const camX = pPos.x + Math.sin(a) * rad;
      const camZ = pPos.z + Math.cos(a) * rad;
      cam.near = 0.06;
      cam.position.set(camX, camY, camZ);
      _t.set(pPos.x, focusY, pPos.z);
      cam.lookAt(_t);
      const aspect = innerWidth / Math.max(1, innerHeight);
      const shiftFrac = aspect > 1.1 ? 0.14 * Math.min(1, aspect / 1.6) : 0;
      cam.setViewOffset(innerWidth, innerHeight, innerWidth * shiftFrac, 0, innerWidth, innerHeight);
      this.wardrobeLights.group.visible = true;
      this.wardrobeLights.key.position.set(pPos.x + Math.sin(a + 0.65) * 2.2, pPos.y + 1.5, pPos.z + Math.cos(a + 0.65) * 2.2);
      this.wardrobeLights.rim.position.set(pPos.x - Math.sin(a - 0.5) * 2.0, pPos.y + 1.2, pPos.z - Math.cos(a - 0.5) * 2.0);
      this.fov = damp(this.fov, faceMode ? 38 : 42, 8, rdt);
      if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
      p.model.hideCape = false;
      if (p.model.cape) p.model.cape.visible = p.model.root.visible && !p.model.noCape;
      return;
    }
    if (this.camera.viewOffset) this.camera.clearViewOffset();
    if (this.wardrobeLights) this.wardrobeLights.group.visible = false;

    const sp = p.speed;
    const tgt = _t.copy(p.pos); tgt.y += 0.55;
    if (p.grabbedBy) { p.grabbedBy.head.getWorldPosition(_v); tgt.lerp(_v, 0.4); }
    if (!this.game.started) tgt.y += 2.2;
    this.target.lerp(tgt, 1 - Math.exp(-24 * rdt));
    let wantDist = clamp(4.2 + sp * 0.04, 4.2, 6.0);
    if (p.grabbedBy) wantDist = 6 + p.grabbedBy.height * 0.9;
    if (p.dead) wantDist = 10;
    if (!this.game.started) wantDist = 13.5;
    this.dist = damp(this.dist, wantDist, 4.5, rdt);

    const lat = p.vel.dot(this.rightFlat);
    const accLat = p.accS ? p.accS.dot(this.rightFlat) : 0;
    const wantRoll = p.grounded ? clamp(-lat * 0.0025, -0.04, 0.04) : clamp(-lat * 0.0062 - accLat * 0.0022, -0.24, 0.24);
    this.roll = damp(this.roll, wantRoll, 5.5, rdt);

    if (p.grounded && !this.wasGrounded) this.dip = clamp(-this.lastVy * 0.012, 0, 0.28);
    this.wasGrounded = p.grounded; this.lastVy = p.vel.y;
    this.dip = damp(this.dip || 0, 0, 7.5, rdt);
    const fp = this.isFP();
    p.model.hideCape = fp;
    if (p.model.cape) p.model.cape.visible = p.model.root.visible && !fp && !p.model.noCape;
    if (cam.near !== (fp ? 0.04 : 0.1)) { cam.near = fp ? 0.04 : 0.1; cam.updateProjectionMatrix(); }

    if (fp) {
      this.updateFP(cam, rdt);
    } else {
      const desired = _v.copy(this.target).addScaledVector(this.forward, -this.dist).addScaledVector(this.right, 0.55);
      desired.y += 0.35;
      const d = _t.subVectors(desired, this.target);
      const L = d.length();
      if (L > 1e-5) d.divideScalar(L);
      const hit = this.game.world.col.raycast(this.target, d, L + 0.3, { dynamics: false }, _camHit);
      let dd = L;
      if (hit && hit.t < L + 0.3) dd = Math.max(0.6, hit.t - 0.35);
      cam.position.copy(this.target).addScaledVector(d, dd);
      if (cam.position.y < 0.3) cam.position.y = 0.3;
      _v.copy(this.target).addScaledVector(this.right, 0.55).addScaledVector(this.forward, 10);
      cam.lookAt(_v);
      cam.rotateZ(this.roll);

      if (this.execT > 0) {
        const prog = 1 - this.execT / this.execDur;
        const blend = Math.sin(clamp(prog, 0, 1) * Math.PI);
        const orbitYaw = this.yaw + this.execSide * lerp(0.8, 0.16, prog);
        const rad = lerp(3.2, 4.4, prog);
        _execPos.set(
          p.pos.x - Math.sin(orbitYaw) * rad,
          p.pos.y + lerp(-0.2, 0.6, prog),
          p.pos.z - Math.cos(orbitYaw) * rad,
        );
        if (_execPos.y < 0.5) _execPos.y = 0.5;
        cam.position.lerp(_execPos, blend * 0.78);
        _v.lerpVectors(p.pos, this.execNape, 0.52);
        _t.copy(this.target).addScaledVector(this.forward, 8).lerp(_v, blend * 0.82);
        cam.lookAt(_t);
        cam.rotateZ(this.roll + this.execSide * 0.12 * blend);
      }
    }

    if (this.execT > 0) this.execT = Math.max(0, this.execT - rdt);
    if (this.override) this.override(cam, rdt);

    this.trauma = Math.max(0, this.trauma - rdt * 1.9);
    const s = this.trauma * this.trauma;
    if (s > 0) {
      const t = this.t * 36;
      cam.rotateX((Math.sin(t * 1.1) + Math.sin(t * 2.3)) * 0.0095 * s);
      cam.rotateY((Math.sin(t * 1.3 + 2) + Math.sin(t * 2.9)) * 0.0095 * s);
      cam.rotateZ(Math.sin(t * 0.9 + 4) * 0.015 * s);
    }
    if (this.hitJoltT > 0) {
      this.hitJoltT = Math.max(0, this.hitJoltT - rdt);
      const jt = this.t * 165;
      const a = this.hitJoltAmp * (this.hitJoltT / this.hitJoltDur);
      cam.rotateX(Math.sin(jt) * 0.015 * a);
      cam.rotateY(Math.cos(jt * 1.37) * 0.015 * a);
      cam.rotateZ(Math.sin(jt * 0.83) * 0.012 * a);
    } else {
      this.hitJoltAmp = 0;
    }

    const base = this.baseFov;
    const execZoom = this.execT > 0 ? -7 * Math.sin((this.execT / this.execDur) * Math.PI) : 0;
    const speedFov = clamp(Math.max(0, sp - 9) * 0.42, 0, 19);
    const wantFov = clamp(base + speedFov + (fp ? 5 : 0), base, base + 24) + execZoom + this.impactFov * (_reducedMotion.matches ? 0.3 : 1);
    this.impactFov = damp(this.impactFov, 0, 11, rdt);
    this.fov = this.fovOverride ?? damp(this.fov, wantFov, 6.2, rdt);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    this.killCam = Math.max(0, this.killCam - rdt);
    if (this.debug) this.debug(cam);
  }

  isFP() { const p = this.game.player; return this.fp && this.game.started && !p.dead && !p.grabbedBy; }

  updateFP(cam, rdt) {
    const p = this.game.player, m = p.model;
    m.root.updateMatrixWorld(true);
    m.head.getWorldPosition(_v);
    const bodyUp = _t.set(0, 1, 0).applyQuaternion(p.quat);
    const targetFpRoll = clamp(-bodyUp.dot(this.right) * 0.42 + this.roll * 0.55, -0.3, 0.3);
    this.fpRoll = damp(this.fpRoll || 0, targetFpRoll, 6.0, rdt);
    const run = p.grounded ? clamp(Math.hypot(p.vel.x, p.vel.z) / 10, 0, 1.2) : 0;
    const ph = m.runPhase;
    _v.y += Math.abs(Math.sin(ph)) * 0.038 * run - this.dip * 0.55;
    _v.addScaledVector(this.right, Math.sin(ph) * 0.018 * run).addScaledVector(this.forwardFlat, 0.14);
    const acc = p.accS || _t.set(0, 0, 0);
    const aF = p.grounded ? 0 : acc.dot(this.forward);
    this.fpKick = damp(this.fpKick || 0, clamp(aF * 0.0022, -0.06, 0.06), 5.5, rdt);
    const execTilt = this.execT > 0 ? this.execSide * 0.12 * Math.sin((this.execT / this.execDur) * Math.PI) : 0;
    cam.position.copy(_v);
    cam.lookAt(_t.copy(_v).add(this.forward));
    cam.rotateZ(this.fpRoll + execTilt);
    cam.rotateX(this.fpKick + Math.sin(ph * 2) * 0.005 * run - this.dip * 0.14);
  }
  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
}
