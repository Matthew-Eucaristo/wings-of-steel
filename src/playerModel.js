import * as THREE from 'three';
import { capeTexture } from './textures.js';
import { clamp, damp, lerp } from './util.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

// Survey-scout style figure with procedural animation and a verlet cape
export class PlayerModel {
  constructor(scene) {
    this.scene = scene;
    const skin = new THREE.MeshStandardMaterial({ color: '#e8c3a6', roughness: 0.6 });
    const jacket = new THREE.MeshStandardMaterial({ color: '#9a7a55', roughness: 0.8 });
    const pants = new THREE.MeshStandardMaterial({ color: '#e9e4d8', roughness: 0.85 });
    const boots = new THREE.MeshStandardMaterial({ color: '#3a271b', roughness: 0.55 });
    const strap = new THREE.MeshStandardMaterial({ color: '#2a1d15', roughness: 0.6 });
    const metal = new THREE.MeshStandardMaterial({ color: '#a8b0b8', roughness: 0.28, metalness: 0.9 });
    const hairM = new THREE.MeshStandardMaterial({ color: '#141210', roughness: 0.7 });
    this.bladeMat = new THREE.MeshStandardMaterial({ color: '#dfe7ef', roughness: 0.12, metalness: 1, emissive: '#3a5a7a', emissiveIntensity: 0.0 });
    const mk = (g, m, parent, x = 0, y = 0, z = 0) => { const me = new THREE.Mesh(g, m); me.position.set(x, y, z); me.castShadow = true; parent.add(me); return me; };
    const G = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
    const root = new THREE.Group();
    this.root = root;
    scene.add(root);
    const pelvis = G(root, 0, 0.02, 0); this.pelvis = pelvis;
    mk(new THREE.CapsuleGeometry(0.15, 0.12, 4, 10), pants, pelvis).scale.set(1.25, 1, 0.9);
    // ODM gear
    for (const sx of [-1, 1]) {
      const box = mk(new THREE.BoxGeometry(0.1, 0.16, 0.26), metal, pelvis, sx * 0.24, 0, 0.02);
      box.rotation.x = 0.15;
      const tank = mk(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 10), metal, pelvis, sx * 0.2, 0.08, -0.22);
      tank.rotation.x = Math.PI / 2 - 0.3;
      const sheath = mk(new THREE.BoxGeometry(0.09, 0.14, 0.6), strap, pelvis, sx * 0.27, -0.12, -0.05);
      sheath.rotation.x = 0.35;
    }
    const spine = G(pelvis, 0, 0.1, 0); this.spine = spine;
    mk(new THREE.CapsuleGeometry(0.17, 0.28, 4, 12), jacket, spine, 0, 0.24, 0).scale.set(1.15, 1, 0.78);
    // harness straps
    for (const sx of [-1, 1]) {
      const st = mk(new THREE.BoxGeometry(0.035, 0.5, 0.3), strap, spine, sx * 0.1, 0.22, 0); st.rotation.z = sx * 0.25;
    }
    mk(new THREE.TorusGeometry(0.19, 0.018, 6, 20), strap, spine, 0, 0.12, 0).rotation.x = Math.PI / 2;
    const neck = G(spine, 0, 0.5, 0); this.neck = neck;
    mk(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), skin, neck, 0, 0.03, 0);
    const head = G(neck, 0, 0.1, 0); this.head = head;
    mk(new THREE.SphereGeometry(0.11, 16, 12), skin, head, 0, 0.08, 0.01).scale.set(0.9, 1.05, 1);
    const hair = mk(new THREE.SphereGeometry(0.118, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM, head, 0, 0.1, -0.005);
    hair.scale.set(0.95, 1, 1.05);
    mk(new THREE.BoxGeometry(0.2, 0.05, 0.08), hairM, head, 0, 0.16, 0.07).rotation.x = 0.4;
    // scarf
    mk(new THREE.TorusGeometry(0.075, 0.03, 6, 16), new THREE.MeshStandardMaterial({ color: '#e8e8e2', roughness: 0.9 }), neck, 0, 0.0, 0).rotation.x = Math.PI / 2;
    // arms
    this.sh = []; this.el = []; this.hand = []; this.blades = [];
    for (const sx of [-1, 1]) {
      const sh = G(spine, sx * 0.23, 0.42, 0);
      mk(new THREE.CapsuleGeometry(0.055, 0.2, 4, 8), jacket, sh, 0, -0.13, 0);
      const el = G(sh, 0, -0.28, 0);
      mk(new THREE.CapsuleGeometry(0.048, 0.18, 4, 8), pants, el, 0, -0.12, 0);
      const hd = G(el, 0, -0.27, 0);
      mk(new THREE.BoxGeometry(0.07, 0.09, 0.09), metal, hd, 0, -0.02, 0);
      // reverse-grip blade
      const bl = new THREE.Group(); hd.add(bl);
      bl.position.set(sx * 0.03, 0, 0.02);
      const bm = mk(new THREE.BoxGeometry(0.012, 0.95, 0.06), this.bladeMat, bl, 0, 0.47, 0.03);
      bm.rotation.x = 0;
      bl.rotation.set(0.25, 0, sx * 0.25);
      this.sh.push(sh); this.el.push(el); this.hand.push(hd); this.blades.push(bl);
    }
    // legs
    this.th = []; this.kn = [];
    for (const sx of [-1, 1]) {
      const th = G(pelvis, sx * 0.1, -0.06, 0);
      mk(new THREE.CapsuleGeometry(0.07, 0.3, 4, 8), pants, th, 0, -0.22, 0);
      const kn = G(th, 0, -0.45, 0);
      mk(new THREE.CapsuleGeometry(0.06, 0.26, 4, 8), boots, kn, 0, -0.2, 0);
      mk(new THREE.BoxGeometry(0.1, 0.07, 0.2), boots, kn, 0, -0.42, 0.04);
      this.th.push(th); this.kn.push(kn);
    }
    this.buildCape();
    this.slash = 0; this.slashSide = 1;
    this.spinAngle = 0;
    this.runPhase = 0;
    this.tipPrev = [new THREE.Vector3(), new THREE.Vector3()];
  }

  buildCape() {
    const C = 6, R = 9;
    this.capeC = C; this.capeR = R;
    const W = 0.5, L = 0.95;
    this.capeRest = { dx: W / (C - 1), dy: L / (R - 1) };
    this.cp = []; this.cpp = [];
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const p = new THREE.Vector3((c / (C - 1) - 0.5) * W, -r * this.capeRest.dy, 0);
      this.cp.push(p.clone()); this.cpp.push(p.clone());
    }
    const g = new THREE.PlaneGeometry(W, L, C - 1, R - 1);
    this.capeGeo = g;
    const m = new THREE.MeshStandardMaterial({ map: capeTexture(), side: THREE.DoubleSide, roughness: 0.92 });
    this.cape = new THREE.Mesh(g, m);
    this.cape.castShadow = true;
    this.cape.frustumCulled = false;
    this.scene.add(this.cape);
    this.capeInit = false;
  }

  anchorPoint(c, out) {
    const W = 0.44;
    return out.set((c / (this.capeC - 1) - 0.5) * W, 0.5, -0.14).applyMatrix4(this.spine.matrixWorld);
  }

  updateCape(dt, vel) {
    const C = this.capeC, R = this.capeR;
    if (!this.capeInit) {
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        this.anchorPoint(c, _v);
        const i = r * C + c;
        this.cp[i].copy(_v).y -= r * this.capeRest.dy;
        this.cpp[i].copy(this.cp[i]);
      }
      this.capeInit = true;
    }
    const steps = 3;
    const h = Math.min(dt, 0.05) / steps;
    const t = performance.now() * 0.001;
    for (let s = 0; s < steps; s++) {
      for (let i = C; i < C * R; i++) {
        const p = this.cp[i], pp = this.cpp[i];
        const vx = (p.x - pp.x) * 0.985, vy = (p.y - pp.y) * 0.985, vz = (p.z - pp.z) * 0.985;
        pp.copy(p);
        // air drag towards wind relative to player
        const flutter = Math.sin(t * 13 + i * 0.7) * 0.25;
        const ax = -vel.x * 1.6 + flutter, ay = -9.8 - vel.y * 1.6, az = -vel.z * 1.6 + flutter;
        p.x += vx + ax * h * h * 4; p.y += vy + ay * h * h * 4; p.z += vz + az * h * h * 4;
      }
      for (let c = 0; c < C; c++) { this.anchorPoint(c, this.cp[c]); this.cpp[c].copy(this.cp[c]); }
      for (let it = 0; it < 4; it++) {
        for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
          const i = r * C + c;
          if (c < C - 1) this.solve(i, i + 1, this.capeRest.dx, r === 0);
          if (r < R - 1) this.solve(i, i + C, this.capeRest.dy, r === 0);
        }
        // body collision: keep behind torso
        this.spine.getWorldPosition(_w);
        _w.y += 0.15;
        for (let i = C; i < C * R; i++) {
          const p = this.cp[i];
          _v.subVectors(p, _w);
          const d = _v.length();
          if (d < 0.26) p.addScaledVector(_v.normalize(), 0.26 - d);
        }
      }
    }
    const pos = this.capeGeo.attributes.position;
    for (let i = 0; i < C * R; i++) pos.setXYZ(i, this.cp[i].x, this.cp[i].y, this.cp[i].z);
    pos.needsUpdate = true;
    this.capeGeo.computeVertexNormals();
    this.capeGeo.computeBoundingSphere();
  }

  solve(a, b, rest, pinA) {
    const pa = this.cp[a], pb = this.cp[b];
    _v.subVectors(pb, pa);
    const d = _v.length() || 1e-6;
    const diff = (d - rest) / d;
    if (pinA) pb.addScaledVector(_v, -diff);
    else { pa.addScaledVector(_v, diff * 0.5); pb.addScaledVector(_v, -diff * 0.5); }
  }

  bladeTip(i, out) { return out.set(0, 0.95, 0.03).applyMatrix4(this.blades[i].matrixWorld); }
  bladeBase(i, out) { return out.set(0, 0.1, 0.03).applyMatrix4(this.blades[i].matrixWorld); }
  gearPos(side, out) { return out.set(side * 0.26, 0, 0.12).applyMatrix4(this.pelvis.matrixWorld); }

  // st: {grounded, speed, vel, hooked, reeling, spin, slashT, grabbed, moveAmt, dt, ropeDir}
  update(dt, pos, quat, st) {
    const r = this.root;
    r.position.copy(pos);
    r.quaternion.copy(quat);
    if (st.spin) {
      this.spinAngle += dt * 26;
      r.rotateZ(this.spinAngle);
    } else this.spinAngle = 0;
    const D = (o, prop, v, k = 14) => { o[prop] = damp(o[prop], v, k, dt); };
    this.runPhase += dt * (st.grounded ? st.speed * 1.25 : 0);
    const ph = this.runPhase;
    const run = st.grounded ? clamp(st.speed / 9, 0, 1) : 0;
    const air = st.grounded ? 0 : 1;
    // legs
    for (let i = 0; i < 2; i++) {
      const sw = Math.sin(ph + i * Math.PI);
      const airTh = st.hooked ? -0.25 - i * 0.35 : -0.6 + i * 0.25;
      const airKn = st.hooked ? 0.5 + i * 0.4 : 1.1 - i * 0.2;
      D(this.th[i].rotation, 'x', lerp(-sw * 0.9 * run, airTh, air));
      D(this.kn[i].rotation, 'x', lerp(Math.max(0, -Math.sin(ph + i * Math.PI + 0.9)) * 1.3 * run + 0.05, airKn, air));
      D(this.th[i].rotation, 'z', (i ? -1 : 1) * (air * 0.12));
    }
    // arms
    const sl = st.slashT;
    for (let i = 0; i < 2; i++) {
      const sg = i ? 1 : -1;
      let sx = lerp(Math.sin(ph + i * Math.PI) * 0.7 * run, 0.55, air);
      let sz = sg * lerp(0.15, 0.55, air);
      let ex = lerp(-0.6 * run - 0.2, -0.35, air);
      if (st.spin) { sx = -0.2; sz = sg * 1.45; ex = -0.05; }
      else if (sl >= 0) {
        // two-blade cross slash: wind up back then sweep forward
        const k = sl < 0.25 ? sl / 0.25 : 1 - (sl - 0.25) / 0.75;
        const sweep = sl < 0.25 ? 0 : (sl - 0.25) / 0.75;
        sx = lerp(1.2, -1.9, sweep) * (sl < 0.25 ? k : 1);
        sz = sg * lerp(1.3, 0.2, sweep);
        ex = -0.2;
      } else if (st.grabbed) {
        sx = Math.sin(performance.now() * 0.02 + i) * 0.8 - 1.5; sz = sg * 0.8;
      }
      D(this.sh[i].rotation, 'x', sx, sl >= 0 ? 40 : 14);
      D(this.sh[i].rotation, 'z', sz, sl >= 0 ? 40 : 14);
      D(this.el[i].rotation, 'x', ex, 20);
    }
    // blade glow when fast
    this.bladeMat.emissiveIntensity = damp(this.bladeMat.emissiveIntensity, st.speed > 25 || st.spin ? 1.2 : 0.05, 6, dt);
    D(this.spine.rotation, 'x', lerp(run * 0.35, st.hooked ? 0.15 : 0.35, air));
    D(this.spine.rotation, 'y', sl >= 0 ? Math.sin(sl * Math.PI) * 0.7 : 0, 20);
    D(this.head.rotation, 'x', -this.spine.rotation.x * 0.6);
    this.pelvis.position.y = 0.02 + (st.grounded ? Math.abs(Math.cos(ph)) * 0.04 * run : 0);
    r.updateMatrixWorld(true);
    this.updateCape(dt, st.vel);
  }

  setVisible(v) { this.root.visible = v; this.cape.visible = v; }
}
