import * as THREE from 'three';
import { capeTexture } from './textures.js';
import { clamp, damp, lerp } from './util.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export const APPEARANCE_PRESETS = {
  hairStyles: [
    { id: 'scout', label: 'Pengintai' },
    { id: 'levi', label: 'Belah Tengah' },
    { id: 'ponytail', label: 'Ekor Kuda' },
    { id: 'garrison', label: ' Ikat Kepala' },
  ],
  hairColors: [
    { id: '#181512', label: 'Hitam Gagak' },
    { id: '#4a2e1b', label: 'Cokelat Kayu' },
    { id: '#c8a25c', label: 'Pirang Abu' },
    { id: '#7c2820', label: 'Merah Tembaga' },
    { id: '#b8c0c8', label: 'Perak Baja' },
  ],
  capeStyles: [
    { id: 'survey', label: 'Sayap Kebebasan', tint: '#ffffff' },
    { id: 'crimson', label: 'Merah Garnisun', tint: '#d45a4a' },
    { id: 'obsidian', label: 'Hitam Khusus', tint: '#484c54' },
    { id: 'ivory', label: 'Putih Kehormatan', tint: '#f4efe4' },
    { id: 'none', label: 'Tanpa Jubah', tint: '#ffffff' },
  ],
  scarfColors: [
    { id: '#b82924', label: 'Merah Mikasa' },
    { id: '#e8e8e2', label: 'Putih Klasik' },
    { id: '#22252a', label: 'Hitam Taktis' },
    { id: '#d8a848', label: 'Emas Komandan' },
  ],
  jacketColors: [
    { id: '#9a7a55', label: 'Kulit Klasik' },
    { id: '#2a2d32', label: 'Hitam Malam' },
    { id: '#606b76', label: 'Abu Baja' },
    { id: '#5e3829', label: 'Cokelat Tua' },
  ],
  bladeAuras: [
    { id: '#7ac8ff', label: 'Biru Baja', trail2: '#bfe8ff' },
    { id: '#ffcc55', label: 'Emas Surya', trail2: '#fff0b8' },
    { id: '#ff5242', label: 'Merah Darah', trail2: '#ffb0a0' },
    { id: '#58ff9a', label: 'Hijau Zamrud', trail2: '#c4ffe0' },
  ],
};

export const DEFAULT_APPEARANCE = {
  hairStyle: 'scout',
  hairColor: '#181512',
  capeStyle: 'survey',
  scarfColor: '#b82924',
  jacketColor: '#9a7a55',
  bladeAura: '#7ac8ff',
};

let BASE_MATS = null;
function getBaseMats() {
  if (BASE_MATS) return BASE_MATS;
  BASE_MATS = {
    skin: new THREE.MeshStandardMaterial({ color: '#e8c3a6', roughness: 0.58 }),
    pants: new THREE.MeshStandardMaterial({ color: '#ebe5d8', roughness: 0.82 }),
    boots: new THREE.MeshStandardMaterial({ color: '#382519', roughness: 0.52 }),
    strap: new THREE.MeshStandardMaterial({ color: '#261a12', roughness: 0.58 }),
    metal: new THREE.MeshStandardMaterial({ color: '#b0b8c0', roughness: 0.24, metalness: 0.92 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: '#3a4046', roughness: 0.35, metalness: 0.85 }),
    sheath: new THREE.MeshStandardMaterial({ color: '#586068', roughness: 0.32, metalness: 0.78 }),
    eyeWhite: new THREE.MeshStandardMaterial({ color: '#f6f4ee', roughness: 0.2 }),
    eyeDark: new THREE.MeshStandardMaterial({ color: '#1c242b', roughness: 0.15 }),
    brass: new THREE.MeshStandardMaterial({ color: '#cfa454', roughness: 0.3, metalness: 0.85 }),
    spear: new THREE.MeshStandardMaterial({ color: '#34302c', emissive: '#ff5a28', emissiveIntensity: 0.65, roughness: 0.42, metalness: 0.65 }),
  };
  return BASE_MATS;
}

