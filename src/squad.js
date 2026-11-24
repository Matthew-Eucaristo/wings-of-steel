import * as THREE from 'three';
import { PlayerModel } from './playerModel.js';
import { Ribbon } from './particles.js';
import { clamp, rand } from './util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

const ROSTER = [
  {
    name: 'Capt. Reno',
    role: 'Vanguard',
    appearance: { hairStyle: 'levi', hairColor: '#181512', capeStyle: 'survey', scarfColor: '#d8a848', jacketColor: '#2a2d32', bladeAura: '#7ac8ff' },
    offset: new THREE.Vector3(-9, 6, -6),
  },
  {
    name: 'Sgt. Mira',
    role: 'Flanker',
    appearance: { hairStyle: 'ponytail', hairColor: '#7c2820', capeStyle: 'survey', scarfColor: '#b82924', jacketColor: '#9a7a55', bladeAura: '#ffcc55' },
    offset: new THREE.Vector3(9, 7, -6),
  },
  {
    name: 'Cpl. Dax',
    role: 'Support',
    appearance: { hairStyle: 'scout', hairColor: '#c8a25c', capeStyle: 'survey', scarfColor: '#e8e8e2', jacketColor: '#606b76', bladeAura: '#58ff9a' },
    offset: new THREE.Vector3(0, 9, -11),
  },
];

export class Squad {
  constructor(game) {
    this.game = game;
    this.members = [];
    this.focusTarget = null;
    this.focusT = 0;
    this.rallyT = 0;
    this.cmdCD = 0;

    const markGeo = new THREE.OctahedronGeometry(0.95, 0);
    const markMat = new THREE.MeshBasicMaterial({ color: '#ff4d38', wireframe: true });
    this.targetBeacon = new THREE.Mesh(markGeo, markMat);
    this.targetBeacon.visible = false;
    game.scene.add(this.targetBeacon);

    const fog = game.scene.fog;
    for (let i = 0; i < ROSTER.length; i++) {
      const cfg = ROSTER[i];
      const model = new PlayerModel(game.scene, cfg.appearance, { lightweight: true });
      const cable = new Ribbon(game.scene, 12, { color: 0x2e2c2a, opacity: 0.95, fog });
      const trail = new Ribbon(game.scene, 10, { color: 0xffffff, color2: cfg.appearance.bladeAura, additive: true, opacity: 0.8, fog });
      this.members.push({
        idx: i,
        name: cfg.name,
        role: cfg.role,
        offset: cfg.offset,
        model,
        cable,
        trail,
        cablePts: Array.from({ length: 12 }, () => new THREE.Vector3()),
        trailPts: Array.from({ length: 10 }, () => new THREE.Vector3()),
        trailLen: 0,
        trailHead: 0,
        trailSlice: [],
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        anchor: new THREE.Vector3(),
        anchorHouse: null,
        hasAnchor: false,
        anchorT: 0,
        target: null,
        attackCD: rand(0.5, 1.8),
        spearCD: rand(6, 10),
        slashT: -1,
        status: 'STANDBY',
        orbitPhase: i * 2.1,
      });
    }
    this.reset();
  }

