import * as THREE from 'three';

const VERT = `
attribute vec3 iOffset;
attribute vec4 iColor;
attribute vec3 iSizeRot;
attribute vec3 iVel;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
varying float vShade;
varying float vNear;
uniform float uFogDensity;
void main(){
  vUv = uv;
  vColor = iColor;
  vec4 mv = viewMatrix * vec4(iOffset, 1.0);
  float c = cos(iSizeRot.y), s = sin(iSizeRot.y);
  vec2 corner = position.xy;
  vec2 rc = vec2(c*corner.x - s*corner.y, s*corner.x + c*corner.y) * iSizeRot.x;
  if (iSizeRot.z > 0.0) {
    vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
    float vLen = length(vv.xy);
    vec2 dir = vLen > 1e-4 ? (vv.xy / vLen) : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    rc = dir * corner.x * iSizeRot.x * (1.0 + iSizeRot.z * vLen) + perp * corner.y * iSizeRot.x * 0.35;
  }
  mv.xy += rc;
  vShade = 0.72 + 0.56 * (corner.y + 0.5) * 0.5 + 0.1;
  gl_Position = projectionMatrix * mv;
  float d = length(mv.xyz);
  vNear = smoothstep(0.6, 3.8, -mv.z);
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
}`;

const FRAG = `
uniform sampler2D uTex;
uniform vec3 uFogColor;
uniform float uLit;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
varying float vShade;
varying float vNear;
void main(){
  vec4 t = texture2D(uTex, vUv);
  vec3 col = max(vec3(0.0), vColor.rgb * t.rgb * mix(1.0, vShade, uLit));
  float a = clamp(t.a * vColor.a * vNear, 0.0, 1.0);
  if (uLit > 0.5) col = mix(col, uFogColor, vFog);
  else a *= (1.0 - vFog);
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
}`;

const WHITE = new THREE.Color(1, 1, 1);
const _tmpColor = new THREE.Color();

