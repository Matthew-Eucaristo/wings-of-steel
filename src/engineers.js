import * as THREE from 'three';
import { clamp, damp } from './util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _from = new THREE.Vector3();

let ENG_MATS = null;
function getEngMats() {
  if (ENG_MATS) return ENG_MATS;
  ENG_MATS = {
    coat: new THREE.MeshStandardMaterial({ color: '#8f3a2c', roughness: 0.78 }),
    pants: new THREE.MeshStandardMaterial({ color: '#d8d0c0', roughness: 0.85 }),
    skin: new THREE.MeshStandardMaterial({ color: '#e4be9e', roughness: 0.65 }),
    helm: new THREE.MeshStandardMaterial({ color: '#c8a252', roughness: 0.35, metalness: 0.72 }),
    iron: new THREE.MeshStandardMaterial({ color: '#34383d', roughness: 0.4, metalness: 0.82 }),
    wood: new THREE.MeshStandardMaterial({ color: '#5e4228', roughness: 0.88 }),
    charge: new THREE.MeshStandardMaterial({ color: '#a84224', emissive: '#ff7a30', emissiveIntensity: 0.35, roughness: 0.6 }),
    beacon: new THREE.MeshBasicMaterial({ color: '#ffd97a', transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false }),
    ringIdle: new THREE.MeshBasicMaterial({ color: '#5be4ff', transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false }),
    ringCleared: new THREE.MeshBasicMaterial({ color: '#6dff9e', transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
  };
  return ENG_MATS;
}

function buildEngineerFigure() {
  const M = getEngMats();
  const root = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.42, 4, 8), M.coat);
  torso.position.y = 0.95;
  torso.castShadow = true;
  root.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), M.skin);
  head.position.y = 1.44;
  root.add(head);
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.165, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), M.helm);
  helm.position.y = 1.47;
  root.add(helm);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.22, 0.03, 12), M.helm);
  brim.position.y = 1.45;
  root.add(brim);
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.38, 3, 6), M.pants);
    leg.position.set(sx * 0.11, 0.36, 0);
    root.add(leg);
    legs.push(leg);
  }
  const tool = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.08), M.iron);
  tool.position.set(0.24, 0.92, 0.16);
  tool.rotation.x = 0.5;
  root.add(tool);
  return { root, legs, tool };
}

