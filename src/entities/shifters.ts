import * as THREE from 'three';
import { clamp, rand } from '../util.js';

const _v = new THREE.Vector3();

export class ShifterAbilities {
  game: any;
  spikes: Array<{ mesh: THREE.Mesh; pos: THREE.Vector3; t: number; dur: number; maxH: number; hit: boolean }>;
  spikeGeo: THREE.ConeGeometry | null;
  spikeMat: THREE.MeshStandardMaterial | null;

  constructor(game: any) {
    this.game = game;
    this.spikes = [];
    this.spikeGeo = null;
    this.spikeMat = null;
  }

  clear() {
    for (const s of this.spikes) this.game.scene.remove(s.mesh);
    this.spikes.length = 0;
  }

  castWarhammerSpikes(caster: any, targetPos: THREE.Vector3) {
    const g = this.game;
    if (!this.spikeGeo) {
      this.spikeGeo = new THREE.ConeGeometry(1.35, 14, 6);
      this.spikeGeo.translate(0, 7, 0);
    }
    if (!this.spikeMat) {
      this.spikeMat = new THREE.MeshStandardMaterial({
        color: '#dde6f2',
        roughness: 0.18,
        metalness: 0.35,
        emissive: '#5882b8',
        emissiveIntensity: 0.35,
      });
    }
    const count = 4;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand(-0.4, 0.4);
      const r = i === 0 ? 1.5 : rand(4.5, 11);
      const px = targetPos.x + Math.sin(a) * r;
      const pz = targetPos.z + Math.cos(a) * r;
      const mesh = new THREE.Mesh(this.spikeGeo, this.spikeMat);
      mesh.position.set(px, -14, pz);
      mesh.rotation.set(rand(-0.22, 0.22), rand(0, 6.28), rand(-0.22, 0.22));
      mesh.castShadow = true;
      g.scene.add(mesh);
      this.spikes.push({
        mesh,
        pos: new THREE.Vector3(px, 0, pz),
        t: -i * 0.12,
        dur: 4.5,
        maxH: rand(11, 16),
        hit: false,
      });
    }
    g.audio.buildingCollapse?.(targetPos);
    g.cam.shake(0.45);
    g.hud.toast('<span style="font-size:18px;color:#b8dcff">FORGE SENTINEL: CRYSTAL SPIKES ERUPTING!</span>', 1.1);
  }

  castBeastBarrage(caster: any, targetPos: THREE.Vector3) {
    const g = this.game;
    const launch = caster.handPos(1, _v.clone());
    for (let i = 0; i < 4; i++) {
      const spread = new THREE.Vector3(
        targetPos.x + (i - 1.5) * 9 + rand(-3, 3),
        targetPos.y,
        targetPos.z + rand(-7, 7),
      );
      g.spawnBoulder(launch, spread, 1.05 * caster.s);
    }
    g.audio.boulderThrow(launch);
    g.hud.toast('<span style="font-size:18px;color:#ffb878">SIEGE TITAN: SCATTER BARRAGE INCOMING!</span>', 1.1);
  }

  castFounderSummon(caster: any) {
    const g = this.game;
    const pos = caster.root.position;
    g.audio.roar(pos, caster.height, 1.4);
    g.vfx.impactRing(pos, new THREE.Vector3(0, 1, 0), 28, 0xffe49c, 0.45);
    g.cam.shake(0.75);
    const active = g.titans.filter((t: any) => t.alive).length;
    if (active < 22) {
      for (let i = 0; i < 2; i++) {
        const a = rand(0, Math.PI * 2);
        const sp = new THREE.Vector3(clamp(pos.x + Math.sin(a) * 26, -320, 320), 0, clamp(pos.z + Math.cos(a) * 26, -320, 320));
        g.titans.push(new g.TitanClass(g, sp, { type: i === 0 ? 'sprinter' : 'crawler' }));
      }
      g.hud.radio('ALERT: SOVEREIGN ROAR — Reinforcements emerging around the alpha!');
    }
  }

  update(dt: number) {
    const g = this.game, p = g.player;
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i];
      s.t += dt;
      if (s.t < 0) continue;
      if (s.t < 0.24) {
        const k = s.t / 0.24;
        s.mesh.position.y = -s.maxH * (1 - k * k);
        if (k > 0.5 && !s.hit) {
          s.hit = true;
          g.vfx.dust(s.pos, 4.5, 8);
          g.world.destroyNear(s.pos, 4.0, 120);
          if (!p.dead && p.invuln <= 0 && Math.hypot(p.pos.x - s.pos.x, p.pos.z - s.pos.z) < 2.8 && p.pos.y < s.maxH) {
            _v.subVectors(p.pos, s.pos).setY(0.8).normalize();
            p.knockback(_v, 18, 18);
          }
        }
      } else if (s.t > s.dur - 0.6) {
        const k = clamp((s.t - (s.dur - 0.6)) / 0.6, 0, 1);
        s.mesh.position.y = -s.maxH * k;
      } else {
        s.mesh.position.y = 0;
      }
      if (s.t >= s.dur) {
        g.scene.remove(s.mesh);
        this.spikes.splice(i, 1);
      }
    }
  }
}
