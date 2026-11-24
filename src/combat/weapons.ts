import * as THREE from 'three';
import { clamp, rand } from '../util.js';
import { createRayHit } from '../collision.js';
import { VFX_COLORS } from '../vfx.js';

const _dir = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _v = new THREE.Vector3();
const _gunHit = createRayHit();

export interface PistolState {
  ammo: number;
  maxAmmo: number;
  reserveMags: number;
  fireCd: number;
  reloadT: number;
  side: number;
  muzzleFlashT: number;
}

export function createPistolState(maxAmmo = 12, reserveMags = 8): PistolState {
  return {
    ammo: maxAmmo,
    maxAmmo,
    reserveMags,
    fireCd: 0,
    reloadT: 0,
    side: 1,
    muzzleFlashT: 0,
  };
}

export function updatePistols(player: any, dt: number) {
  const st: PistolState = player.pistols;
  if (!st) return;
  st.fireCd = Math.max(0, st.fireCd - dt);
  st.muzzleFlashT = Math.max(0, st.muzzleFlashT - dt);
  if (st.reloadT > 0) {
    st.reloadT -= dt;
    if (st.reloadT <= 0) {
      st.ammo = st.maxAmmo;
      st.reserveMags = Math.max(0, st.reserveMags - 1);
      player.game.audio.bladeSwap();
      player.game.hud.toast('<span style="font-size:17px">MAGAZINES LOCKED</span>', 0.65);
    }
  }
}

export function reloadPistols(player: any) {
  const st: PistolState = player.pistols;
  if (!st || st.reloadT > 0 || st.ammo >= st.maxAmmo) return;
  if (st.reserveMags <= 0 && player.game.mode !== 'training') {
    player.game.hud.toast('<span style="font-size:17px">OUT OF AMMO — Visit a Supply Depot</span>', 1.0);
    player.game.audio.click();
    return;
  }
  st.reloadT = 0.72;
  player.model.triggerReloadAnim();
  player.game.audio.click();
  player.game.hud.toast('<span style="font-size:17px">RELOADING PISTOLS…</span>', 0.7);
}

export function firePistolShot(player: any) {
  const g = player.game;
  const st: PistolState = player.pistols;
  if (!st || st.fireCd > 0 || st.reloadT > 0) return;
  if (st.ammo <= 0) {
    reloadPistols(player);
    return;
  }
  st.ammo--;
  st.fireCd = 0.16;
  st.side = -st.side;
  st.muzzleFlashT = 0.08;
  player.slashT = 0.12;
  player.slashSide = st.side;

  const cam = g.cam.camera;
  cam.getWorldDirection(_dir);
  if (player.lock?.alive && player.pos.distanceTo(player.lock.nape.c) < 88) {
    _v.subVectors(player.lock.nape.c, cam.position).normalize();
    if (_v.dot(_dir) > 0.9) _dir.lerp(_v, 0.55).normalize();
  }

  const muzzle = player.model.bladeTip(st.side > 0 ? 1 : 0, _pt);
  if (g.cam.isFP()) {
    muzzle.copy(cam.position).addScaledVector(_dir, 0.85).addScaledVector(g.cam.right, st.side * 0.24);
    muzzle.y -= 0.14;
  }
  g.vfx.flash(muzzle, 1.35, VFX_COLORS.SPARK);
  g.vfx.sparks(muzzle, 5);
  g.audio.pistolShot?.(muzzle);
  g.cam.shake(0.065);
  g.cam.impactFov = Math.max(g.cam.impactFov, 0.75);
  player.vel.addScaledVector(_dir, -1.2);

  const range = 145;
  const hit = g.world.col.raycast(cam.position, _dir, range, { dynamics: true, inflate: 1.35 }, _gunHit);
  const endPt = hit ? hit.point : _v.copy(cam.position).addScaledVector(_dir, range);
  g.vfx.bulletTracer?.(muzzle, endPt);

  if (g.net?.connected && g.net.netMode === 'pvp') {
    for (const [id, peer] of g.net.peers) {
      if (peer.pos.distanceTo(endPt) < 2.2) {
        g.net.sendPvpHit(id, _dir, 26);
        g.hud.hitmarker('hit');
        g.hud.pop(peer.pos, '26', 'small');
      }
    }
  }

  if (hit?.collider?.owner) {
    const t = hit.collider.owner;
    if (!t.alive) return;
    const part = hit.collider.part || 'torso';
    const napeDist = hit.point.distanceTo(t.nape.c);
    const isNape = napeDist < t.nape.r * 1.45;
    const speedBonus = clamp(player.speed * 2.8, 0, 120);
    const baseDmg = Math.round((isNape ? 165 : 115) + speedBonus * player.mods.damageBonus);
    const r = t.hit(isNape ? 'nape' : part, baseDmg, hit.point.clone(), _dir, hit.collider.side || 0, { heavy: player.speed > 26 });
    g.onSlashHit(t, r.result, r.armorDmg || baseDmg, hit.point.clone());
  } else if (hit?.collider?.house) {
    g.world.damageHouse(hit.collider.house, hit.point, _dir, 24);
    g.vfx.sparks(hit.point, 8);
    g.vfx.dust(hit.point, 1.5, 4);
  } else if (hit) {
    g.vfx.sparks(hit.point, 7);
    g.vfx.dust(hit.point, 1.2, 3);
  }

  if (st.ammo === 0 && st.reserveMags > 0) reloadPistols(player);
}
