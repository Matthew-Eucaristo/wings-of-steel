import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    float clean(float x){ return (x >= 0.0 && x <= 32.0) ? x : (x > 32.0 ? 32.0 : 0.0); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(clean(c.r), clean(c.g), clean(c.b), 1.0);
    }`,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSpeed: { value: 0 },
    uHurt: { value: 0 },
    uFlash: { value: 0 },
    uImpact: { value: 0 },
    uBlood: { value: 0 },
    uMood: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime, uSpeed, uHurt, uFlash, uImpact, uBlood, uMood;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 safeSample(vec2 u){
      vec3 s = texture2D(tDiffuse, clamp(u, vec2(0.001), vec2(0.999))).rgb;
      return clamp(s, vec3(0.0), vec3(1.0));
    }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r = length(c);
      float edgeMask = smoothstep(0.14, 0.72, r);
      float blur = (uSpeed * 0.017 + uImpact * 0.017) * edgeMask;
      float ca = (0.0007 + uSpeed * 0.0018 + uHurt * 0.004 + uImpact * 0.005) * r;
      vec3 col;
      if (uSpeed > 0.02 || uHurt > 0.02 || uImpact > 0.02) {
        vec3 s0 = safeSample(uv);
        vec3 s1 = safeSample(uv - c * (blur * 0.35));
        vec3 s2 = safeSample(uv - c * (blur * 0.70));
        vec3 s3 = safeSample(uv - c * blur);
        col = (s0 + s1 + s2 + s3) * 0.25;
        col.r = mix(col.r, safeSample(uv + c * ca).r, 0.72);
        col.b = mix(col.b, safeSample(uv - c * ca).b, 0.72);
      } else {
        col = safeSample(uv);
      }
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 coolShad = mix(vec3(0.93, 0.98, 1.06), vec3(0.84, 0.92, 1.12), uMood);
      vec3 warmHi = mix(vec3(1.06, 1.0, 0.91), vec3(0.96, 1.0, 1.08), uMood);
      col = mix(col, col * coolShad, (1.0 - smoothstep(0.0, 0.45, l)) * 0.48);
      col = mix(col, col * warmHi, smoothstep(0.5, 1.0, l) * 0.42);
      col = mix(vec3(l), col, 1.08 + uImpact * 0.2);
      col = clamp(col, vec3(0.0), vec3(1.0));
      float contrast = 0.28 + uImpact * 0.16;
      col = col * col * (3.0 - 2.0 * col) * contrast + col * (1.0 - contrast);
      if (uImpact > 0.01 || uSpeed > 0.38) {
        float ang = atan(c.y, c.x);
        float rays = abs(sin(ang * 44.0 + floor(uTime * 24.0) * 1.7));
        float lineMask = smoothstep(0.91, 0.994, rays) * smoothstep(0.32, 0.78, r);
        col += vec3(1.0, 0.96, 0.88) * lineMask * (uImpact * 0.25 + max(0.0, uSpeed - 0.38) * 0.11);
      }
      if (uBlood > 0.01) {
        float sp = hash(floor(uv * 38.0)) * smoothstep(0.38, 0.82, r);
        float drop = smoothstep(0.62, 0.94, sp) * uBlood;
        col = mix(col, vec3(0.48, 0.04, 0.03), drop * 0.42);
      }
      col *= 1.0 - smoothstep(0.56, 1.04, r) * 0.28;
      col += vec3(1.0, 0.93, 0.84) * (uFlash * 0.3);
      col += (hash(uv * uRes + fract(uTime) * 100.0) - 0.5) * 0.016;
      gl_FragColor = vec4(clamp(col, vec3(0.0), vec3(1.0)), 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.maxPR = 1.5;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.sanitize = new ShaderPass(SanitizeShader);
    this.composer.addPass(this.sanitize);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.24, 0.5, 1.05);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
    this.u = this.grade.uniforms;
    this.resize();
  }
  resize() {
    const pr = Math.min(devicePixelRatio, this.maxPR || 1.5);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(innerWidth, innerHeight);
    const w = Math.max(1, Math.floor(innerWidth * pr));
    const h = Math.max(1, Math.floor(innerHeight * pr));
    this.bloom.resolution.set(w, h);
    this.u.uRes.value.set(w, h);
    this.fxaa.material.uniforms.resolution.value.set(1 / w, 1 / h);
  }
  render(t) {
    this.u.uTime.value = t;
    this.composer.render();
  }
}
