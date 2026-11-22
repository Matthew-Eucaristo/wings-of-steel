import * as THREE from 'three';
import { Capsule } from './collision.js';
import { clamp, damp, lerp, rand, randSign, mulberry32, angleDiff } from './util.js';
import { skinTextures } from './textures.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function mergeJoints(root, keepSet) {
  const groups = [];
  root.traverse((o) => { if (o.isGroup) groups.push(o); });
  for (const g of groups) {
    const byMat = new Map();
    for (const c of g.children) {
      if (c.isMesh && (!keepSet || !keepSet.has(c))) {
        if (!byMat.has(c.material)) byMat.set(c.material, []);
        byMat.get(c.material).push(c);
      }
    }
    for (const [mat, list] of byMat) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        const gg = m.geometry.clone();
        gg.applyMatrix4(m.matrix);
        return gg;
      });
      const merged = mergeGeometries(geos, false);
      if (!merged) { geos.forEach((x) => x.dispose()); continue; }
      for (const m of list) { g.remove(m); m.geometry.dispose(); }
      geos.forEach((x) => x.dispose());
      const mm = new THREE.Mesh(merged, mat);
      mm.castShadow = mm.receiveShadow = true;
      g.add(mm);
    }
  }
}

let SHARED = null;
function getSharedMats() {
  if (SHARED) return SHARED;
  SHARED = {
    skin: skinTextures(),
    dark: new THREE.MeshStandardMaterial({ color: '#1a0c0a', roughness: 0.9 }),
    teeth: new THREE.MeshStandardMaterial({ color: '#d8cdb2', roughness: 0.55 }),
    eye: new THREE.MeshStandardMaterial({ color: '#cfc4b0', roughness: 0.15 }),
    abnEye: new THREE.MeshStandardMaterial({ color: '#ff9068', emissive: '#ff3b14', emissiveIntensity: 0.95, roughness: 0.2 }),
    socket: new THREE.MeshStandardMaterial({ color: '#4a302a', roughness: 0.85 }),
    wound: new THREE.MeshStandardMaterial({ color: '#7a0b08', emissive: '#a81810', emissiveIntensity: 0.55, roughness: 0.35 }),
    rock: new THREE.MeshStandardMaterial({ color: '#746b60', roughness: 0.95 }),
    iris: ['#3a2a1a', '#2c3a30', '#4a3a22'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.1 })),
    hair: ['#2b1d14', '#4a3020', '#191512', '#6b4a2a'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })),
    armor: new THREE.MeshStandardMaterial({ color: '#d2bf9f', roughness: 0.34, metalness: 0.28, emissive: '#5a2410', emissiveIntensity: 0.1 }),
  };
  return SHARED;
}

