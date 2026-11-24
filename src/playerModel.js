import * as THREE from 'three';
import { capeTexture } from './textures.js';
import { clamp, damp, lerp } from './util.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export const APPEARANCE_PRESETS = {
  skinTones: [
    { id: '#f0cfb6', label: 'Porcelain' },
    { id: '#e4bca0', label: 'Warm Fair' },
    { id: '#d2a27f', label: 'Olive Tan' },
    { id: '#b5805a', label: 'Bronze' },
    { id: '#8c5a3c', label: 'Umber' },
    { id: '#5e3b28', label: 'Deep Espresso' },
  ],
  eyeColors: [
    { id: '#4e7898', label: 'Steel Blue' },
    { id: '#4c7e58', label: 'Emerald' },
    { id: '#7d5533', label: 'Amber Hazel' },
    { id: '#2d323a', label: 'Storm Gray' },
    { id: '#9e382e', label: 'Crimson' },
    { id: '#c69e46', label: 'Gold' },
  ],
  expressions: [
    { id: 'focused', label: 'Focused' },
    { id: 'fierce', label: 'Fierce' },
    { id: 'stoic', label: 'Stoic' },
    { id: 'confident', label: 'Confident' },
  ],
  accessories: [
    { id: 'none', label: 'None' },
    { id: 'scar', label: 'Battle Scar' },
    { id: 'goggles', label: 'Storm Goggles', unlockKey: 'accessory:goggles' },
    { id: 'eyepatch', label: 'Eyepatch' },
    { id: 'mask', label: 'Tactical Mask' },
    { id: 'visor', label: 'Ballistic Visor', unlockKey: 'accessory:visor' },
  ],
  hairStyles: [
    { id: 'scout', label: 'Scout Sweep' },
    { id: 'levi', label: 'Center Curtain' },
    { id: 'ponytail', label: 'High Ponytail' },
    { id: 'bun', label: 'Tactical Bun' },
    { id: 'long', label: 'Long Layered' },
    { id: 'spiky', label: 'Vanguard Spikes' },
    { id: 'undercut', label: 'Short Undercut' },
    { id: 'garrison', label: 'Headband' },
  ],
  hairColors: [
    { id: '#181512', label: 'Raven Black' },
    { id: '#462c1b', label: 'Chestnut' },
    { id: '#8a5a32', label: 'Warm Auburn' },
    { id: '#c8a25c', label: 'Ash Blonde' },
    { id: '#7c241d', label: 'Copper Red' },
    { id: '#cfd6de', label: 'Silver White' },
    { id: '#2b3a4a', label: 'Midnight Blue' },
    { id: '#3a4a3c', label: 'Pine Ash' },
  ],
  capeStyles: [
    { id: 'survey', label: 'Survey Cloak', tint: '#ffffff' },
    { id: 'crimson', label: 'Garrison Red', tint: '#d45a4a', unlockKey: 'cloak:crimson' },
    { id: 'obsidian', label: 'Night Ops', tint: '#42474f', unlockKey: 'cloak:obsidian' },
    { id: 'ivory', label: 'Honor Ivory', tint: '#f4efe4', unlockKey: 'cloak:ivory' },
    { id: 'royal', label: 'Royal Navy', tint: '#4b6894' },
    { id: 'none', label: 'No Cloak', tint: '#ffffff' },
  ],
  scarfColors: [
    { id: '#b82924', label: 'Crimson' },
    { id: '#e8e8e2', label: 'Ivory Cravat' },
    { id: '#22252a', label: 'Tactical Black' },
    { id: '#d8a848', label: 'Commander Gold' },
    { id: '#35543e', label: 'Forest Green' },
    { id: '#3b5272', label: 'Slate Blue' },
  ],
  jacketColors: [
    { id: '#9a7a55', label: 'Classic Tan' },
    { id: '#26292e', label: 'Midnight Ops' },
    { id: '#596570', label: 'Slate Steel' },
    { id: '#5a3626', label: 'Dark Leather' },
    { id: '#34473a', label: 'Survey Olive' },
    { id: '#6e2e28', label: 'Garrison Maroon' },
  ],
  pantsThemes: [
    { id: 'ivory', label: 'Corps Ivory', pants: '#ebe5d8', boots: '#3a2518', skirt: '#4a3020' },
    { id: 'charcoal', label: 'Shadow Ops', pants: '#2c3036', boots: '#1c1a19', skirt: '#262220' },
    { id: 'khaki', label: 'Field Khaki', pants: '#bcae92', boots: '#483020', skirt: '#5a3d28' },
    { id: 'navy', label: 'Garrison Slate', pants: '#444f5c', boots: '#2b2019', skirt: '#3d2c22' },
  ],
  rigFinishes: [
    { id: 'steel', label: 'Brushed Steel', metal: '#b4bcc4', sheath: '#5a636c', trim: '#cfa454' },
    { id: 'gunmetal', label: 'Gunmetal', metal: '#5a626b', sheath: '#32373d', trim: '#9ca4ac' },
    { id: 'obsidian', label: 'Night-Forged', metal: '#272b30', sheath: '#181b1f', trim: '#6eb8ff', unlockKey: 'rigFinish:obsidian' },
    { id: 'gold', label: 'Commander Gold', metal: '#d8b468', sheath: '#3f3830', trim: '#fff0c4', unlockKey: 'rigFinish:gold' },
    { id: 'crimson', label: 'Crimson Alloy', metal: '#8e3830', sheath: '#2d2424', trim: '#e0b060' },
  ],
  bladeAuras: [
    { id: '#7ac8ff', label: 'Cold Steel', trail2: '#bfe8ff' },
    { id: '#ffcc55', label: 'Solar Gold', trail2: '#fff0b8', unlockKey: 'bladeAura:#ffcc55' },
    { id: '#ff5242', label: 'Crimson Edge', trail2: '#ffb0a0' },
    { id: '#58ff9a', label: 'Emerald Glint', trail2: '#c4ffe0' },
    { id: '#c8a0ff', label: 'Violet Flash', trail2: '#ebd8ff' },
    { id: '#ffffff', label: 'Pure Silver', trail2: '#e4eef6' },
  ],
  crests: [
    { id: 'survey', label: 'Wings Crest', color: '#cfd6de' },
    { id: 'vanguard', label: 'Twin Blades', color: '#8ac8ff' },
    { id: 'garrison', label: 'Wall Rose', color: '#d46a5a' },
    { id: 'wings_gold', label: 'Gold Wings', color: '#f0c464', unlockKey: 'crest:wings_gold' },
  ],
};

