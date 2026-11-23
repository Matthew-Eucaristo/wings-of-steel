import * as THREE from 'three';
import { clamp, damp, lerp } from './util.js';
import { createRayHit } from './collision.js';

const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _execPos = new THREE.Vector3();
const _camHit = createRayHit();
const _reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

export class CameraRig {
  constructor(game) {
    this.game = game;
    this.baseFov = 72;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, innerWidth / innerHeight, 0.1, 4000);
    this.yaw = Math.PI;
    this.pitch = -0.08;
    this.invertY = false;
    this.forward = new THREE.Vector3();
    this.forwardFlat = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.rightFlat = new THREE.Vector3();
    this.dist = 4.5;
    this.fov = 72;
    this.trauma = 0;
    this.hitJoltT = 0;
    this.hitJoltDur = 0.12;
    this.hitJoltAmp = 0;
    this.roll = 0;
    this.t = 0;
    this.fp = true;
    this.target = new THREE.Vector3();
    this.sens = 0.0022;
    this.killCam = 0;
    this.execT = 0;
    this.execDur = 0.56;
    this.execSide = 1;
    this.execNape = new THREE.Vector3();
    this.customizing = false;
    this.wardrobeAngle = 0.35;
    this.impactFov = 0;
    this.computeAxes();
  }
  look(dx, dy) {
    this.yaw -= dx * this.sens;
    const ySign = this.invertY ? 1 : -1;
    this.pitch = clamp(this.pitch + dy * this.sens * ySign, -1.45, 1.35);
  }
  shake(a) {
    if (_reducedMotion.matches) return;
    this.trauma = Math.min(1.3, this.trauma + a * (this.game.prefs.shake ? 1 : 0.25));
  }
  hitJolt(amp = 0.85, dur = 0.13) {
    if (_reducedMotion.matches) amp = 0;
    if (!this.game.prefs.shake) amp *= 0.25;
    this.hitJoltAmp = Math.max(this.hitJoltAmp, amp);
    this.hitJoltT = Math.max(this.hitJoltT, dur);
    this.hitJoltDur = Math.max(0.05, dur);
  }
  triggerExecution(napePos) {
    this.execNape.copy(napePos);
    this.execDur = 0.58;
    this.execT = this.execDur;
    this.execSide = -this.execSide || 1;
    this.killCam = 0.9;
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
    this.computeAxes();
    const cam = this.camera;

    if (this.customizing && !this.game.started) {
      const pPos = p.pos;
      const faceYaw = Math.atan2(this.forwardFlat.x, this.forwardFlat.z);
      const a = faceYaw + this.wardrobeAngle;
      const focus = _t.set(pPos.x - 0.55, pPos.y + 0.32, pPos.z);
      cam.near = 0.08;
      cam.position.set(pPos.x + Math.sin(a) * 2.45 - 0.35, pPos.y + 0.42, pPos.z + Math.cos(a) * 2.45);
      cam.lookAt(focus);
      this.fov = damp(this.fov, 50, 8, rdt);
      if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
      p.model.hideCape = false;
      if (p.model.cape) p.model.cape.visible = p.model.root.visible && !p.model.noCape;
      return;
    }

    const sp = p.speed;
    const tgt = _t.copy(p.pos); tgt.y += 0.55;
    if (p.grabbedBy) { p.grabbedBy.head.getWorldPosition(_v); tgt.lerp(_v, 0.4); }
    if (!this.game.started) tgt.y += 2.5;
    this.target.lerp(tgt, 1 - Math.exp(-30 * rdt));
    let wantDist = clamp(4.2 + sp * 0.04, 4.2, 6.2);
    if (p.grabbedBy) wantDist = 6 + p.grabbedBy.height * 0.9;
    if (p.dead) wantDist = 10;
    if (!this.game.started) wantDist = 15;
    this.dist = damp(this.dist, wantDist, 4, rdt);
    const lat = p.vel.dot(this.rightFlat);
    const wantRoll = p.grounded ? 0 : clamp(-lat * 0.007, -0.22, 0.22);
    this.roll = damp(this.roll, wantRoll, 4.5, rdt);

    if (p.grounded && !this.wasGrounded) this.dip = clamp(-this.lastVy * 0.012, 0, 0.3);
    this.wasGrounded = p.grounded; this.lastVy = p.vel.y;
    this.dip = damp(this.dip || 0, 0, 7, rdt);
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
        const orbitYaw = this.yaw + this.execSide * lerp(0.85, 0.18, prog);
        const rad = lerp(3.1, 4.4, prog);
        _execPos.set(
          p.pos.x - Math.sin(orbitYaw) * rad,
          p.pos.y + lerp(-0.25, 0.65, prog),
          p.pos.z - Math.cos(orbitYaw) * rad,
        );
        if (_execPos.y < 0.5) _execPos.y = 0.5;
        cam.position.lerp(_execPos, blend * 0.82);
        _v.lerpVectors(p.pos, this.execNape, 0.55);
        _t.copy(this.target).addScaledVector(this.forward, 8).lerp(_v, blend * 0.88);
        cam.lookAt(_t);
        cam.rotateZ(this.roll + this.execSide * 0.14 * blend);
      }
    }

    if (this.execT > 0) this.execT = Math.max(0, this.execT - rdt);
    if (this.override) this.override(cam, rdt);

    this.trauma = Math.max(0, this.trauma - rdt * 1.7);
    const s = this.trauma * this.trauma;
    if (s > 0) {
      const t = this.t * 40;
      cam.rotateX((Math.sin(t * 1.1) + Math.sin(t * 2.3)) * 0.011 * s);
      cam.rotateY((Math.sin(t * 1.3 + 2) + Math.sin(t * 2.9)) * 0.011 * s);
      cam.rotateZ(Math.sin(t * 0.9 + 4) * 0.018 * s);
    }
    if (this.hitJoltT > 0) {
      this.hitJoltT = Math.max(0, this.hitJoltT - rdt);
      const jt = this.t * 175;
      const a = this.hitJoltAmp * (this.hitJoltT / this.hitJoltDur);
      cam.rotateX(Math.sin(jt) * 0.018 * a);
      cam.rotateY(Math.cos(jt * 1.37) * 0.018 * a);
      cam.rotateZ(Math.sin(jt * 0.83) * 0.014 * a);
    } else {
      this.hitJoltAmp = 0;
    }

    const base = this.baseFov;
    const execZoom = this.execT > 0 ? -9 * Math.sin((this.execT / this.execDur) * Math.PI) : 0;
    const wantFov = clamp(base + Math.max(0, sp - 8) * 0.5 + (fp ? 9 : 0), base, fp ? base + 26 : base + 22) + execZoom + this.impactFov * (_reducedMotion.matches ? 0.3 : 1);
    this.impactFov = damp(this.impactFov, 0, 14, rdt);
    this.fov = this.fovOverride ?? damp(this.fov, wantFov, 7, rdt);
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
    this.fpRoll = damp(this.fpRoll || 0, clamp(-bodyUp.dot(this.right) * 0.55, -0.38, 0.38), 8, rdt);
    const run = p.grounded ? clamp(Math.hypot(p.vel.x, p.vel.z) / 10, 0, 1.3) : 0;
    const ph = m.runPhase;
    _v.y += Math.abs(Math.sin(ph)) * 0.045 * run - this.dip * 0.6;
    _v.addScaledVector(this.right, Math.sin(ph) * 0.02 * run).addScaledVector(this.forwardFlat, 0.14);
    const acc = p.accS || _t.set(0, 0, 0);
    const aF = p.grounded ? 0 : acc.dot(this.forward);
    this.fpKick = damp(this.fpKick || 0, clamp(aF * 0.0025, -0.07, 0.07), 6, rdt);
    const execTilt = this.execT > 0 ? this.execSide * 0.16 * Math.sin((this.execT / this.execDur) * Math.PI) : 0;
    cam.position.copy(_v);
    cam.lookAt(_t.copy(_v).add(this.forward));
    cam.rotateZ(this.fpRoll + this.roll * 0.45 + execTilt);
    cam.rotateX(this.fpKick + Math.sin(ph * 2) * 0.006 * run - this.dip * 0.15);
  }
  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
}
