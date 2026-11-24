import * as THREE from 'three';
import { clamp } from '../util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class CannonController {
  game: any;
  mounted: any;
  reloadT: number;
  nearCannon: any;

  constructor(game: any) {
    this.game = game;
    this.mounted = null;
    this.reloadT = 0;
    this.nearCannon = null;
  }

  reset() {
    this.mounted = null;
    this.reloadT = 0;
    this.nearCannon = null;
  }

  findNearby(): any {
    const p = this.game.player;
    const cannons = this.game.engineers?.cannons || [];
    let best = null;
    let bd = 6.2;
    for (let i = 0; i < cannons.length; i++) {
      const c = cannons[i];
      if (!c.root.visible) continue;
      const d = p.pos.distanceTo(c.pos);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  toggleMount(): boolean {
    if (this.mounted) {
      this.dismount();
      return true;
    }
    const c = this.findNearby();
    if (!c) return false;
    this.mounted = c;
    const p = this.game.player;
    for (const h of p.hooks) p.release(h, true);
    p.vel.set(0, 0, 0);
    p.pos.copy(c.pos).add(_v.set(0, 1.2, -1.6));
    this.game.hud.toast('<span style="font-size:18px;color:#ffe29a">GARRISON CANNON MOUNTED · LMB TO FIRE</span>', 1.4);
    this.game.audio.bladeSwap();
    return true;
  }

  dismount() {
    if (!this.mounted) return;
    const p = this.game.player;
    p.pos.copy(this.mounted.pos).add(_v.set(0, 2.2, 0));
    p.vel.set(0, 7.5, 0);
    p.grounded = false;
    this.mounted = null;
    this.game.hud.toast('<span style="font-size:17px">DISMOUNTED CANNON</span>', 0.8);
  }

  fireManual() {
    if (!this.mounted || this.reloadT > 0) return;
    const g = this.game;
    const c = this.mounted;
    this.reloadT = 1.65;
    c.recoil = 0.65;
    const dir = _v.copy(g.cam.forward).normalize();
    const muzzle = _v2.copy(c.pos).add(_v.set(0, 1.35, 0)).addScaledVector(dir, 2.6);
    const targetPt = muzzle.clone().addScaledVector(dir, 145);
    const hit = g.world.col.raycast(muzzle, dir, 280, { dynamics: true, inflate: 1.9 });
    const impact = hit ? hit.point.clone() : targetPt;

    g.vfx.cannonShot(muzzle, impact);
    g.audio.cannonBoom(muzzle);
    g.cam.shake(0.55);
    g.explode(impact);
  }

  update(dt: number) {
    this.reloadT = Math.max(0, this.reloadT - dt);
    this.nearCannon = this.mounted ? null : this.findNearby();
    if (!this.mounted) return;
    const g = this.game;
    const c = this.mounted;
    const p = g.player;
    c.yaw = g.cam.yaw;
    c.root.rotation.y = c.yaw;
    c.barrel.rotation.x = clamp(-g.cam.pitch, -0.55, 0.45);
    p.pos.set(c.pos.x - Math.sin(c.yaw) * 1.45, c.pos.y + 1.35, c.pos.z - Math.cos(c.yaw) * 1.45);
    p.vel.set(0, 0, 0);
    if (g.input.mouse.lPressed) this.fireManual();
    if (g.input.actionPressed('reel')) this.dismount();
  }
}