export const DEFAULT_APPEARANCE = {
  skinTone: '#e4bca0',
  eyeColor: '#4e7898',
  expression: 'focused',
  accessory: 'none',
  hairStyle: 'scout',
  hairColor: '#181512',
  capeStyle: 'survey',
  scarfColor: '#b82924',
  jacketColor: '#9a7a55',
  pantsTheme: 'ivory',
  rigFinish: 'steel',
  bladeAura: '#7ac8ff',
  crest: 'survey',
};

function taperedLimbGeo(len, rTop, rMid, rBot, seg = 10) {
  const pts = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(rTop, -len * 0.06),
    new THREE.Vector2(rMid, -len * 0.42),
    new THREE.Vector2(rBot, -len * 0.94),
    new THREE.Vector2(0.001, -len),
  ];
  return new THREE.LatheGeometry(pts, seg);
}

function headLatheGeo() {
  const pts = [
    new THREE.Vector2(0.001, -0.008),
    new THREE.Vector2(0.036, 0.002),
    new THREE.Vector2(0.068, 0.025),
    new THREE.Vector2(0.088, 0.062),
    new THREE.Vector2(0.095, 0.105),
    new THREE.Vector2(0.094, 0.145),
    new THREE.Vector2(0.076, 0.18),
    new THREE.Vector2(0.044, 0.2),
    new THREE.Vector2(0.001, 0.208),
  ];
  return new THREE.LatheGeometry(pts, 20);
}

function torsoLatheGeo() {
  const pts = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(0.135, 0.03),
    new THREE.Vector2(0.125, 0.16),
    new THREE.Vector2(0.142, 0.31),
    new THREE.Vector2(0.158, 0.44),
    new THREE.Vector2(0.12, 0.5),
    new THREE.Vector2(0.052, 0.53),
    new THREE.Vector2(0.001, 0.54),
  ];
  return new THREE.LatheGeometry(pts, 14);
}

let BASE_MATS = null;
function getBaseMats() {
  if (BASE_MATS) return BASE_MATS;
  BASE_MATS = {
    strap: new THREE.MeshStandardMaterial({ color: '#281b12', roughness: 0.56 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: '#2b3036', roughness: 0.34, metalness: 0.86 }),
    eyeWhite: new THREE.MeshStandardMaterial({ color: '#f7f5f0', roughness: 0.16 }),
    pupil: new THREE.MeshStandardMaterial({ color: '#0d1014', roughness: 0.1 }),
    spear: new THREE.MeshStandardMaterial({ color: '#34302c', emissive: '#ff5a28', emissiveIntensity: 0.65, roughness: 0.42, metalness: 0.65 }),
    glass: new THREE.MeshStandardMaterial({ color: '#3e627a', roughness: 0.12, metalness: 0.85, transparent: true, opacity: 0.82 }),
    scar: new THREE.MeshStandardMaterial({ color: '#9e4a42', roughness: 0.78 }),
    shirt: new THREE.MeshStandardMaterial({ color: '#e6e0d2', roughness: 0.84 }),
    lips: new THREE.MeshStandardMaterial({ color: '#b47468', roughness: 0.65 }),
  };
  return BASE_MATS;
}

