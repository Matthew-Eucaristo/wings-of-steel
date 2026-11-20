import * as THREE from 'three';
import { clamp, damp, lerp } from './util.js';

const _v = new THREE.Vector3(), _t = new THREE.Vector3();

export class CameraRig {
  constructor(game) {
    this.game = game;
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 4000);
    this.yaw = Math.PI; this.pitch = -0.08;
    this.forward = new THREE.Vector3(); this.forwardFlat = new THREE.Vector3();
    this.right = new THREE.Vector3(); this.rightFlat = new THREE.Vector3();
    this.dist = 4.5; this.fov = 72; this.trauma = 0; this.roll = 0; this.t = 0;
    this.target = new THREE.Vector3(); this.sens = +localStorage.getItem('odm-sens') || 0.0022;
    this.killCam = 0; this.impactFov = 0; this.killPos = new THREE.Vector3();
    this.computeAxes();
  }
  look(dx, dy) {
    this.yaw -= dx * this.sens;
    this.pitch = clamp(this.pitch - dy * this.sens, -1.45, 1.35);
  }
  shake(a) { this.trauma = Math.min(1.2, this.trauma + a); }
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
    const sp = p.speed;
    const tgt = _t.copy(p.pos); tgt.y += 0.55;
    if (p.grabbedBy) { p.grabbedBy.head.getWorldPosition(_v); tgt.lerp(_v, 0.4); }
    if (!this.game.started) tgt.y += 2.5;
    this.target.lerp(tgt, 1 - Math.exp(-30 * rdt));
    // tighter follow at speed so the soldier stays readable; FOV and blur carry the speed instead
    let wantDist = clamp(4.2 + sp * 0.04, 4.2, 6.2);
    if (p.grabbedBy) wantDist = 6 + p.grabbedBy.height * 0.9;
    if (p.dead) wantDist = 10;
    if (!this.game.started) wantDist = 15;
    this.dist = damp(this.dist, wantDist, 3, rdt);
    // shoulder offset; lean the frame into lateral velocity for a sense of swing
    const lat = p.vel.dot(this.rightFlat);
    const wantRoll = p.grounded ? 0 : clamp(-lat * 0.006, -0.18, 0.18);
    this.roll = damp(this.roll, wantRoll, 3, rdt);
    const cam = this.camera;
    // landing dip shared by both views
    if (p.grounded && !this.wasGrounded) this.dip = clamp(-this.lastVy * 0.012, 0, 0.3);
    this.wasGrounded = p.grounded; this.lastVy = p.vel.y;
    this.dip = damp(this.dip || 0, 0, 7, rdt);
    const fp = this.isFP();
    if (cam.near !== (fp ? 0.04 : 0.1)) { cam.near = fp ? 0.04 : 0.1; cam.updateProjectionMatrix(); }
    if (fp) this.updateFP(cam, rdt);
    else {
      const cam = this.camera;
      const desired = _v.copy(this.target).addScaledVector(this.forward, -this.dist).addScaledVector(this.right, 0.55);
      desired.y += 0.35;
      // collision pull-in
      const d = _t.subVectors(desired, this.target);
      const L = d.length(); d.divideScalar(L);
      const hit = this.game.world.col.raycast(this.target, d, L + 0.3, { dynamics: false });
      let dd = L;
      if (hit && hit.t < L + 0.3) dd = Math.max(0.6, hit.t - 0.35);
      cam.position.copy(this.target).addScaledVector(d, dd);
      if (cam.position.y < 0.3) cam.position.y = 0.3;
      // look slightly above the player so the crosshair leads
      _v.copy(this.target).addScaledVector(this.right, 0.55).addScaledVector(this.forward, 10);
      cam.lookAt(_v);
      cam.rotateZ(this.roll);
    }
    if (this.override) this.override(cam, rdt);
    // trauma shake
    this.trauma = Math.max(0, this.trauma - rdt * 1.6);
    const s = this.trauma * this.trauma;
    if (s > 0) {
      const t = this.t * 40;
      cam.rotateX((Math.sin(t * 1.1) + Math.sin(t * 2.3)) * 0.012 * s);
      cam.rotateY((Math.sin(t * 1.3 + 2) + Math.sin(t * 2.9)) * 0.012 * s);
      cam.rotateZ(Math.sin(t * 0.9 + 4) * 0.02 * s);
    }
    const wantFov = clamp(70 + Math.max(0, sp - 8) * 0.5 + (fp ? 8 : 0), 70, fp ? 96 : 92) + (this.killCam > 0 ? -8 : 0) + this.impactFov;
    this.impactFov = damp(this.impactFov, 0, 14, rdt);
    this.fov = this.fovOverride ?? damp(this.fov, wantFov, 4, rdt);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    this.killCam = Math.max(0, this.killCam - rdt);
    if (this.debug) this.debug(cam);
  }
  isFP() { const p = this.game.player; return this.fp && this.game.started && !p.dead && !p.grabbedBy; }
  updateFP(cam, rdt) {
    const p = this.game.player, m = p.model;
    m.root.updateMatrixWorld(true);
    m.head.getWorldPosition(_v);
    // the head rides the body: roll with its lean, bob with the stride, lag against acceleration
    const bodyUp = _t.set(0, 1, 0).applyQuaternion(p.quat);
    this.fpRoll = damp(this.fpRoll || 0, clamp(-bodyUp.dot(this.right) * 0.6, -0.45, 0.45), 7, rdt);
    const run = p.grounded ? clamp(Math.hypot(p.vel.x, p.vel.z) / 10, 0, 1.3) : 0;
    const ph = m.runPhase;
    _v.y += Math.abs(Math.sin(ph)) * 0.045 * run - this.dip * 0.6;
    _v.addScaledVector(this.right, Math.sin(ph) * 0.02 * run).addScaledVector(this.forwardFlat, 0.13);
    const acc = p.accS || _t.set(0, 0, 0);
    const aF = p.grounded ? 0 : acc.dot(this.forward);
    this.fpKick = damp(this.fpKick || 0, clamp(aF * 0.0025, -0.07, 0.07), 6, rdt);
    cam.position.copy(_v);
    cam.lookAt(_t.copy(_v).add(this.forward));
    cam.rotateZ(this.fpRoll + this.roll * 0.5);
    cam.rotateX(this.fpKick + Math.sin(ph * 2) * 0.006 * run - this.dip * 0.15);
  }
  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
}
