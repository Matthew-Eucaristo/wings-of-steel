import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Convex, VCylinder, Capsule, RingWall, boxPlanes, prismPlanes, CollisionWorld } from './collision.js';
import * as TX from './textures.js';
import { mulberry32, clamp } from './util.js';

export const WALL_R = 380;
export const WALL_T = 14;
export const WALL_H = 58;
export const GAP_HALF = 0.05;
export const TOWN_R = 206;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

// Box with UVs in world units (u/uS, v/vS) and per-vertex colour
function boxGeo(w, h, d, uS, vS, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] / uS, uv.getY(i) * dims[f][1] / vS);
    }
  }
  return colorize(g, color);
}

function colorize(g, color) {
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function place(g, x, y, z, yaw = 0, rx = 0, rz = 0) {
  _e.set(rx, yaw, rz, 'YXZ');
  _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1));
  g.applyMatrix4(_m);
  return g;
}

// gable roof: ridge along x, slopes towards ±z. base at y=0
function roofGeo(w, rh, d, over, color) {
  const hx = w / 2 + over, hz = d / 2 + over;
  const dropY = -(over * rh) / (d / 2);
  const pos = [], uv = [], idx = [];
  const slopeLen = Math.hypot(hz, rh - dropY);
  const quad = (a, b, c, dd, uvs) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...dd);
    uv.push(...uvs);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // +z slope
  quad([-hx, dropY, hz], [hx, dropY, hz], [hx, rh, 0], [-hx, rh, 0], [0, 0, (2 * hx) / 4, 0, (2 * hx) / 4, slopeLen / 4, 0, slopeLen / 4]);
  // -z slope
  quad([hx, dropY, -hz], [-hx, dropY, -hz], [-hx, rh, 0], [hx, rh, 0], [0, 0, (2 * hx) / 4, 0, (2 * hx) / 4, slopeLen / 4, 0, slopeLen / 4]);
  // underside (thin), so overhang has a bottom
  quad([-hx, dropY - 0.15, -hz], [hx, dropY - 0.15, -hz], [hx, dropY - 0.15, hz], [-hx, dropY - 0.15, hz], [0, 0, 1, 0, 1, 1, 0, 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return colorize(g, color);
}

// gable triangles on the ±x ends (wall material)
function gableGeo(w, rh, d, color) {
  const hx = w / 2, hz = d / 2;
  const pos = [hx, 0, hz, hx, 0, -hz, hx, rh, 0, -hx, 0, -hz, -hx, 0, hz, -hx, rh, 0];
  const uv = [0, 0, d / 8, 0, d / 16, rh / 6.4, 0, 0, d / 8, 0, d / 16, rh / 6.4];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 3, 4, 5]);
  g.computeVertexNormals();
  return colorize(g, color);
}

function pyramidGeo(s, h, color) {
  const g = new THREE.ConeGeometry(s * Math.SQRT2, h, 4, 1);
  g.rotateY(Math.PI / 4);
  g.translate(0, h / 2, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * (h / 4));
  return colorize(g, color);
}

function pyramidPlanes(s, h) {
  const L = Math.hypot(h, s);
  return [
    [h / L, s / L, 0, (s * h) / L], [-h / L, s / L, 0, (s * h) / L],
    [0, s / L, h / L, (s * h) / L], [0, s / L, -h / L, (s * h) / L],
    [0, -1, 0, 0],
  ];
}