export class PlayerModel {
  constructor(scene, appearance = {}, opts = {}) {
    this.scene = scene;
    this.lightweight = !!opts.lightweight;
    const M = getBaseMats();

    this.skinMat = new THREE.MeshStandardMaterial({ color: '#e4bca0', roughness: 0.56 });
    this.irisMat = new THREE.MeshStandardMaterial({ color: '#4e7898', roughness: 0.16, metalness: 0.15 });
    this.jacketMat = new THREE.MeshStandardMaterial({ color: '#9a7a55', roughness: 0.72 });
    this.pantsMat = new THREE.MeshStandardMaterial({ color: '#ebe5d8', roughness: 0.84 });
    this.bootsMat = new THREE.MeshStandardMaterial({ color: '#3a2518', roughness: 0.48 });
    this.skirtMat = new THREE.MeshStandardMaterial({ color: '#4a3020', roughness: 0.65, side: THREE.DoubleSide });
    this.hairMat = new THREE.MeshStandardMaterial({ color: '#181512', roughness: 0.62 });
    this.scarfMat = new THREE.MeshStandardMaterial({ color: '#b82924', roughness: 0.85 });
    this.capeMat = new THREE.MeshStandardMaterial({ map: capeTexture(), side: THREE.DoubleSide, roughness: 0.88 });
    this.metalMat = new THREE.MeshStandardMaterial({ color: '#b4bcc4', roughness: 0.24, metalness: 0.92 });
    this.sheathMat = new THREE.MeshStandardMaterial({ color: '#5a636c', roughness: 0.34, metalness: 0.8 });
    this.trimMat = new THREE.MeshStandardMaterial({ color: '#cfa454', roughness: 0.28, metalness: 0.88 });
    this.crestMat = new THREE.MeshStandardMaterial({ color: '#cfd6de', roughness: 0.28, metalness: 0.86 });
    this.bladeMat = new THREE.MeshStandardMaterial({ color: '#aebbc8', roughness: 0.3, metalness: 0.94, emissive: '#7ac8ff', emissiveIntensity: 0.1 });

    this.ownedGeos = [];
    this.ownedMats = [
      this.skinMat, this.irisMat, this.jacketMat, this.pantsMat, this.bootsMat, this.skirtMat,
      this.hairMat, this.scarfMat, this.capeMat, this.metalMat, this.sheathMat, this.trimMat,
      this.crestMat, this.bladeMat,
    ];

    const mk = (g, m, parent, x = 0, y = 0, z = 0) => {
      this.ownedGeos.push(g);
      const me = new THREE.Mesh(g, m);
      me.position.set(x, y, z);
      me.castShadow = !this.lightweight;
      me.receiveShadow = true;
      parent.add(me);
      return me;
    };
    const G = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

    const root = new THREE.Group();
    this.root = root;
    scene.add(root);

    const pelvis = G(root, 0, 0.02, 0);
    this.pelvis = pelvis;
    mk(new THREE.SphereGeometry(0.16, 12, 10), this.pantsMat, pelvis, 0, -0.02, 0).scale.set(1.12, 0.82, 0.84);
    const waistWrap = mk(new THREE.CylinderGeometry(0.175, 0.215, 0.27, 14, 1, true, -Math.PI * 0.72, Math.PI * 1.44), this.skirtMat, pelvis, 0, -0.07, 0);
    waistWrap.rotation.y = Math.PI;
    mk(new THREE.CylinderGeometry(0.168, 0.168, 0.055, 14), M.strap, pelvis, 0, 0.055, 0).scale.set(1.06, 1, 0.82);
    mk(new THREE.BoxGeometry(0.068, 0.062, 0.03), this.trimMat, pelvis, 0, 0.055, 0.145);

    const turbineDrum = mk(new THREE.CylinderGeometry(0.082, 0.082, 0.24, 14), this.metalMat, pelvis, 0, 0.05, -0.19);
    turbineDrum.rotation.z = Math.PI / 2;
    mk(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 14), this.trimMat, pelvis, 0, 0.05, -0.19).rotation.z = Math.PI / 2;
    mk(new THREE.CylinderGeometry(0.048, 0.064, 0.09, 10), M.darkMetal, pelvis, 0, 0.02, -0.275).rotation.x = Math.PI / 2;

    this.spearMeshes = [];
    for (const sx of [-1, 1]) {
      const box = mk(new THREE.BoxGeometry(0.095, 0.155, 0.27), this.metalMat, pelvis, sx * 0.23, 0.01, 0.02);
      box.rotation.x = 0.14;
      const nozzle = mk(new THREE.CylinderGeometry(0.024, 0.034, 0.11, 8), M.darkMetal, box, 0, 0.02, 0.16);
      nozzle.rotation.x = Math.PI / 2;
      const tank = mk(new THREE.CylinderGeometry(0.055, 0.055, 0.54, 12), this.metalMat, pelvis, sx * 0.205, 0.08, -0.22);
      tank.rotation.x = Math.PI / 2 - 0.28;
      mk(new THREE.CylinderGeometry(0.06, 0.06, 0.045, 12), this.trimMat, tank, 0, 0.2, 0);
      mk(new THREE.CylinderGeometry(0.06, 0.06, 0.035, 12), this.trimMat, tank, 0, -0.16, 0);
      const sheath = mk(new THREE.BoxGeometry(0.072, 0.145, 0.6), this.sheathMat, pelvis, sx * 0.265, -0.2, -0.06);
      sheath.rotation.x = -0.5;
      mk(new THREE.BoxGeometry(0.08, 0.154, 0.055), M.strap, sheath, 0, 0, 0.22);
      mk(new THREE.BoxGeometry(0.08, 0.154, 0.055), M.strap, sheath, 0, 0, -0.18);
      for (let k = -1; k <= 1; k++) {
        mk(new THREE.BoxGeometry(0.012, 0.03, 0.12), this.bladeMat, sheath, 0, k * 0.038, 0.33);
      }
      const sp = mk(new THREE.CylinderGeometry(0.034, 0.034, 0.78, 8), M.spear, sheath, sx * 0.056, 0.045, 0.05);
      sp.rotation.x = Math.PI / 2;
      mk(new THREE.ConeGeometry(0.046, 0.16, 8), M.spear, sp, 0, 0.44, 0);
      this.spearMeshes.push(sp);
    }