function resolveColor(src, fallback) {
  if (!src) return fallback;
  if (typeof src === 'object' && Number.isFinite(src.r) && Number.isFinite(src.g) && Number.isFinite(src.b)) {
    return src;
  }
  if (typeof src === 'number' && Number.isFinite(src)) {
    return _tmpColor.setHex(src);
  }
  if (typeof src === 'string') {
    return _tmpColor.set(src);
  }
  return fallback;
}

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
    if (this.n >= this.max || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return;
    const i = this.n++;
    const i3 = i * 3;
    this.px[i3] = p.x; this.px[i3 + 1] = p.y; this.px[i3 + 2] = p.z;
    this.v[i3] = v && Number.isFinite(v.x) ? v.x : 0;
    this.v[i3 + 1] = v && Number.isFinite(v.y) ? v.y : 0;
    this.v[i3 + 2] = v && Number.isFinite(v.z) ? v.z : 0;
    const life = o.life > 1e-4 && Number.isFinite(o.life) ? o.life : 1;
    this.life[i] = 0; this.maxLife[i] = life;
    const sz0 = Number.isFinite(o.size0) ? o.size0 : 1;
    this.s0[i] = sz0;
    this.s1[i] = Number.isFinite(o.size1) ? o.size1 : sz0;
    this.rot[i] = o.rot ?? Math.random() * Math.PI * 2;
    this.rotV[i] = o.rotV ?? (Math.random() - 0.5) * 1.5;
    const c0 = resolveColor(o.color, WHITE);
    const r0 = c0.r, g0 = c0.g, b0 = c0.b;
    this.c0[i3] = r0; this.c0[i3 + 1] = g0; this.c0[i3 + 2] = b0;
    if (o.colorEnd) {
      const c1 = resolveColor(o.colorEnd, WHITE);
      this.c1[i3] = c1.r; this.c1[i3 + 1] = c1.g; this.c1[i3 + 2] = c1.b;
    } else {
      this.c1[i3] = r0; this.c1[i3 + 1] = g0; this.c1[i3 + 2] = b0;
    }
    this.a0[i] = Number.isFinite(o.alpha) ? o.alpha : 1;
    this.drag[i] = o.drag ?? 1;
    this.buoy[i] = o.buoy ?? 0;
    this.stretch[i] = o.stretch ?? 0;
    this.fadeIn[i] = o.fadeIn ?? 0.1;
  }

  clear() {
    this.n = 0;
    this.geo.instanceCount = 0;
  }

  _kill(i) {
    const j = --this.n;
    if (i === j) return;
    const i3 = i * 3, j3 = j * 3;
    this.px[i3] = this.px[j3]; this.px[i3 + 1] = this.px[j3 + 1]; this.px[i3 + 2] = this.px[j3 + 2];
    this.v[i3] = this.v[j3]; this.v[i3 + 1] = this.v[j3 + 1]; this.v[i3 + 2] = this.v[j3 + 2];
    this.c0[i3] = this.c0[j3]; this.c0[i3 + 1] = this.c0[j3 + 1]; this.c0[i3 + 2] = this.c0[j3 + 2];
    this.c1[i3] = this.c1[j3]; this.c1[i3 + 1] = this.c1[j3 + 1]; this.c1[i3 + 2] = this.c1[j3 + 2];
    this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j];
    this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
    this.rot[i] = this.rot[j]; this.rotV[i] = this.rotV[j];
    this.a0[i] = this.a0[j]; this.drag[i] = this.drag[j]; this.buoy[i] = this.buoy[j];
    this.stretch[i] = this.stretch[j]; this.fadeIn[i] = this.fadeIn[j];
  }

  update(dt, wind) {
    if (this.n === 0) {
      if (this.geo.instanceCount !== 0) this.geo.instanceCount = 0;
      return;
    }
    const O = this.aOffset.array, C = this.aColor.array, S = this.aSize.array, V = this.aVel.array;
    const wx = wind ? wind.x : 0, wz = wind ? wind.z : 0;
    let i = 0;
    while (i < this.n) {
      const nl = this.life[i] + dt;
      const ml = this.maxLife[i];
      if (nl >= ml) { this._kill(i); continue; }
      this.life[i] = nl;
      const i3 = i * 3, i4 = i * 4;
      const k = Math.exp(-this.drag[i] * dt);
      const vx = this.v[i3] * k + wx * (1 - k);
      const vy = this.v[i3 + 1] * k + this.buoy[i] * dt;
      const vz = this.v[i3 + 2] * k + wz * (1 - k);
      this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
      const px = this.px[i3] + vx * dt;
      const py = this.px[i3 + 1] + vy * dt;
      const pz = this.px[i3 + 2] + vz * dt;
      this.px[i3] = px; this.px[i3 + 1] = py; this.px[i3 + 2] = pz;
      const rot = this.rot[i] + this.rotV[i] * dt;
      this.rot[i] = rot;
      const t = nl / ml;
      O[i3] = px; O[i3 + 1] = py; O[i3 + 2] = pz;
      V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz;
      C[i4] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      C[i4 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      C[i4 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
      const fi = this.fadeIn[i] > 0 ? Math.min(1, t / this.fadeIn[i]) : 1;
      C[i4 + 3] = this.a0[i] * fi * (1 - t) * (1 - t * 0.3);
      S[i3] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
      S[i3 + 1] = rot;
      S[i3 + 2] = this.stretch[i];
      i++;
    }
    this.geo.instanceCount = this.n;
    if (this.n > 0) {
      const n3 = this.n * 3, n4 = this.n * 4;
      this.aOffset.clearUpdateRanges(); this.aOffset.addUpdateRange(0, n3); this.aOffset.needsUpdate = true;
      this.aVel.clearUpdateRanges(); this.aVel.addUpdateRange(0, n3); this.aVel.needsUpdate = true;
      this.aSize.clearUpdateRanges(); this.aSize.addUpdateRange(0, n3); this.aSize.needsUpdate = true;
      this.aColor.clearUpdateRanges(); this.aColor.addUpdateRange(0, n4); this.aColor.needsUpdate = true;
    }
  }
}

const RVERT = `
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

const RFRAG = `
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uOpacity;
uniform vec3 uFogColor;
uniform float uAdd;
varying float vAlpha;
varying vec2 vUv;
varying float vFog;
void main(){
  float d = vUv.y * 2.0 - 1.0;
  float edge = max(0.0, 1.0 - d * d);
  vec3 col = max(vec3(0.0), mix(uColor2, uColor, edge));
  float a = clamp(vAlpha * uOpacity * mix(1.0, edge, uAdd), 0.0, 1.0);
  if (uAdd < 0.5) col = mix(col, uFogColor, vFog); else a *= 1.0 - vFog;
  if (a < 0.002) discard;
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
    this.posAttr.clearUpdateRanges(); this.posAttr.addUpdateRange(0, n * 6); this.posAttr.needsUpdate = true;
    this.alphaAttr.clearUpdateRanges(); this.alphaAttr.addUpdateRange(0, n * 2); this.alphaAttr.needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
  }
  hide() { this.geo.setDrawRange(0, 0); }
}

