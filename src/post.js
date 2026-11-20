import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uSpeed: { value: 0 }, uHurt: { value: 0 }, uFlash: { value: 0 }, uSlow: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uSpeed, uHurt, uFlash, uSlow; uniform vec2 uRes; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv; vec2 c = uv - 0.5;
      float r = length(c);
      // speed radial blur
      vec3 col = vec3(0.0);
      float blur = uSpeed * 0.035 * smoothstep(0.15, 0.7, r);
      const int N = 8;
      for (int i = 0; i < N; i++) {
        float t = float(i) / float(N - 1);
        vec2 u = uv - c * blur * t;
        // chromatic aberration grows with speed and hits
        float ca = (0.0015 + uSpeed * 0.003 + uHurt * 0.006) * r;
        col.r += texture2D(tDiffuse, u + c * ca).r;
        col.g += texture2D(tDiffuse, u).g;
        col.b += texture2D(tDiffuse, u - c * ca).b;
      }
      col /= float(N);
      // grade: warm highlights, cool shadows, gentle s-curve
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * vec3(0.92, 0.98, 1.08), (1.0 - smoothstep(0.0, 0.45, l)) * 0.6);
      col = mix(col, col * vec3(1.06, 1.0, 0.9), smoothstep(0.5, 1.0, l) * 0.5);
      col = mix(vec3(l), col, 1.08 - uSlow * 0.55);
      col = col * col * (3.0 - 2.0 * col) * 0.35 + col * 0.65;
      // slow-mo tint
      col = mix(col, col * vec3(1.1, 0.95, 0.85), uSlow * 0.4);
      // vignette
      col *= 1.0 - smoothstep(0.45, 0.95, r) * (0.45 + uSlow * 0.3);
      col += vec3(1.0, 0.9, 0.8) * uFlash;
      col += (hash(uv * uRes + fract(uTime) * 100.0) - 0.5) * 0.035;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.6, 0.88);
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
    this.u.uRes.value.set(innerWidth * pr, innerHeight * pr);
  }
  render(t) { this.u.uTime.value = t; this.composer.render(); }
}