export class PlayerModel {
  constructor(scene, appearance = {}, opts = {}) {
    this.scene = scene;
    this.lightweight = !!opts.lightweight;
    const M = getBaseMats();
    this.jacketMat = new THREE.MeshStandardMaterial({ color: '#9a7a55', roughness: 0.76 });
    this.hairMat = new THREE.MeshStandardMaterial({ color: '#181512', roughness: 0.68 });
    this.scarfMat = new THREE.MeshStandardMaterial({ color: '#b82924', roughness: 0.86 });
    this.capeMat = new THREE.MeshStandardMaterial({ map: capeTexture(), side: THREE.DoubleSide, roughness: 0.9 });
    this.bladeMat = new THREE.MeshStandardMaterial({ color: '#e6eef6', roughness: 0.1, metalness: 1, emissive: '#7ac8ff', emissiveIntensity: 0.12 });
    this.ownedGeos = [];
    this.ownedMats = [this.jacketMat, this.hairMat, this.scarfMat, this.capeMat, this.bladeMat];

    const mk = (g, m, parent, x = 0, y = 0, z = 0) => {
      this.ownedGeos.push(g);
      const me = new THREE.Mesh(g, m);
      me.position.set(x, y, z);
      me.castShadow = !this.lightweight;
      parent.add(me);
      return me;
    };
    const G = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

    const root = new THREE.Group();
    this.root = root;
    scene.add(root);

    const pelvis = G(root, 0, 0.02, 0);
    this.pelvis = pelvis;
    mk(new THREE.CapsuleGeometry(0.15, 0.12, 4, 10), M.pants, pelvis).scale.set(1.25, 1, 0.9);
    mk(new THREE.BoxGeometry(0.34, 0.06, 0.25), M.strap, pelvis, 0, 0.07, 0);
    mk(new THREE.BoxGeometry(0.07, 0.065, 0.03), M.brass, pelvis, 0, 0.07, 0.13);

    const turbineDrum = mk(new THREE.CylinderGeometry(0.085, 0.085, 0.24, 12), M.metal, pelvis, 0, 0.05, -0.19);
    turbineDrum.rotation.z = Math.PI / 2;
    mk(new THREE.CylinderGeometry(0.05, 0.065, 0.08, 10), M.darkMetal, pelvis, 0, 0.02, -0.27).rotation.x = Math.PI / 2;

    this.spearMeshes = [];
    for (const sx of [-1, 1]) {
      const box = mk(new THREE.BoxGeometry(0.1, 0.16, 0.28), M.metal, pelvis, sx * 0.24, 0.01, 0.03);
      box.rotation.x = 0.15;
      const nozzle = mk(new THREE.CylinderGeometry(0.026, 0.035, 0.1, 8), M.darkMetal, box, 0, 0.02, 0.16);
      nozzle.rotation.x = Math.PI / 2;
      const tank = mk(new THREE.CylinderGeometry(0.058, 0.058, 0.52, 10), M.metal, pelvis, sx * 0.2, 0.09, -0.22);
      tank.rotation.x = Math.PI / 2 - 0.28;
      mk(new THREE.CylinderGeometry(0.062, 0.062, 0.05, 10), M.brass, tank, 0, 0.2, 0);
      const sheath = mk(new THREE.BoxGeometry(0.075, 0.15, 0.58), M.sheath, pelvis, sx * 0.27, -0.2, -0.06);
      sheath.rotation.x = -0.52;
      mk(new THREE.BoxGeometry(0.082, 0.156, 0.06), M.strap, sheath, 0, 0, 0.22);
      mk(new THREE.BoxGeometry(0.082, 0.156, 0.06), M.strap, sheath, 0, 0, -0.18);
      for (let k = -1; k <= 1; k++) {
        mk(new THREE.BoxGeometry(0.012, 0.032, 0.11), M.darkMetal, sheath, 0, k * 0.04, 0.32);
      }
      const sp = mk(new THREE.CylinderGeometry(0.036, 0.036, 0.78, 8), M.spear, sheath, sx * 0.058, 0.045, 0.05);
      sp.rotation.x = Math.PI / 2;
      mk(new THREE.ConeGeometry(0.048, 0.16, 8), M.spear, sp, 0, 0.44, 0);
      this.spearMeshes.push(sp);
    }

    const spine = G(pelvis, 0, 0.1, 0);
    this.spine = spine;
    mk(new THREE.CapsuleGeometry(0.165, 0.26, 4, 12), M.pants, spine, 0, 0.22, 0).scale.set(1.08, 1, 0.74);
    mk(new THREE.BoxGeometry(0.38, 0.26, 0.26), this.jacketMat, spine, 0, 0.34, -0.01);
    for (const sx of [-1, 1]) {
      const lapel = mk(new THREE.BoxGeometry(0.11, 0.22, 0.04), this.jacketMat, spine, sx * 0.11, 0.33, 0.125);
      lapel.rotation.z = sx * 0.18;
      const st = mk(new THREE.BoxGeometry(0.032, 0.5, 0.29), M.strap, spine, sx * 0.1, 0.22, 0);
      st.rotation.z = sx * 0.24;
    }
    mk(new THREE.BoxGeometry(0.055, 0.055, 0.02), M.brass, spine, -0.11, 0.38, 0.135);
    mk(new THREE.TorusGeometry(0.185, 0.018, 6, 18), M.strap, spine, 0, 0.12, 0).rotation.x = Math.PI / 2;

    const neck = G(spine, 0, 0.5, 0);
    this.neck = neck;
    mk(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), M.skin, neck, 0, 0.03, 0);
    const scarfRing = mk(new THREE.TorusGeometry(0.082, 0.034, 7, 16), this.scarfMat, neck, 0, 0.01, 0.01);
    scarfRing.rotation.x = Math.PI / 2;
    const scarfTail = mk(new THREE.BoxGeometry(0.065, 0.22, 0.03), this.scarfMat, neck, 0.04, -0.09, -0.09);
    scarfTail.rotation.set(0.35, 0, 0.15);