export class Engineers {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.cannons = [];
    this.squad = [];
    this.rings = [];
    this.buildConvoy();
    this.buildCannons();
    this.reset('campaign');
  }

  buildConvoy() {
    const M = getEngMats();
    const wagon = new THREE.Group();
    this.wagon = wagon;
    const bed = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.9, 5.4), M.wood);
    bed.position.y = 1.15;
    bed.castShadow = bed.receiveShadow = true;
    wagon.add(bed);
    const shieldL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.6, 5.2), M.iron);
    shieldL.position.set(-1.75, 1.72, 0);
    const shieldR = shieldL.clone();
    shieldR.position.x = 1.75;
    wagon.add(shieldL, shieldR);
    for (let i = 0; i < 4; i++) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.35, 10), M.charge);
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(0, 1.95 + (i > 1 ? 0.72 : 0), -1.1 + (i % 2) * 1.8);
      barrel.castShadow = true;
      wagon.add(barrel);
    }
    this.wheels = [];
    const wheelGeo = new THREE.CylinderGeometry(0.68, 0.68, 0.24, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    for (const [wx, wz] of [[-1.85, -1.7], [1.85, -1.7], [-1.85, 1.7], [1.85, 1.7]]) {
      const w = new THREE.Mesh(wheelGeo, M.iron);
      w.position.set(wx, 0.68, wz);
      wagon.add(w);
      this.wheels.push(w);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(5.8, 6.4, 40), M.beacon);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.1;
    wagon.add(ring);
    this.convoyRing = ring;

    const offsets = [[-2.7, 1.8], [2.7, 1.8], [-2.5, -2.0], [2.5, -2.0]];
    for (let i = 0; i < 4; i++) {
      const fig = buildEngineerFigure();
      fig.ox = offsets[i][0];
      fig.oz = offsets[i][1];
      wagon.add(fig.root);
      this.squad.push(fig);
    }
    this.group.add(wagon);
  }

  buildCannons() {
    const M = getEngMats();
    const carriageGeo = new THREE.BoxGeometry(1.5, 0.85, 2.2);
    const barrelGeo = new THREE.CylinderGeometry(0.24, 0.34, 3.1, 12);
    barrelGeo.rotateX(Math.PI / 2);
    barrelGeo.translate(0, 0, 1.1);
    for (let i = 0; i < this.game.world.cannonMounts.length; i++) {
      const mount = this.game.world.cannonMounts[i];
      const root = new THREE.Group();
      root.position.copy(mount);
      const carriage = new THREE.Mesh(carriageGeo, M.wood);
      carriage.position.y = 0.42;
      carriage.castShadow = true;
      root.add(carriage);
      const barrel = new THREE.Mesh(barrelGeo, M.iron);
      barrel.position.y = 0.98;
      barrel.castShadow = true;
      root.add(barrel);
      const gunner = buildEngineerFigure();
      gunner.root.position.set(-1.1, 0, -0.9);
      root.add(gunner.root);
      this.group.add(root);
      this.cannons.push({
        root,
        barrel,
        pos: mount.clone(),
        cd: 1.5 + i * 1.1,
        recoil: 0,
        yaw: 0,
        volleyTarget: null,
        volleyDelay: 0,
      });
    }
  }

  clearRings() {
    for (const r of this.rings) {
      this.group.remove(r.mesh);
      r.mesh.geometry.dispose();
    }
    this.rings.length = 0;
  }

  spawnTrainingCourse() {
    this.clearRings();
    const M = getEngMats();
    const waypoints = [
      [0, 26, -18],
      [22, 30, 18],
      [38, 24, 62],
      [14, 34, 108],
      [-22, 28, 146],
      [-36, 24, 96],
      [-18, 32, 42],
      [0, 48, 4],
    ];
    for (let i = 0; i < waypoints.length; i++) {
      const [x, y, z] = waypoints[i];
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.3, 8, 28), M.ringIdle);
      mesh.position.set(x, y, z);
      if (i < waypoints.length - 1) {
        const nx = waypoints[i + 1];
        mesh.lookAt(nx[0], nx[1], nx[2]);
      }
      this.group.add(mesh);
      this.rings.push({ pos: new THREE.Vector3(x, y, z), mesh, cleared: false });
    }
    this.ringsCleared = 0;
  }

  reset(mode = 'campaign') {
    this.mode = mode;
    this.convoyPos = new THREE.Vector3(0, 0, 52);
    this.convoyTargetZ = 348;
    this.convoyHP = 100;
    this.sealProgress = 0;
    this.districtHP = 100;
    this.pinned = false;
    this.moraleT = 0;
    this.alarmCD = 0;
    this.walkT = 0;
    this.ringsCleared = 0;
    this.wagon.visible = mode === 'campaign';
    this.wagon.position.copy(this.convoyPos);
    for (const c of this.cannons) {
      c.root.visible = mode !== 'training';
      c.cd = 2 + Math.random() * 2.5;
      c.volleyTarget = null;
    }
    if (mode === 'training') this.spawnTrainingCourse();
    else this.clearRings();
    this.game.world.setSealProgress(0);
  }

  get activeConvoy() {
    return this.mode === 'campaign' && this.game.started && this.game.story.allowWaves() && this.convoyHP > 0 && this.sealProgress < 1;
  }

  getThreatAttractor(titanPos, titanType) {
    if (!this.activeConvoy) return null;
    const dConvoy = titanPos.distanceTo(this.convoyPos);
    const dPlayer = titanPos.distanceTo(this.game.player.pos);
    if (titanType === 'abnormal' && dConvoy < 130 && dPlayer > 28) return this.convoyPos;
    if (dConvoy < 52 && dConvoy < dPlayer * 0.8) return this.convoyPos;
    return null;
  }

  requestArtillery(target) {
    if (!target || this.mode === 'training') return 0;
    let assigned = 0;
    for (let i = 0; i < this.cannons.length; i++) {
      const c = this.cannons[i];
      if (c.pos.distanceTo(target.root.position) < 290) {
        c.volleyTarget = target;
        c.volleyDelay = 0.38 + assigned * 0.16;
        assigned++;
      }
    }
    return assigned;
  }

  onNearKill(pos) {
    if (!this.activeConvoy) return;
    if (pos.distanceTo(this.convoyPos) < 60) {
      this.moraleT = 7.5;
      this.convoyHP = Math.min(100, this.convoyHP + 8);
      const p = this.game.player;
      p.gas = Math.min(100, p.gas + 25);
      p.blade = Math.min(100, p.blade + 25);
      p.hp = Math.min(100, p.hp + 15);
      this.game.hud.radio('REGU INSINYUR: Jalur bersih! Suplai darurat dilempar (+Gas/+Pedang)');
    }
  }

  fireCannon(c, target, barrage = false) {
    const g = this.game;
    const aimPt = _v.copy(target.nape.c);
    _from.copy(c.pos).setY(c.pos.y + 1.1);
    const dy = aimPt.x - c.pos.x, dz = aimPt.z - c.pos.z;
    c.yaw = Math.atan2(dy, dz);
    c.root.rotation.y = c.yaw;
    _from.x += Math.sin(c.yaw) * 2.2;
    _from.z += Math.cos(c.yaw) * 2.2;
    c.recoil = 0.55;
    g.vfx.cannonShot(_from, aimPt);
    g.vfx.dust(aimPt, 4.5, 10);
    g.audio.cannonBoom(c.pos);
    const dmg = barrage ? 360 : 220;
    if (target.state === 'grab') {
      g.player.releaseGrab(target);
      target.setState('kneel');
      target.legCut = 3.8;
      g.hud.radio('MERIAM GARNISUN: Tembakan penyelamat memutus cengkeraman titan!');
    } else if (target.armor > 0) {
      const r = target.hit('nape', dmg, aimPt, _v2.set(0, 0, -1), 0, { explosive: true });
      if (r.result === 'armor-break') {
        g.vfx.armorShatter(aimPt, _v2.set(0, 1, 0));
        g.audio.armorShatter(aimPt);
        g.hud.pop(aimPt, 'ZIRAH HANCUR!', 'kill');
        g.hud.radio('MERIAM GARNISUN: Zirah tengkuk Titan Lapis pecah! Serang sekarang!');
      } else {
        g.vfx.sparks(aimPt, 16);
        g.hud.pop(aimPt, '-' + r.armorDmg + ' ZIRAH', 'small');
      }
    } else {
      target.stagger(barrage ? 3.8 : 2.4);
      target.hp = Math.max(60, target.hp - dmg * 0.65);
      g.vfx.bloodSpray(aimPt, _v2.set(0, 1, 0), 22, 0.9);
      g.hud.pop(aimPt, barrage ? 'MERIAM!' : 'STAGGER', 'small');
    }
  }

  update(dt) {
    const g = this.game, p = g.player;
    this.moraleT = Math.max(0, this.moraleT - dt);
    this.alarmCD = Math.max(0, this.alarmCD - dt);

    if (this.mode === 'training') {
      for (let i = 0; i < this.rings.length; i++) {
        const r = this.rings[i];
        r.mesh.rotation.z += dt * 0.8;
        if (!r.cleared && p.pos.distanceTo(r.pos) < 5.5) {
          r.cleared = true;
          r.mesh.material = getEngMats().ringCleared;
          this.ringsCleared++;
          p.gas = Math.min(100, p.gas + 35);
          g.audio.hookHit(r.pos, false);
          g.vfx.impactRing(r.pos, p.vel, 5.5, 0x5be4ff, 0.25);
          g.hud.toast(`CINCIN ${this.ringsCleared}/${this.rings.length}<br><span style="font-size:17px">${Math.round(p.speed)} m/s</span>`, 0.9);
          if (this.ringsCleared === this.rings.length) {
            g.hud.radio('PELATIH: Semua cincin udara diselesaikan! Kecepatan luar biasa!');
            setTimeout(() => {
              if (this.mode === 'training') this.spawnTrainingCourse();
            }, 1500);
          }
        }
      }
      return;
    }

    for (let i = 0; i < this.cannons.length; i++) {
      const c = this.cannons[i];
      c.recoil = damp(c.recoil, 0, 8, dt);
      c.barrel.position.z = -c.recoil;
      if (c.volleyTarget) {
        if (!c.volleyTarget.alive) {
          c.volleyTarget = null;
        } else {
          const dx = c.volleyTarget.root.position.x - c.pos.x, dz = c.volleyTarget.root.position.z - c.pos.z;
          c.yaw = damp(c.yaw, Math.atan2(dx, dz), 8, dt);
          c.root.rotation.y = c.yaw;
          c.volleyDelay -= dt;
          if (c.volleyDelay <= 0) {
            const tgt = c.volleyTarget;
            c.volleyTarget = null;
            c.cd = 5.2;
            this.fireCannon(c, tgt, true);
          }
          continue;
        }
      }
      c.cd -= dt;
      let best = null, bestScore = Infinity;
      for (let k = 0; k < g.titans.length; k++) {
        const t = g.titans[k];
        if (!t.alive || t.state === 'emerge') continue;
        const d = c.pos.distanceTo(t.root.position);
        if (d > 220 || d < 14) continue;
        const score = (t.state === 'grab' ? d * 0.12 : d) * (t.squadMarked ? 0.45 : 1);
        if (score < bestScore) { bestScore = score; best = t; }
      }
      if (best) {
        const dx = best.root.position.x - c.pos.x, dz = best.root.position.z - c.pos.z;
        const wantY = Math.atan2(dx, dz);
        const diff = Math.atan2(Math.sin(wantY - c.yaw), Math.cos(wantY - c.yaw));
        c.yaw += clamp(diff, -2.5 * dt, 2.5 * dt);
        c.root.rotation.y = c.yaw;
        if (c.cd <= 0 && Math.abs(diff) < 0.24) {
          c.cd = 5.8 + Math.random() * 1.8;
          this.fireCannon(c, best, false);
        }
      }
    }

    if (!this.activeConvoy) return;

    let threatCount = 0;
    for (let i = 0; i < g.titans.length; i++) {
      const t = g.titans[i];
      if (!t.alive || t.state === 'emerge' || t.state === 'kneel') continue;
      const d = t.root.position.distanceTo(this.convoyPos);
      if (d < 20) threatCount++;
    }
    const wasPinned = this.pinned;
    this.pinned = threatCount > 0;
    if (this.pinned && !wasPinned) g.audio.alarm();
    const boost = this.moraleT > 0 ? 1.65 : 1.0;

    if (this.pinned) {
      this.convoyHP = Math.max(0, this.convoyHP - Math.min(3.2, threatCount * 1.05) * dt);
      if (this.alarmCD <= 0) {
        this.alarmCD = 7.5;
        g.hud.radio('PERINGATAN: Konvoi Insinyur dihadang titan! Tekan [T] panggil skuadron!');
      }
      if (this.convoyHP <= 0) {
        g.onMissionFail('convoy');
        return;
      }
    } else {
      this.convoyHP = Math.min(100, this.convoyHP + 2.2 * dt);
      const atGate = this.convoyPos.z >= this.convoyTargetZ - 0.5;
      if (!atGate) {
        const moveSpd = 6.2 * boost;
        this.convoyPos.z = Math.min(this.convoyTargetZ, this.convoyPos.z + moveSpd * dt);
        this.walkT += dt * moveSpd * 2.2;
        for (const w of this.wheels) w.rotation.x += dt * moveSpd * 1.4;
      } else {
        this.walkT += dt * 5 * boost;
        const waveCap = Math.min(1, g.wave / g.maxWave);
        const rate = 0.032 * boost;
        this.sealProgress = Math.min(waveCap, this.sealProgress + rate * dt);
        g.world.setSealProgress(this.sealProgress);
        if (Math.random() < dt * 6) {
          _v.set((Math.random() - 0.5) * 18, 4 + this.sealProgress * 22, 382);
          g.vfx.sparks(_v, 5);
        }
      }
    }

    this.wagon.position.copy(this.convoyPos);
    this.convoyRing.scale.setScalar(1 + Math.sin(g.elapsed * 4) * 0.06);
    this.convoyRing.material.color.setHex(this.pinned ? 0xff4d3a : this.moraleT > 0 ? 0x6dffb3 : 0xffd97a);
    for (let i = 0; i < this.squad.length; i++) {
      const f = this.squad[i];
      const sw = this.pinned ? 0 : Math.sin(this.walkT + i * 1.6) * 0.55;
      f.legs[0].rotation.x = sw;
      f.legs[1].rotation.x = -sw;
      f.tool.rotation.x = 0.5 + (this.convoyPos.z >= this.convoyTargetZ - 1 && !this.pinned ? Math.sin(g.elapsed * 9 + i) * 0.65 : 0);
      f.root.position.set(f.ox, 0, f.oz);
    }

    if (p.pos.distanceTo(this.convoyPos) < 9.5 && !p.dead) {
      p.gas = Math.min(100, p.gas + dt * 35);
      p.hp = Math.min(100, p.hp + dt * 12);
    }
  }
}