const PLASTER = ['#f3ead8', '#eadcc0', '#f0e2cc', '#e6d7c2', '#e3e6e2', '#f2dabf', '#ebe2d0', '#e8d2bc', '#dcd6c8'].map((c) => new THREE.Color(c));
const ROOFC = ['#b5583a', '#a5492f', '#9a5a3a', '#5d6674', '#6c4c3c', '#b86a45', '#8d3f2c'].map((c) => new THREE.Color(c));

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.col = new CollisionWorld();
    this.depots = [];
    this.titanSpawns = [];
    this.obstacles = []; // {x,z,r,h} footprints for titan steering
    this.houses = [];      // destructible buildings {x,z,yaw,w,d,h,top,cols,lists,sec,dead}
    this.houseSections = [];
    this.time = 0;
    this.uniformsTime = { value: 0 };
    this.rng = mulberry32(1337);
    this.windDir = new THREE.Vector3(0.6, 0, 0.3);
  }

  build() {
    this.buildSky();
    this.textures = {
      facade: TX.facadeTextures(),
      roof: TX.roofTextures(),
      cobble: TX.cobbleTextures(),
      grass: TX.grassTextures(),
      stone: TX.stoneWallTextures(),
      bark: TX.barkTextures(),
      leaf: TX.leafTextures(),
    };
    this.buildGround();
    this.buildWall();
    this.buildTown();
    this.buildForest();
    this.buildCountryside();
    this.buildMountains();
    this.buildClouds();
    this.col.build();
  }

  buildSky() {
    const scene = this.scene;
    const sky = new Sky();
    sky.scale.setScalar(20000);
    const u = sky.material.uniforms;
    u.turbidity.value = 7;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.0045;
    u.mieDirectionalG.value = 0.86;
    const elevation = 13, azimuth = 205;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    this.sky = sky;

    // environment lighting from the sky
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const sky2 = sky.clone();
    envScene.add(sky2);
    this.envRT = pmrem.fromScene(envScene, 0.02);
    scene.environment = this.envRT.texture;
    scene.environmentIntensity = 0.55;
    scene.add(sky);

    scene.fog = new THREE.FogExp2(new THREE.Color('#c9b9a4'), 0.0014);

    const sun = new THREE.DirectionalLight(new THREE.Color('#ffd7a8'), 3.2);
    sun.position.copy(this.sunDir).multiplyScalar(300);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera;
    sc.left = -130; sc.right = 130; sc.top = 130; sc.bottom = -130;
    sc.near = 10; sc.far = 900;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;

    const hemi = new THREE.HemisphereLight(new THREE.Color('#bcd2ff'), new THREE.Color('#6b5a44'), 0.55);
    scene.add(hemi);
  }

  // keep the shadow frustum centred on the player, snapped to texels to avoid shimmering
  followShadow(center) {
    const sun = this.sun;
    const texel = 260 / sun.shadow.mapSize.x;
    const lightMatrix = new THREE.Matrix4().lookAt(new THREE.Vector3(), this.sunDir.clone().negate(), new THREE.Vector3(0, 1, 0));
    const inv = lightMatrix.clone().invert();
    const lc = center.clone().applyMatrix4(inv);
    lc.x = Math.round(lc.x / texel) * texel;
    lc.y = Math.round(lc.y / texel) * texel;
    const snapped = lc.applyMatrix4(lightMatrix);
    sun.target.position.copy(snapped);
    sun.position.copy(snapped).addScaledVector(this.sunDir, 420);
    sun.target.updateMatrixWorld();
  }

  buildGround() {
    const t = this.textures;
    const mat = new THREE.MeshStandardMaterial({ map: t.grass.map, normalMap: t.grass.normalMap, roughness: 0.95, metalness: 0 });
    mat.normalScale.set(0.6, 0.6);
    const uniforms = {
      uCobble: { value: t.cobble.map },
      uCobbleN: { value: t.cobble.normalMap },
      uTownR: { value: TOWN_R },
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vWPos;
uniform sampler2D uCobble; uniform sampler2D uCobbleN; uniform float uTownR;
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm2(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5;} return s; }
float townMask(){ float r = length(vWPos.xz); return 1.0 - smoothstep(uTownR-6.0, uTownR+4.0, r + (fbm2(vWPos.xz*0.05)-0.5)*14.0); }
`)
        .replace('#include <map_fragment>', `
  vec2 guv = vWPos.xz / 9.0;
  vec4 grassC = texture2D(map, guv);
  vec4 grassC2 = texture2D(map, vWPos.xz / 41.0 + 0.37);
  vec4 cob = texture2D(uCobble, vWPos.xz / 2.4);
  cob.rgb *= vec3(1.15, 1.02, 0.86);
  float macro = fbm2(vWPos.xz * 0.012);
  float tm = townMask();
  vec3 g = mix(grassC.rgb, grassC2.rgb, 0.45) * mix(0.75, 1.2, macro);
  // dry patches and dirt
  float dirt = smoothstep(0.55, 0.75, fbm2(vWPos.xz * 0.03 + 7.0));
  g = mix(g, vec3(0.42, 0.34, 0.22) * (0.8 + macro*0.4), dirt * 0.6);
  // forest floor darker
  float ang = atan(vWPos.x, vWPos.z);
  float forest = smoothstep(0.9, 0.6, abs(abs(ang) - 3.14159) ) * smoothstep(TOWN_EDGE, TOWN_EDGE + 30.0, length(vWPos.xz));
  g = mix(g, g * vec3(0.55, 0.62, 0.45), forest);
  // warmer, lighter sandstone paving so the streets don't read as a black void from the air
  vec3 cb = cob.rgb * mix(0.8, 1.15, macro) * vec3(1.3, 1.22, 1.1);
  diffuseColor.rgb *= mix(g, cb, tm);
`.replace(/TOWN_EDGE/g, (TOWN_R + 10).toFixed(1)))
        .replace('#include <normal_fragment_maps>', `
  {
    float tmN = townMask();
    vec3 nG = texture2D(normalMap, vWPos.xz / 9.0).xyz * 2.0 - 1.0;
    vec3 nC = texture2D(uCobbleN, vWPos.xz / 2.4).xyz * 2.0 - 1.0;
    vec3 mapN = normalize(mix(nG * vec3(0.6,0.6,1.0), nC * vec3(0.55,0.55,1.0), tmN));
    normal = normalize( tbn * mapN );
  }
`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(0.95, 0.9, townMask());');
    };
    // ground needs tangent frame for normal map: use USE_NORMALMAP_TANGENTSPACE with computed tbn from derivatives
    const g = new THREE.PlaneGeometry(9000, 9000, 1, 1);
    g.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.ground = mesh;
  }

  wallMaterial() {
    const t = this.textures.stone;
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.92, color: new THREE.Color('#d6cfc2') });
  }

  buildWall() {
    const R = WALL_R, T = WALL_T, H = WALL_H;
    const segs = 360;
    const a0 = GAP_HALF, a1 = Math.PI * 2 - GAP_HALF;
    const pos = [], uv = [], idx = [];
    const addStrip = (fn) => {
      const base = pos.length / 3;
      for (let i = 0; i <= segs; i++) {
        const a = a0 + ((a1 - a0) * i) / segs;
        const [p0, p1, u, v0, v1] = fn(a, i);
        pos.push(...p0, ...p1);
        uv.push(u, v0, u, v1);
      }
      for (let i = 0; i < segs; i++) {
        const k = base + i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    };
    const circ = (r, a) => [r * Math.sin(a), r * Math.cos(a)];
    // inner face (facing centre)
    addStrip((a) => { const [x, z] = circ(R, a); return [[x, 0, z], [x, H, z], (a * R) / 8, 0, H / 8]; });
    // outer face
    addStrip((a) => { const [x, z] = circ(R + T, a); return [[x, H, z], [x, 0, z], (a * (R + T)) / 8, H / 8, 0]; });
    // top
    addStrip((a) => { const [x, z] = circ(R, a); const [x2, z2] = circ(R + T, a); return [[x, H, z], [x2, H, z2], (a * R) / 8, 0, T / 8]; });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = this.wallMaterial();
    const wall = new THREE.Mesh(g, mat);
    wall.castShadow = wall.receiveShadow = true;
    this.scene.add(wall);
    this.col.add(new RingWall(R, T, H, 0, GAP_HALF));
    // intact gate section, only shown in the prologue before the breach
    const gw = 2 * R * Math.sin(GAP_HALF) + 4;
    this.breachPlug = new THREE.Mesh(new THREE.BoxGeometry(gw, H, T), mat);
    this.breachPlug.position.set(0, H / 2, R + T / 2);
    this.breachPlug.visible = false;
    this.breachPlug.castShadow = this.breachPlug.receiveShadow = true;
    this.scene.add(this.breachPlug);

    // buttress towers, battlements, broken edges
    const parts = [];
    const white = new THREE.Color('#ffffff');
    const n = 40;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.08;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < GAP_HALF + 0.08) continue;
      const r = R - 3;
      const x = r * Math.sin(a), z = r * Math.cos(a);
      const bw = 12, bd = 8, bh = H + 6;
      parts.push(place(boxGeo(bw, bh, bd, 8, 8, white), x, bh / 2, z, a));
      this.col.add(new Convex(new THREE.Vector3(x, bh / 2, z), a, boxPlanes(bw / 2, bh / 2, bd / 2), Math.hypot(bw, bh, bd) / 2, { surface: 'stone' }));
    }
    // merlons along the outer rim
    for (let i = 0; i < 520; i++) {
      const a = (i / 520) * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < GAP_HALF + 0.01) continue;
      const r = R + T - 1;
      parts.push(place(boxGeo(2.6, 2.4, 1.6, 8, 8, white), r * Math.sin(a), H + 1.2, r * Math.cos(a), a));
    }
    // rubble in the breach
    const rr = this.rng;
    for (let i = 0; i < 26; i++) {
      const a = (rr() - 0.5) * GAP_HALF * 2.6;
      const r = R - 6 + rr() * (T + 18);
      const s = 2 + rr() * 6;
      const x = r * Math.sin(a), z = r * Math.cos(a);
      const g2 = boxGeo(s, s * 0.8, s * 1.2, 8, 8, white);
      place(g2, x, s * 0.3, z, rr() * 6, rr() - 0.5, rr() - 0.5);
      parts.push(g2);
      if (s > 4) this.col.add(new Convex(new THREE.Vector3(x, s * 0.25, z), 0, boxPlanes(s * 0.45, s * 0.35, s * 0.45), s, { surface: 'stone' }));
    }
    // jagged ends of the wall at the breach
    for (const side of [-1, 1]) {
      const a = side * GAP_HALF;
      for (let k = 0; k < 6; k++) {
        const r = R + 1 + k * 2.2;
        const hgt = H * (0.55 + rr() * 0.45);
        const x = r * Math.sin(a + side * 0.004), z = r * Math.cos(a + side * 0.004);
        parts.push(place(boxGeo(3, hgt, 2.4, 8, 8, white), x, hgt / 2, z, a));
      }
    }
    const merged = mergeGeometries(parts);
    const m2 = new THREE.Mesh(merged, mat);
    m2.castShadow = m2.receiveShadow = true;
    this.scene.add(m2);
    // spawn points just inside the breach
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.03;
      this.titanSpawns.push(new THREE.Vector3((R - 25) * Math.sin(a), 0, (R - 25) * Math.cos(a)));
    }
  }

  buildTown() {
    const t = this.textures;
    const _townWalls = [], _townRoofs = [], _townTrim = [], _townStones = [];
    const walls = _townWalls, roofs = _townRoofs, trim = _townTrim, stones = _townStones;
    const rr = this.rng;
    const avenues = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, (5 * Math.PI) / 4, (3 * Math.PI) / 2, (7 * Math.PI) / 4];
    const wood = new THREE.Color('#4a3424');
    const stoneC = new THREE.Color('#cfc8bb');
    const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

    const addBuilding = (x, z, yaw, w, d, h, opts = {}) => {
      const plaster = opts.plaster || PLASTER[Math.floor(rr() * PLASTER.length)];
      const roofC = opts.roofC || ROOFC[Math.floor(rr() * ROOFC.length)];
      const own = opts.destructible === false ? null : { x, z, yaw, w, d, h, cols: [], lists: { walls: [], roofs: [], trim: [], stones: [] }, dead: false };
      const walls = own ? own.lists.walls : _townWalls, roofs = own ? own.lists.roofs : _townRoofs, trim = own ? own.lists.trim : _townTrim, stones = own ? own.lists.stones : _townStones;
      const addCol = (cc) => { const col = this.col.add(cc); if (own) own.cols.push(col); return col; };
      // stone foundation
      stones.push(place(boxGeo(w + 0.3, 1.2, d + 0.3, 8, 8, stoneC), x, 0.6, z, yaw));
      walls.push(place(boxGeo(w, h - 1.2, d, 8, 6.4, plaster), x, 1.2 + (h - 1.2) / 2, z, yaw));
      // corner posts & eave beam
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const toW = (lx, lz) => [x + c * lx + s * lz, z - s * lx + c * lz];
      for (const [lx, lz] of [[w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]]) {
        const [px, pz] = toW(lx, lz);
        trim.push(place(boxGeo(0.45, h - 1.2, 0.45, 1, 1, wood), px, 1.2 + (h - 1.2) / 2, pz, yaw));
      }
      trim.push(place(boxGeo(w + 0.5, 0.35, d + 0.5, 1, 1, wood), x, h - 0.1, z, yaw));
      const bodyR = Math.hypot(w, h, d) / 2;
      addCol(new Convex(new THREE.Vector3(x, h / 2, z), yaw, boxPlanes(w / 2, h / 2, d / 2), bodyR, { surface: 'wood' }));
      let top = h;
      if (opts.flat) {
        // parapet
        for (const [lx, lz, pw, pd] of [[0, d / 2 - 0.3, w, 0.6], [0, -d / 2 + 0.3, w, 0.6], [w / 2 - 0.3, 0, 0.6, d], [-w / 2 + 0.3, 0, 0.6, d]]) {
          const [px, pz] = toW(lx, lz);
          stones.push(place(boxGeo(pw, 1.1, pd, 8, 8, stoneC), px, h + 0.55, pz, yaw));
        }
        roofs.push(place(boxGeo(w - 0.2, 0.2, d - 0.2, 4, 4, new THREE.Color('#8a7d6a')), x, h + 0.05, z, yaw));
        top = h + 0.2;
        addCol(new Convex(new THREE.Vector3(x, h + 0.1, z), yaw, boxPlanes(w / 2, 0.1, d / 2), Math.hypot(w, d) / 2, { surface: 'stone' }));
        // rooftop clutter (chimney stack + hatch) so flat roofs aren't bare slabs; skipped on the HQ landing roof
        if (!opts.plaster) {
          // position hash instead of rr() so the city layout RNG sequence is unchanged
          const hr = (k) => { const v = Math.sin(x * 12.9898 + z * 78.233 + k) * 43758.5453; return v - Math.floor(v); };
          const cx = (hr(1) - 0.5) * (w - 3), cz = (hr(2) - 0.5) * (d - 3);
          const [px, pz] = toW(cx, cz);
          stones.push(place(boxGeo(1.2, 2.4, 1.2, 2, 4, stoneC), px, h + 1.4, pz, yaw));
          addCol(new Convex(new THREE.Vector3(px, h + 1.4, pz), yaw, boxPlanes(0.6, 1.2, 0.6), 1.5, { surface: 'stone' }));
          const [qx, qz] = toW(-cx * 0.8, -cz * 0.8);
          roofs.push(place(boxGeo(1.8, 0.5, 1.8, 2, 2, new THREE.Color('#5a4a3a')), qx, h + 0.45, qz, yaw));
        }
      } else {
        const rh = opts.rh ?? d * (0.32 + rr() * 0.18);
        roofs.push(place(roofGeo(w, rh, d, 0.6, roofC), x, h, z, yaw));
        walls.push(place(gableGeo(w, rh, d, plaster), x, h, z, yaw));
        addCol(new Convex(new THREE.Vector3(x, h, z), yaw, prismPlanes(w / 2 + 0.3, rh, d / 2 + 0.3), Math.hypot(w, rh, d) / 2 + 1, { surface: 'roof' }));
        top = h + rh;
        // chimney
        if (rr() < 0.6) {
          const [px, pz] = toW((rr() - 0.5) * w * 0.6, (rr() - 0.5) * d * 0.3);
          stones.push(place(boxGeo(1.0, rh + 1.6, 1.0, 8, 8, stoneC), px, h + (rh + 1.6) / 2, pz, yaw));
        }
      }
      const ob = { x, z, r: Math.max(w, d) * 0.55, h: top, house: own };
      this.obstacles.push(ob);
      if (own) {
        own.ob = ob; own.top = top;
        let sec = this.houseSections[this.houseSections.length - 1];
        if (!sec || sec.houses.length >= 8) { sec = { houses: [], meshes: [] }; this.houseSections.push(sec); }
        own.sec = sec; sec.houses.push(own);
        this.houses.push(own);
      }
      return top;
    };

    // central bell tower
    {
      const s = 10, h = 42;
      stones.push(place(boxGeo(s, h, s, 8, 8, stoneC), 0, h / 2, 0, 0));
      stones.push(place(boxGeo(s + 1.4, 1.2, s + 1.4, 8, 8, stoneC), 0, h + 0.6, 0, 0));
      for (const [ox, oz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) stones.push(place(boxGeo(1.4, 7, 1.4, 8, 8, stoneC), (ox * s) / 2, h + 4.7, (oz * s) / 2, 0));
      stones.push(place(boxGeo(s, 1, s, 8, 8, stoneC), 0, h + 8.6, 0, 0));
      roofs.push(place(pyramidGeo(s / 2 + 0.6, 20, new THREE.Color('#4f5a66')), 0, h + 9, 0, 0));
      this.col.add(new Convex(new THREE.Vector3(0, h / 2, 0), 0, boxPlanes(s / 2, h / 2, s / 2), h, { surface: 'stone' }));
      this.col.add(new Convex(new THREE.Vector3(0, h + 4.6, 0), 0, boxPlanes(s / 2 + 0.7, 4.6, s / 2 + 0.7), 10, { surface: 'stone' }));
      this.col.add(new Convex(new THREE.Vector3(0, h + 9, 0), 0, pyramidPlanes(s / 2 + 0.6, 20), 24, { surface: 'roof' }));
      this.obstacles.push({ x: 0, z: 0, r: 7, h: h + 29 });
      // clock faces (emissive)
      this.clockFaces = [];
      const clockMat = new THREE.MeshStandardMaterial({ color: '#efe4c8', emissive: '#ffcf8a', emissiveIntensity: 0.25, roughness: 0.6 });
      for (let i = 0; i < 4; i++) {
        const disc = new THREE.Mesh(new THREE.CircleGeometry(2.6, 32), clockMat);
        const a = (i * Math.PI) / 2;
        disc.position.set(Math.sin(a) * (s / 2 + 0.05), h - 6, Math.cos(a) * (s / 2 + 0.05));
        disc.rotation.y = a;
        this.scene.add(disc);
        const hand = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.2, 0.1), new THREE.MeshStandardMaterial({ color: '#222' }));
        hand.position.copy(disc.position).add(new THREE.Vector3(Math.sin(a) * 0.08, 0.9, Math.cos(a) * 0.08));
        hand.rotation.y = a;
        this.scene.add(hand);
      }
    }
    // plaza fountain
    {
      stones.push(place(colorize(new THREE.CylinderGeometry(7, 7.5, 1.2, 32), stoneC), 0, 0.6, 22, 0));
    }

    // Survey HQ: start point and supply depot on the roof (towards -z)
    {
      const x = 0, z = -54, w = 26, d = 18, h = 20;
      addBuilding(x, z, Math.PI, w, d, h, { flat: true, plaster: new THREE.Color('#d9cfbc'), destructible: false });
      this.playerSpawn = new THREE.Vector3(x + 5, h + 1.4, z + 4);
      this.addDepot(new THREE.Vector3(x - 8, h + 0.2, z - 3), 'HQ');
    }

    const ringRadii = [50, 74, 98, 122, 146, 170, 194];
    ringRadii.forEach((r, ri) => {
      let a = rr() * 0.2;
      const end = a + Math.PI * 2 - 0.02;
      while (a < end) {
        const w = 8 + rr() * 7;
        const gap = rr() < 0.25 ? 2 + rr() * 3 : 0.2;
        const span = w / r;
        const mid = a + span / 2;
        let blocked = false;
        for (const av of avenues) if (angDiff(mid, av) < (span / 2 + 7 / r)) blocked = true;
        if (ri === 0 && angDiff(mid, Math.PI) < 0.42) blocked = true; // HQ
        if (!blocked) {
          const d = 11 + rr() * 5;
          const floors = Math.max(2, Math.round(5.6 - ri * 0.55 + (rr() - 0.4) * 3));
          const h = 1.2 + floors * 3.2;
          const x = r * Math.sin(mid), z = r * Math.cos(mid);
          if (rr() < 0.05 && ri > 1) {
            // watch tower
            const s = 7, th = 30 + rr() * 12;
            stones.push(place(boxGeo(s, th, s, 8, 8, stoneC), x, th / 2, z, mid));
            roofs.push(place(pyramidGeo(s / 2 + 0.8, 8, ROOFC[3]), x, th, z, mid));
            this.col.add(new Convex(new THREE.Vector3(x, th / 2, z), mid, boxPlanes(s / 2, th / 2, s / 2), th, { surface: 'stone' }));
            this.col.add(new Convex(new THREE.Vector3(x, th, z), mid, pyramidPlanes(s / 2 + 0.8, 8), 10, { surface: 'roof' }));
            this.obstacles.push({ x, z, r: 5, h: th + 8 });
          } else {
            addBuilding(x, z, mid, w, d, h, { flat: rr() < 0.12 });
          }
        }
        a += span + gap / r;
      }
    });

    // church with tall spire on the east avenue
    {
      const a = Math.PI / 2 + 0.2, r = 86;
      const x = r * Math.sin(a), z = r * Math.cos(a);
      addBuilding(x, z, a + Math.PI / 2, 12, 30, 16, { plaster: new THREE.Color('#e9e4d8'), roofC: ROOFC[3], rh: 8, destructible: false });
      const tx = x + Math.sin(a) * 0, tz = z;
      const s = 8, th = 46;
      const ox = tx - Math.cos(a) * 0 - Math.sin(a) * 19, oz = tz - Math.cos(a) * 19;
      stones.push(place(boxGeo(s, th, s, 8, 8, stoneC), ox, th / 2, oz, a));
      roofs.push(place(pyramidGeo(s / 2 + 0.5, 22, ROOFC[3]), ox, th, oz, a));
      this.col.add(new Convex(new THREE.Vector3(ox, th / 2, oz), a, boxPlanes(s / 2, th / 2, s / 2), th, { surface: 'stone' }));
      this.col.add(new Convex(new THREE.Vector3(ox, th, oz), a, pyramidPlanes(s / 2 + 0.5, 22), 24, { surface: 'roof' }));
      this.obstacles.push({ x: ox, z: oz, r: 6, h: th + 22 });
    }

    // second depot on a watch post at the west
    {
      const a = -Math.PI / 2 + 0.12, r = 112;
      const x = r * Math.sin(a), z = r * Math.cos(a);
      const s = 12, th = 26;
      stones.push(place(boxGeo(s, th, s, 8, 8, stoneC), x, th / 2, z, a));
      this.col.add(new Convex(new THREE.Vector3(x, th / 2, z), a, boxPlanes(s / 2, th / 2, s / 2), th, { surface: 'stone' }));
      this.obstacles.push({ x, z, r: 8, h: th });
      this.addDepot(new THREE.Vector3(x, th, z), 'WEST');
    }

    const facadeMat = new THREE.MeshStandardMaterial({
      map: t.facade.map, normalMap: t.facade.normalMap, emissiveMap: t.facade.emissiveMap,
      emissive: new THREE.Color('#ffb066'), emissiveIntensity: 0.35, vertexColors: true, roughness: 0.88,
    });
    facadeMat.normalScale.set(0.8, 0.8);
    const roofMat = new THREE.MeshStandardMaterial({ map: t.roof.map, normalMap: t.roof.normalMap, vertexColors: true, roughness: 0.75 });
    const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const stoneMat = this.wallMaterial();
    stoneMat.vertexColors = true;
    this.townMats = { walls: facadeMat, roofs: roofMat, trim: trimMat, stones: stoneMat };
    for (const [list, mat] of [[walls, facadeMat], [roofs, roofMat], [trim, trimMat], [stones, stoneMat]]) {
      const g = mergeGeometries(list);
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
    for (const sec of this.houseSections) this.buildHouseSection(sec);

    this.buildProps();
  }

  buildProps() {
    // barrels, crates and market stalls scattered on the streets (instanced)
    const rr = this.rng;
    const crateG = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    const barrelG = new THREE.CylinderGeometry(0.5, 0.55, 1.2, 12);
    const crateM = new THREE.MeshStandardMaterial({ color: '#8a6a44', roughness: 0.9 });
    const barrelM = new THREE.MeshStandardMaterial({ color: '#6a4a30', roughness: 0.8 });
    const N = 260;
    const crates = new THREE.InstancedMesh(crateG, crateM, N);
    const barrels = new THREE.InstancedMesh(barrelG, barrelM, N);
    const m = new THREE.Matrix4();
    let ci = 0, bi = 0;
    for (let i = 0; i < N * 2; i++) {
      const r = 40 + rr() * 165;
      const a = rr() * Math.PI * 2;
      const x = r * Math.sin(a), z = r * Math.cos(a);
      let ok = true;
      for (const o of this.obstacles) if ((o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + 1) ** 2) { ok = false; break; }
      if (!ok) continue;
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rr() * 6);
      if (rr() < 0.5 && ci < N) { m.compose(_p.set(x, 0.6, z), _q, _s.set(1, 1, 1)); crates.setMatrixAt(ci++, m); }
      else if (bi < N) { m.compose(_p.set(x, 0.6, z), _q, _s.set(1, 1, 1)); barrels.setMatrixAt(bi++, m); }
    }
    crates.count = ci; barrels.count = bi;
    crates.castShadow = barrels.castShadow = true;
    crates.receiveShadow = barrels.receiveShadow = true;
    this.scene.add(crates, barrels);

    // lamp posts around the plaza
    const postM = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.6, metalness: 0.4 });
    const lampM = new THREE.MeshStandardMaterial({ color: '#ffcc88', emissive: '#ffaa55', emissiveIntensity: 2.5 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.13;
      const x = 32 * Math.sin(a), z = 32 * Math.cos(a);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 4.5, 8), postM);
      post.position.set(x, 2.25, z);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), lampM);
      lamp.position.set(x, 4.6, z);
      post.castShadow = true;
      this.scene.add(post, lamp);
    }
  }

  addDepot(pos, name) {
    const g = new THREE.Group();
    g.position.copy(pos);
    const crateM = new THREE.MeshStandardMaterial({ color: '#6f5235', roughness: 0.85 });
    const tankM = new THREE.MeshStandardMaterial({ color: '#8d969c', roughness: 0.35, metalness: 0.8 });
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.0), crateM);
      c.position.set((i % 3) * 1.5 - 1.5, 0.55 + Math.floor(i / 3) * 1.1, Math.floor(i / 3) * 0.2);
      c.castShadow = true;
      g.add(c);
    }
    for (let i = 0; i < 6; i++) {
      const tnk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.3, 12), tankM);
      tnk.position.set(-1.8 + i * 0.5, 0.65, 1.3);
      tnk.castShadow = true;
      g.add(tnk);
    }
    // flag pole with cloth flag
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 9, 8), tankM);
    pole.position.set(2.5, 4.5, -0.5);
    g.add(pole);
    const flagGeo = new THREE.PlaneGeometry(3.2, 2.0, 16, 8);
    flagGeo.translate(1.6, 0, 0);
    const flagMat = new THREE.MeshStandardMaterial({ map: TX.capeTexture(), side: THREE.DoubleSide, roughness: 0.9 });
    const tu = this.uniformsTime;
    flagMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = tu;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float k = position.x / 3.2;
          transformed.z += sin(position.x * 2.2 - uTime * 6.0) * 0.28 * k + sin(position.y*3.0 - uTime*4.0)*0.06*k;
          transformed.y += sin(position.x * 1.3 - uTime * 3.0) * 0.08 * k;`);
    };
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(2.5, 7.8, -0.5);
    flag.castShadow = true;
    g.add(flag);
    // beacon column
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: tu },
      vertexShader: 'varying vec2 vUv; varying float vD; void main(){ vUv=uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vD = -mv.z; gl_Position = projectionMatrix*mv;}',
      fragmentShader: 'varying vec2 vUv; varying float vD; uniform float uTime; void main(){ float a = pow(1.0-vUv.y, 2.0) * (0.3 + 0.1*sin(uTime*3.0 + vUv.y*20.0)) * smoothstep(3.0, 25.0, vD); gl_FragColor = vec4(vec3(0.35,1.0,0.6)*a, a);}',
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.8, 60, 24, 1, true), beamMat);
    beam.position.set(0, 30, 0);
    g.add(beam);
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.2, 4.6, 48), new THREE.MeshBasicMaterial({ color: '#7dffb0', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    g.add(ring);
    this.scene.add(g);
    this.depots.push({ pos: pos.clone(), name, radius: 6, group: g, ring });
  }

  // rebuild a destructible-house section's merged meshes, skipping dead houses
  buildHouseSection(sec) {
    for (const m of sec.meshes) { this.scene.remove(m); m.geometry.dispose(); }
    sec.meshes.length = 0;
    for (const key of ['walls', 'roofs', 'trim', 'stones']) {
      const list = [];
      for (const h of sec.houses) if (!h.dead) list.push(...h.lists[key]);
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(list), this.townMats[key]);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
      sec.meshes.push(mesh);
    }
  }

  destroyHouse(h) {
    if (!h || h.dead) return false;
    h.dead = true;
    if (h.ob) h.ob.dead = true;
    for (const c of h.cols) this.col.remove(c);
    this.col.build();
    this.buildHouseSection(h.sec);
    // rubble: collapsed mound + fallen beams where the house stood
    const list = [];
    const moundC = new THREE.Color('#7a6a55'), wood = new THREE.Color('#4a3424');
    const rub = new THREE.SphereGeometry(1, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2);
    rub.scale(h.w * 0.52, Math.min(h.h * 0.32, 4.5), h.d * 0.52);
    list.push(place(colorize(rub, moundC), h.x, 0.1, h.z, h.yaw));
    const rr = Math.random;
    for (let i = 0; i < 7; i++) {
      const bw = 0.4 + rr() * 0.9, bl = 2 + rr() * Math.min(h.w, h.d) * 0.4;
      list.push(place(boxGeo(bw, bl, bw, 1, 1, i % 3 ? wood : moundC),
        h.x + (rr() - 0.5) * h.w * 0.8, 0.5 + rr() * 1.4, h.z + (rr() - 0.5) * h.d * 0.8,
        rr() * 6, rr() * 0.9 - 0.45, rr() * 0.9 - 0.45));
    }
    const mesh = new THREE.Mesh(mergeGeometries(list), this.townMats.trim);
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    (this.rubble ||= []).push(mesh);
    return true;
  }

  destroyNear(p, r) {
    let n = 0;
    for (const h of this.houses) {
      if (h.dead) continue;
      const dx = p.x - h.x, dz = p.z - h.z;
      const rr = Math.hypot(h.w, h.d) / 2 + r;
      if (dx * dx + dz * dz > rr * rr) continue;
      if (p.y > h.top + 6) continue;
      if (this.destroyHouse(h)) n++;
    }
    if (n) this.col.build();
    return n;
  }

  buildForest() {
    const rr = this.rng;
    const t = this.textures;
    const trunks = [], canopies = [];
    const brown = new THREE.Color('#ffffff');
    const leafC = [new THREE.Color('#3d5a2a'), new THREE.Color('#4b6a30'), new THREE.Color('#36522a'), new THREE.Color('#56723a')];
    let placed = 0;
    for (let tries = 0; tries < 2000 && placed < 70; tries++) {
      const a = Math.PI + (rr() - 0.5) * 2.3;
      const r = TOWN_R + 26 + rr() * (WALL_R - TOWN_R - 50);
      const x = r * Math.sin(a), z = r * Math.cos(a);
      let ok = true;
      for (const o of this.obstacles) if ((o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + 22) ** 2) { ok = false; break; }
      if (!ok) continue;
      placed++;
      const h = 72 + rr() * 30;
      const rad = 2.8 + rr() * 2.4;
      const tg = new THREE.CylinderGeometry(rad * 0.55, rad, h, 18, 10);
      // gnarled trunk
      const p = tg.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const ang = Math.atan2(p.getX(i), p.getZ(i));
        const k = 1 + Math.sin(ang * 5 + y * 0.12) * 0.06 + Math.sin(ang * 3 - y * 0.05) * 0.05;
        p.setX(i, p.getX(i) * k + Math.sin(y * 0.04 + x) * 0.8);
        p.setZ(i, p.getZ(i) * k + Math.cos(y * 0.035 + z) * 0.8);
      }
      const uv = tg.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * h / 10);
      tg.computeVertexNormals();
      trunks.push(place(colorize(tg, brown), x, h / 2, z, rr() * 6));
      // root flare
      for (let k = 0; k < 5; k++) {
        const ra = (k / 5) * Math.PI * 2 + rr();
        const rg = new THREE.CylinderGeometry(0.4, rad * 0.55, 10, 8);
        rg.translate(0, 5, 0);
        place(rg, x + Math.sin(ra) * rad * 0.6, 0, z + Math.cos(ra) * rad * 0.6, ra, 0, 0);
        rg.applyMatrix4(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(Math.cos(ra), 0, -Math.sin(ra)), 0));
        trunks.push(colorize(rg, brown));
      }
      this.col.add(new VCylinder(x, z, rad * 0.85, 0, h, { surface: 'wood' }));
      this.obstacles.push({ x, z, r: rad + 1, h });
      // branches
      const nb = 4 + Math.floor(rr() * 4);
      for (let b = 0; b < nb; b++) {
        const by = h * (0.38 + rr() * 0.42);
        const ba = rr() * Math.PI * 2;
        const len = 12 + rr() * 10;
        const up = 0.25 + rr() * 0.4;
        const dir = new THREE.Vector3(Math.sin(ba) * Math.cos(up), Math.sin(up), Math.cos(ba) * Math.cos(up));
        const br = 0.6 + rr() * 0.5;
        const bg = new THREE.CylinderGeometry(br * 0.4, br, len, 8, 1);
        bg.translate(0, len / 2, 0);
        _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        _m.compose(_p.set(x, by, z), _q, _s.set(1, 1, 1));
        bg.applyMatrix4(_m);
        trunks.push(colorize(bg, brown));
        const a3 = new THREE.Vector3(x, by, z).addScaledVector(dir, rad * 0.8);
        const b3 = new THREE.Vector3(x, by, z).addScaledVector(dir, len);
        this.col.add(new Capsule(a3, b3, br * 0.85, { surface: 'wood' }));
        // foliage at branch tip
        const cg = new THREE.IcosahedronGeometry(6 + rr() * 4, 2);
        cg.scale(1.2, 0.7, 1.2);
        canopies.push(place(colorize(cg, leafC[Math.floor(rr() * 4)]), b3.x, b3.y + 2, b3.z, rr() * 6));
      }
      for (let k = 0; k < 6; k++) {
        const cg = new THREE.IcosahedronGeometry(9 + rr() * 6, 2);
        cg.scale(1.3, 0.75, 1.3);
        const ca = rr() * Math.PI * 2, cr = rr() * 9;
        canopies.push(place(colorize(cg, leafC[Math.floor(rr() * 4)]), x + Math.sin(ca) * cr, h - 4 + rr() * 10, z + Math.cos(ca) * cr, rr() * 6));
      }
    }
    const barkMat = new THREE.MeshStandardMaterial({ map: t.bark.map, normalMap: t.bark.normalMap, roughness: 0.95, vertexColors: true, color: '#c7b8a6' });
    barkMat.normalScale.set(0.5, 0.5);
    this.canopyMat = this.leafMaterial();
    // merge per 90 m cell instead of one forest-wide mesh so camera and shadow frustum culling can skip far trees
    const chunked = (geos, mat) => {
      const cells = new Map();
      for (const g of geos) {
        g.computeBoundingSphere();
        const c = g.boundingSphere.center, key = Math.floor(c.x / 90) + ':' + Math.floor(c.z / 90);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(g);
      }
      for (const list of cells.values()) {
        const m = new THREE.Mesh(mergeGeometries(list), mat);
        m.castShadow = m.receiveShadow = true;
        this.scene.add(m);
      }
    };
    chunked(trunks, barkMat);
    chunked(canopies, this.canopyMat);
  }

  leafMaterial() {
    const t = this.textures.leaf;
    const mat = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, vertexColors: true, roughness: 0.85 });
    mat.normalScale.set(1.5, 1.5);
    const tu = this.uniformsTime;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = tu;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 wp0 = modelMatrix * vec4(position,1.0);
          float sw = sin(uTime*1.3 + wp0.x*0.05 + wp0.z*0.04) * 0.5 + sin(uTime*2.7 + wp0.y*0.3)*0.2;
          transformed.x += sw * 0.6; transformed.z += sw * 0.4;
          transformed += normal * (sin(wp0.x*0.9)*sin(wp0.y*1.1)*sin(wp0.z*0.8)) * 1.2;`);
      // fake light transmission so canopies don't read as black blobs
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * vec3(0.32, 0.4, 0.18);`);
    };
    return mat;
  }

  buildCountryside() {
    const rr = this.rng;
    const t = this.textures;
    const walls = [], roofs = [], hay = [], trunks = [], canopies = [];
    const white = new THREE.Color('#ffffff');
    const hayC = new THREE.Color('#c9a95a');
    const leafC = new THREE.Color('#4a6a2e');
    let n = 0;
    for (let tries = 0; tries < 900 && n < 60; tries++) {
      const a = (rr() - 0.5) * 3.6; // front half (towards breach)
      const r = TOWN_R + 20 + rr() * (WALL_R - TOWN_R - 40);
      const x = r * Math.sin(a), z = r * Math.cos(a);
      if (Math.abs(a) < 0.12) continue; // road to breach
      let ok = true;
      for (const o of this.obstacles) if ((o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + 16) ** 2) { ok = false; break; }
      if (!ok) continue;
      n++;
      const k = rr();
      if (k < 0.35) {
        const w = 9 + rr() * 5, d = 8 + rr() * 3, h = 5 + rr() * 3;
        const yaw = rr() * Math.PI;
        walls.push(place(boxGeo(w, h, d, 8, 6.4, PLASTER[Math.floor(rr() * PLASTER.length)]), x, h / 2, z, yaw));
        const rh = d * 0.5;
        roofs.push(place(roofGeo(w, rh, d, 0.6, ROOFC[Math.floor(rr() * ROOFC.length)]), x, h, z, yaw));
        walls.push(place(gableGeo(w, rh, d, PLASTER[0]), x, h, z, yaw));
        this.col.add(new Convex(new THREE.Vector3(x, h / 2, z), yaw, boxPlanes(w / 2, h / 2, d / 2), Math.hypot(w, h, d) / 2, { surface: 'wood' }));
        this.col.add(new Convex(new THREE.Vector3(x, h, z), yaw, prismPlanes(w / 2 + 0.3, rh, d / 2 + 0.3), Math.hypot(w, rh, d) / 2 + 1, { surface: 'roof' }));
        this.obstacles.push({ x, z, r: w * 0.55, h: h + rh });
      } else if (k < 0.65) {
        for (let j = 0; j < 4; j++) {
          const hg = new THREE.ConeGeometry(1.8, 3.2, 10);
          hg.translate(0, 1.6, 0);
          hay.push(place(colorize(hg, hayC), x + (rr() - 0.5) * 12, 0, z + (rr() - 0.5) * 12, rr() * 6));
        }
      } else {
        const h = 9 + rr() * 6;
        const tg = new THREE.CylinderGeometry(0.4, 0.7, h, 8);
        tg.translate(0, h / 2, 0);
        const uv = tg.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * h / 8);
        trunks.push(place(colorize(tg, white), x, 0, z, 0));
        const cg = new THREE.IcosahedronGeometry(4 + rr() * 2, 2);
        canopies.push(place(colorize(cg, leafC), x, h + 1, z, rr() * 6));
        this.col.add(new VCylinder(x, z, 0.6, 0, h, { surface: 'wood' }));
      }
    }
    // windmill
    {
      const a = 0.9, r = 290;
      const x = r * Math.sin(a), z = r * Math.cos(a);
      const tg = new THREE.CylinderGeometry(4, 6, 22, 12);
      tg.translate(0, 11, 0);
      walls.push(place(colorize(tg, PLASTER[2]), x, 0, z, 0));
      const rg = new THREE.ConeGeometry(4.8, 6, 12);
      rg.translate(0, 25, 0);
      roofs.push(place(colorize(rg, ROOFC[4]), x, 0, z, 0));
      this.col.add(new VCylinder(x, z, 5, 0, 22, { surface: 'stone' }));
      this.obstacles.push({ x, z, r: 7, h: 28 });
      const blades = new THREE.Group();
      const bm = new THREE.MeshStandardMaterial({ color: '#7a6248', roughness: 0.9 });
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 14, 0.3), bm);
        b.position.y = 7.5;
        const holder = new THREE.Group();
        holder.rotation.z = (i * Math.PI) / 2;
        holder.add(b);
        blades.add(holder);
      }
      blades.position.set(x - Math.sin(a) * 5.2, 21, z - Math.cos(a) * 5.2);
      blades.rotation.y = a;
      this.scene.add(blades);
      this.windmill = blades;
    }
    const facadeMat = new THREE.MeshStandardMaterial({ map: t.facade.map, normalMap: t.facade.normalMap, vertexColors: true, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ map: t.roof.map, normalMap: t.roof.normalMap, vertexColors: true, roughness: 0.75 });
    const hayMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: t.grass.map });
    const barkMat = new THREE.MeshStandardMaterial({ map: t.bark.map, normalMap: t.bark.normalMap, vertexColors: true, roughness: 0.95 });
    for (const [list, mat] of [[walls, facadeMat], [roofs, roofMat], [hay, hayMat], [trunks, barkMat], [canopies, this.canopyMat]]) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(list), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
    // outer spawn ring for titans (inside wall, outside town)
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = TOWN_R + 40 + (i % 3) * 30;
      this.titanSpawns.push(new THREE.Vector3(r * Math.sin(a), 0, r * Math.cos(a)));
    }
  }

  buildMountains() {
    const rr = this.rng;
    const parts = [];
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2 + rr() * 0.05;
      const r = 1900 + rr() * 1400;
      const h = 260 + rr() * 520;
      const g = new THREE.ConeGeometry(h * (1.3 + rr()), h, 7 + Math.floor(rr() * 4), 3);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const y = p.getY(k);
        if (y < h / 2 - 1) { p.setX(k, p.getX(k) * (0.85 + rr() * 0.3)); p.setZ(k, p.getZ(k) * (0.85 + rr() * 0.3)); p.setY(k, y + (rr() - 0.5) * h * 0.08); }
      }
      g.computeVertexNormals();
      g.translate(0, h / 2 - 20, 0);
      const cols = new Float32Array(p.count * 3);
      for (let k = 0; k < p.count; k++) {
        const y = p.getY(k) / h;
        const snow = y > 0.78 ? 1 : 0;
        const base = new THREE.Color('#6f7785').lerp(new THREE.Color('#e8ecf2'), snow);
        cols[k * 3] = base.r; cols[k * 3 + 1] = base.g; cols[k * 3 + 2] = base.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      g.deleteAttribute('uv');
      parts.push(place(g, r * Math.sin(a), 0, r * Math.cos(a), rr() * 6));
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, fog: false, flatShading: true });
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.78, 0.74, 0.70), 0.55);`);
    };
    const mesh = new THREE.Mesh(mergeGeometries(parts), mat);
    this.scene.add(mesh);
  }

  buildClouds() {
    const tex = [TX.cloudSprite(1), TX.cloudSprite(2), TX.cloudSprite(3)];
    const rr = this.rng;
    this.clouds = [];
    for (let i = 0; i < 34; i++) {
      const m = new THREE.SpriteMaterial({ map: tex[i % 3], color: new THREE.Color('#ffe2c4'), transparent: true, opacity: 0.85, fog: false, depthWrite: false });
      const s = new THREE.Sprite(m);
      const a = rr() * Math.PI * 2, r = 900 + rr() * 2600;
      s.position.set(r * Math.sin(a), 380 + rr() * 520, r * Math.cos(a));
      const sc = 500 + rr() * 900;
      s.scale.set(sc * 2.2, sc * 0.8, 1);
      this.scene.add(s);
      this.clouds.push(s);
    }
  }

  nearestDepot(p) {
    let best = null, bd = Infinity;
    for (const d of this.depots) {
      const dd = d.pos.distanceTo(p);
      if (dd < bd) { bd = dd; best = d; }
    }
    return { depot: best, dist: bd };
  }

  update(dt) {
    this.time += dt;
    this.uniformsTime.value = this.time;
    if (this.windmill) this.windmill.rotation.z += dt * 0.4;
    for (const d of this.depots) {
      d.ring.scale.setScalar(1 + Math.sin(this.time * 3) * 0.05);
    }
    for (const c of this.clouds) c.position.x += dt * 2;
  }
}