  reset(visible = true) {
    const pSpawn = this.game.world.playerSpawn;
    this.focusTarget = null;
    this.focusT = 0;
    this.rallyT = 0;
    this.cmdCD = 0;
    this.targetBeacon.visible = false;
    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i];
      m.pos.copy(pSpawn).add(m.offset);
      m.vel.set(0, 0, 0);
      m.hasAnchor = false;
      m.anchorHouse = null;
      m.target = null;
      m.slashT = -1;
      m.trailLen = 0;
      m.status = 'FORMATION';
      m.model.capeInit = false;
      m.model.setVisible(visible);
      m.cable.hide();
      m.trail.hide();
    }
  }

  detachHouse(house) {
    for (const m of this.members) {
      if (m.anchorHouse === house) {
        m.hasAnchor = false;
        m.anchorHouse = null;
        m.anchorT = 0;
      }
    }
  }

  issueCommand() {
    const g = this.game, p = g.player;
    if (this.cmdCD > 0 || p.dead) return false;
    p.model.triggerFlareAnim();
    g.audio.flareLaunch();
    g.audio.squadAck();

    let tgt = p.lock?.alive ? p.lock : null;
    if (!tgt && p.aim?.collider?.owner?.alive) tgt = p.aim.collider.owner;
    if (!tgt) {
      const camDir = g.cam.forward;
      let bestS = 0.84;
      for (let i = 0; i < g.titans.length; i++) {
        const t = g.titans[i];
        if (!t.alive || t.state === 'emerge') continue;
        _v.subVectors(t.nape.c, g.cam.camera.position);
        const d = _v.length();
        if (d > 220 || d < 1) continue;
        const s = _v.dot(camDir) / d;
        if (s > bestS) { bestS = s; tgt = t; }
      }
    }

    if (tgt) {
      if (this.focusTarget) this.focusTarget.squadMarked = false;
      this.focusTarget = tgt;
      this.focusT = 16;
      tgt.squadMarked = true;
      this.rallyT = 0;
      this.cmdCD = 4.5;
      g.vfx.signalFlare(p.pos, 'red');
      for (const m of this.members) {
        m.target = tgt;
        m.attackCD = Math.min(m.attackCD, 0.25 + m.idx * 0.22);
      }
      const cannonsAssigned = g.engineers?.requestArtillery(tgt) || 0;
      g.hud.radio(
        cannonsAssigned > 0
          ? `CAPT. RENO: Target marked! Squad converging & ${cannonsAssigned} Garrison cannons firing!`
          : 'CAPT. RENO: Copy that! All wings converging on marked Titan!',
      );
    } else {
      if (this.focusTarget) this.focusTarget.squadMarked = false;
      this.focusTarget = null;
      this.focusT = 0;
      this.rallyT = 9.0;
      this.cmdCD = 8.0;
      g.vfx.signalFlare(p.pos, 'green');
      p.gas = Math.min(100, p.gas + 38);
      p.blade = Math.min(100, p.blade + 35);
      p.hp = Math.min(100, p.hp + 20);
      if (p.spears < p.classDef.spears + p.mods.maxSpearBonus) p.spears++;
      if (g.engineers) {
        g.engineers.moraleT = 8.0;
        g.engineers.convoyHP = Math.min(100, g.engineers.convoyHP + 15);
      }
      g.hud.radio('SGT. MIRA: Regrouping on your six! Gas, blades & spear resupplied.');
    }
    return true;
  }

  pickTargetFor(m) {
    const g = this.game, p = g.player;
    if (p.grabbedBy?.alive) return p.grabbedBy;
    if (this.focusTarget?.alive && this.focusTarget.state !== 'emerge') return this.focusTarget;
    if (this.rallyT > 0) return null;

    let best = null, bestScore = Infinity;
    const refPos = m.idx === 2 && g.engineers?.activeConvoy ? g.engineers.convoyPos : p.pos;
    for (let i = 0; i < g.titans.length; i++) {
      const t = g.titans[i];
      if (!t.alive || t.state === 'emerge') continue;
      const d = t.root.position.distanceTo(refPos);
      if (d > 210) continue;
      let mult = 1;
      if (m.idx === 0 && (t.type === 'sprinter' || t.type === 'crawler' || t.hp < 220)) mult = 0.65;
      else if (m.idx === 1 && (t.type === 'tank' || t.type === 'armored') && t.legCut <= 0) mult = 0.6;
      else if (m.idx === 2 && t.type === 'armored') mult = 0.55;
      else if (t.type === 'abnormal') mult = 0.8;
      const score = d * mult;
      if (score < bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  pickSwingAnchor(m, goal) {
    const g = this.game;
    let bestPt = null, bestHouse = null, bestScore = -Infinity;
    _v2.subVectors(goal, m.pos);
    const goalDist = _v2.length();
    if (goalDist > 1e-3) _v2.divideScalar(goalDist);
    const obs = g.world.obstacles;
    for (let k = 0; k < 12; k++) {
      const ob = obs[(m.idx * 37 + Math.floor(g.elapsed * 9) + k * 17) % obs.length];
      if (!ob || ob.dead || ob.h < 9) continue;
      _v.set(ob.x, Math.min(ob.h, 30), ob.z);
      _v3.subVectors(_v, m.pos);
      const d = _v3.length();
      if (d < 12 || d > 115) continue;
      const align = _v3.dot(_v2) / d;
      const score = align * 42 + _v.y * 0.45 - Math.abs(d - 46) * 0.24;
      if (score > bestScore) { bestScore = score; bestPt = _v.clone(); bestHouse = ob.house || null; }
    }
    if (bestPt) {
      m.anchor.copy(bestPt);
      m.anchorHouse = bestHouse;
      m.hasAnchor = true;
      m.anchorT = rand(0.65, 1.25);
    } else {
      m.hasAnchor = false;
      m.anchorHouse = null;
      m.anchorT = 0.35;
    }
  }

  performStrike(m, t) {
    const g = this.game, p = g.player;
    m.slashT = 0;
    m.attackCD = rand(2.1, 3.5);
    g.vfx.slashArc(m.pos, m.quat, 2.3);
    g.audio.whoosh(m.pos, 0.75);

    if (p.grabbedBy === t) {
      t.hit('arm', 190, m.pos, m.vel, t.grabSide === 1 ? 1 : -1);
      g.hud.radio(`${m.name.toUpperCase()}: Hang on Commander! Severing its grip!`);
      return;
    }

    if (m.idx === 2 && m.spearCD <= 0 && (t.armor > 0 || t.type === 'tank')) {
      m.spearCD = 12;
      g.audio.rocketLaunch();
      g.vfx.flash(t.nape.c, 3.4, 0xffaa44);
      g.vfx.impactRing(t.nape.c, _up, 7.5, 0xffd29a, 0.25);
      const r = t.hit('nape', 210, t.nape.c, m.vel, 0, { explosive: true });
      if (r.result === 'armor-break') {
        g.vfx.armorShatter(t.nape.c, m.vel);
        g.audio.armorShatter(t.nape.c);
        g.hud.radio('CPL. DAX: Thunder Spear landed — nape armor shattered! Move in!');
      } else {
        t.stagger(3.0);
        g.hud.pop(t.nape.c, 'SQUAD SPEAR', 'small');
      }
      return;
    }

    if (t.type === 'armored' && t.armor > 0) {
      const r = t.hit('nape', 145, t.nape.c, m.vel, 0, { heavy: true });
      if (r.result === 'armor-break') {
        g.vfx.armorShatter(t.nape.c, m.vel);
        g.audio.armorShatter(t.nape.c);
        g.hud.radio(`${m.name.toUpperCase()}: Armored nape cracked open! Finish it!`);
      } else if (t.legCut <= 0 && Math.random() < 0.7) {
        t.hit('ankle', 180, t.root.position, m.vel, 1);
        g.vfx.bloodSpray(t.root.position, m.vel, 18, 0.85);
        g.hud.pop(t.root.position, 'TENDON CUT', 'small');
      } else {
        g.vfx.sparks(t.nape.c, 12);
      }
      return;
    }

    const executeSmall = t.type === 'sprinter' || t.type === 'crawler' || t.hp <= 220 || (this.focusTarget === t && t.hp <= 340);
    if (executeSmall) {
      const r = t.hit('nape', 420, t.nape.c, m.vel, 0, { heavy: true });
      if (r.result === 'kill') {
        g.kills++;
        g.vfx.napeKill(t.nape.c, m.vel);
        g.audio.flesh(t.nape.c, false);
        g.hud.pop(t.nape.c, m.name.split(' ')[1].toUpperCase(), 'small');
        g.hud.killFeed(`<b>${m.name}</b> eliminated <em>${t.label}</em>`);
      } else {
        g.vfx.bloodSpray(t.nape.c, m.vel, 18, 0.85);
      }
    } else if (t.legCut <= 0 && (m.idx === 1 || Math.random() < 0.6)) {
      t.hit('ankle', 190, t.root.position, m.vel, 1);
      g.vfx.bloodSpray(t.root.position, m.vel, 18, 0.85);
      g.hud.pop(t.root.position, 'CRIPPLED!', 'small');
      if (m.idx === 1 && Math.random() < 0.4) g.hud.radio('SGT. MIRA: Tendons severed — nape is wide open!');
    } else if (t.armCut[1] <= 1.2 && Math.random() < 0.5) {
      t.hit('arm', 170, m.pos, m.vel, 1);
    } else {
      t.hit('nape', 155, t.nape.c, m.vel, 0, { heavy: true });
      g.vfx.bloodSpray(t.nape.c, m.vel, 18, 0.85);
    }
  }

  update(dt) {
    const g = this.game, p = g.player, camPos = g.cam.camera.position;
    if (!g.started) {
      for (const m of this.members) m.model.setVisible(false);
      this.targetBeacon.visible = false;
      return;
    }

    const activeMode = g.mode !== 'training' || g.titans.length > 0;
    this.cmdCD = Math.max(0, this.cmdCD - dt);
    this.rallyT = Math.max(0, this.rallyT - dt);
    if (this.focusTarget) {
      this.focusT -= dt;
      if (!this.focusTarget.alive || this.focusT <= 0) {
        this.focusTarget.squadMarked = false;
        this.focusTarget = null;
      }
    }

    if (this.focusTarget?.alive) {
      this.targetBeacon.visible = true;
      this.targetBeacon.position.copy(this.focusTarget.nape.c).setY(this.focusTarget.nape.c.y + 3.2 * this.focusTarget.s);
      this.targetBeacon.rotation.y += dt * 3.5;
      this.targetBeacon.scale.setScalar(this.focusTarget.s * (1.15 + Math.sin(g.elapsed * 7) * 0.18));
    } else {
      this.targetBeacon.visible = false;
    }

    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i];
      m.model.setVisible(activeMode);
      if (!activeMode) { m.cable.hide(); m.trail.hide(); continue; }

      m.attackCD -= dt;
      m.spearCD = Math.max(0, (m.spearCD || 0) - dt);
      m.anchorT -= dt;
      m.orbitPhase += dt * (1.4 + i * 0.18);
      if (m.slashT >= 0) {
        m.slashT += dt / 0.3;
        if (m.slashT > 1) m.slashT = -1;
      }

      const tgt = this.pickTargetFor(m);
      m.target = tgt;
      const goal = _v;

      if (p.grabbedBy === tgt && tgt) {
        tgt.handPos(tgt.grabSide, goal);
        m.status = 'RESCUING';
      } else if (tgt) {
        const orbitR = m.attackCD <= 0.35 ? 1.8 : 13 + i * 3;
        const oa = m.orbitPhase + i * 2.09;
        const aimLow = tgt.legCut <= 0 && tgt.type !== 'sprinter' && tgt.type !== 'crawler' && m.idx === 1;
        if (aimLow && m.attackCD <= 0.35) {
          goal.copy(tgt.root.position).setY(2.2 * tgt.s);
        } else {
          goal.copy(tgt.nape.c);
          goal.x += Math.cos(oa) * orbitR;
          goal.z += Math.sin(oa) * orbitR;
          goal.y = Math.max(4, goal.y + (m.attackCD <= 0.35 ? 0.5 : 3.4));
        }
        m.status = this.focusTarget === tgt ? 'FOCUS FIRE' : aimLow ? 'FLANKING' : 'ENGAGING';
      } else {
        const base = m.idx === 2 && g.engineers?.activeConvoy && this.rallyT <= 0 ? g.engineers.convoyPos : p.pos;
        const oa = m.orbitPhase * 0.55 + i * 2.1;
        const rad = this.rallyT > 0 ? 7.5 : 16;
        goal.set(base.x + Math.cos(oa) * rad, Math.max(11, base.y + 5 + (i % 2) * 3), base.z + Math.sin(oa) * rad);
        m.status = this.rallyT > 0 ? 'RALLYING' : m.idx === 2 && g.engineers?.activeConvoy ? 'ESCORT' : 'FORMATION';
      }

      _v2.subVectors(goal, m.pos);
      const dist = _v2.length();
      const maxSpd = p.grabbedBy === tgt ? 42 : this.focusTarget === tgt ? 35 : 28;
      if (dist > 0.5) {
        _v2.divideScalar(dist);
        const wantSpd = clamp(dist * 2.1, 10, maxSpd);
        _v2.multiplyScalar(wantSpd);
        m.vel.lerp(_v2, 1 - Math.exp(-4.6 * dt));
      }
      if (m.hasAnchor) {
        _v3.subVectors(m.anchor, m.pos);
        const ad = _v3.length();
        if (ad > 1) m.vel.addScaledVector(_v3.divideScalar(ad), 6.5 * dt);
      }
      m.vel.y += Math.sin(g.elapsed * 3.0 + i * 1.7) * 3.5 * dt;
      m.pos.addScaledVector(m.vel, dt);
      if (m.pos.y < 2.6) { m.pos.y = 2.6; if (m.vel.y < 0) m.vel.y = 3.5; }

      if (tgt && m.attackCD <= 0) {
        const hitPt = p.grabbedBy === tgt ? tgt.handPos(tgt.grabSide, _v3) : (m.idx === 1 && tgt.legCut <= 0 && tgt.type !== 'sprinter' ? _v3.copy(tgt.root.position).setY(2.2 * tgt.s) : tgt.nape.c);
        if (m.pos.distanceTo(hitPt) < 4.8 + tgt.s * 1.4) {
          this.performStrike(m, tgt);
        }
      }

      if (m.anchorT <= 0) {
        if (tgt && m.pos.distanceTo(tgt.nape.c) < 58) {
          m.anchor.copy(tgt.nape.c);
          m.anchorHouse = null;
          m.hasAnchor = true;
          m.anchorT = rand(0.45, 0.85);
        } else {
          this.pickSwingAnchor(m, goal);
        }
      }

      const spd = m.vel.length();
      if (spd > 19 && Math.random() < dt * 10) {
        _v3.copy(m.vel).normalize();
        g.vfx.gas(m.pos, _v3, 0.45);
      }

      const fwd = _v2.copy(m.vel);
      if (fwd.lengthSq() < 0.2) fwd.set(0, 0, 1); else fwd.normalize();
      const right = _v3.crossVectors(_up, fwd);
      if (right.lengthSq() < 1e-4) right.set(1, 0, 0); else right.normalize();
      const upOrtho = _v.crossVectors(fwd, right).normalize();
      _m.makeBasis(right, upOrtho, fwd);
      _q.setFromRotationMatrix(_m);
      m.quat.slerp(_q, 1 - Math.exp(-9 * dt));

      m.model.update(dt, m.pos, m.quat, {
        grounded: false,
        speed: spd,
        vel: m.vel,
        hooked: m.hasAnchor,
        spin: false,
        slashT: m.slashT,
        grabbed: false,
        fp: false,
        spears: 1,
        blade: 100,
      });

      if (m.hasAnchor) {
        const gearFrom = m.model.gearPos(i % 2 ? 1 : -1, _v2);
        const pts = m.cablePts;
        for (let k = 0; k < pts.length; k++) {
          const u = k / (pts.length - 1);
          pts[k].lerpVectors(gearFrom, m.anchor, u);
          pts[k].y -= Math.sin(u * Math.PI) * 0.55;
        }
        m.cable.set(pts, camPos, 0.042, 0.85);
      } else {
        m.cable.hide();
      }

      if (m.slashT >= 0 || spd > 24) {
        const head = (m.trailHead - 1 + m.trailPts.length) % m.trailPts.length;
        m.trailHead = head;
        m.model.bladeTip(0, m.trailPts[head]);
        m.trailLen = Math.min(8, m.trailLen + 1);
      } else if (m.trailLen > 0) {
        m.trailLen--;
      }
      if (m.trailLen > 1) {
        m.trailSlice.length = m.trailLen;
        for (let k = 0; k < m.trailLen; k++) m.trailSlice[k] = m.trailPts[(m.trailHead + k) % m.trailPts.length];
        m.trail.set(m.trailSlice, camPos, (k, nn) => 0.22 * (1 - k / nn), (k, nn) => (1 - k / nn) * 0.65);
      } else {
        m.trail.hide();
      }
    }
  }
}
