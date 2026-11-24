import * as THREE from 'three';
import { WALL_R, GAP_HALF } from './world.js';
import { formatKey } from './util.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();
const _proj = { x: 0, y: 0, z: 0 };

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'),
      cross: $('cross'),
      range: $('range'),
      hitmark: $('hitmark'),
      candL: $('cand-l'),
      candR: $('cand-r'),
      candLKey: $('cand-l-key'),
      candRKey: $('cand-r-key'),
      lock: $('lock'),
      locktxt: $('locktxt'),
      marks: $('marks'),
      pops: $('pops'),
      wave: $('wave'),
      obj: $('obj'),
      left: $('left'),
      tacbars: $('tacbars'),
      distWrap: $('dist-wrap'),
      distb: $('distb'),
      distBar: $('distb')?.parentElement,
      distpct: $('distpct'),
      engWrap: $('eng-wrap'),
      englbl: $('englbl'),
      engb: $('engb'),
      engBar: $('engb')?.parentElement,
      engpct: $('engpct'),
      radar: $('radar'),
      kills: $('kills').querySelector('b'),
      combo: $('combo'),
      hpb: $('hpb'),
      hpnum: $('hpnum'),
      viewbadge: $('viewbadge'),
      spearAlert: $('spear-alert'),
      spearKeyAlert: $('spear-key-alert'),
      spearhint: $('spearhint'),
      squadBox: $('squad-box'),
      sqRows: [$('sq0'), $('sq1'), $('sq2')],
      flareRow: $('flare-row'),
      flaretxt: $('flaretxt'),
      cmdKeyHud: $('cmd-key-hud'),
      gasPod: $('gas-pod'),
      gasb: $('gasb'),
      gasnum: $('gasnum'),
      gaspips: $('gaspips'),
      gasKeyHud: $('gas-key-hud'),
      bladePod: $('blade-pod'),
      bladeb: $('bladeb'),
      bladenum: $('bladenum'),
      bladepips: $('bladepips'),
      bladeKeyHud: $('blade-key-hud'),
      spearMini: $('spear-mini'),
      spearKeyHud: $('spear-key-hud'),
      spearcount: $('spearcount'),
      hl: $('hl'),
      hr: $('hr'),
      spd: $('spd'),
      fps: $('fps'),
      hmode: $('hmode'),
      spinbar: $('spinbar'),
      spinfill: $('spinbar')?.querySelector('i'),
      rebound: $('rebound'),
      radio: $('radio'),
      upgrades: $('upgrades'),
      upcards: $('upcards'),
      toast: $('toast'),
      struggle: $('struggle'),
      struggleKey: $('struggle-key'),
      strb: $('strb'),
      hurt: $('hurt'),
      help: $('help'),
      helpGrid: $('help-grid'),
      helpCloseHint: $('help-close-hint'),
      hk: document.querySelectorAll('#cross .hk'),
      depot: $('depotm'),
      threats: $('threats'),
      dmgdir: $('dmgdir'),
      objm: $('objm'),
      objtxt: $('objtxt'),
      killfeed: $('killfeed'),
      lockhp: $('lockhp'),
      lockarmor: $('lockarmor'),
    };
    this.rctx = this.el.radar.getContext('2d');
    this.marks = [];
    this.threatEls = [];
    this._prev = {};
    this.toastT = 0;
    this.hurtT = 0;
    this.comboT = 0;
    this.resT = 0;
    this.radioT = 0;
    this.hitmarkT = 0;
    this.syncBindHints();
  }

  syncBindHints() {
    const b = this.game.prefs?.binds || {};
    const k = (act) => formatKey(b[act]);
    const e = this.el;
    if (e.candLKey) e.candLKey.textContent = k('hookL');
    if (e.candRKey) e.candRKey.textContent = k('hookR');
    if (e.hl) e.hl.textContent = k('hookL');
    if (e.hr) e.hr.textContent = k('hookR');
    if (e.gasKeyHud) e.gasKeyHud.textContent = k('reloadGas');
    if (e.bladeKeyHud) e.bladeKeyHud.textContent = k('reloadBlade');
    if (e.spearKeyHud) e.spearKeyHud.textContent = k('spear');
    if (e.spearKeyAlert) e.spearKeyAlert.textContent = k('spear');
    if (e.cmdKeyHud) e.cmdKeyHud.textContent = k('command');
    if (e.struggleKey) e.struggleKey.textContent = k('reel');
    if (e.rebound) e.rebound.textContent = `${k('reel')} · WALL-KICK`;
    if (e.helpCloseHint) e.helpCloseHint.textContent = `[${k('help')}] Close`;

    const helpItems = [
      [`<kbd>${k('hookL')}</kbd><kbd>${k('hookR')}</kbd> / <kbd>RMB</kbd>`, 'Left / Right / Dual Hooks'],
      [`<kbd>${k('reel')}</kbd>`, 'Winch Reel / Jump / Wall-Kick'],
      [`<kbd>${k('boost')}</kbd>+<kbd>${k('forward')}${k('left')}${k('back')}${k('right')}</kbd>`, 'Momentum Boost & Steer'],
      [`<kbd>${k('back')}</kbd>+<kbd>${k('boost')}</kbd>`, 'Air Brake'],
      ['<kbd>LMB</kbd>', 'Slash / Hold for Spiral Slash'],
      [`<kbd>${k('spear')}</kbd>`, 'Fire / Detonate Thunder Spear'],
      [`<kbd>${k('command')}</kbd>`, 'Squad Order & Artillery'],
      [`<kbd>${k('reloadBlade')}</kbd> / <kbd>${k('reloadGas')}</kbd>`, 'Swap Blades / Gas Canister'],
      [`<kbd>${k('hookMode')}</kbd>`, 'Smart / Focus Grapple Mode'],
      [`<kbd>${k('viewToggle')}</kbd> / <kbd>${k('help')}</kbd>`, 'Camera View / Controls'],
    ];
    if (e.helpGrid) {
      e.helpGrid.innerHTML = helpItems.map(([keys, desc]) => `<div>${keys} ${desc}</div>`).join('');
    }
    const pauseBinds = $('pause-binds');
    if (pauseBinds) {
      pauseBinds.innerHTML = helpItems.slice(0, 8).map(([keys, desc]) => `<div>${keys} ${desc}</div>`).join('');
    }
  }

  setText(el, key, val) {
    if (el && this._prev[key] !== val) {
      this._prev[key] = val;
      el.textContent = val;
    }
  }

  show(v) { this.el.hud.classList.toggle('hidden', !v); }

  project(p, out = _proj) {
    _v.copy(p).project(this.game.cam.camera);
    out.x = (_v.x * 0.5 + 0.5) * innerWidth;
    out.y = (-_v.y * 0.5 + 0.5) * innerHeight;
    out.z = _v.z;
    return out;
  }

  pop(p, text, cls = '') {
    const o = this.project(p);
    if (o.z > 1) return;
    const d = document.createElement('div');
    d.className = 'p ' + cls;
    d.textContent = text;
    d.style.left = o.x + 'px';
    d.style.top = o.y + 'px';
    this.el.pops.appendChild(d);
    setTimeout(() => d.remove(), 1050);
  }

  hitmarker(kind = 'hit') {
    const hm = this.el.hitmark;
    hm.className = '';
    void hm.offsetWidth;
    hm.className = kind;
    this.hitmarkT = kind === 'kill' ? 0.3 : 0.16;
  }

  radio(msg, dur = 4.2) {
    this.el.radio.textContent = msg;
    this.el.radio.classList.remove('hidden');
    this.radioT = dur;
  }

  showUpgrades(choices) {
    if (!choices || !choices.length) {
      this.el.upgrades.classList.add('hidden');
      return;
    }
    this.el.upcards.innerHTML = choices
      .map((c, idx) => `<div class="up-card"><b>[${idx + 1}] ${c.title}</b><small>${c.desc}</small></div>`)
      .join('');
    this.el.upgrades.classList.remove('hidden');
  }

  killFeed(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    this.el.killfeed.prepend(d);
    while (this.el.killfeed.children.length > 3) this.el.killfeed.lastChild.remove();
    setTimeout(() => d.remove(), 4300);
  }

  damageFrom(src) {
    const cam = this.game.cam, p = this.game.player.pos;
    const dx = src.x - p.x, dz = src.z - p.z;
    const ang = Math.atan2(dx * cam.rightFlat.x + dz * cam.rightFlat.z, dx * cam.forwardFlat.x + dz * cam.forwardFlat.z);
    const d = document.createElement('div');
    d.className = 'd';
    d.style.transform = `rotate(${ang}rad)`;
    d.innerHTML = '<i></i>';
    this.el.dmgdir.appendChild(d);
    setTimeout(() => d.remove(), 1050);
  }

  updateThreats() {
    const g = this.game, p = g.player, e = this.el;
    let n = 0;
    if (!p.dead) {
      for (let i = 0; i < g.titans.length; i++) {
        const t = g.titans[i];
        const th = t.threatInfo();
        if (!th) continue;
        const d = t.root.position.distanceTo(p.pos);
        const range = th.kind === 'throw' ? 160 : th.kind === 'slam' ? 9 * t.s + 10 : th.kind === 'leap' ? 42 : 5.5 * t.s + 8;
        if (d > range) continue;
        let el = this.threatEls[n];
        if (!el) {
          el = document.createElement('div');
          el.innerHTML = '<i></i><span></span>';
          e.threats.appendChild(el);
          this.threatEls.push(el);
        }
        n++;
        const hot = th.active || th.windup > 0.72;
        const label = { swipe: 'SWIPE!', slam: 'GROUND SLAM!', throw: 'BOULDER!', grab: 'GRAB!', lunge: 'CHARGE!', leap: 'LEAP!' }[th.kind] || 'INCOMING!';
        _v.copy(t.nape.c).project(g.cam.camera);
        const behind = _v.z > 1;
        let x = _v.x, y = _v.y;
        if (behind) { x = -x; y = -y; }
        if (!behind && Math.abs(x) < 0.88 && Math.abs(y) < 0.82) {
          el.className = 'th' + (hot ? ' hot' : '');
          el.style.left = (x * 0.5 + 0.5) * innerWidth + 'px';
          el.style.top = (-y * 0.5 + 0.5) * innerHeight + 'px';
          el.style.transform = '';
          el.firstChild.style.transform = `scale(${1.8 - th.windup * 0.85})`;
        } else {
          const a = Math.atan2(y, x), k = 0.86 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)) * 1.1);
          el.className = 'edge' + (hot ? ' hot' : '');
          el.style.left = (Math.cos(a) * k * 0.5 + 0.5) * innerWidth + 'px';
          el.style.top = (-Math.sin(a) * k * 0.5 + 0.5) * innerHeight + 'px';
          el.style.transform = `rotate(${-a + Math.PI / 4}rad)`;
          el.firstChild.style.transform = '';
        }
        el.lastChild.textContent = label;
        el.style.display = 'block';
      }
    }
    for (let i = n; i < this.threatEls.length; i++) this.threatEls[i].style.display = 'none';
  }

  updateObjective() {
    const g = this.game, eng = g.engineers, e = this.el, p = g.player;
    const show = eng.activeConvoy && !p.dead;
    e.objm.classList.toggle('hidden', !show);
    if (!show) return;
    _v.copy(eng.convoyPos).setY(5.5);
    const dist = Math.round(_v.distanceTo(p.pos));
    if (dist < 14) { e.objm.classList.add('hidden'); return; }
    _v.project(g.cam.camera);
    let x = _v.x, y = _v.y;
    if (_v.z > 1) { x = -x; y = -y; if (Math.abs(x) < 0.9 && Math.abs(y) < 0.82) y = -0.82; }
    const k = Math.max(1, Math.abs(x) / 0.88, Math.abs(y) / 0.78);
    let sx = ((x / k) * 0.5 + 0.5) * innerWidth;
    const sy = Math.min(innerHeight - 108, Math.max(96, (-(y / k) * 0.5 + 0.5) * innerHeight));
    if (sy > innerHeight - 150 && Math.abs(sx - innerWidth / 2) < 250) sx = innerWidth / 2 + (sx < innerWidth / 2 ? -250 : 250);
    e.objm.style.left = sx + 'px';
    e.objm.style.top = sy + 'px';
    e.objm.classList.toggle('alert', eng.pinned);
    this.setText(e.objtxt, 'objtxt', (eng.pinned ? 'CONVOY PINNED ' : 'CONVOY ') + dist + 'm');
  }

  toast(text, dur = 1.6) {
    this.el.toast.innerHTML = text;
    this.el.toast.style.opacity = 1;
    this.toastT = dur;
  }

  flash(kind) {
    const b = this.game.prefs?.binds || {};
    const map = {
      'no-anchor': 'No anchor surface in range',
      blades: `Blades shattered! Press [${formatKey(b.reloadBlade)}] to swap`,
      swap: '',
      lowgas: 'LOW GAS PRESSURE',
    };
    if (map[kind]) this.toast(`<span style="font-size:18px">${map[kind]}</span>`, 0.9);
  }

  resupply(name) {
    if (this.resT <= 0) this.toast(`<span style="font-size:18px;color:#9effc4">RESUPPLIED — ${name}</span>`, 0.8);
    this.resT = 0.7;
  }

  hurt(d) { this.hurtT = Math.min(1, this.hurtT + d / 35 + 0.18); }

  combo(n) {
    if (n >= 2) {
      this.el.combo.textContent = `${n}× STREAK`;
      this.el.combo.style.opacity = 1;
      this.comboT = 3.2;
    }
  }

  reset() {
    this.toastT = 0; this.hurtT = 0; this.comboT = 0; this.resT = 0; this.radioT = 0; this.hitmarkT = 0;
    this._prev = {};
    const e = this.el;
    e.toast.style.opacity = 0; e.toast.innerHTML = '';
    e.hurt.style.opacity = 0;
    e.combo.style.opacity = 0; e.combo.textContent = '';
    e.hitmark.className = '';
    e.lock.style.display = 'none';
    e.candL.classList.add('hidden');
    e.candR.classList.add('hidden');
    e.depot.classList.add('hidden');
    e.radio.classList.add('hidden');
    e.upgrades.classList.add('hidden');
    e.struggle.classList.add('hidden');
    e.help.classList.add('hidden');
    if (e.spearAlert) e.spearAlert.classList.add('hidden');
    if (e.rebound) e.rebound.classList.add('hidden');
    if (e.spinbar) e.spinbar.classList.remove('on');
    e.pops.innerHTML = '';
    e.killfeed.innerHTML = '';
    e.dmgdir.innerHTML = '';
    for (const t of this.threatEls) t.style.display = 'none';
    e.objm.classList.add('hidden');
    for (const m of this.marks) m.style.display = 'none';
  }

  drawRadar() {
    const g = this.game, p = g.player, eng = g.engineers, sq = g.squad;
    const ctx = this.rctx;
    const W = 128, C = W / 2, scale = (C - 9) / 270;
    ctx.clearRect(0, 0, W, W);
    const yaw = g.cam.yaw;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const toR = (wx, wz) => {
      const dx = wx - p.pos.x, dz = wz - p.pos.z;
      const rx = -(dx * cos - dz * sin) * scale;
      const ry = -(dx * sin + dz * cos) * scale;
      const r = Math.hypot(rx, ry);
      if (r > C - 7) {
        const k = (C - 7) / r;
        return [C + rx * k, C + ry * k, true];
      }
      return [C + rx, C + ry, false];
    };

    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(C, C, (C - 9) * 0.5, 0, Math.PI * 2); ctx.stroke();

    ctx.fillStyle = 'rgba(255,235,190,0.08)';
    ctx.beginPath();
    ctx.moveTo(C, C);
    ctx.arc(C, C, C - 7, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(210,185,135,0.4)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= 48; i++) {
      const a = GAP_HALF + ((Math.PI * 2 - GAP_HALF * 2) * i) / 48;
      const [sx, sy, clipped] = toR(Math.sin(a) * WALL_R, Math.cos(a) * WALL_R);
      if (clipped) { started = false; continue; }
      if (!started) { ctx.moveTo(sx, sy); started = true; }
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    for (let i = 0; i < g.world.depots.length; i++) {
      const d = g.world.depots[i];
      const [sx, sy] = toR(d.pos.x, d.pos.z);
      ctx.fillStyle = '#5dffaa';
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-2.6, -2.6, 5.2, 5.2);
      ctx.restore();
    }

    if (eng?.mode === 'training') {
      for (let i = 0; i < eng.rings.length; i++) {
        const r = eng.rings[i];
        if (r.cleared) continue;
        const [sx, sy] = toR(r.pos.x, r.pos.z);
        ctx.strokeStyle = '#5be4ff';
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(sx, sy, 2.8, 0, Math.PI * 2); ctx.stroke();
      }
    } else if (eng?.wagon.visible) {
      const [sx, sy] = toR(eng.convoyPos.x, eng.convoyPos.z);
      ctx.fillStyle = eng.pinned ? '#ff4d3a' : '#ffd97a';
      ctx.fillRect(sx - 3.5, sy - 3.5, 7, 7);
    }

    if (sq) {
      for (let i = 0; i < sq.members.length; i++) {
        const m = sq.members[i];
        if (!m.model.root.visible) continue;
        const [sx, sy] = toR(m.pos.x, m.pos.z);
        ctx.fillStyle = '#70d6ff';
        ctx.beginPath(); ctx.arc(sx, sy, 2.2, 0, Math.PI * 2); ctx.fill();
      }
    }

    for (let i = 0; i < g.titans.length; i++) {
      const t = g.titans[i];
      if (!t.alive) continue;
      const [sx, sy] = toR(t.root.position.x, t.root.position.z);
      if (t.type === 'armored') {
        ctx.fillStyle = '#ffe07d';
        ctx.beginPath(); ctx.arc(sx, sy, 4.4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ff3b20';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      } else {
        ctx.fillStyle = t.type === 'abnormal' || t.type === 'crawler' ? '#ff9f38' : t.type === 'tank' ? '#d96bff' : '#ff4c38';
        ctx.beginPath(); ctx.arc(sx, sy, t.type === 'tank' ? 3.8 : 2.8, 0, Math.PI * 2); ctx.fill();
      }
    }

    for (let i = 0; i < g.boulders.length; i++) {
      const b = g.boulders[i];
      const [sx, sy] = toR(b.m.position.x, b.m.position.z);
      ctx.fillStyle = '#ffb347';
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(g.elapsed * 4);
      ctx.fillRect(-2, -2, 4, 4);
      ctx.restore();
    }

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(C, C - 4.5);
    ctx.lineTo(C + 3.5, C + 3.5);
    ctx.lineTo(C, C + 1.5);
    ctx.lineTo(C - 3.5, C + 3.5);
    ctx.closePath();
    ctx.fill();
  }

  update(dt) {
    const g = this.game, p = g.player, eng = g.engineers, sq = g.squad, e = this.el;
    const b = g.prefs?.binds || {};
    if (e.fps && !e.fps.classList.contains('hidden')) {
      this.fpsAcc = (this.fpsAcc || 0) + dt;
      this.fpsN = (this.fpsN || 0) + 1;
      if (this.fpsAcc >= 0.3) {
        e.fps.textContent = Math.round(this.fpsN / this.fpsAcc) + ' FPS';
        this.fpsAcc = 0; this.fpsN = 0;
      }
    }

    const hpInt = Math.max(0, Math.round(p.hp));
    e.hpb.style.width = hpInt + '%';
    this.setText(e.hpnum, 'hpnum', String(hpInt));
    this.setText(e.viewbadge, 'vbadge', g.cam.fp ? '1ST' : '3RD');

    e.gasb.style.width = Math.max(0, Math.round(p.gas)) + '%';
    e.bladeb.style.width = Math.max(0, Math.round(p.blade)) + '%';
    this.setText(e.gasnum, 'gasnum', p.gasReload > 0 ? p.gasReload.toFixed(1) + 's' : String(Math.round(p.gas)));
    this.setText(e.bladenum, 'bladenum', String(Math.round(p.blade)));
    for (let i = 0; i < 6; i++) e.gaspips.children[i].classList.toggle('on', i < p.gasCylinders);
    for (let i = 0; i < 8; i++) e.bladepips.children[i].classList.toggle('on', i < p.bladeSets);
    e.gasPod.classList.toggle('low', p.gas < 20);
    e.bladePod.classList.toggle('low', p.blade < 22);
    this.setText(e.spd, 'spd', String(Math.round(p.speed)));

    const maxSp = p.maxSpears;
    this.setText(e.spearcount, 'spcnt', `${p.spears}/${maxSp}`);
    const activeShot = p.spearShots.some((s) => s.fuse > 0 || s.age > 0.14);
    e.spearMini.classList.toggle('active', activeShot);
    e.spearAlert.classList.toggle('hidden', !activeShot);
    if (activeShot) {
      this.setText(e.spearhint, 'sphint', 'DETONATE THUNDER SPEAR!');
    }

    if (sq) {
      const cd = sq.cmdCD;
      const hasTgt = !!(p.lock || p.aim?.collider?.owner?.alive);
      e.flareRow.classList.toggle('cd', cd > 0);
      e.flareRow.classList.toggle('attack', cd <= 0 && hasTgt);
      this.setText(
        e.flaretxt,
        'flare',
        cd > 0
          ? `ORDER READY (${Math.ceil(cd)}s)`
          : hasTgt
            ? 'FOCUS FIRE & ARTILLERY'
            : 'RALLY & RESUPPLY',
      );
      for (let i = 0; i < 3; i++) {
        const m = sq.members[i];
        const rowEl = e.sqRows[i];
        if (m && rowEl) {
          this.setText(rowEl, 'sq' + i, m.status);
          rowEl.classList.toggle('atk', m.status === 'FOCUS FIRE' || m.status === 'ENGAGING' || m.status === 'RESCUING' || m.status === 'FLANKING');
        }
      }
    }

    if (eng) {
      const showTac = g.mode !== 'training' && g.story.allowWaves();
      e.tacbars.classList.toggle('hidden', !showTac);
      if (showTac) {
        const dp = Math.round(eng.districtHP);
        e.distb.style.width = dp + '%';
        e.distBar.classList.toggle('warn', dp < 45);
        this.setText(e.distpct, 'dpct', dp + '%');
        e.engWrap.classList.toggle('hidden', g.mode !== 'campaign');
        if (g.mode === 'campaign') {
          const atGate = eng.convoyPos.z >= eng.convoyTargetZ - 1;
          this.setText(e.englbl, 'elbl', eng.pinned ? 'PINNED' : atGate ? 'SEALING' : 'CONVOY');
          const pct = atGate ? Math.round(eng.sealProgress * 100) : Math.round(((eng.convoyPos.z - 52) / (eng.convoyTargetZ - 52)) * 100);
          e.engb.style.width = pct + '%';
          e.engBar.classList.toggle('pinned', eng.pinned);
          this.setText(e.engpct, 'epct', pct + '%');
        }
      }
    }

    const focus = p.hookMode === 'focus';
    this.setText(e.hmode, 'hmode', `${focus ? 'FOCUS' : 'SMART'} [${formatKey(b.hookMode)}]`);
    e.hmode.classList.toggle('focus', focus);
    e.hmode.classList.toggle('auto', !focus);

    if (e.spinbar && e.spinfill) {
      const ch = Math.min(1, p.charge || 0);
      const showSpin = ch > 0.05 && !p.grounded && !p.dead;
      e.spinbar.classList.toggle('on', showSpin);
      e.spinbar.classList.toggle('ready', ch >= 0.4);
      if (showSpin) e.spinfill.style.width = ch * 100 + '%';
    }
    if (e.rebound) e.rebound.classList.toggle('hidden', !((p.impactT || 0) > 0 && !p.dead));

    for (let i = 0; i < 2; i++) {
      const h = p.hooks[i];
      const on = h.state === 'fly' || h.state === 'attached';
      (i ? e.hr : e.hl).classList.toggle('on', on);
      e.hk[i].classList.toggle('on', on);
      const cEl = i === 0 ? e.candL : e.candR;
      const cand = p.cand[i];
      if (!on && cand.ok && !p.dead && !focus) {
        const o = this.project(cand.point);
        if (o.z < 1 && o.x > 24 && o.x < innerWidth - 24 && o.y > 24 && o.y < innerHeight - 24) {
          cEl.classList.remove('hidden');
          cEl.classList.toggle('flesh', cand.surface === 'flesh' || !!cand.collider?.owner);
          cEl.style.left = o.x + 'px';
          cEl.style.top = o.y + 'px';
        } else cEl.classList.add('hidden');
      } else cEl.classList.add('hidden');
    }

    const aim = p.aim;
    e.cross.classList.toggle('ok', !!aim);
    e.cross.classList.toggle('flesh', !!(aim && aim.collider && aim.collider.owner));
    this.setText(e.range, 'range', aim ? Math.round(aim.t) + 'm' : '');

    if (this.hitmarkT > 0) {
      this.hitmarkT -= dt;
      if (this.hitmarkT <= 0) e.hitmark.className = '';
    }

    if (p.lock) {
      const o = this.project(p.lock.nape.c);
      if (o.z < 1) {
        e.lock.style.display = 'block';
        e.lock.style.left = o.x + 'px';
        e.lock.style.top = o.y + 'px';
        const armored = p.lock.armor > 0;
        e.lock.classList.toggle('armored', armored);
        e.lockhp.style.width = Math.max(0, (p.lock.hp / p.lock.napeHP) * 100) + '%';
        e.lockarmor.style.width = p.lock.maxArmor ? (p.lock.armor / p.lock.maxArmor) * 100 + '%' : '0';
        e.lock.classList.toggle('exec', !armored && p.canExecute);
        this.setText(
          e.locktxt,
          'locktxt',
          armored ? `ARMOR [${formatKey(b.spear)}]` : p.canExecute ? '[LMB] EXECUTE!' : 'NAPE',
        );
      } else e.lock.style.display = 'none';
    } else e.lock.style.display = 'none';

    let aliveCount = 0;
    for (let i = 0; i < g.titans.length; i++) if (g.titans[i].alive) aliveCount++;
    while (this.marks.length < aliveCount) {
      const d = document.createElement('div');
      d.className = 'm';
      d.innerHTML = '<i></i>';
      e.marks.appendChild(d);
      this.marks.push(d);
    }
    let mIdx = 0;
    for (let i = 0; i < g.titans.length; i++) {
      const t = g.titans[i];
      if (!t.alive) continue;
      const m = this.marks[mIdx++];
      _v.copy(t.nape.c).project(g.cam.camera);
      const behind = _v.z > 1;
      let x = _v.x, y = _v.y;
      if (behind) { x = -x; y = -y; }
      const off = behind || Math.abs(x) > 0.94 || Math.abs(y) > 0.88;
      if (!off) { m.style.display = 'none'; continue; }
      const a = Math.atan2(y, x), k = 0.88 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)) * 1.1);
      const sx = (Math.cos(a) * k * 0.5 + 0.5) * innerWidth;
      const sy = Math.max(165, Math.min(innerHeight - 105, (-Math.sin(a) * k * 0.5 + 0.5) * innerHeight));
      m.className = 'm' + (t.type === 'armored' ? ' boss' : t.type === 'abnormal' || t.type === 'crawler' ? ' abn' : '');
      m.style.display = 'block';
      m.style.left = sx + 'px';
      m.style.top = sy + 'px';
      m.style.transform = `rotate(${-a + Math.PI / 4}rad)`;
    }
    for (let i = mIdx; i < this.marks.length; i++) this.marks[i].style.display = 'none';

    const nd = p.gas < 28 && !p.dead ? g.world.nearestDepot(p.pos) : null;
    e.depot.classList.toggle('hidden', !nd || !nd.depot || nd.dist < 8);
    if (nd && nd.depot && nd.dist >= 8) {
      _v.copy(nd.depot.pos).project(g.cam.camera);
      let x = _v.x, y = _v.y;
      if (_v.z > 1) { x = -x; y = -y; if (Math.abs(x) < 0.9 && Math.abs(y) < 0.82) y = -0.82; }
      const k = Math.max(1, Math.abs(x) / 0.88, Math.abs(y) / 0.78);
      let sx = ((x / k) * 0.5 + 0.5) * innerWidth;
      const sy = Math.min(innerHeight - 108, Math.max(96, (-(y / k) * 0.5 + 0.5) * innerHeight));
      if (sy > innerHeight - 150 && Math.abs(sx - innerWidth / 2) < 240) sx = innerWidth / 2 + (sx < innerWidth / 2 ? -240 : 240);
      e.depot.style.left = sx + 'px';
      e.depot.style.top = sy + 'px';
      this.setText(e.depot.lastChild, 'depot', 'DEPOT ' + Math.round(nd.dist) + 'm');
    }

    this.setText(e.left, 'left', g.mode === 'training' ? `RINGS ${eng?.ringsCleared || 0}/8` : aliveCount ? `${aliveCount} TITANS ACTIVE` : '');
    this.setText(e.kills, 'kills', String(g.kills));
    e.struggle.classList.toggle('hidden', !p.grabbedBy);
    if (p.grabbedBy) e.strb.style.width = Math.min(100, p.struggle * 100) + '%';

    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) e.toast.style.opacity = 0; }
    if (this.radioT > 0) { this.radioT -= dt; if (this.radioT <= 0) e.radio.classList.add('hidden'); }
    this.resT -= dt;
    this.hurtT = Math.max(0, this.hurtT - dt * 0.85);
    e.hurt.style.opacity = Math.max(this.hurtT, p.hp < 30 ? 0.32 + Math.sin(g.elapsed * 6) * 0.14 : 0);
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) e.combo.style.opacity = 0; }

    this.updateThreats();
    this.updateObjective();
    this.drawRadar();
  }
}