    const spine = G(pelvis, 0, 0.08, 0);
    this.spine = spine;
    const innerTorso = mk(torsoLatheGeo(), M.shirt, spine, 0, 0, 0);
    innerTorso.scale.set(0.98, 1.0, 0.68);
    const jacketBack = mk(new THREE.CylinderGeometry(0.188, 0.156, 0.34, 16, 1, false, Math.PI * 0.22, Math.PI * 1.56), this.jacketMat, spine, 0, 0.325, -0.006);
    jacketBack.scale.set(1.06, 1, 0.78);
    jacketBack.rotation.y = Math.PI;
    const collar = mk(new THREE.CylinderGeometry(0.115, 0.142, 0.072, 16, 1, true, Math.PI * 0.2, Math.PI * 1.6), this.jacketMat, spine, 0, 0.495, -0.008);
    collar.rotation.y = Math.PI;
    for (const sx of [-1, 1]) {
      const panel = mk(new THREE.BoxGeometry(0.135, 0.325, 0.042), this.jacketMat, spine, sx * 0.098, 0.32, 0.116);
      panel.rotation.y = -sx * 0.2;
      const lapel = mk(new THREE.BoxGeometry(0.068, 0.14, 0.024), this.jacketMat, spine, sx * 0.068, 0.415, 0.134);
      lapel.rotation.set(0.1, -sx * 0.18, sx * 0.26);
      const epaulet = mk(new THREE.BoxGeometry(0.105, 0.026, 0.07), this.jacketMat, spine, sx * 0.175, 0.48, -0.005);
      epaulet.rotation.z = -sx * 0.16;
      mk(new THREE.BoxGeometry(0.024, 0.47, 0.305), M.strap, spine, sx * 0.095, 0.23, 0).rotation.z = sx * 0.2;
      mk(new THREE.BoxGeometry(0.036, 0.032, 0.016), this.trimMat, spine, sx * 0.095, 0.24, 0.156);
    }
    mk(new THREE.BoxGeometry(0.052, 0.06, 0.016), this.crestMat, spine, -0.108, 0.36, 0.142);
    mk(new THREE.CylinderGeometry(0.158, 0.154, 0.038, 16), M.strap, spine, 0, 0.13, 0).scale.set(1.06, 1, 0.8);

    const neck = G(spine, 0, 0.51, 0);
    this.neck = neck;
    mk(new THREE.CylinderGeometry(0.044, 0.056, 0.11, 12), this.skinMat, neck, 0, 0.042, 0);
    const scarfRing = mk(new THREE.TorusGeometry(0.082, 0.028, 8, 18), this.scarfMat, neck, 0, 0.02, 0.008);
    scarfRing.rotation.x = Math.PI / 2;
    const scarfDrape = mk(new THREE.BoxGeometry(0.066, 0.16, 0.02), this.scarfMat, neck, 0.02, -0.07, 0.096);
    scarfDrape.rotation.set(-0.2, 0.08, -0.06);
    const scarfTail = mk(new THREE.BoxGeometry(0.058, 0.2, 0.02), this.scarfMat, neck, -0.035, -0.085, -0.095);
    scarfTail.rotation.set(0.3, 0, -0.12);

    const head = G(neck, 0, 0.095, 0.006);
    this.head = head;
    const headMesh = mk(headLatheGeo(), this.skinMat, head, 0, 0, 0);
    headMesh.scale.set(0.95, 1.0, 1.02);
    const nose = mk(new THREE.ConeGeometry(0.013, 0.038, 6), this.skinMat, head, 0, 0.076, 0.096);
    nose.rotation.x = Math.PI / 2 - 0.38;
    nose.scale.set(0.7, 1, 0.8);
    const mouth = mk(new THREE.BoxGeometry(0.046, 0.0075, 0.009), M.lips, head, 0, 0.042, 0.084);
    this.mouthMesh = mouth;

    this.brows = [];
    this.lids = [];
    for (const sx of [-1, 1]) {
      const ear = mk(new THREE.SphereGeometry(0.02, 8, 6), this.skinMat, head, sx * 0.09, 0.088, -0.008);
      ear.scale.set(0.34, 1.15, 0.65);

      const eyeW = mk(new THREE.SphereGeometry(0.021, 10, 8), M.eyeWhite, head, sx * 0.036, 0.094, 0.078);
      eyeW.scale.set(1.18, 0.78, 0.45);
      const iris = mk(new THREE.SphereGeometry(0.0135, 10, 8), this.irisMat, head, sx * 0.036, 0.093, 0.0865);
      iris.scale.set(1.0, 1.05, 0.4);
      const pupil = mk(new THREE.SphereGeometry(0.0068, 8, 6), M.pupil, head, sx * 0.036, 0.093, 0.0905);
      pupil.scale.set(1, 1.1, 0.35);
      const glint = mk(new THREE.SphereGeometry(0.0032, 6, 6), M.eyeWhite, head, sx * 0.036 + 0.004, 0.097, 0.0922);
      glint.castShadow = false;

      const lid = mk(new THREE.SphereGeometry(0.023, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.48), this.skinMat, head, sx * 0.036, 0.095, 0.078);
      lid.scale.set(1.24, 0.82, 0.5);
      lid.rotation.x = -0.38;
      this.lids.push(lid);

      const brow = mk(new THREE.BoxGeometry(0.042, 0.0095, 0.011), this.hairMat, head, sx * 0.037, 0.117, 0.087);
      brow.rotation.z = -sx * 0.12;
      this.brows.push(brow);
    }

