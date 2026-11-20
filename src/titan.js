import * as THREE from 'three';
import { Capsule } from './collision.js';
import { clamp, damp, lerp, rand, randSign, mulberry32 } from './util.js';
import { skinTextures } from './textures.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// collapse static child meshes of every joint into one mesh per material (draw-call reduction)
function mergeJoints(root) {
  const groups = [];
  root.traverse((o) => { if (o.isGroup) groups.push(o); });
  for (const g of groups) {
    const byMat = new Map();
    for (const c of g.children) if (c.isMesh) { if (!byMat.has(c.material)) byMat.set(c.material, []); byMat.get(c.material).push(c); }
    for (const [mat, list] of byMat) {
      if (list.length < 2) continue;
      const geos = list.map((m) => { m.updateMatrix(); const gg = m.geometry.index ? m.geometry.clone() : m.geometry.clone(); gg.applyMatrix4(m.matrix); return gg; });
      const merged = mergeGeometries(geos.map((x) => (x.index ? x : x)), false);
      if (!merged) continue;
      for (const m of list) { g.remove(m); m.geometry.dispose(); }
      geos.forEach((x) => x.dispose());
      const mm = new THREE.Mesh(merged, mat); mm.castShadow = mm.receiveShadow = true; g.add(mm);
    }
  }
}

