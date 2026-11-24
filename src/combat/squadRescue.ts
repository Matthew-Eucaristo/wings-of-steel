import * as THREE from 'three';

const _v = new THREE.Vector3();

export function initSquadVitals(member: any) {
  member.hp = 100;
  member.downed = false;
  member.bleedT = 0;
  member.reviveProg = 0;
  member.hitCd = 0;
  member.flareT = 0;
}

export function damageSquadMember(game: any, member: any, dmg: number) {
  if (member.downed || member.hitCd > 0) return;
  member.hp = Math.max(0, member.hp - dmg);
  member.hitCd = 1.6;
  if (member.hp <= 0) {
    member.downed = true;
    member.bleedT = 32;
    member.reviveProg = 0;
    member.hasAnchor = false;
    member.vel.set(0, 0, 0);
    member.pos.y = Math.max(1.2, Math.min(member.pos.y, 1.4));
    member.status = 'DOWNED!';
    game.vfx.signalFlare(member.pos, 'gold');
    game.audio.alarm();
    game.hud.radio(`MAYDAY: ${member.name.toUpperCase()} is down! Swing in and press [B] to revive!`);
  }
}

export function updateDownedMember(game: any, member: any, dt: number): boolean {
  if (!member.downed) {
    member.hitCd = Math.max(0, (member.hitCd || 0) - dt);
    if (member.hp < 100 && member.hitCd <= 0) member.hp = Math.min(100, member.hp + dt * 2.2);
    return false;
  }
  member.bleedT = Math.max(0, member.bleedT - dt);
  member.flareT = (member.flareT || 0) - dt;
  if (member.flareT <= 0) {
    member.flareT = 4.5;
    game.vfx.signalFlare(member.pos, 'gold');
  }
  member.pos.y = Math.max(0.9, member.pos.y - 12 * dt);
  member.status = `DOWNED ${Math.ceil(member.bleedT)}s`;
  member.cable.hide();
  member.trail.hide();

  const p = game.player;
  const dist = p.pos.distanceTo(member.pos);
  if (!p.dead && dist < 8.5) {
    const fast = game.input.action('interact') ? 2.4 : 1.0;
    member.reviveProg += dt * 0.72 * fast;
    member.status = `REVIVING ${Math.min(100, Math.round(member.reviveProg * 100))}%`;
    if (member.reviveProg >= 1) {
      member.downed = false;
      member.hp = 85;
      member.reviveProg = 0;
      member.hitCd = 3.0;
      member.pos.y += 2.2;
      member.vel.set(0, 8, 0);
      member.status = 'FORMATION';
      game.audio.reviveChime?.();
      game.vfx.impactRing(member.pos, _v.set(0, 1, 0), 4.5, 0x6dffb3, 0.25);
      game.hud.pop(member.pos, 'REVIVED!', 'small');
      game.hud.radio(`${member.name.toUpperCase()}: Back in the sky — owe you one, Commander!`);
    }
  } else {
    member.reviveProg = Math.max(0, member.reviveProg - dt * 0.2);
  }

  if (member.bleedT <= 0) {
    member.hp = 55;
    member.downed = false;
    member.reviveProg = 0;
    member.pos.copy(game.world.getArenaSpawn ? game.world.getArenaSpawn(game.arena) : game.world.playerSpawn);
    member.status = 'REDEPLOYING';
    game.hud.radio(`${member.name.toUpperCase()}: Medics patched me at HQ — rejoining!`);
  }

  member.model.update(dt, member.pos, member.quat, {
    grounded: true,
    speed: 0,
    vel: member.vel,
    hooked: false,
    spin: false,
    slashT: -1,
    grabbed: false,
    fp: false,
    spears: 0,
    blade: 100,
  });
  return true;
}
