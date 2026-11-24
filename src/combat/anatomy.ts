import * as THREE from 'three';
import { clamp, lerp, rand } from '../util.js';
import type { LimbStatus, RagdollState } from '../types/game.ts';

export function createLimbStatus(): LimbStatus {
  return {
    leftLeg: 100,
    rightLeg: 100,
    leftArm: 100,
    rightArm: 100,
    eyes: 100,
    torso: 100,
  };
}

export function createRagdollState(): RagdollState {
  return {
    active: false,
    t: 0,
    hipVel: new THREE.Vector3(),
    rotVel: new THREE.Vector3(),
    limbVels: [0, 0, 0, 0, 0, 0],
    settled: false,
  };
}

export function initTitanRagdoll(titan: any, impactDir: THREE.Vector3 | null) {
  const rd: RagdollState = titan.ragdoll || (titan.ragdoll = createRagdollState());
  rd.active = true;
  rd.t = 0;
  rd.settled = false;
  const dir = impactDir && impactDir.lengthSq() > 1e-4 ? impactDir.clone().normalize() : new THREE.Vector3(Math.sin(titan.heading), 0, Math.cos(titan.heading));
  const spd = clamp(titan.speed * 0.65 + 4.5, 3.5, 14);
  rd.hipVel.set(dir.x * spd, 2.4 * titan.s, dir.z * spd);
  rd.rotVel.set(rand(1.4, 2.5), rand(-1.2, 1.2), rand(-1.3, 1.3));
  for (let i = 0; i < rd.limbVels.length; i++) rd.limbVels[i] = rand(-3.6, 3.6);
}

export function stepTitanRagdoll(titan: any, dt: number): boolean {
  const rd: RagdollState = titan.ragdoll;
  if (!rd || !rd.active) return false;
  rd.t += dt;
  const s = titan.s;

  if (!rd.settled) {
    rd.hipVel.y -= 24 * dt;
    titan.root.position.x += rd.hipVel.x * dt;
    titan.root.position.z += rd.hipVel.z * dt;
    titan.body.position.y += rd.hipVel.y * dt;

    titan.body.rotation.x = clamp(titan.body.rotation.x + rd.rotVel.x * dt, -1.55, 1.52);
    titan.body.rotation.z = clamp(titan.body.rotation.z + rd.rotVel.z * dt, -0.95, 0.95);
    titan.root.rotation.y += rd.rotVel.y * dt * 0.45;

    titan.hips.position.y = lerp(titan.hips.position.y, 1.35, Math.min(1, dt * 3.2));
    titan.spine.rotation.x = lerp(titan.spine.rotation.x, 0.42, Math.min(1, dt * 3));
    titan.head.rotation.x = lerp(titan.head.rotation.x, 0.55, Math.min(1, dt * 4));
    titan.head.rotation.z = clamp(titan.head.rotation.z + rd.limbVels[0] * dt * 0.5, -0.75, 0.75);

    for (let i = 0; i < 2; i++) {
      titan.shoulders[i].rotation.x = clamp(titan.shoulders[i].rotation.x + rd.limbVels[i + 1] * dt, -2.8, 1.1);
      titan.elbows[i].rotation.x = clamp(titan.elbows[i].rotation.x + rd.limbVels[i + 3] * dt, -2.2, -0.1);
      titan.thighs[i].rotation.x = lerp(titan.thighs[i].rotation.x, i === 0 ? -0.9 : -0.4, Math.min(1, dt * 2.8));
      titan.knees[i].rotation.x = lerp(titan.knees[i].rotation.x, i === 0 ? 1.35 : 0.75, Math.min(1, dt * 2.8));
    }

    if (titan.body.position.y <= 0 && rd.hipVel.y < 0) {
      titan.body.position.y = 0;
      const hitVy = -rd.hipVel.y;
      if (!titan.landed && hitVy > 3.5) {
        titan.landed = true;
        titan.game.onTitanFall(titan);
      }
      rd.hipVel.y = hitVy > 4 ? hitVy * 0.18 : 0;
      rd.hipVel.x *= 0.42;
      rd.hipVel.z *= 0.42;
      rd.rotVel.multiplyScalar(0.42);
      for (let i = 0; i < rd.limbVels.length; i++) rd.limbVels[i] *= 0.4;
      if (rd.t > 1.3 && rd.hipVel.lengthSq() < 0.35 && Math.abs(titan.body.rotation.x) > 1.15) {
        rd.settled = true;
      }
    }
    if (rd.t > 2.4 && !titan.landed) {
      titan.landed = true;
      titan.game.onTitanFall(titan);
      rd.settled = true;
    }
  }
  return true;
}

export function applyLocationalInjury(titan: any, part: string, side: number, dmg: number) {
  const limbs: LimbStatus = titan.limbs || (titan.limbs = createLimbStatus());
  const scale = titan.type === 'armored' || titan.type === 'tank' ? 0.55 : 1.0;
  const eff = dmg * 0.42 * scale;
  if (part === 'ankle' || part === 'leg') {
    if (side < 0) limbs.leftLeg = Math.max(0, limbs.leftLeg - eff);
    else limbs.rightLeg = Math.max(0, limbs.rightLeg - eff);
  } else if (part === 'arm' || part === 'hand') {
    if (side < 0) limbs.leftArm = Math.max(0, limbs.leftArm - eff);
    else limbs.rightArm = Math.max(0, limbs.rightArm - eff);
  } else if (part === 'head' || part === 'neck') {
    limbs.eyes = Math.max(0, limbs.eyes - eff * 1.2);
  } else if (part === 'torso') {
    limbs.torso = Math.max(0, limbs.torso - eff * 0.6);
  }
  return limbs;
}

export function regenLimbStatus(titan: any, dt: number) {
  const limbs: LimbStatus = titan.limbs;
  if (!limbs) return;
  const rate = titan.state === 'flee' ? 14 : 6;
  limbs.leftLeg = Math.min(100, limbs.leftLeg + rate * dt);
  limbs.rightLeg = Math.min(100, limbs.rightLeg + rate * dt);
  limbs.leftArm = Math.min(100, limbs.leftArm + rate * dt);
  limbs.rightArm = Math.min(100, limbs.rightArm + rate * dt);
  limbs.eyes = Math.min(100, limbs.eyes + rate * 1.4 * dt);
  limbs.torso = Math.min(100, limbs.torso + rate * dt);
}
