import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

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
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime, uSpeed, uHurt, uFlash, uImpact, uBlood;
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
      float blur = (uSpeed * 0.025 + uImpact * 0.028) * edgeMask;
      float ca = (0.001 + uSpeed * 0.0024 + uHurt * 0.005 + uImpact * 0.0085) * r;
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
      col = mix(col, col * vec3(0.94, 0.99, 1.06), (1.0 - smoothstep(0.0, 0.45, l)) * 0.5);
      col = mix(col, col * vec3(1.05, 1.0, 0.92), smoothstep(0.5, 1.0, l) * 0.45);
      col = mix(vec3(l), col, 1.06 + uImpact * 0.22);
      col = clamp(col, vec3(0.0), vec3(1.0));
      float contrast = 0.3 + uImpact * 0.18;
      col = col * col * (3.0 - 2.0 * col) * contrast + col * (1.0 - contrast);
      if (uImpact > 0.01 || uSpeed > 0.32) {
        float ang = atan(c.y, c.x);
        float rays = abs(sin(ang * 46.0 + floor(uTime * 28.0) * 1.9));
        float lineMask = smoothstep(0.89, 0.992, rays) * smoothstep(0.28, 0.76, r);
        col += vec3(1.0, 0.96, 0.88) * lineMask * (uImpact * 0.52 + max(0.0, uSpeed - 0.32) * 0.15);
      }
      if (uBlood > 0.01) {
        float sp = hash(floor(uv * 38.0)) * smoothstep(0.32, 0.78, r);
        float drop = smoothstep(0.55, 0.92, sp) * uBlood;
        col = mix(col, vec3(0.52, 0.04, 0.03), drop * 0.65);
      }
      col *= 1.0 - smoothstep(0.52, 1.02, r) * 0.33;
      col += vec3(1.0, 0.93, 0.84) * (uFlash * 0.52);
      col += (hash(uv * uRes + fract(uTime) * 100.0) - 0.5) * 0.02;
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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.28, 0.52, 1.04);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.u = this.grade.uniforms;
    this.resize();
  }
  resize() {
    const pr = Math.min(devicePixelRatio, this.maxPR || 1.5);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(innerWidth, innerHeight);
    this.bloom.resolution.set(Math.floor(innerWidth * pr), Math.floor(innerHeight * pr));
    this.u.uRes.value.set(innerWidth * pr, innerHeight * pr);
  }
  render(t) {
    this.u.uTime.value = t;
    this.composer.render();
  }
}