    const head = G(neck, 0, 0.1, 0);
    this.head = head;
    mk(new THREE.SphereGeometry(0.112, 16, 12), M.skin, head, 0, 0.082, 0.01).scale.set(0.92, 1.06, 1);
    mk(new THREE.ConeGeometry(0.018, 0.045, 5), M.skin, head, 0, 0.075, 0.115).rotation.x = Math.PI / 2 - 0.25;
    for (const sx of [-1, 1]) {
      mk(new THREE.BoxGeometry(0.036, 0.01, 0.015), this.hairMat, head, sx * 0.038, 0.106, 0.098).rotation.z = -sx * 0.12;
      mk(new THREE.SphereGeometry(0.016, 8, 6), M.eyeWhite, head, sx * 0.038, 0.088, 0.098).scale.set(1.15, 0.78, 0.5);
      mk(new THREE.SphereGeometry(0.009, 6, 6), M.eyeDark, head, sx * 0.038, 0.088, 0.106);
    }

    this.hairGroups = {};
    const hBase = mk(new THREE.SphereGeometry(0.118, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.54), this.hairMat, head, 0, 0.112, -0.014);
    hBase.rotation.x = -0.34;
    hBase.scale.set(0.96, 1.02, 1.06);

    const gScout = G(head);
    mk(new THREE.BoxGeometry(0.18, 0.042, 0.065), this.hairMat, gScout, 0, 0.158, 0.075).rotation.x = 0.32;
    for (const sx of [-1, 1]) {
      const lock = mk(new THREE.ConeGeometry(0.032, 0.11, 5), this.hairMat, gScout, sx * 0.085, 0.08, 0.055);
      lock.rotation.set(0.2, 0, sx * 0.15);
    }
    this.hairGroups.scout = gScout;

    const gLevi = G(head);
    for (const sx of [-1, 1]) {
      const curtain = mk(new THREE.BoxGeometry(0.085, 0.09, 0.065), this.hairMat, gLevi, sx * 0.052, 0.132, 0.072);
      curtain.rotation.set(0.25, sx * 0.2, -sx * 0.28);
    }
    this.hairGroups.levi = gLevi;

    const gPony = G(head);
    mk(new THREE.BoxGeometry(0.17, 0.04, 0.065), this.hairMat, gPony, 0, 0.158, 0.074).rotation.x = 0.3;
    const tailPivot = G(gPony, 0, 0.11, -0.11);
    this.ponytailPivot = tailPivot;
    const tailMesh = mk(new THREE.ConeGeometry(0.048, 0.28, 7), this.hairMat, tailPivot, 0, -0.12, -0.04);
    tailMesh.rotation.x = -2.6;
    this.hairGroups.ponytail = gPony;

