import * as THREE from 'three';
const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = { hud: $('hud'), cross: $('cross'), range: $('range'), lock: $('lock'), marks: $('marks'), pops: $('pops'), wave: $('wave'), obj: $('obj'), left: $('left'),
      kills: $('kills').querySelector('b'), combo: $('combo'), hpb: $('hpb'), gasb: $('gasb'), bladeb: $('bladeb'), sets: $('sets'), hl: $('hl'), hr: $('hr'), spd: $('spd'),
      gear: $('gear'), toast: $('toast'), struggle: $('struggle'), strb: $('strb'), hurt: $('hurt'), help: $('help'), hk: document.querySelectorAll('#cross .hk'), depot: $('depotm') };
    this.marks = [];
    this.toastT = 0; this.hurtT = 0; this.comboT = 0; this.resT = 0;
  }
  show(v) { this.el.hud.classList.toggle('hidden', !v); }
  project(p, out) {
    _v.copy(p).project(this.game.cam.camera);
    out.x = (_v.x * 0.5 + 0.5) * innerWidth; out.y = (-_v.y * 0.5 + 0.5) * innerHeight; out.z = _v.z;
    return out;
  }
  pop(p, text, cls = '') {
    const o = this.project(p, {});
    if (o.z > 1) return;
    const d = document.createElement('div');
    d.className = 'p ' + cls; d.textContent = text;
    d.style.left = o.x + 'px'; d.style.top = o.y + 'px';
    this.el.pops.appendChild(d);
    setTimeout(() => d.remove(), 1150);
  }
  toast(text, dur = 1.6) { this.el.toast.innerHTML = text; this.el.toast.style.opacity = 1; this.toastT = dur; }
  flash(kind) {
    const map = { 'no-anchor': 'Tidak ada titik kait', blades: 'Pedang tumpul! [R] ganti', swap: '', 'lowgas': 'GAS HAMPIR HABIS' };
    if (map[kind]) this.toast(`<span style="font-size:20px">${map[kind]}</span>`, 0.9);
  }
  resupply(name) { if (this.resT <= 0) this.toast(`<span style="font-size:20px;color:#9effc4">RESUPPLY — ${name}</span>`, 0.8); this.resT = 0.6; }
  hurt(d) { this.hurtT = Math.min(1, this.hurtT + d / 35 + 0.2); }
  combo(n) { if (n >= 2) { this.el.combo.textContent = `${n}× COMBO`; this.el.combo.style.opacity = 1; this.comboT = 3; } }
  update(dt) {
    const g = this.game, p = g.player, e = this.el;
    e.hpb.style.width = p.hp + '%'; e.gasb.style.width = p.gas + '%'; e.bladeb.style.width = p.blade + '%';
    e.sets.textContent = '×' + p.bladeSets;
    e.gear.classList.toggle('lowgas', p.gas < 20);
    e.spd.textContent = Math.round(p.speed);
    for (let i = 0; i < 2; i++) {
      const on = p.hooks[i].state === 'fly' || p.hooks[i].state === 'attached';
      (i ? e.hr : e.hl).classList.toggle('on', on); e.hk[i].classList.toggle('on', on);
    }
    const aim = p.aim;
    e.cross.classList.toggle('ok', !!aim);
    e.cross.classList.toggle('flesh', !!(aim && aim.collider && aim.collider.owner));
    e.range.textContent = aim ? Math.round(aim.t) + 'm' : '';
    // nape lock
    if (p.lock) {
      const o = this.project(p.lock.nape.c, {});
      if (o.z < 1) { e.lock.style.display = 'block'; e.lock.style.left = o.x + 'px'; e.lock.style.top = o.y + 'px'; } else e.lock.style.display = 'none';
    } else e.lock.style.display = 'none';
    // off-screen titan markers
    const alive = g.titans.filter((t) => t.alive);
    while (this.marks.length < alive.length) { const d = document.createElement('div'); d.className = 'm'; d.innerHTML = '<i></i>'; e.marks.appendChild(d); this.marks.push(d); }
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i];
      if (i >= alive.length) { m.style.display = 'none'; continue; }
      _v.copy(alive[i].nape.c).project(g.cam.camera);
      const behind = _v.z > 1;
      let x = _v.x, y = _v.y;
      if (behind) { x = -x; y = -y; }
      const off = behind || Math.abs(x) > 0.95 || Math.abs(y) > 0.9;
      if (!off) { m.style.display = 'none'; continue; }
      const a = Math.atan2(y, x), k = 0.9 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)) * 1.1);
      const sx = (Math.cos(a) * k * 0.5 + 0.5) * innerWidth, sy = (-Math.sin(a) * k * 0.5 + 0.5) * innerHeight;
      // keep edge arrows off the gear panel in the bottom-left corner
      const panel = e.gear.getBoundingClientRect();
      const ty = sx < panel.right + 12 && sy > panel.top - 12 ? panel.top - 12 : sy;
      m.style.display = 'block'; m.style.left = sx + 'px'; m.style.top = ty + 'px';
      m.style.transform = `rotate(${-a + Math.PI / 4}rad)`;
    }
    // low gas: beacon on the nearest depot, clamped to the screen edge when off-screen
    const nd = p.gas < 25 && !p.dead ? g.world.nearestDepot(p.pos) : null;
    e.depot.classList.toggle('hidden', !nd || !nd.depot || nd.dist < 8);
    if (nd && nd.depot && nd.dist >= 8) {
      _v.copy(nd.depot.pos).project(g.cam.camera);
      let x = _v.x, y = _v.y;
      if (_v.z > 1) { x = -x; y = -y; if (Math.abs(x) < 0.9 && Math.abs(y) < 0.85) y = -0.85; }
      const k = Math.max(1, Math.abs(x) / 0.9, Math.abs(y) / 0.85);
      e.depot.style.left = ((x / k) * 0.5 + 0.5) * innerWidth + 'px'; e.depot.style.top = (-(y / k) * 0.5 + 0.5) * innerHeight + 'px';
      e.depot.lastChild.textContent = 'DEPOT ' + Math.round(nd.dist) + 'm';
    }
    e.left.textContent = alive.length ? `${alive.length} TITAN TERSISA` : '';
    e.kills.textContent = g.kills;
    e.struggle.classList.toggle('hidden', !p.grabbedBy);
    if (p.grabbedBy) e.strb.style.width = Math.min(100, p.struggle * 100) + '%';
    this.toastT -= dt; if (this.toastT <= 0) e.toast.style.opacity = 0;
    this.resT -= dt;
    this.hurtT = Math.max(0, this.hurtT - dt * 0.8); e.hurt.style.opacity = Math.max(this.hurtT, p.hp < 30 ? 0.35 + Math.sin(performance.now() * 0.006) * 0.15 : 0);
    this.comboT -= dt; if (this.comboT <= 0) e.combo.style.opacity = 0;
  }
}
