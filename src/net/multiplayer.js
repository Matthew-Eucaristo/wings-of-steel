import * as THREE from 'three';
import { PlayerModel } from '../playerModel.js';
import { Ribbon } from '../particles.js';

const _v = new THREE.Vector3();

export class MultiplayerClient {
  constructor(game) {
    this.game = game;
    this.ws = null;
    this.connected = false;
    this.roomCode = '';
    this.playerId = 'p-' + Math.random().toString(36).slice(2, 8);
    this.callsign = 'Scout-' + Math.floor(10 + Math.random() * 89);
    this.netMode = 'coop';
    this.peers = new Map();
    this.sendAcc = 0;
    this.onStatus = null;
  }

  setStatus(text, ok = false) {
    this.statusText = text;
    this.connected = ok;
    if (this.onStatus) this.onStatus(text, ok, this.peers.size);
  }

  connect(url, roomCode, callsign, netMode = 'coop') {
    this.disconnect();
    this.roomCode = (roomCode || 'HALVARD-1').toUpperCase();
    this.callsign = (callsign || this.callsign).slice(0, 16);
    this.netMode = netMode;
    if (!url || !/^wss?:\/\//i.test(url)) {
      this.setStatus('Enter a valid ws:// or wss:// relay URL (or launch Local Bot Skirmish).', false);
      return false;
    }
    try {
      this.setStatus(`Connecting to ${url}…`, false);
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'join',
          room: this.roomCode,
          id: this.playerId,
          callsign: this.callsign,
          mode: this.netMode,
          appearance: this.game.prefs.appearance,
        }));
        this.setStatus(`Connected · Room ${this.roomCode} (${this.netMode.toUpperCase()})`, true);
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        this.handleMessage(msg);
      };
      ws.onerror = () => {
        this.setStatus('Relay unreachable — start server/relay.mjs or use Local Bot Skirmish.', false);
      };
      ws.onclose = () => {
        if (this.ws === ws) {
          this.ws = null;
          this.clearPeers();
          this.setStatus('Disconnected from relay.', false);
        }
      };
      return true;
    } catch {
      this.setStatus('WebSocket unavailable in this environment.', false);
      return false;
    }
  }

  disconnect() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.clearPeers();
    this.connected = false;
  }

  clearPeers() {
    for (const peer of this.peers.values()) {
      peer.model.dispose();
      peer.cable.hide();
      this.game.scene.remove(peer.cable.mesh);
    }
    this.peers.clear();
  }

  ensurePeer(id, meta = {}) {
    let peer = this.peers.get(id);
    if (peer) return peer;
    const model = new PlayerModel(this.game.scene, meta.appearance || {}, { lightweight: true });
    const cable = new Ribbon(this.game.scene, 10, { color: 0x2b2928, opacity: 0.9, fog: this.game.scene.fog });
    peer = {
      id,
      callsign: meta.callsign || id,
      model,
      cable,
      cablePts: Array.from({ length: 10 }, () => new THREE.Vector3()),
      pos: new THREE.Vector3(),
      targetPos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      targetQuat: new THREE.Quaternion(),
      hookTip: new THREE.Vector3(),
      hooked: false,
      slashT: -1,
      lastSeen: this.game.elapsed,
    };
    this.peers.set(id, peer);
    this.setStatus(this.statusText, this.connected);
    return peer;
  }

  handleMessage(msg) {
    if (!msg || msg.id === this.playerId) return;
    if (msg.type === 'state') {
      const peer = this.ensurePeer(msg.id, msg);
      peer.targetPos.set(msg.p[0], msg.p[1], msg.p[2]);
      peer.vel.set(msg.v[0], msg.v[1], msg.v[2]);
      peer.targetQuat.set(msg.q[0], msg.q[1], msg.q[2], msg.q[3]);
      peer.hooked = !!msg.h;
      if (msg.h) peer.hookTip.set(msg.h[0], msg.h[1], msg.h[2]);
      peer.slashT = msg.sl ?? -1;
      peer.lastSeen = this.game.elapsed;
    } else if (msg.type === 'join') {
      this.ensurePeer(msg.id, msg);
      this.game.hud?.killFeed(`<b>${msg.callsign || msg.id}</b> joined room <em>${this.roomCode}</em>`);
    } else if (msg.type === 'leave') {
      const peer = this.peers.get(msg.id);
      if (peer) {
        peer.model.dispose();
        peer.cable.hide();
        this.game.scene.remove(peer.cable.mesh);
        this.peers.delete(msg.id);
        this.setStatus(this.statusText, this.connected);
      }
    } else if (msg.type === 'pvp-hit' && msg.target === this.playerId) {
      const p = this.game.player;
      _v.set(msg.dir[0], msg.dir[1], msg.dir[2]).normalize();
      p.knockback(_v, 14, msg.dmg || 18);
      this.game.audio?.steelClash?.(p.pos);
    }
  }

  sendPvpHit(targetId, dir, dmg) {
    if (!this.connected || !this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({
      type: 'pvp-hit',
      room: this.roomCode,
      id: this.playerId,
      target: targetId,
      dir: [dir.x, dir.y, dir.z],
      dmg,
    }));
  }

  update(dt) {
    if (this.connected && this.ws && this.ws.readyState === 1 && this.game.started) {
      this.sendAcc += dt;
      if (this.sendAcc >= 0.05) {
        this.sendAcc = 0;
        const p = this.game.player;
        const att = p.hooks.find((h) => h.state === 'attached');
        this.ws.send(JSON.stringify({
          type: 'state',
          room: this.roomCode,
          id: this.playerId,
          callsign: this.callsign,
          p: [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2)],
          v: [+p.vel.x.toFixed(2), +p.vel.y.toFixed(2), +p.vel.z.toFixed(2)],
          q: [+p.quat.x.toFixed(3), +p.quat.y.toFixed(3), +p.quat.z.toFixed(3), +p.quat.w.toFixed(3)],
          h: att ? [+att.tip.x.toFixed(1), +att.tip.y.toFixed(1), +att.tip.z.toFixed(1)] : null,
          sl: p.slashT >= 0 ? +p.slashT.toFixed(2) : -1,
        }));
      }
    }

    const camPos = this.game.cam.camera.position;
    for (const [id, peer] of this.peers) {
      if (this.game.elapsed - peer.lastSeen > 12) {
        peer.model.dispose();
        peer.cable.hide();
        this.game.scene.remove(peer.cable.mesh);
        this.peers.delete(id);
        continue;
      }
      peer.pos.lerp(peer.targetPos, 1 - Math.exp(-14 * dt));
      peer.quat.slerp(peer.targetQuat, 1 - Math.exp(-14 * dt));
      peer.model.update(dt, peer.pos, peer.quat, {
        grounded: false,
        speed: peer.vel.length(),
        vel: peer.vel,
        hooked: peer.hooked,
        slashT: peer.slashT,
        fp: false,
        blade: 100,
        spears: 1,
      });
      if (peer.hooked) {
        const from = peer.model.gearPos(1, _v);
        for (let k = 0; k < peer.cablePts.length; k++) {
          peer.cablePts[k].lerpVectors(from, peer.hookTip, k / (peer.cablePts.length - 1));
        }
        peer.cable.set(peer.cablePts, camPos, 0.045, 0.85);
      } else {
        peer.cable.hide();
      }
    }
  }
}