    this.accGroups = {};
    const gScar = G(head);
    const sc1 = mk(new THREE.BoxGeometry(0.005, 0.042, 0.005), M.scar, gScar, 0.044, 0.068, 0.085);
    sc1.rotation.z = -0.38;
    this.accGroups.scar = gScar;

    const gGog = G(head);
    mk(new THREE.CylinderGeometry(0.098, 0.098, 0.022, 18, 1, true), M.strap, gGog, 0, 0.144, -0.002).scale.set(0.95, 1, 1.0);
    for (const sx of [-1, 1]) {
      const rim = mk(new THREE.TorusGeometry(0.026, 0.0055, 8, 16), this.trimMat, gGog, sx * 0.035, 0.146, 0.088);
      rim.rotation.y = sx * 0.18;
      const lens = mk(new THREE.CircleGeometry(0.023, 14), M.glass, gGog, sx * 0.035, 0.146, 0.09);
      lens.rotation.y = sx * 0.18;
    }
    this.accGroups.goggles = gGog;

    const gPatch = G(head);
    const patch = mk(new THREE.SphereGeometry(0.022, 10, 8), M.strap, gPatch, -0.034, 0.094, 0.085);
    patch.scale.set(1.12, 0.84, 0.42);
    const pStrap = mk(new THREE.TorusGeometry(0.096, 0.004, 6, 20), M.strap, gPatch, 0, 0.106, 0);
    pStrap.rotation.set(Math.PI / 2 + 0.16, 0.18, 0);
    this.accGroups.eyepatch = gPatch;

    const gMask = G(head);
    const mask = mk(new THREE.CylinderGeometry(0.078, 0.066, 0.06, 14, 1, false, -Math.PI * 0.52, Math.PI * 1.04), M.strap, gMask, 0, 0.044, 0.018);
    mask.scale.set(1.06, 1, 1.06);
    this.accGroups.mask = gMask;

    const gVisor = G(head);
    const vis = mk(new THREE.CylinderGeometry(0.102, 0.1, 0.036, 18, 1, true, -Math.PI * 0.42, Math.PI * 0.84), M.glass, gVisor, 0, 0.096, 0.004);
    vis.scale.set(0.96, 1, 1.02);
    this.accGroups.visor = gVisor;

    this.hairGroups = {};
    const hCrown = mk(new THREE.SphereGeometry(0.104, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.58), this.hairMat, head, 0, 0.118, -0.008);
    hCrown.rotation.x = -0.34;
    hCrown.scale.set(0.96, 1.04, 1.04);
    const hNape = mk(new THREE.SphereGeometry(0.092, 14, 10), this.hairMat, head, 0, 0.075, -0.048);
    hNape.scale.set(0.95, 0.9, 0.72);

    const addStrand = (parent, x, y, z, rx, ry, rz, w = 0.032, len = 0.085, th = 0.016) => {
      const g = new THREE.BoxGeometry(w, len, th);
      g.translate(0, -len * 0.45, 0);
      const m = mk(g, this.hairMat, parent, x, y, z);
      m.rotation.set(rx, ry, rz);
      return m;
    };

    const gScout = G(head);
    addStrand(gScout, -0.038, 0.168, 0.072, -0.22, -0.18, -0.14, 0.042, 0.068, 0.02);
    addStrand(gScout, 0.01, 0.172, 0.076, -0.2, 0.05, 0.12, 0.046, 0.074, 0.02);
    addStrand(gScout, 0.052, 0.164, 0.064, -0.18, 0.35, 0.16, 0.038, 0.066, 0.018);
    addStrand(gScout, -0.08, 0.142, 0.036, -0.06, -0.6, -0.08, 0.028, 0.085, 0.018);
    addStrand(gScout, 0.08, 0.142, 0.036, -0.06, 0.6, 0.08, 0.028, 0.085, 0.018);
    this.hairGroups.scout = gScout;

    const gLevi = G(head);
    for (const sx of [-1, 1]) {
      addStrand(gLevi, sx * 0.042, 0.17, 0.072, -0.22, sx * 0.28, sx * 0.28, 0.048, 0.078, 0.022);
      addStrand(gLevi, sx * 0.078, 0.146, 0.042, -0.08, sx * 0.55, sx * 0.1, 0.032, 0.09, 0.018);
    }
    this.hairGroups.levi = gLevi;

    const gPony = G(head);
    addStrand(gPony, -0.022, 0.17, 0.074, -0.22, -0.12, -0.15, 0.044, 0.066, 0.018);
    addStrand(gPony, 0.034, 0.168, 0.072, -0.22, 0.2, 0.18, 0.04, 0.064, 0.018);
    const tailPivot = G(gPony, 0, 0.14, -0.102);
    this.ponytailPivot = tailPivot;
    mk(new THREE.TorusGeometry(0.026, 0.008, 6, 12), this.scarfMat, tailPivot, 0, 0, 0);
    const tMesh = mk(new THREE.ConeGeometry(0.042, 0.26, 7), this.hairMat, tailPivot, 0, -0.11, -0.045);
    tMesh.rotation.x = -2.55;
    this.hairGroups.ponytail = gPony;