const SW_VERT = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SW_FRAG = `
uniform vec3 uColor;
uniform float uProgress;
uniform float uArc;
varying vec2 vUv;
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0 || r < 0.15) discard;
  float ringR = mix(0.32, 0.92, uProgress);
  float band = max(0.0, 1.0 - abs(r - ringR) / mix(0.26, 0.08, uProgress));
  float ang = atan(p.y, p.x);
  float arcMask = uArc > 0.5 ? smoothstep(2.1, 0.2, abs(ang)) : 1.0;
  float a = band * band * arcMask * (1.0 - uProgress);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * (1.4 * a), a);
}`;

export class ShockwavePool {
  constructor(scene, cap = 20) {
    this.scene = scene;
    this.items = [];
    const geo = new THREE.PlaneGeometry(2, 2);
    for (let i = 0; i < cap; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: SW_VERT,
        fragmentShader: SW_FRAG,
        uniforms: {
          uColor: { value: new THREE.Color(1, 0.9, 0.75) },
          uProgress: { value: 0 },
          uArc: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 13;
      scene.add(mesh);
      this.items.push({ mesh, mat, t: 0, dur: 0.25, s0: 1, s1: 5, active: false });
    }
  }
  spawn(pos, normalOrQuat, { s0 = 1.2, s1 = 6.5, dur = 0.22, color = WHITE, arc = false } = {}) {
    let slot = null;
    for (let i = 0; i < this.items.length; i++) {
      if (!this.items[i].active) { slot = this.items[i]; break; }
    }
    if (!slot) slot = this.items[0];
    slot.active = true;
    slot.t = 0;
    slot.dur = dur;
    slot.s0 = s0;
    slot.s1 = s1;
    slot.mesh.position.copy(pos);
    if (normalOrQuat?.isQuaternion) {
      slot.mesh.quaternion.copy(normalOrQuat);
    } else if (normalOrQuat) {
      slot.mesh.lookAt(pos.x + normalOrQuat.x, pos.y + normalOrQuat.y, pos.z + normalOrQuat.z);
    }
    const c = resolveColor(color, WHITE);
    slot.mat.uniforms.uColor.value.setRGB(c.r, c.g, c.b);
    slot.mat.uniforms.uProgress.value = 0;
    slot.mat.uniforms.uArc.value = arc ? 1 : 0;
    slot.mesh.scale.setScalar(s0);
    slot.mesh.visible = true;
  }
  update(dt) {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it.active) continue;
      it.t += dt;
      if (it.t >= it.dur) {
        it.active = false;
        it.mesh.visible = false;
        continue;
      }
      const p = it.t / it.dur;
      const e = 1 - (1 - p) * (1 - p);
      it.mat.uniforms.uProgress.value = e;
      it.mesh.scale.setScalar(it.s0 + (it.s1 - it.s0) * e);
    }
  }
  clear() {
    for (let i = 0; i < this.items.length; i++) {
      this.items[i].active = false;
      this.items[i].mesh.visible = false;
    }
  }
}