    const gGar = G(head);
    const band = mk(new THREE.CylinderGeometry(0.116, 0.116, 0.028, 16, 1, true), this.scarfMat, gGar, 0, 0.132, 0.004);
    band.scale.set(0.94, 1, 1.04);
    mk(new THREE.BoxGeometry(0.15, 0.04, 0.06), this.hairMat, gGar, 0, 0.168, 0.06).rotation.x = 0.25;
    this.hairGroups.garrison = gGar;

    this.sh = []; this.el = []; this.hand = []; this.blades = []; this.bladeSteel = [];
    for (const sx of [-1, 1]) {
      const sh = G(spine, sx * 0.23, 0.42, 0);
      mk(new THREE.CapsuleGeometry(0.056, 0.2, 4, 8), this.jacketMat, sh, 0, -0.13, 0);
      const el = G(sh, 0, -0.28, 0);
      mk(new THREE.CapsuleGeometry(0.048, 0.18, 4, 8), this.jacketMat, el, 0, -0.12, 0);
      mk(new THREE.CylinderGeometry(0.054, 0.05, 0.07, 8), M.strap, el, 0, -0.21, 0);
      const hd = G(el, 0, -0.27, 0);
      mk(new THREE.SphereGeometry(0.042, 8, 6), M.skin, hd, 0, -0.02, 0).scale.set(0.9, 1.1, 1.1);
      const bl = new THREE.Group();
      hd.add(bl);
      bl.position.set(0, -0.03, 0.03);
      mk(new THREE.BoxGeometry(0.024, 0.14, 0.048), M.darkMetal, bl, 0, 0.0, 0);
      mk(new THREE.BoxGeometry(0.016, 0.11, 0.035), M.metal, bl, 0, -0.01, 0.042);
      mk(new THREE.BoxGeometry(0.036, 0.022, 0.11), M.metal, bl, 0, 0.075, 0.015);
      const steel = mk(new THREE.BoxGeometry(0.009, 0.92, 0.052), this.bladeMat, bl, 0, 0.54, 0.0);
      this.bladeSteel.push(steel);
      for (let seg = 1; seg <= 5; seg++) {
        const groove = mk(new THREE.BoxGeometry(0.012, 0.006, 0.056), M.darkMetal, steel, 0, -0.42 + seg * 0.15, 0);
        groove.rotation.x = 0.35;
      }
      bl.rotation.set(Math.PI / 2 - 0.1, sx * 0.08, 0);
      this.sh.push(sh); this.el.push(el); this.hand.push(hd); this.blades.push(bl);
    }

    this.th = []; this.kn = [];
    for (const sx of [-1, 1]) {
      const th = G(pelvis, sx * 0.1, -0.06, 0);
      mk(new THREE.CapsuleGeometry(0.072, 0.3, 4, 8), M.pants, th, 0, -0.22, 0);
      mk(new THREE.CylinderGeometry(0.078, 0.075, 0.05, 8), M.strap, th, 0, -0.18, 0);
      const kn = G(th, 0, -0.45, 0);
      mk(new THREE.CapsuleGeometry(0.062, 0.26, 4, 8), M.boots, kn, 0, -0.2, 0);
      mk(new THREE.BoxGeometry(0.1, 0.07, 0.21), M.boots, kn, 0, -0.42, 0.045);
      this.th.push(th); this.kn.push(kn);
    }