    const gBun = G(head);
    mk(new THREE.SphereGeometry(0.046, 12, 10), this.hairMat, gBun, 0, 0.158, -0.104);
    mk(new THREE.TorusGeometry(0.032, 0.007, 6, 12), this.scarfMat, gBun, 0, 0.152, -0.088).rotation.x = 0.4;
    for (const sx of [-1, 1]) addStrand(gBun, sx * 0.068, 0.145, 0.052, -0.12, sx * 0.4, sx * 0.12, 0.022, 0.08, 0.014);
    this.hairGroups.bun = gBun;

    const gLong = G(head);
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * 0.62 + (i / 6) * Math.PI * 0.76;
      addStrand(gLong, Math.sin(a) * 0.092, 0.135, Math.cos(a) * 0.092 - 0.008, 0.08, a, 0, 0.042, 0.2, 0.02);
    }
    for (const sx of [-1, 1]) addStrand(gLong, sx * 0.062, 0.16, 0.058, -0.14, sx * 0.35, sx * 0.12, 0.032, 0.13, 0.016);
    this.hairGroups.long = gLong;

    const gSpiky = G(head);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const m = mk(new THREE.ConeGeometry(0.03, 0.08, 5), this.hairMat, gSpiky, Math.sin(a) * 0.055, 0.19, Math.cos(a) * 0.055 - 0.01);
      m.rotation.set(Math.cos(a) * 0.55, 0, -Math.sin(a) * 0.55);
    }
    this.hairGroups.spiky = gSpiky;

    const gUnder = G(head);
    mk(new THREE.SphereGeometry(0.094, 14, 10), this.hairMat, gUnder, 0, 0.168, 0.004).scale.set(0.95, 0.52, 1.04);
    this.hairGroups.undercut = gUnder;

    const gGar = G(head);
    const band = mk(new THREE.CylinderGeometry(0.102, 0.102, 0.026, 18, 1, true), this.scarfMat, gGar, 0, 0.14, 0.002);
    band.scale.set(0.94, 1, 1.02);
    addStrand(gGar, 0, 0.172, 0.07, -0.22, 0, 0, 0.05, 0.052, 0.018);
    addStrand(gGar, -0.02, 0.132, -0.105, 0.28, 0, -0.14, 0.022, 0.14, 0.008);
    this.hairGroups.garrison = gGar;

    this.sh = []; this.el = []; this.hand = []; this.blades = []; this.bladeSteel = [];
    for (const sx of [-1, 1]) {
      const sh = G(spine, sx * 0.215, 0.425, 0);
      mk(new THREE.SphereGeometry(0.058, 10, 8), this.jacketMat, sh, 0, 0, 0);
      mk(taperedLimbGeo(0.28, 0.054, 0.048, 0.044, 10), this.jacketMat, sh, 0, 0, 0);
      const el = G(sh, 0, -0.275, 0);
      mk(taperedLimbGeo(0.26, 0.044, 0.041, 0.036, 10), this.jacketMat, el, 0, 0, 0);
      mk(new THREE.CylinderGeometry(0.045, 0.042, 0.068, 10), M.strap, el, 0, -0.21, 0);
      const hd = G(el, 0, -0.26, 0);
      mk(new THREE.BoxGeometry(0.062, 0.076, 0.066), M.strap, hd, 0, -0.018, 0);
      mk(new THREE.SphereGeometry(0.034, 8, 6), this.skinMat, hd, 0, -0.044, 0.012).scale.set(0.88, 0.96, 1.0);

      const bl = new THREE.Group();
      hd.add(bl);
      bl.position.set(0, -0.03, 0.03);
      mk(new THREE.BoxGeometry(0.024, 0.145, 0.05), M.darkMetal, bl, 0, 0, 0);
      mk(new THREE.BoxGeometry(0.016, 0.11, 0.036), this.metalMat, bl, 0, -0.01, 0.044);
      mk(new THREE.BoxGeometry(0.01, 0.055, 0.022), this.trimMat, bl, sx * 0.014, 0.018, 0.035);
      mk(new THREE.BoxGeometry(0.038, 0.024, 0.115), this.metalMat, bl, 0, 0.076, 0.016);
      const steel = mk(new THREE.BoxGeometry(0.0085, 0.94, 0.054), this.bladeMat, bl, 0, 0.55, 0.0);
      this.bladeSteel.push(steel);
      for (let seg = 1; seg <= 5; seg++) {
        const groove = mk(new THREE.BoxGeometry(0.012, 0.006, 0.058), M.darkMetal, steel, 0, -0.42 + seg * 0.15, 0);
        groove.rotation.x = 0.35;
      }
      bl.rotation.set(Math.PI / 2 - 0.1, sx * 0.08, 0);
      this.sh.push(sh); this.el.push(el); this.hand.push(hd); this.blades.push(bl);
    }

    this.th = []; this.kn = [];
    for (const sx of [-1, 1]) {
      const th = G(pelvis, sx * 0.098, -0.05, 0);
      mk(taperedLimbGeo(0.44, 0.082, 0.07, 0.056, 10), this.pantsMat, th, 0, 0, 0);
      mk(new THREE.CylinderGeometry(0.076, 0.073, 0.042, 10), M.strap, th, 0, -0.18, 0);
      mk(new THREE.CylinderGeometry(0.068, 0.065, 0.034, 10), M.strap, th, 0, -0.31, 0);
      const kn = G(th, 0, -0.435, 0);
      mk(new THREE.CylinderGeometry(0.062, 0.058, 0.065, 10), this.bootsMat, kn, 0, -0.04, 0);
      mk(taperedLimbGeo(0.41, 0.058, 0.052, 0.044, 10), this.bootsMat, kn, 0, -0.03, 0);
      mk(new THREE.BoxGeometry(0.092, 0.068, 0.215), this.bootsMat, kn, 0, -0.425, 0.048);
      mk(new THREE.BoxGeometry(0.096, 0.02, 0.225), M.strap, kn, 0, -0.462, 0.048);
      this.th.push(th); this.kn.push(kn);
    }

    this.buildCape();
    this.slash = 0;
    this.slashSide = 1;
    this.spinAngle = 0;
    this.runPhase = 0;
    this.animTime = 0;
    this.blinkT = 2.4;
    this.reloadAnim = 0;
    this.spearAnim = 0;
    this.flareAnim = 0;
    this.applyAppearance({ ...DEFAULT_APPEARANCE, ...appearance });
  }

  applyAppearance(app) {
    this.appearance = { ...DEFAULT_APPEARANCE, ...app };
    const A = this.appearance;
    this.skinMat.color.set(A.skinTone);
    this.irisMat.color.set(A.eyeColor);
    this.hairMat.color.set(A.hairColor);
    this.scarfMat.color.set(A.scarfColor);
    this.jacketMat.color.set(A.jacketColor);
    this.bladeMat.emissive.set(A.bladeAura);

    const pt = APPEARANCE_PRESETS.pantsThemes.find((p) => p.id === A.pantsTheme) || APPEARANCE_PRESETS.pantsThemes[0];
    this.pantsMat.color.set(pt.pants);
    this.bootsMat.color.set(pt.boots);
    this.skirtMat.color.set(pt.skirt);

    const rf = APPEARANCE_PRESETS.rigFinishes.find((r) => r.id === A.rigFinish) || APPEARANCE_PRESETS.rigFinishes[0];
    this.metalMat.color.set(rf.metal);
    this.sheathMat.color.set(rf.sheath);
    this.trimMat.color.set(rf.trim);

    const cr = APPEARANCE_PRESETS.crests.find((c) => c.id === A.crest) || APPEARANCE_PRESETS.crests[0];
    this.crestMat.color.set(cr.color);

    const exprAngle = { focused: 0.14, fierce: 0.28, stoic: 0.03, confident: -0.06 }[A.expression] ?? 0.14;
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      this.brows[i].rotation.z = -sx * exprAngle;
      this.brows[i].position.y = A.expression === 'fierce' ? 0.1135 : 0.117;
    }
    this.mouthMesh.scale.set(A.expression === 'confident' ? 1.18 : A.expression === 'fierce' ? 1.1 : 0.92, A.expression === 'fierce' ? 1.45 : 1.0, 1);

    for (const [k, grp] of Object.entries(this.hairGroups)) grp.visible = k === A.hairStyle;
    for (const [k, grp] of Object.entries(this.accGroups)) grp.visible = k === A.accessory;

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
    const W = 0.62, L = 1.04;
    this.capeRest = { dx: (W / (C - 1)) * 0.78, dy: L / (R - 1) };
    this.cp = []; this.cpp = [];
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const p = new THREE.Vector3((c / (C - 1) - 0.5) * W * 0.82, -r * this.capeRest.dy, Math.sin(c * 2.4) * 0.045 * (0.3 + r / R) - (r / (R - 1)) * 0.05);
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
    return out.set((c / (this.capeC - 1) - 0.5) * W, 0.5, -0.155).applyMatrix4(this.spine.matrixWorld);
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
          this.cp[i].copy(_v);
          this.cp[i].y -= r * this.capeRest.dy;
          this.cp[i].z += Math.sin(c * 2.4) * 0.045 * (0.3 + r / R) - (r / (R - 1)) * 0.05;
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
        const flutter = Math.sin(t * 13 + i * 0.7) * 0.42 + Math.sin(t * 5.1 + i * 1.3) * 0.22;
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
    if (st.showcase) {
      st = {
        ...st, grounded: true, speed: 0, latVel: 0, fwdVel: 0, lookSwayX: 0, lookSwayY: 0,
        charge: 0, wall: null, hooked: false, spin: false, slashT: -1, grabbed: false, fp: false, pitch: 0,
      };
    }
    const r = this.root;
    r.position.copy(pos);
    r.quaternion.copy(quat);
    if (st.spin) {
      this.spinAngle += dt * 28;
      r.rotateZ(this.spinAngle);
    } else this.spinAngle = 0;

    this.blinkT -= dt;
    let lidRot = -0.35;
    if (this.blinkT < 0) {
      if (this.blinkT < -0.13) this.blinkT = 2.6 + Math.random() * 3.4;
      else lidRot = -0.35 + Math.sin((-this.blinkT / 0.13) * Math.PI) * 1.15;
    }
    for (let i = 0; i < 2; i++) this.lids[i].rotation.x = lidRot;

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
      this.ponytailPivot.rotation.x = damp(this.ponytailPivot.rotation.x, clamp(st.speed * 0.03, 0, 0.9) + Math.sin(this.animTime * 8) * 0.07, 8, dt);
    }

    const sl = st.slashT;
    const chargeShake = (st.charge || 0) > 0.1 ? Math.sin(this.animTime * 55) * 0.04 * st.charge : 0;
    for (let i = 0; i < 2; i++) {
      const sg = i ? 1 : -1;
      let sx = lerp(Math.sin(ph + i * Math.PI) * 0.7 * run, 0.55, air);
      let sz = sg * lerp(0.16, 0.55, air);
      let ex = lerp(-0.6 * run - 0.2, -0.35, air);
      let hx = lerp(1.15 - 0.3 * run, 1.95, air);
      if (st.fp) {
        const swayX = clamp(-(st.latVel || 0) * 0.011 + (st.lookSwayX || 0) * 0.55, -0.2, 0.2);
        const swayY = clamp((st.lookSwayY || 0) * 0.42 - clamp((st.fwdVel || 0) * 0.003, -0.05, 0.1), -0.15, 0.14);
        const bob = Math.sin(ph + i * Math.PI) * 0.05 * run + Math.sin(this.animTime * 2.2 + i) * 0.015;
        const hookPull = st.hooked ? 0.09 : 0;
        sx = -1.16 - air * 0.08 - hookPull - (st.pitch || 0) * 0.85 + bob + swayY + chargeShake;
        sz = sg * (0.56 + (st.charge || 0) * 0.24) + swayX;
        ex = -0.34 - (st.charge || 0) * 0.2;
        hx = 0.68 + air * 0.06;
        if (this.reloadAnim > 0) {
          const rp = 1 - this.reloadAnim / 0.38;
          sx = rp < 0.45 ? lerp(-1.16, 0.25, rp / 0.45) : lerp(0.25, -1.18, (rp - 0.45) / 0.55);
          hx = lerp(1.4, 0.68, rp);
        }
        if (i === 0 && this.spearAnim > 0) sx -= Math.sin((this.spearAnim / 0.32) * Math.PI) * 0.48;
        if (i === 1 && this.flareAnim > 0) { sx = -1.85; sz = 0.18; ex = -0.2; }
      }
      if (st.spin) { sx = -0.2; sz = sg * 1.45; ex = -0.05; hx = 0.1; }
      else if (sl >= 0 && st.fp) {
        const w = sl < 0.2 ? sl / 0.2 : 1;
        const sweep = sl < 0.2 ? 0 : Math.min(1, (sl - 0.2) / 0.44);
        const alt = (st.slashSide || 1) * sg > 0 ? 1 : 0.82;
        sx = lerp(lerp(-1.22, -2.12, w), -0.68, sweep) * alt;
        sz = sg * lerp(lerp(0.28, 1.02, w), -0.48, sweep);
        ex = lerp(-0.9, -0.14, sweep);
        hx = lerp(0.45, -0.52, sweep);
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
      D(this.sh[i].rotation, 'x', sx, sl >= 0 ? 42 : 14);
      D(this.sh[i].rotation, 'z', sz, sl >= 0 ? 42 : 14);
      D(this.el[i].rotation, 'x', ex, 20);
      D(this.hand[i].rotation, 'x', hx, sl >= 0 ? 42 : 16);
      const bladePct = clamp((st.blade ?? 100) / 100, 0, 1);
      const reloadSlide = this.reloadAnim > 0 ? clamp((0.38 - this.reloadAnim) / 0.28, 0.15, 1) : 1;
      const bladeLen = (0.38 + bladePct * 0.62) * reloadSlide;
      this.bladeSteel[i].visible = (st.blade ?? 100) > 0;
      this.bladeSteel[i].scale.y = damp(this.bladeSteel[i].scale.y, bladeLen, 16, dt);
      this.bladeSteel[i].position.y = 0.08 + 0.47 * this.bladeSteel[i].scale.y;
    }
    for (const bl of this.blades) bl.scale.y = damp(bl.scale.y, st.fp ? 0.54 : 1, 12, dt);
    this.bladeMat.emissiveIntensity = damp(this.bladeMat.emissiveIntensity, st.speed > 26 || st.spin || sl >= 0 ? 0.85 : 0.12, 8, dt);
    D(this.spine.rotation, 'x', lerp(run * 0.35, st.hooked ? 0.15 : 0.35, air) + lk * 0.5);
    D(this.spine.rotation, 'y', sl >= 0 ? Math.sin(sl * Math.PI) * 0.78 : 0, 24);
    this.head.visible = !st.fp;
    const flick = (st.invuln || 0) > 0 && Math.floor(st.invuln * 14) % 2 === 1;
    this.root.visible = !this._hidden && !flick;
    D(this.head.rotation, 'x', -this.spine.rotation.x * 0.6);
    this.pelvis.position.y = 0.02 + (st.grounded ? Math.abs(Math.cos(ph)) * 0.04 * run : 0) - lk * 0.34;
    r.updateMatrixWorld(true);
    this.updateCape(dt, st.vel);
  }

  setVisible(v) {
    this._hidden = !v;
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
