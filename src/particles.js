import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec3 iOffset;
attribute vec4 iColor;
attribute vec3 iSizeRot; // size, rotation, stretch
attribute vec3 iVel;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
varying float vShade;
uniform float uFogDensity;
void main(){
  vUv = uv;
  vColor = iColor;
  vec4 mv = viewMatrix * vec4(iOffset, 1.0);
  float c = cos(iSizeRot.y), s = sin(iSizeRot.y);
  vec2 corner = position.xy;
  vec2 rc = vec2(c*corner.x - s*corner.y, s*corner.x + c*corner.y) * iSizeRot.x;
  if (iSizeRot.z > 0.0) {
    // velocity-stretched streak in view space
    vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
    vec2 dir = length(vv.xy) > 1e-4 ? normalize(vv.xy) : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    rc = dir * corner.x * iSizeRot.x * (1.0 + iSizeRot.z * length(vv.xy)) + perp * corner.y * iSizeRot.x * 0.35;
  }
  mv.xy += rc;
  vShade = 0.72 + 0.56 * (corner.y + 0.5) * 0.5 + 0.1;
  gl_Position = projectionMatrix * mv;
  float d = length(mv.xyz);
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uFogColor;
uniform float uLit;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
varying float vShade;
void main(){
  vec4 t = texture2D(uTex, vUv);
  vec3 col = vColor.rgb * t.rgb * mix(1.0, vShade, uLit);
  float a = t.a * vColor.a;
  if (uLit > 0.5) col = mix(col, uFogColor, vFog);
  else a *= (1.0 - vFog);
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
}`;

export class Particles {
  constructor(scene, { max = 3000, texture, additive = false, lit = true, fog }) {
    this.max = max;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aOffset = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iOffset', this.aOffset);
    geo.setAttribute('iColor', this.aColor);
    geo.setAttribute('iSizeRot', this.aSize);
    geo.setAttribute('iVel', this.aVel);
    geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTex: { value: texture },
        uFogColor: { value: fog ? fog.color : new THREE.Color(0xcccccc) },
        uFogDensity: { value: fog ? fog.density : 0 },
        uLit: { value: lit ? 1 : 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 11 : 10;
    scene.add(this.mesh);
    this.geo = geo;
    // simulation state (SoA)
    this.n = 0;
    this.px = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.rotV = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.a0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.buoy = new Float32Array(max);
    this.stretch = new Float32Array(max);
    this.fadeIn = new Float32Array(max);
  }

  spawn(p, v, o = {}) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const i3 = i * 3;
    this.px[i3] = p.x; this.px[i3 + 1] = p.y; this.px[i3 + 2] = p.z;
    this.v[i3] = v ? v.x : 0; this.v[i3 + 1] = v ? v.y : 0; this.v[i3 + 2] = v ? v.z : 0;
    const life = o.life ?? 1;
    this.life[i] = 0; this.maxLife[i] = life;
    this.s0[i] = o.size0 ?? 1; this.s1[i] = o.size1 ?? this.s0[i];
    this.rot[i] = o.rot ?? Math.random() * Math.PI * 2;
    this.rotV[i] = o.rotV ?? (Math.random() - 0.5) * 1.5;
    const c0 = o.color || WHITE, c1 = o.colorEnd || c0;
    this.c0[i3] = c0.r; this.c0[i3 + 1] = c0.g; this.c0[i3 + 2] = c0.b;
    this.c1[i3] = c1.r; this.c1[i3 + 1] = c1.g; this.c1[i3 + 2] = c1.b;
    this.a0[i] = o.alpha ?? 1;
    this.drag[i] = o.drag ?? 1;
    this.buoy[i] = o.buoy ?? 0;
    this.stretch[i] = o.stretch ?? 0;
    this.fadeIn[i] = o.fadeIn ?? 0.1;
  }

  _kill(i) {
    const j = --this.n;
    if (i === j) return;
    const i3 = i * 3, j3 = j * 3;
    for (let k = 0; k < 3; k++) {
      this.px[i3 + k] = this.px[j3 + k]; this.v[i3 + k] = this.v[j3 + k];
      this.c0[i3 + k] = this.c0[j3 + k]; this.c1[i3 + k] = this.c1[j3 + k];
    }
    this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j];
    this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
    this.rot[i] = this.rot[j]; this.rotV[i] = this.rotV[j];
    this.a0[i] = this.a0[j]; this.drag[i] = this.drag[j]; this.buoy[i] = this.buoy[j];
    this.stretch[i] = this.stretch[j]; this.fadeIn[i] = this.fadeIn[j];
  }

  update(dt, wind) {
    const O = this.aOffset.array, C = this.aColor.array, S = this.aSize.array, V = this.aVel.array;
    let i = 0;
    while (i < this.n) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) { this._kill(i); continue; }
      const i3 = i * 3;
      const k = Math.exp(-this.drag[i] * dt);
      this.v[i3] = this.v[i3] * k + (wind ? wind.x * (1 - k) : 0);
      this.v[i3 + 1] = this.v[i3 + 1] * k + this.buoy[i] * dt;
      this.v[i3 + 2] = this.v[i3 + 2] * k + (wind ? wind.z * (1 - k) : 0);
      this.px[i3] += this.v[i3] * dt;
      this.px[i3 + 1] += this.v[i3 + 1] * dt;
      this.px[i3 + 2] += this.v[i3 + 2] * dt;
      this.rot[i] += this.rotV[i] * dt;
      i++;
    }
    for (let j = 0; j < this.n; j++) {
      const j3 = j * 3, j4 = j * 4;
      const t = this.life[j] / this.maxLife[j];
      O[j3] = this.px[j3]; O[j3 + 1] = this.px[j3 + 1]; O[j3 + 2] = this.px[j3 + 2];
      V[j3] = this.v[j3]; V[j3 + 1] = this.v[j3 + 1]; V[j3 + 2] = this.v[j3 + 2];
      C[j4] = this.c0[j3] + (this.c1[j3] - this.c0[j3]) * t;
      C[j4 + 1] = this.c0[j3 + 1] + (this.c1[j3 + 1] - this.c0[j3 + 1]) * t;
      C[j4 + 2] = this.c0[j3 + 2] + (this.c1[j3 + 2] - this.c0[j3 + 2]) * t;
      const fi = this.fadeIn[j] > 0 ? Math.min(1, t / this.fadeIn[j]) : 1;
      C[j4 + 3] = this.a0[j] * fi * (1 - t) * (1 - t * 0.3);
      S[j3] = this.s0[j] + (this.s1[j] - this.s0[j]) * Math.sqrt(t);
      S[j3 + 1] = this.rot[j];
      S[j3 + 2] = this.stretch[j];
    }
    this.geo.instanceCount = this.n;
    this.aOffset.needsUpdate = this.aColor.needsUpdate = this.aSize.needsUpdate = this.aVel.needsUpdate = true;
    this.aOffset.clearUpdateRanges?.();
  }
}

const WHITE = new THREE.Color(1, 1, 1);

// Camera-facing strip with per-vertex alpha
const RVERT = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
varying vec2 vUv;
varying float vFog;
uniform float uFogDensity;
void main(){
  vAlpha = aAlpha; vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = length(mv.xyz);
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
}`;
const RFRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uOpacity;
uniform vec3 uFogColor;
uniform float uAdd;
varying float vAlpha;
varying vec2 vUv;
varying float vFog;
void main(){
  float edge = 1.0 - pow(abs(vUv.y * 2.0 - 1.0), 2.0);
  vec3 col = mix(uColor2, uColor, edge);
  float a = vAlpha * uOpacity * mix(1.0, edge, uAdd);
  if (uAdd < 0.5) col = mix(col, uFogColor, vFog); else a *= 1.0 - vFog;
  gl_FragColor = vec4(col, a);
}`;

export class Ribbon {
  constructor(scene, maxPts, { color = 0x222222, color2, opacity = 1, additive = false, fog } = {}) {
    this.maxPts = maxPts;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(maxPts * 2 * 3);
    this.alpha = new Float32Array(maxPts * 2);
    const uv = new Float32Array(maxPts * 2 * 2);
    for (let i = 0; i < maxPts; i++) {
      uv[i * 4] = i / (maxPts - 1); uv[i * 4 + 1] = 0;
      uv[i * 4 + 2] = i / (maxPts - 1); uv[i * 4 + 3] = 1;
    }
    const idx = [];
    for (let i = 0; i < maxPts - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: RVERT,
      fragmentShader: RFRAG,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uColor2: { value: new THREE.Color(color2 ?? color) },
        uOpacity: { value: opacity },
        uFogColor: { value: fog ? fog.color : new THREE.Color() },
        uFogDensity: { value: fog ? fog.density : 0 },
        uAdd: { value: additive ? 1 : 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    scene.add(this.mesh);
    this.geo = geo;
    this._t = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._v = new THREE.Vector3();
  }
  // pts: array of Vector3; width: number or fn(i, n); alpha: fn(i,n) or number
  set(pts, camPos, width, alpha = 1) {
    const n = Math.min(pts.length, this.maxPts);
    if (n < 2) { this.geo.setDrawRange(0, 0); return; }
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      this._t.subVectors(b, a);
      this._v.subVectors(camPos, p);
      this._s.crossVectors(this._t, this._v);
      const l = this._s.length();
      if (l > 1e-8) this._s.multiplyScalar(1 / l); else this._s.set(0, 1, 0);
      const w = (typeof width === 'function' ? width(i, n) : width) * 0.5;
      const al = typeof alpha === 'function' ? alpha(i, n) : alpha;
      const k = i * 6;
      this.pos[k] = p.x + this._s.x * w; this.pos[k + 1] = p.y + this._s.y * w; this.pos[k + 2] = p.z + this._s.z * w;
      this.pos[k + 3] = p.x - this._s.x * w; this.pos[k + 4] = p.y - this._s.y * w; this.pos[k + 5] = p.z - this._s.z * w;
      this.alpha[i * 2] = this.alpha[i * 2 + 1] = al;
    }
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
  }
  hide() { this.geo.setDrawRange(0, 0); }
}