const _qIK = new THREE.Quaternion(), AX_X = new THREE.Vector3(1, 0, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

const SKIN_TONES = ['#b09a8e', '#a89184', '#9c877d', '#b8a59a', '#8e7a70', '#ab968b', '#a2938b'];

function skinMaterial(tone) {
  const S = getSharedMats();
  const m = new THREE.MeshStandardMaterial({ color: tone, map: S.skin.map, normalMap: S.skin.normalMap, roughness: 0.72, metalness: 0 });
  m.normalScale.set(0.9, 0.9);
  const u = { uHit: { value: 0 }, uDead: { value: 0 }, uWarn: { value: 0 } };
  m.userData.u = u;
  m.customProgramCacheKey = () => 'titan-skin-v3';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uHit = u.uHit;
    sh.uniforms.uDead = u.uDead;
    sh.uniforms.uWarn = u.uWarn;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uHit; uniform float uDead; uniform float uWarn; varying vec3 vWP;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float mott = sin(vWP.x*1.7+vWP.y*0.9)*sin(vWP.z*1.3-vWP.y*1.1)*0.5+0.5;
        diffuseColor.rgb *= mix(vec3(0.93,0.9,0.92), vec3(1.05,0.98,0.94), mott);
        diffuseColor.rgb *= mix(vec3(0.5,0.42,0.34), vec3(1.0), smoothstep(0.1, 2.2, vWP.y));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float ndv = max(0.0, 1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))));
        float rim = ndv * ndv * sqrt(ndv);
        totalEmissiveRadiance += vec3(0.5, 0.17, 0.12) * rim * 0.2;
        totalEmissiveRadiance += vec3(1.0, 0.2, 0.1) * uHit * (0.4 + rim);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.45, 0.32, 0.3), uDead);
        totalEmissiveRadiance += vec3(0.9, 0.3, 0.1) * uDead * rim * 0.6;
        totalEmissiveRadiance += vec3(1.0, 0.42, 0.06) * uWarn * (0.18 + rim * 1.7);`);
  };
  return m;
}

function limbGeo(len, r0, r1, bulge = 0.15, bulgeAt = 0.3, seg = 12) {
  const pts = [];
  const N = 10;
  pts.push(new THREE.Vector2(0.001, 0.02 * len));
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = lerp(r0, r1, t) + Math.sin(Math.PI * clamp((t - bulgeAt + 0.3) / 0.6, 0, 1)) * bulge * r0;
    pts.push(new THREE.Vector2(r, -t * len));
  }
  pts.push(new THREE.Vector2(0.001, -len - 0.02 * len));
  return new THREE.LatheGeometry(pts, seg);
}

export class Titan {
  constructor(game, pos, opts = {}) {
    this.game = game;
    this.type = opts.type ?? 'normal';
    const isBoss = this.type === 'armored';
    const isTank = this.type === 'tank';
    const isSprinter = this.type === 'sprinter';
    this.height = opts.height ?? (isBoss ? 20 : isTank ? rand(17, 20) : isSprinter ? rand(7.5, 10) : rand(11, 15.5));
    this.passive = !!opts.passive;
    this.s = this.height / 10;
    this.seed = opts.seed ?? Math.floor(Math.random() * 1e9);
    const r = mulberry32(this.seed);
    this.r = r;
    this.alive = true;
    this.state = opts.instant ? 'chase' : 'emerge';
    this.stateT = 0;
    this.heading = Math.random() * Math.PI * 2;
    this.walkPhase = 0;
    this.speed = 0;
    this.napeHP = isBoss ? 680 : isTank ? 560 : isSprinter ? 150 : this.type === 'abnormal' ? 280 : 250;
    this.hp = this.napeHP;
    this.maxArmor = isBoss ? 620 : 0;
    this.armor = this.maxArmor;
    this.regen = 0;
    this.hitFlash = 0;
    this.hitTwist = 0;
    this.hitTilt = 0;
    this.blind = 0;
    this.armCut = [0, 0];
    this.legCut = 0;
    this.stumpBleedT = 0;
    this.grabSide = 1;
    this.cooldown = rand(1.0, 2.4);
    this.throwCD = rand(3.5, 7.5);
    this.stuckT = 0; this.detour = 0; this.detourDir = 1;
    this.steamT = 0;
    this.deadT = 0;
    this.footPrev = [0, 0];
    this.squadMarked = false;
    this.armAim = [
      { active: false, t: new THREE.Vector3(), w: 0, ik: false },
      { active: false, t: new THREE.Vector3(), w: 0, ik: false },
    ];
    this._mouth = new THREE.Vector3();
    this._hand = new THREE.Vector3();
    this._front = new THREE.Vector3();
    this.prop = {
      head: isBoss ? 0.96 : isSprinter ? 1.18 : lerp(0.88, 1.3, r()) * (this.type === 'abnormal' ? 1.12 : 1),
      arm: isBoss ? 1.12 : isSprinter ? 1.15 : lerp(0.92, 1.15, r()),
      girth: isBoss ? 1.32 : isTank ? 1.42 : isSprinter ? 0.78 : lerp(0.88, 1.2, r()),
      belly: isTank ? 0.75 : isBoss || isSprinter ? 0 : (r() < 0.3 ? lerp(0.3, 0.7, r()) : 0),
      grin: r(),
      hair: isBoss ? 0.82 : r(),
    };
    const defaultTone = isBoss ? '#8e3d32' : isTank ? '#988880' : this.type === 'abnormal' ? '#b39892' : isSprinter ? '#bfa89b' : SKIN_TONES[Math.floor(r() * SKIN_TONES.length)];
    this.build(opts.tone || defaultTone);
    this.root.position.copy(pos);
    this.root.rotation.y = this.heading;
    game.scene.add(this.root);
    this.parts = [];
    this.makeHitboxes();
    this.nape = { c: new THREE.Vector3(), r: 1.32 * this.s };
    this.update(0);
  }

  build(tone) {
    const P = this.prop;
    const S = getSharedMats();
    const isBoss = this.type === 'armored';
    const isAbn = this.type === 'abnormal';
    const isTank = this.type === 'tank';
    const mat = skinMaterial(tone);
    this.mat = mat;
    const irisM = S.iris[Math.floor(this.r() * S.iris.length)];
    const hairM = S.hair[Math.floor(this.r() * S.hair.length)];
    const keepSet = new Set();
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
    const pel = mk(new THREE.SphereGeometry(1, 16, 12), mat, hips); pel.scale.set(1.0 * g, 0.62, 0.72 * g); pel.position.y = 0.1;
    const spine = G(hips, 0, 0.15, 0); this.spine = spine;
    const tp = [[0.001, 0], [0.95, 0.05], [0.88, 0.5], [0.84, 0.95], [0.98, 1.5], [1.12, 2.0], [1.05, 2.35], [0.62, 2.62], [0.35, 2.75], [0.001, 2.78]];
    const torso = mk(new THREE.LatheGeometry(tp.map(([x, y]) => new THREE.Vector2(x * g, y)), 18), mat, spine);
    torso.scale.set(1, 1, 0.68);
    for (const sx of [-1, 1]) {
      const pec = mk(new THREE.SphereGeometry(0.55, 14, 10), mat, spine); pec.scale.set(1.05 * g, 0.62, 0.42); pec.position.set(sx * 0.45 * g, 1.95, 0.52 * g); pec.rotation.z = sx * 0.2;
      const lat = mk(new THREE.SphereGeometry(0.5, 10, 8), mat, spine); lat.scale.set(0.6, 1.3, 0.5); lat.position.set(sx * 0.7 * g, 1.5, -0.2);
      const glute = mk(new THREE.SphereGeometry(0.55, 12, 8), mat, hips); glute.position.set(sx * 0.42 * g, -0.05, -0.38 * g);
      for (let rb = 0; rb < 3; rb++) {
        const rib = mk(new THREE.CapsuleGeometry(0.055, 0.48 * g, 3, 6), mat, spine);
        rib.rotation.set(0, sx * 0.4, Math.PI / 2 - sx * 0.18);
        rib.position.set(sx * 0.52 * g, 1.15 + rb * 0.24, 0.42 * g);
      }
      if (isBoss) {
        const chestPlate = mk(new THREE.BoxGeometry(0.95 * g, 0.78, 0.35), S.armor, spine);
        chestPlate.position.set(sx * 0.48 * g, 1.92, 0.58 * g);
        chestPlate.rotation.set(-0.1, sx * 0.18, sx * 0.12);
      }
    }
    if (P.belly > 0) { const b = mk(new THREE.SphereGeometry(1, 16, 12), mat, spine); b.scale.set(0.95 * g, 0.85, 0.55 + P.belly * 0.5); b.position.set(0, 0.75, 0.25 * g); }
    for (let i = 0; i < 3; i++) {
      const ab = mk(new THREE.SphereGeometry(0.22, 8, 6), isBoss ? S.armor : mat, spine);
      ab.scale.set(1.8, 0.8, 0.6); ab.position.set(0, 0.5 + i * 0.36, 0.56 * g);
    }
    const chest = G(spine, 0, 2.3, 0); this.chest = chest;
    for (const sx of [-1, 1]) {
      const trap = mk(new THREE.SphereGeometry(0.5, 12, 8), mat, chest); trap.scale.set(1.3 * g, 0.55, 0.8); trap.position.set(sx * 0.48 * g, 0.28, -0.18); trap.rotation.z = -sx * 0.35;
    }
    const neck = G(chest, 0, 0.35, -0.05); this.neck = neck;
    mk(limbGeo(0.9, 0.42, 0.5, 0, 0.5, 12), mat, neck).rotation.x = Math.PI;
    const napeScar = mk(new THREE.SphereGeometry(0.26, 8, 6), S.wound, neck);
    napeScar.position.set(0, 0.42, -0.44);
    napeScar.scale.set(0.85, 1.1, 0.4);
    napeScar.visible = false;
    this.napeScar = napeScar;
    keepSet.add(napeScar);
    if (isBoss) {
      const np = mk(new THREE.BoxGeometry(1.15, 1.05, 0.46), S.armor, neck);
      np.position.set(0, 0.42, -0.46);
      np.rotation.x = 0.18;
      this.napePlateMesh = np;
      keepSet.add(np);
    }
    const head = G(neck, 0, 0.75, 0.05); this.head = head;
    const hs = P.head;
    const skull = mk(new THREE.SphereGeometry(0.85 * hs, 18, 14), mat, head); skull.scale.set(0.92, 1.12, 1.0); skull.position.set(0, 0.55 * hs, 0);
    const jaw = mk(new THREE.SphereGeometry(0.7 * hs, 16, 12), isBoss ? S.armor : mat, head);
    jaw.scale.set(0.95, 0.7, 1.0); jaw.position.set(0, 0.05 * hs, 0.12 * hs);
    this.jaw = jaw; this.jawY0 = jaw.position.y; this.jawDrop = 0.32 * hs;
    keepSet.add(jaw);
    const brow = mk(new THREE.CapsuleGeometry(0.11 * hs, 0.7 * hs, 4, 8), isBoss ? S.armor : mat, head);
    brow.rotation.z = Math.PI / 2; brow.position.set(0, 0.72 * hs, 0.72 * hs);
    const nose = mk(new THREE.ConeGeometry(0.13 * hs, 0.36 * hs, 8), mat, head); nose.position.set(0, 0.5 * hs, 0.86 * hs); nose.rotation.x = 0.35;
    for (const sx of [-1, 1]) {
      const ear = mk(new THREE.SphereGeometry(0.2 * hs, 8, 6), mat, head); ear.scale.set(0.4, 1, 0.7); ear.position.set(sx * 0.8 * hs, 0.5 * hs, 0);
      const socket = mk(new THREE.SphereGeometry(0.17 * hs, 10, 8), S.socket, head); socket.scale.set(1.1, 0.75, 0.5); socket.position.set(sx * 0.3 * hs, 0.6 * hs, 0.74 * hs);
      const eye = mk(new THREE.SphereGeometry(0.12 * hs, 10, 8), isBoss || isAbn || isTank ? S.abnEye : S.eye, head); eye.position.set(sx * 0.3 * hs, 0.6 * hs, 0.72 * hs);
      const look = (this.r() - 0.5) * 0.05 * hs;
      if (!isBoss && !isAbn && !isTank) {
        const iris = mk(new THREE.SphereGeometry(0.075 * hs, 8, 6), irisM, head); iris.scale.set(1, 1, 0.5); iris.position.set(sx * 0.3 * hs + look, 0.6 * hs, 0.815 * hs);
      }
      const pupil = mk(new THREE.SphereGeometry(0.035 * hs, 6, 6), S.dark, head); pupil.scale.set(1, 1, 0.4); pupil.position.set(sx * 0.3 * hs + look, 0.6 * hs, 0.845 * hs);
      const lid = mk(new THREE.SphereGeometry(0.135 * hs, 10, 6, 0, Math.PI * 2, 0, Math.PI * (0.38 + this.r() * 0.1)), mat, head); lid.position.copy(eye.position); lid.rotation.x = 0.35;
      (this.lids ||= []).push(lid);
    }
    const grinW = lerp(0.35, 0.75, P.grin);
    const mouth = mk(new THREE.SphereGeometry(0.5 * hs, 16, 8, -grinW * 1.2 + Math.PI / 2, grinW * 2.4, Math.PI * 0.52, Math.PI * 0.14), S.dark, head);
    mouth.position.set(0, 0.42 * hs, 0.25 * hs); mouth.scale.set(1.2, 1, 1.25);
    const nt = Math.round(9 + grinW * 8);
    for (let i = 0; i < nt; i++) {
      const a = (i / (nt - 1) - 0.5) * grinW * 2.1;
      for (const row of [0, 1]) {
        const tooth = mk(new THREE.BoxGeometry(0.058 * hs, (0.085 + this.r() * 0.03) * hs, 0.05 * hs), S.teeth, head);
        const rad = 0.8 * hs;
        tooth.position.set(Math.sin(a) * rad, (0.2 + row * 0.14 - Math.cos(a * 2) * 0.02) * hs, Math.cos(a) * rad + 0.05 * hs);
        tooth.rotation.y = a;
      }
    }
    if (P.hair > 0.35) {
      const cap = mk(new THREE.SphereGeometry(0.9 * hs, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), isBoss ? S.armor : hairM, head);
      cap.scale.set(0.98, 1.1, 1.06); cap.position.set(0, 0.62 * hs, -0.05 * hs); cap.rotation.x = -0.25;
      if (P.hair > 0.7) {
        for (let i = 0; i < 8; i++) {
          const tuft = mk(new THREE.ConeGeometry(0.2 * hs, 0.7 * hs, 6), isBoss ? S.armor : hairM, head);
          const a = (i / 8) * Math.PI * 2;
          tuft.position.set(Math.sin(a) * 0.6 * hs, 0.95 * hs, Math.cos(a) * 0.55 * hs - 0.1 * hs);
          tuft.rotation.set(Math.cos(a) * 0.9, 0, -Math.sin(a) * 0.9);
        }
      }
    }
    this.shoulders = []; this.elbows = []; this.wrists = []; this.stumps = [];
    const al = P.arm;
    for (const sx of [-1, 1]) {
      const sh = G(chest, sx * 1.02 * g, 0.05, -0.05);
      const delt = mk(new THREE.SphereGeometry(0.52, 12, 10), isBoss ? S.armor : mat, sh); delt.scale.set(1.0, 0.9, 0.95);
      mk(limbGeo(2.0 * al, 0.46, 0.33, 0.2, 0.35), mat, sh);
      const bi = mk(new THREE.SphereGeometry(0.3, 10, 8), mat, sh); bi.scale.set(0.9, 2.0, 0.9); bi.position.set(0, -0.85 * al, 0.1);
      const tri = mk(new THREE.SphereGeometry(0.3, 10, 8), mat, sh); tri.scale.set(0.9, 2.2, 0.85); tri.position.set(0, -0.75 * al, -0.1);
      const stump = mk(new THREE.SphereGeometry(0.34, 10, 8), S.wound, sh);
      stump.position.set(0, -1.95 * al, 0);
      stump.scale.set(0.95, 0.55, 0.95);
      stump.visible = false;
      keepSet.add(stump);
      this.stumps.push(stump);

      const el = G(sh, 0, -2.0 * al, 0);
      mk(new THREE.SphereGeometry(0.34, 10, 8), mat, el).scale.set(0.82, 0.9, 0.78);
      mk(limbGeo(1.85 * al, 0.36, 0.24, 0.22, 0.2), isBoss ? S.armor : mat, el);
      const fa = mk(new THREE.SphereGeometry(0.26, 10, 8), isBoss ? S.armor : mat, el); fa.scale.set(1.0, 2.0, 0.9); fa.position.set(sx * 0.03, -0.55 * al, 0.03);
      const wr = G(el, 0, -1.85 * al, 0);
      const palm = mk(new THREE.SphereGeometry(0.34, 10, 8), mat, wr); palm.scale.set(0.78, 1.0, 0.38); palm.position.set(0, -0.34, 0.03);
      for (let f = 0; f < 4; f++) {
        const fg = mk(new THREE.CapsuleGeometry(0.07, 0.38, 3, 6), mat, wr);
        fg.scale.y = [0.85, 1.0, 0.97, 0.8][f];
        fg.position.set(-0.18 + f * 0.12, -0.76, 0.08); fg.rotation.x = 0.45; fg.rotation.z = (f - 1.5) * 0.06;
      }
      const thumb = mk(new THREE.CapsuleGeometry(0.08, 0.3, 3, 6), mat, wr); thumb.position.set(-sx * 0.26, -0.4, 0.14); thumb.rotation.z = -sx * 0.6;
      if (sx === 1) {
        const heldRock = mk(new THREE.DodecahedronGeometry(0.95, 1), S.rock, wr);
        heldRock.position.set(0, -0.85, 0.35);
        heldRock.visible = false;
        keepSet.add(heldRock);
        this.heldRock = heldRock;
      }
      this.shoulders.push(sh); this.elbows.push(el); this.wrists.push(wr);
    }
    this.thighs = []; this.knees = []; this.ankles = [];
    for (const sx of [-1, 1]) {
      const hp = G(hips, sx * 0.5 * g, -0.05, 0);
      mk(limbGeo(2.45, 0.68 * g, 0.44, 0.16, 0.25), mat, hp);
      const quad = mk(new THREE.SphereGeometry(0.42, 12, 8), isBoss ? S.armor : mat, hp); quad.scale.set(1.1 * g, 2.4, 0.95); quad.position.set(0, -1.1, 0.22);
      const ham = mk(new THREE.SphereGeometry(0.4, 12, 8), mat, hp); ham.scale.set(1.0 * g, 2.0, 0.8); ham.position.set(0, -1.0, -0.14);
      const kn = G(hp, 0, -2.45, 0);
      const cap = mk(new THREE.SphereGeometry(0.33, 10, 8), isBoss ? S.armor : mat, kn); cap.position.z = 0.06; cap.scale.set(0.85, 0.8, 0.62);
      mk(limbGeo(2.35, 0.45, 0.27, 0.25, 0.15), mat, kn);
      const calf = mk(new THREE.SphereGeometry(0.34, 12, 8), mat, kn); calf.scale.set(0.9, 2.1, 0.9); calf.position.set(0, -0.75, -0.11);
      const an = G(kn, 0, -2.35, 0);
      const foot = mk(new THREE.CapsuleGeometry(0.24, 0.7, 4, 8), mat, an);
      foot.rotation.x = Math.PI / 2; foot.position.set(0, -0.12, 0.3); foot.scale.set(1.2, 1, 0.75);
      this.thighs.push(hp); this.knees.push(kn); this.ankles.push(an);
    }
    mergeJoints(root, keepSet);
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
    def('neck', this.neck, this.head, new THREE.Vector3(), new THREE.Vector3(), 0.52);
    for (let i = 0; i < 2; i++) {
      const sd = i === 0 ? -1 : 1;
      def('arm', this.shoulders[i], this.elbows[i], new THREE.Vector3(), new THREE.Vector3(), 0.44, sd);
      def('arm', this.elbows[i], this.wrists[i], new THREE.Vector3(), new THREE.Vector3(), 0.36, sd, { isForearm: true, armIdx: i });
      def('hand', this.wrists[i], this.wrists[i], new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, -0.8, 0), 0.4, sd, { isForearm: true, armIdx: i });
      def('leg', this.thighs[i], this.knees[i], new THREE.Vector3(), new THREE.Vector3(), 0.55, sd);
      def('ankle', this.knees[i], this.ankles[i], new THREE.Vector3(), new THREE.Vector3(), 0.45, sd);
    }
  }

  updateHitboxes() {
    this.root.updateMatrixWorld(true);
    for (let i = 0; i < this.parts.length; i++) {
      const c = this.parts[i];
      if (c.isForearm && this.armCut[c.armIdx] > 1.2) {
        c.a.set(0, -999, 0);
        c.b.set(0, -999, 0);
        continue;
      }
      c.a.copy(c.la).applyMatrix4(c.ja.matrixWorld);
      c.b.copy(c.lb).applyMatrix4(c.jb.matrixWorld);
    }
    this.nape.c.set(0, 0.45, -0.5).applyMatrix4(this.neck.matrixWorld);
  }

  handPos(i, out) { return out.set(0, -0.55, 0.05).applyMatrix4(this.wrists[i].matrixWorld); }
  mouthPos(out) { return out.set(0, 0.3 * this.prop.head, 0.9 * this.prop.head).applyMatrix4(this.head.matrixWorld); }

  setState(s) {
    this.state = s;
    this.stateT = 0;
    this.didStrike = false;
    this.whooshed = false;
    if (this.heldRock) this.heldRock.visible = false;
  }

  aimArm(i, target, w, ik = false) {
    if (this.armCut[i] > 1.2) return;
    const slot = this.armAim[i];
    slot.active = true;
    slot.t.copy(target);
    slot.w = w;
    slot.ik = ik;
  }
  applyArmAim() {
    for (let i = 0; i < 2; i++) {
      const a = this.armAim[i];
      if (a.active) {
        this._aim(i, a.t, a.w, a.ik);
        a.active = false;
      }
    }
  }
  _aim(i, target, w, ik) {
    const sh = this.shoulders[i], el = this.elbows[i];
    sh.parent.updateMatrixWorld(true);
    const local = sh.parent.worldToLocal(_v.copy(target)).sub(sh.position);
    const d = local.length();
    if (d < 1e-5) return;
    _q.setFromUnitVectors(DOWN, local.divideScalar(d));
    let bend = 0.15;
    if (ik) {
      const a = el.position.length(), b = this.wrists[i].position.length() + 0.55;
      const dc = clamp(d, Math.abs(a - b) + 0.05, a + b - 0.05);
      bend = Math.PI - Math.acos(clamp((a * a + b * b - dc * dc) / (2 * a * b), -1, 1));
      _qIK.setFromAxisAngle(AX_X, Math.acos(clamp((a * a + dc * dc - b * b) / (2 * a * dc), -1, 1)));
      _q.multiply(_qIK);
    }
    sh.quaternion.slerp(_q, w);
    el.rotation.x = lerp(el.rotation.x, -bend, w);
  }

  stagger(dur = 3.5) {
    if (!this.alive) return;
    if (this.state === 'grab') this.game.player.releaseGrab(this);
    this.legCut = Math.max(this.legCut, dur);
    this.setState('kneel');
  }

  hit(part, dmg, point, dir, side = 0, opts = {}) {
    if (!this.alive) return { result: 'none' };
    this.hitFlash = 1;
    this.hitTwist = randSign() * 0.45;
    this.hitTilt = 0.35;
    const g = this.game;
    if (part === 'nape') {
      if (this.armor > 0) {
        const armorMult = opts.explosive ? 2.8 : opts.heavy ? 1.55 : 0.55;
        const armorDmg = Math.round(dmg * armorMult);
        this.armor -= armorDmg;
        if (this.armor <= 0) {
          this.armor = 0;
          if (this.napePlateMesh) this.napePlateMesh.visible = false;
          this.stagger(5.5);
          return { result: 'armor-break', armorDmg };
        }
        return { result: 'armor', armorDmg };
      }
      if (dmg >= this.hp) {
        if (this.napeScar) this.napeScar.visible = true;
        this.die(dir);
        return { result: 'kill' };
      }
      this.hp -= dmg;
      this.regen = 3.5;
      if (this.napeScar) this.napeScar.visible = true;
      return { result: 'nape' };
    }
    if (part === 'ankle' || part === 'leg') {
      this.legCut = (this.type === 'armored' ? 4.8 : 6.5) + dmg / 280;
      if (this.state !== 'grab') this.setState('kneel');
      g.vfx.bloodPool(this.root.position, 2.2 * this.s);
      g.audio.roar(this.root.position, this.height, 0.8);
      return { result: 'ankle' };
    }
    if (part === 'arm' || part === 'hand') {
      const i = side === 1 ? 1 : 0;
      const wasIntact = this.armCut[i] <= 1.2;
      this.armCut[i] = 8.5;
      if (wasIntact) {
        const elbowWorld = this.elbows[i].getWorldPosition(_v);
        g.vfx.severedLimb(elbowWorld, dir, this.s);
        g.audio.limbSever(elbowWorld);
      }
      if (this.state === 'grab' && i === this.grabSide) {
        g.player.releaseGrab(this);
        this.setState('chase');
      } else if (this.state === 'throw' && i === 1) {
        this.setState('chase');
      }
      return { result: 'arm' };
    }
    if (part === 'head' || part === 'neck') {
      this.blind = 5.5;
      if (this.state === 'throw' || this.state === 'reach') this.setState('chase');
      return { result: 'eyes' };
    }
    return { result: 'deflect' };
  }

  get label() {
    return { sprinter: 'Pelari', normal: 'Biasa', abnormal: 'Abnormal', tank: 'Raksasa', armored: 'Lapis' }[this.type] + ' ' + Math.round(this.height) + 'm';
  }

  threatInfo() {
    if (!this.alive) return null;
    const t = this.stateT;
    if (this.state === 'swipe') return { kind: 'swipe', windup: Math.min(1, t / (0.95 * 0.48)), active: t > 0.95 * 0.48 && t < 0.95 * 0.82 };
    if (this.state === 'slam') return { kind: 'slam', windup: Math.min(1, t / (1.15 * 0.82)), active: t > 1.15 * 0.78 && t < 1.15 * 0.9 };
    if (this.state === 'throw') return { kind: 'throw', windup: Math.min(1, t / (1.25 * 0.76)), active: false };
    if (this.state === 'reach') return { kind: 'grab', windup: Math.min(1, t / (1.45 * 0.42)), active: t > 1.45 * 0.42 && t < 1.45 * 0.84 };
    if (this.lunge > 0) return { kind: 'lunge', windup: 1, active: true };
    return null;
  }

  die(dir) {
    this.alive = false;
    this.squadMarked = false;
    this.setState('dead');
    this.fallDir = dir && dir.lengthSq() > 1e-4 ? Math.atan2(dir.x, dir.z) : this.root.rotation.y;
    if (this.game.player.grabbedBy === this) this.game.player.releaseGrab(this);
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    this.stateT += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.hitTwist = damp(this.hitTwist, 0, 8, dt);
    this.hitTilt = damp(this.hitTilt, 0, 8, dt);
    this.mat.userData.u.uHit.value = this.hitFlash;
    const th = this.threatInfo();
    const warnTarget = th ? (th.active ? 1 : 0.35 + th.windup * 0.65) * (0.75 + Math.sin(g.elapsed * 26) * 0.25) : 0;
    this.warnGlow = damp(this.warnGlow || 0, warnTarget, 14, dt || 0.016);
    this.mat.userData.u.uWarn.value = this.warnGlow;
    this.blind = Math.max(0, this.blind - dt);

    for (let i = 0; i < 2; i++) {
      this.armCut[i] = Math.max(0, this.armCut[i] - dt);
      const cut = this.armCut[i];
      if (cut > 1.2) {
        this.elbows[i].visible = false;
        this.stumps[i].visible = true;
      } else if (cut > 0) {
        this.elbows[i].visible = true;
        this.elbows[i].scale.setScalar(clamp(1 - cut / 1.2, 0.08, 1));
        this.stumps[i].visible = true;
      } else {
        this.elbows[i].visible = true;
        this.elbows[i].scale.setScalar(1);
        this.stumps[i].visible = false;
      }
    }
    if ((this.armCut[0] > 0 || this.armCut[1] > 0) && dt > 0) {
      this.stumpBleedT += dt;
      if (this.stumpBleedT > 0.14) {
        this.stumpBleedT = 0;
        for (let i = 0; i < 2; i++) {
          if (this.armCut[i] > 0) {
            this.stumps[i].getWorldPosition(_v);
            g.vfx.wisp(_v, this.s * 0.9);
            if (this.armCut[i] > 4) g.vfx.bloodSpray(_v, DOWN, 3, 0.5);
          }
        }
      }
    }

    if (this.regen > 0) this.regen -= dt;
    else {
      this.hp = Math.min(this.napeHP, this.hp + dt * 110);
      if (this.napeScar && this.hp >= this.napeHP) this.napeScar.visible = false;
    }
    this.cooldown -= dt;
    this.throwCD -= dt;
    this.lungeCD = (this.lungeCD || 0) - dt;
    const pos = this.root.position;
    const s = this.s;
    let targetSpeed = 0;
    let lean = 0;
    let wantHeading = this.heading;
    const abn = this.type === 'abnormal';
    const isBoss = this.type === 'armored';
    const isTank = this.type === 'tank';
    const isSprinter = this.type === 'sprinter';

    const convoyPos = g.engineers?.getThreatAttractor(pos, this.type);
    const chasePos = convoyPos || p.pos;
    const chasingPlayer = chasePos === p.pos;
    const toT = _v2.subVectors(chasePos, pos);
    const distH = Math.hypot(toT.x, toT.z);
    const toPlayer = _v3.subVectors(p.pos, pos);
    const playerDistH = Math.hypot(toPlayer.x, toPlayer.z);
    const reach = 4.2 * s * this.prop.arm;
    const canSee = this.blind <= 0 && (!p.dead || !!convoyPos);

    if (this.state === 'emerge') {
      this.body.position.y = lerp(-this.height * 0.4, 0, Math.min(1, this.stateT / 1.8));
      if (Math.random() < dt * 28) {
        _v.set(pos.x + rand(-3, 3) * s, pos.y + rand(2, 9) * s, pos.z + rand(-3, 3) * s);
        g.vfx.steam(_v, s * 2.5, 1.5);
      }
      if (this.stateT > 1.8) {
        this.body.position.y = 0;
        this.setState(this.passive ? 'wander' : 'chase');
        g.vfx.debris(pos, 8, 8);
        g.vfx.dust(pos, s * 3, 14);
      }
    } else if (this.state === 'dead') {
      this.updateDead(dt);
      return;
    } else if (this.state === 'kneel') {
      this.legCut -= dt;
      if (this.legCut <= 0) this.setState('chase');
    } else if (this.state === 'grab') {
      const i = this.grabSide;
      const t = clamp(this.stateT / 3.8, 0, 1);
      const mouth = this.mouthPos(this._mouth);
      this._front.set(Math.sin(this.heading), 0.2, Math.cos(this.heading)).multiplyScalar(2.6 * s * (1 - t));
      mouth.add(this._front);
      this.aimArm(i, mouth, lerp(0.6, 1, Math.min(1, t * 2)), true);
      if (this.stateT > 4.2) { p.eaten(this); this.setState('chase'); this.cooldown = 4.5; }
    } else if (this.state === 'swipe') {
      const dur = 0.95;
      const t = this.stateT / dur;
      wantHeading = Math.atan2(toPlayer.x, toPlayer.z);
      targetSpeed = 0.6 * s;
      const side = this.grabSide;
      const sg = side === 1 ? 1 : -1;
      const ang = t < 0.48 ? lerp(0, -sg * 1.4, t / 0.48) : lerp(-sg * 1.4, sg * 1.65, (t - 0.48) / 0.52);
      const tgt = _v.set(
        pos.x + Math.sin(this.heading + ang) * reach * 1.05,
        clamp(p.pos.y, pos.y + 1.5 * s, pos.y + this.height * 0.85),
        pos.z + Math.cos(this.heading + ang) * reach * 1.05,
      );
      this.aimArm(side, tgt, 0.92);
      if (t > 0.48 && !this.whooshed) {
        this.whooshed = true;
        g.audio.whoosh(this.handPos(side, this._hand), s);
      }
      if (t > 0.48 && t < 0.82 && !this.didStrike && this.armCut[side] <= 1.2) {
        const hp = this.handPos(side, this._hand);
        g.world.destroyNear(hp, 2.2 * s);
        if (!p.dead && p.invuln <= 0 && hp.distanceTo(p.pos) < 1.55 * s + 0.8) {
          const committed = ((p.slashT > 0.05 && p.slashT < 0.95) || p.spin > 0) && p.vel.length() > 14;
          if (!committed) {
            this.didStrike = true;
            _v.subVectors(p.pos, pos).setY(0.45).normalize();
            p.knockback(_v, 17, 13);
            g.vfx.dust(hp, 2.8 * s, 10);
          }
        }
      }
      if (t >= 1) { this.setState('chase'); this.cooldown = rand(1.1, 2.2); }
    } else if (this.state === 'slam') {
      const dur = 1.15;
      const t = this.stateT / dur;
      targetSpeed = 0;
      const liftY = t < 0.58 ? lerp(this.height * 0.6, this.height * 1.25, t / 0.58) : lerp(this.height * 1.25, 0.6, (t - 0.58) / 0.42);
      for (let i = 0; i < 2; i++) {
        const sg = i === 1 ? 1 : -1;
        _v.set(pos.x + Math.sin(this.heading + sg * 0.25) * 3.2 * s, pos.y + liftY, pos.z + Math.cos(this.heading + sg * 0.25) * 3.2 * s);
        this.aimArm(i, _v, 0.92);
      }
      if (t >= 0.58 && !this.whooshed) {
        this.whooshed = true;
        g.audio.whoosh(_v.set(pos.x + Math.sin(this.heading) * 3.2 * s, pos.y + this.height * 0.6, pos.z + Math.cos(this.heading) * 3.2 * s), s * 1.3);
      }
      if (t >= 0.82 && !this.didStrike) {
        this.didStrike = true;
        const impactPt = _v.set(pos.x + Math.sin(this.heading) * 3.4 * s, 0.3, pos.z + Math.cos(this.heading) * 3.4 * s);
        g.vfx.dust(impactPt, 6.5 * s, 26);
        g.vfx.impactRing(impactPt, _v2.set(0, 1, 0), 9 * s, 0xffd29a, 0.32);
        g.audio.fall(impactPt, this.height);
        g.cam.shake(clamp(1 - impactPt.distanceTo(p.pos) / 85, 0.15, 0.85));
        g.world.destroyNear(impactPt, 4.2 * s);
        if (!p.dead && p.invuln <= 0 && p.pos.distanceTo(impactPt) < 8.5 * s && p.pos.y < 6.5 * s) {
          _v2.subVectors(p.pos, impactPt).setY(0.85).normalize();
          p.knockback(_v2, 19, 16);
        }
      }
      if (t >= 1) { this.setState('chase'); this.cooldown = rand(1.8, 3.0); }
    } else if (this.state === 'throw') {
      const dur = 1.25;
      const t = this.stateT / dur;
      wantHeading = Math.atan2(toT.x, toT.z);
      targetSpeed = 0;
      if (this.heldRock) this.heldRock.visible = t > 0.22 && t < 0.76;
      if (t < 0.45) {
        _v.set(pos.x + Math.sin(this.heading + 0.35) * 2.2 * s, pos.y + 0.6, pos.z + Math.cos(this.heading + 0.35) * 2.2 * s);
        this.aimArm(1, _v, 0.9);
      } else if (t < 0.76) {
        _v.set(pos.x - Math.sin(this.heading) * 1.5 * s, pos.y + this.height * 1.18, pos.z - Math.cos(this.heading) * 1.5 * s);
        this.aimArm(1, _v, 0.92);
      } else {
        _v.set(pos.x + Math.sin(this.heading) * 4.2 * s, pos.y + this.height * 0.75, pos.z + Math.cos(this.heading) * 4.2 * s);
        this.aimArm(1, _v, 0.95);
        if (!this.didStrike && this.armCut[1] <= 1.2) {
          this.didStrike = true;
          const launchPt = this.handPos(1, this._hand);
          g.spawnBoulder?.(launchPt, chasePos, 1.05 * s);
          g.audio.boulderThrow(launchPt);
        }
      }
      if (t >= 1) { this.setState('chase'); this.throwCD = rand(6.5, 10.5); this.cooldown = 1.6; }
    } else {
      if (!canSee || this.passive) {
        if (this.state !== 'wander') this.setState('wander');
        if (this.stateT > 4 || !this.wanderH) { this.wanderH = Math.random() * Math.PI * 2; this.stateT = 0; }
        wantHeading = this.wanderH;
        targetSpeed = 1.1 * s;
        if (!this.passive && canSee) this.setState('chase');
      } else if (this.state === 'reach') {
        const i = this.grabSide;
        const t = this.stateT / 1.45;
        const w = Math.sin(Math.min(1, t) * Math.PI);
        const tgt = _v.copy(p.pos).addScaledVector(p.vel, -0.06);
        if (this.armCut[i] <= 1.2) this.aimArm(i, tgt, w * 0.9);
        wantHeading = Math.atan2(toPlayer.x, toPlayer.z);
        targetSpeed = 0.35 * s;
        if (t > 0.42 && !this.whooshed) {
          this.whooshed = true;
          g.audio.whoosh(this.handPos(i, this._hand), s);
        }
        if (this.armCut[i] <= 1.2 && t > 0.42 && t < 0.84 && !p.grabbedBy && p.invuln <= 0 && !p.dead) {
          const hp = this.handPos(i, this._hand);
          if (hp.distanceTo(p.pos) < 1.1 * s + 0.55) {
            const speed = p.vel.length();
            const committed = ((p.slashT > 0.05 && p.slashT < 0.95) || p.spin > 0) && speed > 10;
            if (committed) {
              this.setState('chase'); this.cooldown = 1.2; g.cam.shake(0.12);
            } else if (speed > 16) {
              p.knockback(_v.subVectors(p.pos, hp).normalize(), 11, 8); p.invuln = Math.max(p.invuln, 0.45);
              this.setState('chase'); this.cooldown = 1.1;
            } else { p.grab(this); this.setState('grab'); }
          }
        }
        if (t >= 1) { this.setState('chase'); this.cooldown = rand(1.4, 2.8); }
      } else {
        if (this.state !== 'chase') this.setState('chase');
        wantHeading = Math.atan2(toT.x, toT.z);
        const baseSpd = isSprinter ? 9.8 : abn ? 8.2 : isBoss ? 4.3 : isTank ? 2.1 : 3.2;
        targetSpeed = baseSpd * Math.sqrt(s) * (chasingPlayer && distH < reach * 1.25 ? 0.38 : 1);
        lean = isSprinter ? 0.48 : abn ? 0.55 : isBoss ? 0.22 : 0.08;
        const pyRel = p.pos.y - pos.y;
        const attackCommitted = ((p.slashT > 0.05 && p.slashT < 0.95) || p.spin > 0) && p.vel.length() > 11;

        let hookedIn = false;
        for (let k = 0; k < 2; k++) if (p.hooks[k].state === 'attached' && p.hooks[k].owner === this) hookedIn = true;
        this.hookedT = hookedIn ? (this.hookedT || 0) + dt : 0;
        const tokenFree = g.activeAttackers() < 2;
        if (this.hookedT > 2.2 && tokenFree && this.armCut[0] + this.armCut[1] < 2.4 && !attackCommitted && playerDistH < reach * 1.6) {
          this.hookedT = 0;
          const local = this.root.worldToLocal(_v.copy(p.pos));
          this.grabSide = local.x > 0 ? 1 : 0;
          if (this.armCut[this.grabSide] > 1.2) this.grabSide = 1 - this.grabSide;
          this.setState('swipe');
          g.audio.roar(pos, this.height, 0.45);
        } else if (tokenFree && (isTank || isBoss || (abn && Math.random() < 0.25)) && this.throwCD <= 0 && distH > 38 && distH < 145 && this.armCut[1] <= 1.2) {
          this.setState('throw');
          g.audio.roar(pos, this.height, 0.65);
        } else if (tokenFree && !p.dead && playerDistH < reach * 1.18 && pyRel < this.height * 1.02 && pyRel > -2 && this.cooldown <= 0 && !attackCommitted) {
          const local = this.root.worldToLocal(_v.copy(p.pos));
          this.grabSide = local.x > 0 ? 1 : 0;
          if (this.armCut[this.grabSide] > 1.2) this.grabSide = 1 - this.grabSide;
          const bothCut = this.armCut[0] > 1.2 && this.armCut[1] > 1.2;
          if (!bothCut) {
            if ((isTank || isBoss) && pyRel < 6 * s) {
              this.setState('slam');
            } else if (!isTank && !isBoss && p.vel.length() < 11 && Math.random() < 0.14) {
              this.setState('reach');
            } else {
              this.setState('swipe');
            }
            this.lunge = 0;
            g.audio.roar(pos, this.height, 0.35);
          }
        }
        if ((abn || isBoss || isSprinter) && distH < 30 && distH > 11 && (this.lungeCD || 0) <= 0 && Math.random() < dt * 0.45 && pyRel < 9) {
          this.lunge = isBoss ? 1.15 : 0.85; this.lungeCD = isBoss ? 6 : 4.5; this.cooldown = Math.min(this.cooldown, 0.35);
          g.audio.roar(pos, this.height, 0.85);
          g.audio.whoosh(pos, s * 1.4);
        }
      }
      if (this.detour > 0) { this.detour -= dt; wantHeading += this.detourDir * 1.2; }
    }
    if (this.lunge > 0) {
      this.lunge -= dt;
      targetSpeed = isBoss ? 17 : 20;
      lean = isBoss ? 0.6 : 0.85;
    }
    const turnRate = isSprinter ? 2.8 : abn ? 2.2 : isBoss ? 1.25 : isTank ? 0.72 : 1.05;
    const dh = Math.atan2(Math.sin(wantHeading - this.heading), Math.cos(wantHeading - this.heading));
    this.heading += clamp(dh, -turnRate * dt, turnRate * dt);
    if (this.state === 'kneel' || this.state === 'emerge' || this.state === 'grab' || this.state === 'slam' || this.state === 'throw') targetSpeed = 0;
    this.speed = damp(this.speed, targetSpeed, 3.2, dt);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const bx = pos.x, bz = pos.z;
    pos.x += fx * this.speed * dt;
    pos.z += fz * this.speed * dt;
    this.avoid(dt);
    const moved = Math.hypot(pos.x - bx, pos.z - bz);
    if (this.speed > 0.5 && moved < this.speed * dt * 0.3) {
      this.stuckT += dt;
      if (this.stuckT > 1.2) { this.detour = 2.5; this.detourDir = randSign(); this.stuckT = 0; }
    } else this.stuckT = Math.max(0, this.stuckT - dt);
    this.root.rotation.y = this.heading;
    this.animate(dt, lean);
    this.updateHitboxes();
    this.steamT -= dt;
    if (this.steamT <= 0) {
      this.steamT = 0.38;
      g.vfx.wisp(this.parts[Math.floor(Math.random() * this.parts.length)].a, s);
    }
  }

  avoid(dt) {
    const pos = this.root.position;
    const rad = 1.2 * this.s;
    const crushScale = this.type === 'armored' || this.type === 'tank' ? 1.45 : 1.05;
    for (let i = 0; i < this.game.world.obstacles.length; i++) {
      const o = this.game.world.obstacles[i];
      if (o.dead) continue;
      const dx = pos.x - o.x, dz = pos.z - o.z;
      const rr = o.r + rad;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      if (o.house && !o.house.dead && o.h < this.height * crushScale && d2 < rr * rr * 0.68) {
        this.game.onHouseDown(o.house, pos);
        continue;
      }
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x += (dx / d) * (rr - d) * Math.min(1, dt * 8);
        pos.z += (dz / d) * (rr - d) * Math.min(1, dt * 8);
      }
    }
    for (let i = 0; i < this.game.titans.length; i++) {
      const t = this.game.titans[i];
      if (t === this || !t.alive) continue;
      const dx = pos.x - t.root.position.x, dz = pos.z - t.root.position.z;
      const rr = rad + 1.2 * t.s;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x += (dx / d) * (rr - d) * 0.5 * Math.min(1, dt * 6);
        pos.z += (dz / d) * (rr - d) * 0.5 * Math.min(1, dt * 6);
      }
    }
    const R = Math.hypot(pos.x, pos.z);
    if (R > 362) { pos.x *= 362 / R; pos.z *= 362 / R; }
  }

  animate(dt, lean) {
    const s = this.s;
    const abn = this.type === 'abnormal' || this.type === 'sprinter';
    const stride = (abn ? 3.1 : 2.6) * s;
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
      const swing = abn ? Math.sin(ph * 2 + i * 2) * 1.25 * amp - 0.35 : sw * 0.3 * amp;
      const cut = this.armCut[i] > 1.2;
      this.shoulders[i].rotation.set(swing - (abn ? 0.55 : 0) + k * -0.7, 0, (i ? -1 : 1) * (0.12 + (abn ? 0.45 : 0) + k * 0.2));
      this.elbows[i].rotation.set(-0.25 - (abn ? 0.55 : 0) - (cut ? -0.3 : 0), 0, 0);
    }
    if (this.blind > 0 && this.armCut[0] <= 1.2) {
      this.shoulders[0].rotation.set(-2.25, 0.35, 0.45);
      this.elbows[0].rotation.set(-1.75, 0, 0);
    }
    const bob = Math.abs(Math.cos(ph)) * 0.12 * amp;
    this.hips.position.y = lerp(5.05 - bob, 2.5, k);
    this.hips.rotation.y = Math.sin(ph) * 0.08 * amp;
    this.spine.rotation.set(lean + k * 0.5 + this.hitTilt, -Math.sin(ph) * 0.1 * amp + this.hitTwist, Math.sin(ph) * 0.04 * amp);
    this.chest.rotation.x = abn ? 0.25 : 0.05;
    const idleW = clamp(1 - this.speed / (1.2 * s), 0, 1);
    if (idleW > 0.01) {
      const br = this.game.elapsed;
      this.spine.rotation.z += Math.sin(br * 1.3 + this.walkPhase) * 0.035 * idleW;
      this.chest.rotation.x += Math.sin(br * 1.7) * 0.03 * idleW;
      this.hips.position.y += Math.sin(br * 1.7) * 0.06 * idleW;
    }
    const p = this.game.player;
    this.head.updateMatrixWorld(true);
    const hl = this.neck.worldToLocal(_v.copy(p.pos));
    const yaw = clamp(Math.atan2(hl.x, hl.z), -1.1, 1.1);
    const pitch = clamp(-Math.atan2(hl.y - 0.8, Math.hypot(hl.x, hl.z)), -0.7, 0.5);
    const look = this.blind > 0 ? 0 : 1;
    this.head.rotation.y = damp(this.head.rotation.y, yaw * look + (this.blind > 0 ? Math.sin(this.stateT * 7) * 0.7 : 0), 3, dt);
    this.headPitch = damp(this.headPitch ?? 0, pitch * look, 3, dt);
    this.head.rotation.x = this.headPitch - this.hitTilt * 0.6;
    this.head.rotation.z = Math.sin(this.walkPhase * 0.5) * 0.12 + this.hitTwist * 0.5;
    const bt = this.state === 'grab' ? this.stateT : 0;
    const jo = clamp((bt - 2.6) / 0.9, 0, 1) * (bt < 3.95 ? 1 : clamp((4.2 - bt) / 0.25, 0, 1));
    this.jaw.position.y = this.jawY0 - jo * this.jawDrop;
    this.jaw.rotation.x = jo * 0.35;
    this.head.rotation.x -= jo * 0.3;
    this.blinkT = (this.blinkT ?? rand(1.5, 4.5)) - dt;
    let lidRot = 0.35;
    if (this.blinkT < 0) {
      if (this.blinkT < -0.14) this.blinkT = rand(2.2, 5.5);
      else lidRot = 0.35 + Math.sin((-this.blinkT / 0.14) * Math.PI) * 1.2;
    }
    if (this.blind > 0) lidRot = 0.35 + 1.5;
    if (this.lids) for (const l of this.lids) l.rotation.x = lidRot;
    let stoopT = 0;
    if (this.state === 'reach' || (this.state === 'throw' && this.stateT < 0.55)) {
      const rel = this.state === 'throw' ? 0.1 : (p.pos.y - this.root.position.y) / this.height;
      const t = this.stateT / 1.3;
      stoopT = clamp((0.62 - rel) / 0.45, 0, 1) * (t < 0.85 ? Math.min(1, t / 0.3) : clamp((1 - t) / 0.15, 0, 1));
    }
    const st = (this.stoopW = damp(this.stoopW || 0, stoopT, 6, dt));
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
    const fall = clamp(t / 1.65, 0, 1);
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
    this.root.rotation.y += clamp(angleDiff(this.fallDir, this.root.rotation.y), -dt * 2.2, dt * 2.2);
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
        for (let k = 0; k < 2; k++) {
          const part = this.parts[Math.floor(Math.random() * this.parts.length)];
          _v.lerpVectors(part.a, part.b, Math.random());
          this.game.vfx.steam(_v, s * 2.2 * (1 - dead * 0.4), 3.2);
          if (k === 0 && Math.random() < 0.3) this.game.vfx.wisp(_v, s * 2.4);
        }
      }
    }
    if (t > 6.5) {
      const shrink = clamp((t - 6.5) / 5.5, 0, 1);
      this.body.scale.setScalar(this.s * (1 - shrink * 0.5));
      this.body.position.y = -shrink * 2 * s;
    }
    if (t > 12) this.remove = true;
  }

  dispose() {
    this.game.scene.remove(this.root);
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.mat.dispose();
  }
}