    this.buildCape();
    this.slash = 0;
    this.slashSide = 1;
    this.spinAngle = 0;
    this.runPhase = 0;
    this.animTime = 0;
    this.reloadAnim = 0;
    this.spearAnim = 0;
    this.flareAnim = 0;
    this.applyAppearance({ ...DEFAULT_APPEARANCE, ...appearance });
  }

  applyAppearance(app) {
    this.appearance = { ...DEFAULT_APPEARANCE, ...app };
    const A = this.appearance;
    this.hairMat.color.set(A.hairColor);
    this.scarfMat.color.set(A.scarfColor);
    this.jacketMat.color.set(A.jacketColor);
    this.bladeMat.emissive.set(A.bladeAura);
    for (const [k, grp] of Object.entries(this.hairGroups)) {
      grp.visible = k === A.hairStyle;
    }
    const preset = APPEARANCE_PRESETS.capeStyles.find((c) => c.id === A.capeStyle) || APPEARANCE_PRESETS.capeStyles[0];
    this.noCape = A.capeStyle === 'none';
    this.capeMat.color.set(preset.tint);
    if (this.cape) this.cape.visible = this.root.visible && !this.hideCape && !this.noCape;
  }

  triggerReloadAnim() { this.reloadAnim = 0.38; }
  triggerSpearAnim() { this.spearAnim = 0.32; }
  triggerFlareAnim() { this.flareAnim = 0.42; }

  buildCape() {
    const C = this.lightweight ? 4 : 6;
    const R = this.lightweight ? 6 : 9;
    this.capeC = C; this.capeR = R;
    const W = 0.52, L = 0.96;
    this.capeRest = { dx: W / (C - 1), dy: L / (R - 1) };
    this.cp = []; this.cpp = [];
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const p = new THREE.Vector3((c / (C - 1) - 0.5) * W, -r * this.capeRest.dy, 0);
        this.cp.push(p.clone()); this.cpp.push(p.clone());
      }
    }
    const g = new THREE.PlaneGeometry(W, L, C - 1, R - 1);
    this.capeGeo = g;
    this.ownedGeos.push(g);
    this.cape = new THREE.Mesh(g, this.capeMat);
    this.cape.castShadow = !this.lightweight;
    this.cape.frustumCulled = false;
    this.scene.add(this.cape);
    this.capeInit = false;
  }

  anchorPoint(c, out) {
    const W = 0.45;
    return out.set((c / (this.capeC - 1) - 0.5) * W, 0.5, -0.14).applyMatrix4(this.spine.matrixWorld);
  }

  updateCape(dt, vel) {
    if (this.noCape || this.hideCape) {
      this.cape.visible = false;
      return;
    }
    this.cape.visible = this.root.visible;
    const C = this.capeC, R = this.capeR;
    if (this.capeInit && this.anchorPoint(0, _v) && _v.distanceToSquared(this.cp[0]) > 16) this.capeInit = false;
    if (!this.capeInit) {
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
          this.anchorPoint(c, _v);
          const i = r * C + c;
          this.cp[i].copy(_v).y -= r * this.capeRest.dy;
          this.cpp[i].copy(this.cp[i]);
        }
      }
      this.capeInit = true;
    }
    if (dt <= 0) return;
    const steps = this.lightweight ? 2 : 3;
    const iters = this.lightweight ? 2 : 4;
    const h = Math.min(dt, 0.05) / steps;
    const t = this.animTime;
    for (let s = 0; s < steps; s++) {
      for (let i = C; i < C * R; i++) {
        const p = this.cp[i], pp = this.cpp[i];
        const vx = (p.x - pp.x) * 0.985, vy = (p.y - pp.y) * 0.985, vz = (p.z - pp.z) * 0.985;
        pp.copy(p);
        const flutter = Math.sin(t * 13 + i * 0.7) * 0.25;
        const ax = -vel.x * 1.6 + flutter, ay = -9.8 - vel.y * 1.6, az = -vel.z * 1.6 + flutter;
        p.x += vx + ax * h * h * 4; p.y += vy + ay * h * h * 4; p.z += vz + az * h * h * 4;
      }
      for (let c = 0; c < C; c++) { this.anchorPoint(c, this.cp[c]); this.cpp[c].copy(this.cp[c]); }
      for (let it = 0; it < iters; it++) {
        for (let r = 0; r < R; r++) {
          for (let c = 0; c < C; c++) {
            const i = r * C + c;
            if (c < C - 1) this.solve(i, i + 1, this.capeRest.dx, r === 0);
            if (r < R - 1) this.solve(i, i + C, this.capeRest.dy, r === 0);
          }
        }
        this.spine.getWorldPosition(_w);
        _w.y += 0.15;
        for (let i = C; i < C * R; i++) {
          const p = this.cp[i];
          _v.subVectors(p, _w);
          const d = _v.length();
          if (d < 0.26 && d > 1e-6) p.addScaledVector(_v.divideScalar(d), 0.26 - d);
        }
      }
    }
    const pos = this.capeGeo.attributes.position;
    for (let i = 0; i < C * R; i++) pos.setXYZ(i, this.cp[i].x, this.cp[i].y, this.cp[i].z);
    pos.needsUpdate = true;
    this.capeGeo.computeVertexNormals();
  }

  solve(a, b, rest, pinA) {
    const pa = this.cp[a], pb = this.cp[b];
    _v.subVectors(pb, pa);
    const d = _v.length() || 1e-6;
    const diff = (d - rest) / d;
    if (pinA) pb.addScaledVector(_v, -diff);
    else { pa.addScaledVector(_v, diff * 0.5); pb.addScaledVector(_v, -diff * 0.5); }
  }

  bladeTip(i, out) { return out.set(0, 0.98, 0).applyMatrix4(this.blades[i].matrixWorld); }
  bladeBase(i, out) { return out.set(0, 0.12, 0).applyMatrix4(this.blades[i].matrixWorld); }
  gearPos(side, out) { return out.set(side * 0.26, 0, 0.12).applyMatrix4(this.pelvis.matrixWorld); }

  update(dt, pos, quat, st) {
    this.animTime += dt;
    this.reloadAnim = Math.max(0, this.reloadAnim - dt);
    this.spearAnim = Math.max(0, this.spearAnim - dt);
    this.flareAnim = Math.max(0, this.flareAnim - dt);
    const r = this.root;
    r.position.copy(pos);
    r.quaternion.copy(quat);
    if (st.spin) {
      this.spinAngle += dt * 28;
      r.rotateZ(this.spinAngle);
    } else this.spinAngle = 0;
    const D = (o, prop, v, k = 14) => { o[prop] = damp(o[prop], v, k, dt); };
    this.runPhase += dt * (st.wall ? Math.max(st.speed, 6) * 1.25 : st.grounded ? st.speed * 1.25 : 0);
    const ph = this.runPhase;
    const run = st.wall ? 1 : st.grounded ? clamp(st.speed / 9, 0, 1) : 0;
    const air = st.grounded || st.wall ? 0 : 1;
    if (st.grounded && this.wasAir && (this.prevVy || 0) < -5) this.landK = clamp(-this.prevVy / 20, 0.3, 1);
    this.wasAir = !st.grounded; this.prevVy = st.vel ? st.vel.y : 0;
    const lk = (this.landK = damp(this.landK || 0, 0, 4.5, dt));
    for (let i = 0; i < 2; i++) {
      const sw = Math.sin(ph + i * Math.PI);
      const airTh = st.hooked ? -0.25 - i * 0.35 : -0.6 + i * 0.25;
      const airKn = st.hooked ? 0.5 + i * 0.4 : 1.1 - i * 0.2;
      D(this.th[i].rotation, 'x', lerp(-sw * 0.9 * run, airTh, air) - lk * (1.0 + i * 0.25));
      D(this.kn[i].rotation, 'x', lerp(Math.max(0, -Math.sin(ph + i * Math.PI + 0.9)) * 1.3 * run + 0.05, airKn, air) + lk * (1.6 + i * 0.3));
      D(this.th[i].rotation, 'z', (i ? -1 : 1) * (air * 0.12));
      this.spearMeshes[i].visible = (st.spears || 0) > i;
    }
    if (this.ponytailPivot && this.hairGroups.ponytail.visible) {
      this.ponytailPivot.rotation.x = damp(this.ponytailPivot.rotation.x, clamp(st.speed * 0.03, 0, 0.9) + Math.sin(this.animTime * 9) * 0.08, 8, dt);
    }

    const sl = st.slashT;
    const chargeShake = (st.charge || 0) > 0.1 ? Math.sin(this.animTime * 55) * 0.04 * st.charge : 0;
    for (let i = 0; i < 2; i++) {
      const sg = i ? 1 : -1;
      let sx = lerp(Math.sin(ph + i * Math.PI) * 0.7 * run, 0.55, air);
      let sz = sg * lerp(0.15, 0.55, air);
      let ex = lerp(-0.6 * run - 0.2, -0.35, air);
      let hx = lerp(1.15 - 0.3 * run, 1.95, air);
      if (st.fp) {
        const swayX = clamp(-(st.latVel || 0) * 0.012, -0.18, 0.18);
        const bob = Math.sin(ph + i * Math.PI) * 0.08 * run + Math.sin(this.animTime * 2.4 + i) * 0.022;
        sx = -1.52 - air * 0.12 - (st.pitch || 0) * 0.85 + bob + chargeShake;
        sz = sg * (0.34 + (st.charge || 0) * 0.22) + swayX;
        ex = -0.48 - (st.charge || 0) * 0.25;
        hx = 0.32 + air * 0.08;
        if (this.reloadAnim > 0) {
          const rp = 1 - this.reloadAnim / 0.38;
          sx = rp < 0.45 ? lerp(-1.52, 0.2, rp / 0.45) : lerp(0.2, -1.56, (rp - 0.45) / 0.55);
          hx = lerp(1.3, 0.32, rp);
        }
        if (i === 0 && this.spearAnim > 0) {
          sx -= Math.sin((this.spearAnim / 0.32) * Math.PI) * 0.55;
        }
        if (i === 1 && this.flareAnim > 0) {
          sx = -2.0; sz = 0.12; ex = -0.2;
        }
      }
      if (st.spin) { sx = -0.2; sz = sg * 1.45; ex = -0.05; hx = 0.1; }
      else if (sl >= 0 && st.fp) {
        const w = sl < 0.22 ? sl / 0.22 : 1;
        const sweep = sl < 0.22 ? 0 : Math.min(1, (sl - 0.22) / 0.42);
        sx = lerp(lerp(-1.18, -2.15, w), -0.65, sweep);
        sz = sg * lerp(lerp(0.28, 1.05, w), -0.52, sweep);
        ex = lerp(-0.92, -0.12, sweep);
        hx = lerp(0.45, -0.55, sweep);
      } else if (sl >= 0) {
        const k = sl < 0.22 ? sl / 0.22 : 1 - (sl - 0.22) / 0.78;
        const sweep = sl < 0.22 ? 0 : (sl - 0.22) / 0.78;
        sx = lerp(1.25, -2.05, sweep) * (sl < 0.22 ? k : 1);
        sz = sg * lerp(1.38, -0.15, sweep);
        ex = -0.2;
        hx = lerp(1.9, -0.25, Math.min(1, sweep * 1.6));
      } else if (st.wall === 'climb' && !st.fp) {
        sx = -2.5 + Math.sin(ph + i * Math.PI) * 0.55; sz = sg * 0.3; ex = -0.5 - Math.max(0, Math.sin(ph + i * Math.PI)) * 0.5; hx = 0.3;
      } else if (st.grabbed) {
        sx = Math.sin(this.animTime * 20 + i) * 0.8 - 1.5; sz = sg * 0.8;
      }
      D(this.sh[i].rotation, 'x', sx, sl >= 0 ? 48 : 16);
      D(this.sh[i].rotation, 'z', sz, sl >= 0 ? 48 : 16);
      D(this.el[i].rotation, 'x', ex, 22);
      D(this.hand[i].rotation, 'x', hx, sl >= 0 ? 48 : 18);
      this.bladeSteel[i].visible = (st.blade ?? 100) > 0;
    }
    for (const bl of this.blades) bl.scale.y = damp(bl.scale.y, st.fp ? 0.68 : 1, 12, dt);
    this.bladeMat.emissiveIntensity = damp(this.bladeMat.emissiveIntensity, st.speed > 22 || st.spin || sl >= 0 ? 1.35 : 0.14, 8, dt);
    D(this.spine.rotation, 'x', lerp(run * 0.35, st.hooked ? 0.15 : 0.35, air) + lk * 0.5);
    D(this.spine.rotation, 'y', sl >= 0 ? Math.sin(sl * Math.PI) * 0.78 : 0, 24);
    this.head.visible = !st.fp;
    D(this.head.rotation, 'x', -this.spine.rotation.x * 0.6);
    this.pelvis.position.y = 0.02 + (st.grounded ? Math.abs(Math.cos(ph)) * 0.04 * run : 0) - lk * 0.34;
    r.updateMatrixWorld(true);
    this.updateCape(dt, st.vel);
  }

  setVisible(v) {
    this.root.visible = v;
    this.cape.visible = v && !this.hideCape && !this.noCape;
  }

  dispose() {
    this.scene.remove(this.root);
    this.scene.remove(this.cape);
    for (const g of this.ownedGeos) g.dispose();
    for (const m of this.ownedMats) m.dispose();
  }
}