let SKIN = null;
const _qIK = new THREE.Quaternion(), AX_X = new THREE.Vector3(1, 0, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

// muted, slightly grey flesh: titans read as pale and unwell rather than cartoon pink
const SKIN_TONES = ['#b9998a', '#b08f80', '#a3857a', '#c2a497', '#94786c', '#b59487', '#a99389'];

function skinMaterial(tone) {
  if (!SKIN) SKIN = skinTextures();
  const m = new THREE.MeshStandardMaterial({ color: tone, map: SKIN.map, normalMap: SKIN.normalMap, roughness: 0.58, metalness: 0 });
  m.normalScale.set(0.9, 0.9);
  const u = { uHit: { value: 0 }, uDead: { value: 0 } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uHit; uniform float uDead; varying vec3 vWP;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float mott = sin(vWP.x*1.7+vWP.y*0.9)*sin(vWP.z*1.3-vWP.y*1.1)*0.5+0.5;
        diffuseColor.rgb *= mix(vec3(0.93,0.9,0.92), vec3(1.05,0.98,0.94), mott);
        diffuseColor.rgb *= mix(vec3(0.5,0.42,0.34), vec3(1.0), smoothstep(0.1, 2.2, vWP.y));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float rim = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.5);
        // fake subsurface: warm reddish rim + soft wrap
        totalEmissiveRadiance += vec3(0.5, 0.17, 0.12) * rim * 0.2;
        totalEmissiveRadiance += vec3(1.0, 0.2, 0.1) * uHit * (0.4 + rim);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.45, 0.32, 0.3), uDead);
        totalEmissiveRadiance += vec3(0.9, 0.3, 0.1) * uDead * rim * 0.6;`);
  };
  return m;
}

function limbGeo(len, r0, r1, bulge = 0.15, bulgeAt = 0.3, seg = 14) {
  const pts = [];
  const N = 12;
  pts.push(new THREE.Vector2(0.001, 0.02 * len));
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let r = lerp(r0, r1, t) + Math.sin(Math.PI * clamp((t - bulgeAt + 0.3) / 0.6, 0, 1)) * bulge * r0;
    pts.push(new THREE.Vector2(r, -t * len));
  }
  pts.push(new THREE.Vector2(0.001, -len - 0.02 * len));
  return new THREE.LatheGeometry(pts, seg);
}

// a procedurally-built humanoid giant. Units are "10 tall" then scaled.
export class Titan {
  constructor(game, pos, opts = {}) {
    this.game = game;
    this.height = opts.height ?? rand(7, 15);
    this.type = opts.type ?? 'normal';
    this.passive = !!opts.passive;
    this.s = this.height / 10;
    this.seed = Math.floor(Math.random() * 1e9);
    const r = mulberry32(this.seed);
    this.r = r;
    this.alive = true;
    this.state = 'emerge';
    this.stateT = 0;
    this.heading = Math.random() * Math.PI * 2;
    this.walkPhase = 0;
    this.speed = 0;
    this.napeHP = 380 + this.height * 26;
    this.hp = this.napeHP;
    this.regen = 0;
    this.hitFlash = 0;
    this.blind = 0; this.armCut = [0, 0]; this.legCut = 0;
    this.grabSide = 1;
    this.reachT = 0;
    this.cooldown = rand(1, 2.5);
    this.stuckT = 0; this.detour = 0; this.detourDir = 1;
    this.steamT = 0;
    this.deadT = 0;
    this.footPrev = [0, 0];
    this.prop = {
      head: lerp(0.85, 1.35, r()) * (this.type === 'abnormal' ? 1.15 : 1),
      arm: lerp(0.9, 1.15, r()) * (this.type === 'abnormal' ? 1.2 : 1),
      girth: lerp(0.85, 1.25, r()),
      belly: r() < 0.3 ? lerp(0.3, 0.8, r()) : 0,
      grin: r(),
      hair: r(),
    };
    this.build(opts.tone || SKIN_TONES[Math.floor(r() * SKIN_TONES.length)]);
    this.root.position.copy(pos);
    this.root.rotation.y = this.heading;
    game.scene.add(this.root);
    this.parts = [];
    this.makeHitboxes();
    this.nape = { c: new THREE.Vector3(), r: 0.6 * this.s };
    this.update(0);
  }

  build(tone) {
    const P = this.prop;
    const mat = skinMaterial(tone);
    this.mat = mat;
    const dark = new THREE.MeshStandardMaterial({ color: '#1a0c0a', roughness: 0.9 });
    const teethM = new THREE.MeshStandardMaterial({ color: '#efe6d2', roughness: 0.4 });
    const eyeM = new THREE.MeshStandardMaterial({ color: '#cfc4b0', roughness: 0.15 });
    const irisM = new THREE.MeshStandardMaterial({ color: ['#3a2a1a', '#2c3a30', '#4a3a22'][Math.floor(this.r() * 3)], roughness: 0.1 });
    const hairM = new THREE.MeshStandardMaterial({ color: ['#2b1d14', '#4a3020', '#191512', '#6b4a2a'][Math.floor(this.r() * 4)], roughness: 0.8 });
    const mk = (g, m = mat, parent) => {
      const me = new THREE.Mesh(g, m);
      me.castShadow = true;
      me.receiveShadow = true;
      if (parent) parent.add(me);
      return me;
    };
    const G = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
    const root = new THREE.Group();
    this.root = root;
    const body = G(root);
    body.scale.setScalar(this.s);
    this.body = body;
    const g = P.girth;
    const hips = G(body, 0, 5.05, 0); this.hips = hips;
    // pelvis
    const pel = mk(new THREE.SphereGeometry(1, 20, 14), mat, hips); pel.scale.set(1.0 * g, 0.62, 0.72 * g); pel.position.y = 0.1;
    const spine = G(hips, 0, 0.15, 0); this.spine = spine;
    // torso lathe
    const tp = [[0.001, 0], [0.95, 0.05], [0.88, 0.5], [0.84, 0.95], [0.98, 1.5], [1.12, 2.0], [1.05, 2.35], [0.62, 2.62], [0.35, 2.75], [0.001, 2.78]];
    const torso = mk(new THREE.LatheGeometry(tp.map(([x, y]) => new THREE.Vector2(x * g, y)), 22), mat, spine);
    torso.scale.set(1, 1, 0.68);
    // pecs, belly, shoulders blades
    for (const sx of [-1, 1]) {
      const pec = mk(new THREE.SphereGeometry(0.55, 16, 12), mat, spine); pec.scale.set(1.05 * g, 0.62, 0.42); pec.position.set(sx * 0.45 * g, 1.95, 0.52 * g); pec.rotation.z = sx * 0.2;
      const lat = mk(new THREE.SphereGeometry(0.5, 12, 10), mat, spine); lat.scale.set(0.6, 1.3, 0.5); lat.position.set(sx * 0.7 * g, 1.5, -0.2);
      const glute = mk(new THREE.SphereGeometry(0.55, 14, 10), mat, hips); glute.position.set(sx * 0.42 * g, -0.05, -0.38 * g);
    }
    if (P.belly > 0) { const b = mk(new THREE.SphereGeometry(1, 20, 14), mat, spine); b.scale.set(0.95 * g, 0.85, 0.55 + P.belly * 0.5); b.position.set(0, 0.75, 0.25 * g); }
    for (let i = 0; i < 3; i++) { const ab = mk(new THREE.SphereGeometry(0.22, 10, 8), mat, spine); ab.scale.set(1.8, 0.8, 0.6); ab.position.set(0, 0.5 + i * 0.36, 0.56 * g); }
    const chest = G(spine, 0, 2.3, 0); this.chest = chest;
    // trapezius slopes from neck to shoulders, collarbones under the skin
    for (const sx of [-1, 1]) {
      const trap = mk(new THREE.SphereGeometry(0.5, 14, 10), mat, chest); trap.scale.set(1.3 * g, 0.55, 0.8); trap.position.set(sx * 0.48 * g, 0.28, -0.18); trap.rotation.z = -sx * 0.35;
      const clav = mk(new THREE.CapsuleGeometry(0.07, 0.75 * g, 3, 8), mat, chest); clav.rotation.z = Math.PI / 2 + sx * 0.12; clav.position.set(sx * 0.5 * g, 0.2, 0.42 * g);
    }
    const neck = G(chest, 0, 0.35, -0.05); this.neck = neck;
    mk(limbGeo(0.9, 0.42, 0.5, 0, 0.5, 14), mat, neck).rotation.x = Math.PI;
    const head = G(neck, 0, 0.75, 0.05); this.head = head;
    const hs = P.head;
    const skull = mk(new THREE.SphereGeometry(0.85 * hs, 24, 18), mat, head); skull.scale.set(0.92, 1.12, 1.0); skull.position.set(0, 0.55 * hs, 0);
    const jaw = mk(new THREE.SphereGeometry(0.7 * hs, 20, 14), mat, head); jaw.scale.set(0.95, 0.7, 1.0); jaw.position.set(0, 0.05 * hs, 0.12 * hs); this.jaw = jaw; this.jawY0 = jaw.position.y; this.jawDrop = 0.32 * hs;
    // brow ridge + nose + ears
    const brow = mk(new THREE.CapsuleGeometry(0.11 * hs, 0.7 * hs, 4, 10), mat, head); brow.rotation.z = Math.PI / 2; brow.position.set(0, 0.72 * hs, 0.72 * hs);
    const nose = mk(new THREE.ConeGeometry(0.13 * hs, 0.36 * hs, 10), mat, head); nose.position.set(0, 0.5 * hs, 0.86 * hs); nose.rotation.x = 0.35;
    for (const sx of [-1, 1]) {
      const ear = mk(new THREE.SphereGeometry(0.2 * hs, 10, 8), mat, head); ear.scale.set(0.4, 1, 0.7); ear.position.set(sx * 0.8 * hs, 0.5 * hs, 0);
      const socket = mk(new THREE.SphereGeometry(0.2 * hs, 12, 10), dark, head); socket.scale.set(1.1, 0.75, 0.5); socket.position.set(sx * 0.3 * hs, 0.6 * hs, 0.74 * hs);
      const eye = mk(new THREE.SphereGeometry(0.12 * hs, 14, 10), eyeM, head); eye.position.set(sx * 0.3 * hs, 0.6 * hs, 0.72 * hs);
      const look = (this.r() - 0.5) * 0.05 * hs;
      const iris = mk(new THREE.SphereGeometry(0.075 * hs, 12, 8), irisM, head); iris.scale.set(1, 1, 0.5); iris.position.set(sx * 0.3 * hs + look, 0.6 * hs, 0.815 * hs);
      const pupil = mk(new THREE.SphereGeometry(0.035 * hs, 8, 6), dark, head); pupil.scale.set(1, 1, 0.4); pupil.position.set(sx * 0.3 * hs + look, 0.6 * hs, 0.845 * hs);
      const lid = mk(new THREE.SphereGeometry(0.135 * hs, 12, 8, 0, Math.PI * 2, 0, Math.PI * (0.38 + this.r() * 0.1)), mat, head); lid.position.copy(eye.position); lid.rotation.x = 0.35;
    }
    // grin: dark mouth + teeth arc
    const grinW = lerp(0.35, 0.75, P.grin);
    const mouth = mk(new THREE.SphereGeometry(0.5 * hs, 20, 10, -grinW * 1.2 + Math.PI / 2, grinW * 2.4, Math.PI * 0.52, Math.PI * 0.14), dark, head);
    mouth.position.set(0, 0.42 * hs, 0.25 * hs); mouth.scale.set(1.2, 1, 1.25);
    const nt = Math.round(10 + grinW * 10);
    for (let i = 0; i < nt; i++) {
      const a = (i / (nt - 1) - 0.5) * grinW * 2.1;
      for (const row of [0, 1]) {
        const tooth = mk(new THREE.BoxGeometry(0.075 * hs, 0.11 * hs, 0.05 * hs), teethM, head);
        const rad = 0.66 * hs;
        tooth.position.set(Math.sin(a) * rad * 0.95, (0.17 + row * 0.11 - Math.cos(a * 2) * 0.03) * hs, Math.cos(a) * rad * 0.92 + 0.08 * hs);
        tooth.rotation.y = a;
      }
    }
    if (P.hair > 0.35) {
      const cap = mk(new THREE.SphereGeometry(0.9 * hs, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM, head);
      cap.scale.set(0.98, 1.1, 1.06); cap.position.set(0, 0.62 * hs, -0.05 * hs); cap.rotation.x = -0.25;
      if (P.hair > 0.7) for (let i = 0; i < 9; i++) {
        const tuft = mk(new THREE.ConeGeometry(0.2 * hs, 0.7 * hs, 6), hairM, head);
        const a = (i / 9) * Math.PI * 2;
        tuft.position.set(Math.sin(a) * 0.6 * hs, 0.95 * hs, Math.cos(a) * 0.55 * hs - 0.1 * hs);
        tuft.rotation.set(Math.cos(a) * 0.9, 0, -Math.sin(a) * 0.9);
      }
    }
    // arms
    this.shoulders = []; this.elbows = []; this.wrists = [];
    const al = P.arm;
    for (const sx of [-1, 1]) {
      const sh = G(chest, sx * 1.02 * g, 0.05, -0.05);
      const delt = mk(new THREE.SphereGeometry(0.52, 16, 12), mat, sh); delt.scale.set(1.0, 0.9, 0.95);
      mk(limbGeo(2.0 * al, 0.46, 0.33, 0.2, 0.35), mat, sh);
      // biceps / triceps masses break the tube silhouette
      const bi = mk(new THREE.SphereGeometry(0.3, 14, 10), mat, sh); bi.scale.set(0.95, 2.0, 1.0); bi.position.set(0, -0.85 * al, 0.14);
      const tri = mk(new THREE.SphereGeometry(0.3, 14, 10), mat, sh); tri.scale.set(1.0, 2.2, 0.9); tri.position.set(0, -0.75 * al, -0.13);
      const el = G(sh, 0, -2.0 * al, 0);
      mk(new THREE.SphereGeometry(0.34, 12, 10), mat, el).scale.set(0.82, 0.9, 0.78);
      mk(limbGeo(1.85 * al, 0.36, 0.24, 0.22, 0.2), mat, el);
      const fa = mk(new THREE.SphereGeometry(0.26, 12, 10), mat, el); fa.scale.set(1.05, 2.0, 0.95); fa.position.set(sx * 0.08, -0.55 * al, 0.05);
      const wr = G(el, 0, -1.85 * al, 0);
      const palm = mk(new THREE.BoxGeometry(0.5, 0.62, 0.22), mat, wr); palm.position.set(0, -0.32, 0.03);
      for (let f = 0; f < 4; f++) {
        const fg = mk(new THREE.CapsuleGeometry(0.07, 0.38, 3, 6), mat, wr);
        fg.position.set(-0.18 + f * 0.12, -0.78, 0.04); fg.rotation.x = 0.25;
      }
      const thumb = mk(new THREE.CapsuleGeometry(0.08, 0.3, 3, 6), mat, wr); thumb.position.set(-sx * 0.26, -0.4, 0.14); thumb.rotation.z = -sx * 0.6;
      this.shoulders.push(sh); this.elbows.push(el); this.wrists.push(wr);
    }
    // legs
    this.thighs = []; this.knees = []; this.ankles = [];
    for (const sx of [-1, 1]) {
      const hp = G(hips, sx * 0.5 * g, -0.05, 0);
      mk(limbGeo(2.45, 0.62 * g, 0.4, 0.15, 0.25), mat, hp);
      const quad = mk(new THREE.SphereGeometry(0.42, 14, 10), mat, hp); quad.scale.set(1.0 * g, 2.3, 0.9); quad.position.set(0, -1.15, 0.2);
      const ham = mk(new THREE.SphereGeometry(0.4, 14, 10), mat, hp); ham.scale.set(1.0 * g, 2.0, 0.85); ham.position.set(0, -1.0, -0.18);
      const kn = G(hp, 0, -2.45, 0);
      const cap = mk(new THREE.SphereGeometry(0.33, 12, 10), mat, kn); cap.position.z = 0.06; cap.scale.set(0.85, 0.8, 0.62);
      mk(limbGeo(2.35, 0.45, 0.27, 0.25, 0.15), mat, kn);
      const calf = mk(new THREE.SphereGeometry(0.34, 14, 10), mat, kn); calf.scale.set(0.95, 2.1, 0.95); calf.position.set(0, -0.75, -0.14);
      const an = G(kn, 0, -2.35, 0);
      const foot = mk(new THREE.CapsuleGeometry(0.24, 0.7, 4, 10), mat, an);
      foot.rotation.x = Math.PI / 2; foot.position.set(0, -0.12, 0.3); foot.scale.set(1.2, 1, 0.75);
      this.thighs.push(hp); this.knees.push(kn); this.ankles.push(an);
    }
    mergeJoints(root);
  }

  makeHitboxes() {
    const s = this.s;
    const def = (kind, a, b, ar, br, r, side = 0, extra = {}) => {
      const c = new Capsule(new THREE.Vector3(), new THREE.Vector3(), r * s, { surface: 'flesh', owner: this, part: kind });
      c.side = side; c.ja = a; c.jb = b; c.la = ar; c.lb = br; Object.assign(c, extra);
      this.parts.push(c);
      return c;
    };
    def('torso', this.spine, this.chest, new THREE.Vector3(0, 0.4, 0), new THREE.Vector3(0, 0.1, 0), 1.0 * this.prop.girth);
    def('head', this.head, this.head, new THREE.Vector3(0, 0.15 * this.prop.head, 0.05), new THREE.Vector3(0, 0.7 * this.prop.head, 0), 0.85 * this.prop.head);
    def('neck', this.neck, this.head, new THREE.Vector3(), new THREE.Vector3(), 0.48);
    for (let i = 0; i < 2; i++) {
      const sd = i === 0 ? -1 : 1;
      def('arm', this.shoulders[i], this.elbows[i], new THREE.Vector3(), new THREE.Vector3(), 0.42, sd);
      def('arm', this.elbows[i], this.wrists[i], new THREE.Vector3(), new THREE.Vector3(), 0.34, sd);
      def('hand', this.wrists[i], this.wrists[i], new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, -0.8, 0), 0.38, sd);
      def('leg', this.thighs[i], this.knees[i], new THREE.Vector3(), new THREE.Vector3(), 0.55, sd);
      def('ankle', this.knees[i], this.ankles[i], new THREE.Vector3(), new THREE.Vector3(), 0.42, sd);
    }
  }

  updateHitboxes() {
    this.root.updateMatrixWorld(true);
    for (const c of this.parts) {
      c.a.copy(c.la).applyMatrix4(c.ja.matrixWorld);
      c.b.copy(c.lb).applyMatrix4(c.jb.matrixWorld);
    }
    this.nape.c.set(0, 0.45, -0.5).applyMatrix4(this.neck.matrixWorld);
  }

  handPos(i, out) { return out.set(0, -0.55, 0.05).applyMatrix4(this.wrists[i].matrixWorld); }
  mouthPos(out) { return out.set(0, 0.3 * this.prop.head, 0.9 * this.prop.head).applyMatrix4(this.head.matrixWorld); }

  setState(s) { this.state = s; this.stateT = 0; }

  // aim an arm (shoulder joint) to a world target
  aimArm(i, target, w, ik = false) { (this.armAim || (this.armAim = []))[i] = { t: target.clone(), w, ik }; }
  applyArmAim() {
    if (!this.armAim) return;
    for (let i = 0; i < 2; i++) { const a = this.armAim[i]; if (a) this._aim(i, a.t, a.w, a.ik); this.armAim[i] = null; }
  }
  _aim(i, target, w, ik) {
    const sh = this.shoulders[i], el = this.elbows[i];
    sh.parent.updateMatrixWorld(true);
    const local = sh.parent.worldToLocal(_v.copy(target)).sub(sh.position);
    const d = local.length();
    _q.setFromUnitVectors(DOWN, local.normalize());
    let bend = 0.15;
    if (ik) {
      // two-bone solve so the hand lands on the target instead of overshooting it
      const a = el.position.length(), b = this.wrists[i].position.length() + 0.55;
      const dc = clamp(d, Math.abs(a - b) + 0.05, a + b - 0.05);
      bend = Math.PI - Math.acos(clamp((a * a + b * b - dc * dc) / (2 * a * b), -1, 1));
      _qIK.setFromAxisAngle(AX_X, Math.acos(clamp((a * a + dc * dc - b * b) / (2 * a * dc), -1, 1)));
      _q.multiply(_qIK);
    }
    sh.quaternion.slerp(_q, w);
    el.rotation.x = lerp(el.rotation.x, -bend, w);
  }

  hit(part, dmg, point, dir, side = 0) {
    if (!this.alive) return { result: 'none' };
    this.hitFlash = 1;
    const g = this.game;
    if (part === 'nape') {
      if (dmg >= this.hp) { this.die(dir); return { result: 'kill' }; }
      this.hp -= dmg;
      this.regen = 2.5;
      return { result: 'nape' };
    }
    if (part === 'ankle' || part === 'leg') {
      this.legCut = 6 + dmg / 300;
      if (this.state !== 'grab') this.setState('kneel');
      g.audio.roar(this.root.position, this.height, 0.8);
      return { result: 'ankle' };
    }
    if (part === 'arm' || part === 'hand') {
      const i = side === 1 ? 1 : 0;
      this.armCut[i] = 7;
      if (this.state === 'grab' && i === this.grabSide) { g.player.releaseGrab(this); this.setState('chase'); }
      return { result: 'arm' };
    }
    if (part === 'head' || part === 'neck') { this.blind = 5; return { result: 'eyes' }; }
    return { result: 'deflect' };
  }

  die(dir) {
    this.alive = false;
    this.setState('dead');
    this.fallDir = this.root.rotation.y;
    if (this.game.player.grabbedBy === this) this.game.player.releaseGrab(this);
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    this.stateT += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.mat.userData.u.uHit.value = this.hitFlash;
    this.blind = Math.max(0, this.blind - dt);
    this.armCut[0] = Math.max(0, this.armCut[0] - dt); this.armCut[1] = Math.max(0, this.armCut[1] - dt);
    if (this.regen > 0) { this.regen -= dt; } else this.hp = Math.min(this.napeHP, this.hp + dt * 200);
    this.cooldown -= dt;
    this.lungeCD = (this.lungeCD || 0) - dt;
    const pos = this.root.position;
    const s = this.s;
    let targetSpeed = 0;
    let lean = 0;
    let wantHeading = this.heading;
    const toP = _v2.subVectors(p.pos, pos);
    const distH = Math.hypot(toP.x, toP.z);
    const abn = this.type === 'abnormal';
    const reach = 4.2 * s * this.prop.arm;
    const canSee = this.blind <= 0 && !p.dead;

    if (this.state === 'emerge') {
      this.body.position.y = lerp(-this.height * 0.4, 0, Math.min(1, this.stateT / 2.2));
      if (Math.random() < dt * 30) g.vfx.steam(_v.copy(pos).add(new THREE.Vector3(rand(-3, 3) * s, rand(2, 9) * s, rand(-3, 3) * s)), s * 2.5, 1.5);
      if (this.stateT > 2.2) { this.body.position.y = 0; this.setState(this.passive ? 'wander' : 'chase'); }
    } else if (this.state === 'dead') {
      this.updateDead(dt);
      return;
    } else if (this.state === 'kneel') {
      this.legCut -= dt;
      if (this.legCut <= 0) this.setState('chase');
    } else if (this.state === 'grab') {
      // hold player and bring to mouth
      const i = this.grabSide;
      const t = clamp(this.stateT / 3.6, 0, 1);
      const mouth = this.mouthPos(new THREE.Vector3());
      const front = new THREE.Vector3(Math.sin(this.heading), 0.2, Math.cos(this.heading)).multiplyScalar(2.6 * s);
      const tgt = mouth.add(front.multiplyScalar(1 - t));
      this.aimArm(i, tgt, lerp(0.6, 1, Math.min(1, t * 2)), true);
      if (this.stateT > 4.0) { p.eaten(this); this.setState('chase'); this.cooldown = 4; }
    } else {
      // locomotion states
      if (!canSee || this.passive) {
        if (this.state !== 'wander') this.setState('wander');
        if (this.stateT > 4 || !this.wanderH) { this.wanderH = Math.random() * Math.PI * 2; this.stateT = 0; }
        wantHeading = this.wanderH;
        targetSpeed = 1.1 * s;
        if (!this.passive && canSee) this.setState('chase');
      } else if (this.state === 'reach') {
        const i = this.grabSide;
        const t = this.stateT / 1.3;
        const w = Math.sin(Math.min(1, t) * Math.PI);
        // aim slightly behind player for a fair dodge
        const tgt = _v.copy(p.pos).addScaledVector(p.vel, -0.05);
        if (this.armCut[i] <= 0) this.aimArm(i, tgt, w * 0.9);
        wantHeading = Math.atan2(toP.x, toP.z);
        targetSpeed = 0.4 * s;
        if (this.armCut[i] <= 0 && t > 0.35 && t < 0.85 && !p.grabbedBy && p.invuln <= 0) {
          const hp = this.handPos(i, new THREE.Vector3());
          if (hp.distanceTo(p.pos) < 1.15 * s + 0.6) {
            if (p.vel.length() > 24) { p.knockback(_v.subVectors(p.pos, hp).normalize(), 18, 22); }
            else { p.grab(this); this.setState('grab'); }
          }
        }
        if (t >= 1) { this.setState('chase'); this.cooldown = rand(0.8, 2.2) / (abn ? 2 : 1); }
      } else {
        if (this.state !== 'chase') this.setState('chase');
        wantHeading = Math.atan2(toP.x, toP.z);
        targetSpeed = (abn ? 8.5 : 3.0) * Math.sqrt(s) * (distH < reach * 1.3 ? 0.3 : 1);
        lean = abn ? 0.55 : 0.08;
        const pyRel = p.pos.y - pos.y;
        if (distH < reach * 1.15 && pyRel < this.height * 1.05 && pyRel > -2 && this.cooldown <= 0) {
          // pick the arm on the player's side
          const local = this.root.worldToLocal(_v.copy(p.pos));
          this.grabSide = local.x > 0 ? 1 : 0;
          if (this.armCut[this.grabSide] > 0) this.grabSide = 1 - this.grabSide;
          this.setState('reach');
          this.lunge = 0;
          g.audio.roar(pos, this.height, 0.35);
        }
        // abnormal lunge
        if (abn && distH < 30 && distH > 10 && (this.lungeCD || 0) <= 0 && Math.random() < dt * 0.6 && pyRel < 8) {
          this.lunge = 1.0; this.lungeCD = 4; this.cooldown = Math.min(this.cooldown, 0.3);
          g.audio.roar(pos, this.height, 1);
        }
      }
      // stuck detour
      if (this.detour > 0) { this.detour -= dt; wantHeading += this.detourDir * 1.2; }
    }
    if (this.lunge > 0) {
      this.lunge -= dt;
      targetSpeed = 22;
      lean = 0.9;
    }
    // turning
    const turnRate = abn ? 2.2 : 0.9;
    let dh = Math.atan2(Math.sin(wantHeading - this.heading), Math.cos(wantHeading - this.heading));
    this.heading += clamp(dh, -turnRate * dt, turnRate * dt);
    if (this.state === 'kneel' || this.state === 'emerge' || this.state === 'grab') targetSpeed = 0;
    this.speed = damp(this.speed, targetSpeed, 3, dt);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const before = _v.copy(pos);
    pos.x += fx * this.speed * dt;
    pos.z += fz * this.speed * dt;
    this.avoid(dt);
    const moved = Math.hypot(pos.x - before.x, pos.z - before.z);
    if (this.speed > 0.5 && moved < this.speed * dt * 0.3) { this.stuckT += dt; if (this.stuckT > 1.2) { this.detour = 2.5; this.detourDir = randSign(); this.stuckT = 0; } }
    else this.stuckT = Math.max(0, this.stuckT - dt);
    this.root.rotation.y = this.heading;
    this.animate(dt, lean);
    this.updateHitboxes();
    // ambient steam
    this.steamT -= dt;
    if (this.steamT <= 0) {
      this.steamT = 0.35;
      g.vfx.wisp(this.parts[Math.floor(Math.random() * this.parts.length)].a, s);
    }
  }

  avoid(dt) {
    const pos = this.root.position;
    const rad = 1.2 * this.s;
    for (const o of this.game.world.obstacles) {
      const dx = pos.x - o.x, dz = pos.z - o.z;
      const d2 = dx * dx + dz * dz, rr = o.r + rad;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x += (dx / d) * (rr - d) * Math.min(1, dt * 8);
        pos.z += (dz / d) * (rr - d) * Math.min(1, dt * 8);
      }
    }
    for (const t of this.game.titans) {
      if (t === this || !t.alive) continue;
      const dx = pos.x - t.root.position.x, dz = pos.z - t.root.position.z;
      const rr = rad + 1.2 * t.s;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); pos.x += (dx / d) * (rr - d) * 0.5 * Math.min(1, dt * 6); pos.z += (dz / d) * (rr - d) * 0.5 * Math.min(1, dt * 6); }
    }
    const R = Math.hypot(pos.x, pos.z);
    if (R > 360) { pos.x *= 360 / R; pos.z *= 360 / R; }
  }

  animate(dt, lean) {
    const s = this.s;
    const abn = this.type === 'abnormal';
    const stride = (abn ? 3.2 : 2.6) * s;
    this.walkPhase += (this.speed / stride) * dt * Math.PI;
    const ph = this.walkPhase;
    const amp = clamp(this.speed / (1.7 * s), 0, 1.4);
    const kneel = this.state === 'kneel' ? clamp(this.stateT * 3, 0, 1) * (this.legCut > 0.5 ? 1 : clamp(this.legCut * 2, 0, 1)) : 0;
    this.kneelW = damp(this.kneelW || 0, kneel, 6, dt);
    const k = this.kneelW;
    for (let i = 0; i < 2; i++) {
      const sg = i === 0 ? 1 : -1;
      const sw = Math.sin(ph + (i ? Math.PI : 0));
      this.thighs[i].rotation.set(lerp(-sw * 0.45 * amp, -1.45, k), 0, sg * 0.03);
      this.knees[i].rotation.x = lerp(Math.max(0, Math.sin(ph + (i ? Math.PI : 0) + 1.2)) * 0.9 * amp + 0.05, 1.55, k);
      this.ankles[i].rotation.x = lerp(-0.1 * amp * sw, -0.3, k);
      // arms
      const swing = abn ? Math.sin(ph * 2 + i * 2) * 1.3 * amp - 0.4 : sw * 0.3 * amp;
      const cut = this.armCut[i] > 0;
      this.shoulders[i].rotation.set(swing - (abn ? 0.6 : 0) + k * -0.7, 0, (i ? -1 : 1) * (0.12 + (abn ? 0.5 : 0) + k * 0.2));
      this.elbows[i].rotation.set(-0.25 - (abn ? 0.6 : 0) - (cut ? -0.3 : 0), 0, 0);
    }
    const bob = Math.abs(Math.cos(ph)) * 0.12 * amp;
    this.hips.position.y = lerp(5.05 - bob, 2.6, k);
    this.hips.rotation.y = Math.sin(ph) * 0.08 * amp;
    this.spine.rotation.set(lean + k * 0.5, -Math.sin(ph) * 0.1 * amp, Math.sin(ph) * 0.04 * amp);
    this.chest.rotation.x = abn ? 0.25 : 0.05;
    // head tracking
    const p = this.game.player;
    this.head.updateMatrixWorld(true);
    const hl = this.neck.worldToLocal(_v.copy(p.pos));
    const yaw = clamp(Math.atan2(hl.x, hl.z), -1.1, 1.1);
    const pitch = clamp(-Math.atan2(hl.y - 0.8, Math.hypot(hl.x, hl.z)), -0.7, 0.5);
    const look = this.blind > 0 ? 0 : 1;
    this.head.rotation.y = damp(this.head.rotation.y, yaw * look + (this.blind > 0 ? Math.sin(this.stateT * 5) * 0.6 : 0), 3, dt);
    this.headPitch = damp(this.headPitch ?? 0, pitch * look, 3, dt);
    this.head.rotation.x = this.headPitch;
    this.head.rotation.z = Math.sin(this.walkPhase * 0.5) * 0.12;
    // jaw gapes as the victim nears the mouth, then snaps shut
    const bt = this.state === 'grab' ? this.stateT : 0;
    const jo = clamp((bt - 2.6) / 0.9, 0, 1) * (bt < 3.85 ? 1 : clamp((4 - bt) / 0.15, 0, 1));
    this.jaw.position.y = this.jawY0 - jo * this.jawDrop;
    this.jaw.rotation.x = jo * 0.35;
    this.head.rotation.x -= jo * 0.3;
    // stoop and squat when reaching for something near the ground
    let stoopT = 0;
    if (this.state === 'reach') {
      const rel = (p.pos.y - this.root.position.y) / this.height;
      const t = this.stateT / 1.3;
      stoopT = clamp((0.62 - rel) / 0.45, 0, 1) * (t < 0.85 ? Math.min(1, t / 0.3) : clamp((1 - t) / 0.15, 0, 1));
    }
    const st = this.stoopW = damp(this.stoopW || 0, stoopT, 6, dt);
    if (st > 1e-3) {
      this.spine.rotation.x += st * 0.85;
      this.chest.rotation.x += st * 0.2;
      this.hips.position.y -= st * 1.6;
      for (let i = 0; i < 2; i++) {
        this.thighs[i].rotation.x -= st * 0.9;
        this.knees[i].rotation.x += st * 1.5;
        this.ankles[i].rotation.x -= st * 0.5;
      }
    }
    this.applyArmAim();
    // footsteps
    for (let i = 0; i < 2; i++) {
      const f = Math.sin(ph + (i ? Math.PI : 0));
      if (this.footPrev[i] > 0 && f <= 0 && amp > 0.2) this.game.onTitanStep(this, i);
      this.footPrev[i] = f;
    }
  }

  updateDead(dt) {
    const s = this.s;
    this.deadT += dt;
    const t = this.deadT;
    const fall = clamp(t / 1.7, 0, 1);
    const e = fall * fall;
    this.body.rotation.x = e * 1.42;
    this.hips.position.y = lerp(5.05, 2.0, e);
    this.spine.rotation.x = lerp(this.spine.rotation.x, 0.3, dt * 2);
    for (let i = 0; i < 2; i++) {
      this.shoulders[i].rotation.x = lerp(this.shoulders[i].rotation.x, -2.6, dt * 1.5);
      this.knees[i].rotation.x = lerp(this.knees[i].rotation.x, 0.3 + e * 1.2, dt * 2);
      this.thighs[i].rotation.x = lerp(this.thighs[i].rotation.x, -e * 1.2, dt * 2);
    }
    this.head.rotation.x = lerp(this.head.rotation.x, 0.3, dt);
    if (fall >= 1 && !this.landed) {
      this.landed = true;
      this.game.onTitanFall(this);
    }
    const dead = clamp((t - 1.5) / 6, 0, 1);
    this.mat.userData.u.uDead.value = dead;
    this.root.updateMatrixWorld(true);
    if (t > 1.2) {
      this.steamT -= dt;
      if (this.steamT <= 0) {
        this.steamT = 0.05;
        const part = this.parts[Math.floor(Math.random() * this.parts.length)];
        _v.lerpVectors(part.a, part.b, Math.random());
        this.game.vfx.steam(_v, s * 2.2 * (1 - dead * 0.4), 3.5);
      }
    }
    if (t > 7) {
      const shrink = clamp((t - 7) / 6, 0, 1);
      this.body.scale.setScalar(this.s * (1 - shrink * 0.5));
      this.body.position.y = -shrink * 2 * s;
    }
    if (t > 13) this.remove = true;
  }

  dispose() {
    this.game.scene.remove(this.root);
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.mat.dispose();
  }
}
