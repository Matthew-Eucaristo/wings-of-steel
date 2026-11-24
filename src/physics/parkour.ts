import * as THREE from 'three';
import { clamp } from '../util.js';

const _v = new THREE.Vector3();

export interface ParkourState {
  rollWindowT: number;
  rollAnimT: number;
  rollDir: THREE.Vector3;
  rollCd: number;
}

export function createParkourState(): ParkourState {
  return {
    rollWindowT: 0,
    rollAnimT: 0,
    rollDir: new THREE.Vector3(0, 0, 1),
    rollCd: 0,
  };
}

export function updateParkour(player: any, dt: number, control: boolean) {
  const pk: ParkourState = player.parkour || (player.parkour = createParkourState());
  pk.rollWindowT = Math.max(0, pk.rollWindowT - dt);
  pk.rollAnimT = Math.max(0, pk.rollAnimT - dt);
  pk.rollCd = Math.max(0, pk.rollCd - dt);

  if (control && !player.grounded && player.vel.y < -10 && pk.rollCd <= 0) {
    const inp = player.game.input;
    if (inp.actionPressed('roll') || inp.actionPressed('reel')) {
      pk.rollWindowT = 0.38;
    }
  }
}

export function tryLandingRoll(player: any, impactSpeed: number): boolean {
  const pk: ParkourState = player.parkour;
  if (!pk || pk.rollCd > 0) return false;
  const inp = player.game.input;
  const pressedNow = inp.action('roll') || pk.rollWindowT > 0;
  if (!pressedNow || impactSpeed < 13) return false;

  pk.rollWindowT = 0;
  pk.rollAnimT = 0.44;
  pk.rollCd = 0.75;
  const g = player.game;
  _v.set(player.vel.x, 0, player.vel.z);
  if (_v.lengthSq() < 1) _v.copy(g.cam.forwardFlat);
  _v.normalize();
  pk.rollDir.copy(_v);
  const rollBoost = clamp(impactSpeed * 0.48, 8, 19);
  player.vel.x = _v.x * rollBoost;
  player.vel.z = _v.z * rollBoost;
  g.vfx.dust(player.pos, 2.2, 8);
  g.audio.whoosh(player.pos, 0.7);
  g.hud.pop(player.pos, 'PARKOUR ROLL', 'small');
  return true;
}
