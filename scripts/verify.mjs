import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 5199 + (process.pid % 100);
const CDP = 9310 + (process.pid % 400);
const CHROME = process.env.CHROME || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/home/ubuntu/.local/bin/google-chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find(existsSync);
const shotDir = process.env.SHOTS || '';
if (shotDir) mkdirSync(shotDir, { recursive: true });

const vite = spawn('node_modules/.bin/vite', ['--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  vite.stdout.on('data', (d) => d.toString().includes(String(PORT)) && resolve());
  vite.on('exit', (c) => reject(new Error('vite exited ' + c)));
});
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=/tmp/wos-verify-${Date.now()}`,
  '--window-size=1440,900', '--enable-webgl', '--ignore-gpu-blocklist', '--no-first-run', `http://localhost:${PORT}/`,
], { stdio: 'ignore' });
const shutdown = (code) => { try { chrome.kill('SIGKILL'); } catch {} try { vite.kill('SIGKILL'); } catch {} process.exit(code); };
process.on('uncaughtException', (err) => { console.error(err); shutdown(1); });
process.on('unhandledRejection', (err) => { console.error(err); shutdown(1); });

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
    wsUrl = list.find((x) => x.type === 'page' && x.url.includes(String(PORT)))?.webSocketDebuggerUrl;
  } catch {}
  if (!wsUrl) await sleep(200);
}
if (!wsUrl) { console.error('Chrome did not start'); shutdown(1); }

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
const pageErrors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') pageErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
});
const cdp = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const run = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.error) throw new Error('CDP error: ' + JSON.stringify(r.error));
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
  if (r.result?.result?.type === 'object' && r.result?.result?.value === undefined) throw new Error('Unserializable object: ' + JSON.stringify(r.result.result));
  return r.result?.result?.value;
};
const snap = async (name) => {
  if (!shotDir) return;
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(r.result.data, 'base64'));
};

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
for (let i = 0; i < 50; i++) { if (await run('!!window.game')) break; await sleep(200); }
if (!(await run('!!window.game'))) {
  console.error('window.game never initialized; errors:', pageErrors);
  shutdown(1);
}

await run(`(() => {
  const g = window.game;
  g.frozen = true;
  const gl = g.renderer.getContext();
  const px = new Uint8Array(4);
  window.__lum = () => {
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    let sum = 0, black = 0;
    for (let iy = 0; iy < 9; iy++) for (let ix = 0; ix < 16; ix++) {
      gl.readPixels(Math.floor((ix + 0.5) * W / 16), Math.floor((iy + 0.5) * H / 9), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const l = (0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]) / 255;
      sum += l; if (l < 0.01) black++;
    }
    return { avg: sum / 144, black: black / 144 };
  };
  window.__frames = (n, each) => {
    let minAvg = 9, maxBlack = 0, minTs = 1;
    for (let f = 0; f < n; f++) {
      if (each) each(f);
      g.step(1 / 60); g.post.render(g.elapsed); g.input.endFrame();
      const s = window.__lum();
      minAvg = Math.min(minAvg, s.avg); maxBlack = Math.max(maxBlack, s.black); minTs = Math.min(minTs, g.timeScale);
    }
    return { minAvg: +minAvg.toFixed(3), maxBlack, minTs: +minTs.toFixed(3) };
  };
  window.__fresh = (mode = 'campaign', fp = true) => {
    g.mode = mode; g.restart(); g.locked = true; g.syncPause(); g.cam.fp = fp;
  };
  window.__titan = (type, z, h) => {
    const t = new g.TitanClass(g, new THREE.Vector3(0, 0, z), { type, height: h, instant: true });
    t.heading = 0; t.root.rotation.y = 0; t.update(0.016); g.titans.push(t); return t;
  };
})()`);

const cases = {
  'kill 3rd person': `__fresh('campaign', false); const t = __titan('normal', 60, 14); g.player.pos.copy(t.nape.c).add(new THREE.Vector3(0, 0.4, -6)); g.player.vel.set(0, 0, 30); g.cam.yaw = 0; g.cam.pitch = -0.05; g.step(1/60); g.input.mouse.l = true; g.input.mouse.lPressed = true; return { ...__frames(45), kills: g.kills };`,
  'kill 1st person': `__fresh('campaign', true); const t = __titan('normal', 60, 14); g.player.pos.copy(t.nape.c).add(new THREE.Vector3(0, 0.4, -6)); g.player.vel.set(0, 0, 30); g.cam.yaw = 0; g.cam.pitch = -0.05; g.step(1/60); g.input.mouse.l = true; g.input.mouse.lPressed = true; return { ...__frames(45), kills: g.kills };`,
  'limb cut': `__fresh(); const t = __titan('tank', 60, 18); const a = t.parts.find(p => p.part === 'arm'); g.player.pos.copy(a.a).add(new THREE.Vector3(0, 0, -1.2)); g.input.mouse.l = true; g.input.mouse.lPressed = true; return __frames(30);`,
  'armor + spear blast': `__fresh(); const t = __titan('armored', 60, 20); g.player.pos.copy(t.nape.c).add(new THREE.Vector3(0, 1, -9)); g.explode(t.nape.c.clone()); return __frames(30);`,
  'gunslinger shot': `__fresh(); g.player.applyClass('gunslinger', true); const t = __titan('normal', 60, 14); g.player.pos.copy(t.nape.c).add(new THREE.Vector3(0, 0.2, -16)); g.cam.yaw = 0; g.cam.pitch = 0; g.step(1/60); g.input.mouse.l = true; g.input.mouse.lPressed = true; const r = __frames(18); return { ...r, ammo: g.player.pistols.ammo };`,
  'parkour roll': `__fresh(); g.player.pos.set(0, 5, 22); g.player.vel.set(0, -32, 8); g.input.keys.add('ControlLeft'); const r = __frames(20); g.input.keys.clear(); return { ...r, hp: Math.round(g.player.hp), rolled: g.player.parkour.rollAnimT > 0 };`,
  'warhammer spikes': `__fresh(); const t = __titan('warhammer', 55, 20); g.shifters.castWarhammerSpikes(t, g.player.pos.clone().add(new THREE.Vector3(12, 0, 12))); const r = __frames(25); return { ...r, spikes: g.shifters.spikes.length };`,
  'hard landing': `__fresh(); g.player.pos.set(0, 4, 22); g.player.vel.set(0, -32, 5); const r = __frames(20); return { ...r, hp: Math.round(g.player.hp), dead: g.player.dead };`,
  'particle fuzz': `__fresh(); const pt = g.player.pos.clone().add(new THREE.Vector3(0, 0, 4)); g.vfx.flash(pt, 5, 0xffaa33); g.vfx.flash(pt, 5, '#44ccff'); g.vfx.add.spawn(pt, { x: NaN, y: Infinity, z: 0 }, { color: NaN, size0: NaN, alpha: NaN, life: NaN }); return __frames(15);`,
};

let failed = false;
for (const [name, body] of Object.entries(cases)) {
  const r = await run(`(() => { const g = window.game; ${body} })()`);
  let ok = r.maxBlack < 0.05 && r.minAvg > 0.25 && (!('kills' in r) || r.kills >= 1);
  if (name === 'hard landing') ok &&= r.hp < 100 && r.hp > 50 && !r.dead;
  if (name === 'gunslinger shot') ok &&= r.ammo < 12;
  if (name === 'parkour roll') ok &&= r.hp === 100 && r.rolled;
  if (name === 'warhammer spikes') ok &&= r.spikes >= 4;
  failed ||= !ok;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name.padEnd(20)} minLum=${r.minAvg} black=${r.maxBlack} minTimeScale=${r.minTs}${'kills' in r ? ' kills=' + r.kills : ''}${'hp' in r ? ' hp=' + r.hp : ''}`);
}

const sys = await run(`(() => {
  const g = window.game;
  __fresh();
  let minConvoy = 1e9;
  for (let w = 0; w < 3; w++) { g.spawnWave(); for (const t of g.titans) minConvoy = Math.min(minConvoy, t.root.position.distanceTo(g.engineers.convoyPos)); }

  __fresh();
  g.player.pos.set(0, 35, 0); g.player.vel.set(0, 0, 0); g.cam.yaw = 0; g.cam.pitch = 0;
  g.input.keys.add('ShiftLeft'); g.input.keys.add('KeyW');
  for (let i = 0; i < 30; i++) g.step(1/60);
  const idleBoostSpd = Math.hypot(g.player.vel.x, g.player.vel.z);
  g.input.keys.clear();

  __fresh();
  g.player.pos.set(0, 35, 0); g.player.vel.set(0, 0, 28); g.cam.yaw = Math.PI / 2; g.cam.pitch = 0;
  g.input.keys.add('ShiftLeft'); g.input.keys.add('KeyW');
  for (let i = 0; i < 32; i++) g.step(1/60);
  g.input.keys.clear();
  const turn = Math.atan2(g.player.vel.x, g.player.vel.z) * 180 / Math.PI;
  const ampSpd = g.player.vel.length();

  __fresh();
  g.player.pos.set(0, 24, 0); g.player.vel.set(0, 0, 8); g.cam.yaw = 0; g.cam.pitch = 0.05;
  g.step(1/60);
  g.input.keys.add('KeyQ'); g.input.keys.add('KeyE'); g.input.keys.add('Space');
  for (let i = 0; i < 55; i++) g.step(1/60);
  const grappleSpd = g.player.vel.length();
  const grappleGas = g.player.gas;
  g.input.keys.clear();

  __fresh();
  const house = g.world.houses.find(h => !h.dead);
  g.player.hooks[0].state = 'attached';
  g.player.hooks[0].house = house;
  g.player.hooks[0].tip.set(house.x, house.h * 0.5, house.z);
  g.world.collapseHouse(house, new THREE.Vector3(house.x, 4, house.z), new THREE.Vector3(1, 0, 0));
  const hookDetached = g.player.hooks[0].state === 'ret';
  const chunksSpawned = g.world.chunks.length;
  g.post.render(g.elapsed);
  for (let i = 0; i < 90; i++) g.step(1/60);
  const settledChunks = g.world.chunks.filter(c => c.m.position.y < 6).length;

  __fresh();
  g.spawnBoulder(new THREE.Vector3(0, 40, -120), new THREE.Vector3(30, 0, 30), 1.4);
  const b = g.boulders[0];
  const marked = !!(b && b.mark && b.mark.visible);
  const mk = marked ? b.mark.position.clone() : null;
  for (let i = 0; i < 500 && g.boulders.length; i++) g.step(1/60);
  const boulderErr = mk ? Math.hypot(b.pos.x - mk.x, b.pos.z - mk.z) : -1;

  __fresh('endless');
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const t = __titan('normal', 0, 13); t.root.position.set(Math.sin(a) * 6, 0, Math.cos(a) * 6); t.cooldown = 0; }
  g.player.pos.set(0, 6, 0);
  let maxAttackers = 0;
  for (let i = 0; i < 240; i++) { g.player.invuln = 5; g.player.hp = 100; g.step(1/60); maxAttackers = Math.max(maxAttackers, g.activeAttackers()); }

  g.restart(); g.locked = true; g.post.render(g.elapsed);
  const m0 = { ...g.renderer.info.memory };
  for (let c = 0; c < 4; c++) { g.spawnWave(); g.world.destroyNear(new THREE.Vector3(60, 2, 60), 25, 250); for (let i = 0; i < 10; i++) { g.step(1/60); g.post.render(g.elapsed); } g.restart(); g.locked = true; }
  g.post.render(g.elapsed);
  const m1 = { ...g.renderer.info.memory };
  return {
    minConvoy: Math.round(minConvoy),
    idleBoostSpd: +idleBoostSpd.toFixed(1),
    turn: Math.round(turn),
    ampSpd: Math.round(ampSpd),
    grappleSpd: Math.round(grappleSpd),
    grappleGas: Math.round(grappleGas),
    hookDetached,
    chunksSpawned,
    settledChunks,
    maxAttackers,
    geoDelta: m1.geometries - m0.geometries,
    texDelta: m1.textures - m0.textures,
    boulderMark: marked,
    boulderErr: +boulderErr.toFixed(1),
  };
})()`);
const sysOk = sys.minConvoy >= 130
  && sys.idleBoostSpd < 10
  && sys.turn >= 55
  && sys.ampSpd >= 34
  && sys.grappleSpd >= 18
  && sys.grappleGas >= 95
  && sys.hookDetached === true
  && sys.chunksSpawned >= 12
  && sys.settledChunks >= 8
  && sys.maxAttackers >= 1 && sys.maxAttackers <= 2
  && sys.geoDelta <= 0 && sys.texDelta <= 0
  && sys.boulderMark === true && sys.boulderErr >= 0 && sys.boulderErr < 8;
failed ||= !sysOk;
console.log(`${sysOk ? 'PASS' : 'FAIL'} systems              ${JSON.stringify(sys)}`);

const uiCheck = await run(`(() => {
  const g = window.game;
  g.offerUpgrades();
  const shown = !document.getElementById('upgrades').classList.contains('hidden');
  const cards = document.getElementById('upcards').children.length;
  g.pickUpgrade(0);
  const hidden = document.getElementById('upgrades').classList.contains('hidden');
  const applied = !g.pendingUpgrades;
  g.player.invuln = 0.5; g.player.animate(1 / 60);
  const flickered = g.player.model.root.visible === false;
  g.player.invuln = 0; g.player.animate(1 / 60);
  const restored = g.player.model.root.visible === true;
  g.prefs.binds.hookL = 'KeyZ';
  g.hud.syncBindHints();
  const rebindReflected = document.getElementById('hl').textContent === 'Z';
  g.prefs.binds.hookL = 'KeyQ';
  g.hud.syncBindHints();
  const bodyTxt = document.body.innerText;
  const indonesianLeak = /OPERASI|PENGATURAN|KUSTOMISASI|TENGKUK|RUDAL PETIR|TERJUN|KAMU GUGUR/i.test(bodyTxt);
  return { shown, cards, hidden, applied, flickered, restored, rebindReflected, indonesianLeak };
})()`);
const uiOk = uiCheck.shown && uiCheck.cards === 3 && uiCheck.hidden && uiCheck.applied && uiCheck.flickered && uiCheck.restored && uiCheck.rebindReflected && !uiCheck.indonesianLeak;
failed ||= !uiOk;
console.log(`${uiOk ? 'PASS' : 'FAIL'} ui + rebind + en     ${JSON.stringify(uiCheck)}`);

const flow = { phases: [] };
await run(`(() => { const g = window.game; g.returnToMenu(); g.mode = 'campaign'; g.startSession(true, true); g.locked = true; })()`);
for (const t of [1.4, 3.0, 5.6, 7.2, 9.5, 11.0, 12.6, 13.8]) {
  const st = await run(`(() => { const g = window.game; while (g.story.t < ${t} && g.story.active) { g.step(1/60); g.input.endFrame(); } g.post.render(g.elapsed); return { phase: g.story.phase, t: +g.story.t.toFixed(1), cap: document.getElementById('cap').textContent, fade: +document.getElementById('fade').style.opacity, lum: +__lum().avg.toFixed(3) }; })()`);
  flow.phases.push(st);
  await snap('intro-' + t);
}
flow.afterIntro = await run(`(() => { const g = window.game; for (let i = 0; i < 1200 && g.story.active; i++) { g.step(1/60); g.input.endFrame(); } g.step(1/60); g.post.render(g.elapsed); return { phase: g.story.phase, started: g.started, hud: !document.getElementById('hud').classList.contains('hidden'), tut: !document.getElementById('tut').classList.contains('hidden'), capCleared: document.getElementById('cap').textContent === '' }; })()`);
await sleep(380);
await snap('tutorial');
flow.afterSkip = await run(`(() => { const g = window.game; g.input.edge.add('Enter'); g.step(1/60); g.input.endFrame(); for (let i = 0; i < 400; i++) { g.step(1/60); g.input.endFrame(); } return { phase: g.story.phase, wave: g.wave, titans: g.titans.filter(t => t.alive).length }; })()`);
const introLums = flow.phases.filter((p) => p.fade < 0.5).map((p) => p.lum);
const flowOk = flow.afterIntro.phase === 'tut' && flow.afterIntro.started && flow.afterIntro.hud && flow.afterIntro.tut && flow.afterIntro.capCleared && flow.afterSkip.phase === 'play' && flow.afterSkip.wave >= 1 && Math.min(...introLums) > 0.12;
failed ||= !flowOk;
console.log(`${flowOk ? 'PASS' : 'FAIL'} story flow           ${JSON.stringify({ introLums, ...flow.afterIntro, skip: flow.afterSkip })}`);
for (const p of flow.phases) console.log(`     t=${p.t} cap="${p.cap}" fade=${p.fade} lum=${p.lum}`);

if (shotDir) {
  await run(`(() => { const g = window.game; g.mode = 'campaign'; g.returnToMenu(); g.step(1/60); g.post.render(g.elapsed); })()`);
  await snap('title');
  await run(`(() => { document.getElementById('opencust').click(); const g = window.game; for (let i = 0; i < 20; i++) g.step(1/60); g.post.render(g.elapsed); })()`);
  await snap('wardrobe-full');
  await run(`(() => { document.getElementById('cust-face').click(); const g = window.game; for (let i = 0; i < 25; i++) g.step(1/60); g.post.render(g.elapsed); })()`);
  await snap('wardrobe-face');
  await run(`(() => { document.getElementById('closecust').click(); document.getElementById('openplay').click(); })()`);
  await snap('deploy-campaign');
  await run(`(() => { document.querySelector('#modes button[data-mode="endless"]').click(); })()`);
  await snap('deploy-endless');
  await run(`(() => { document.getElementById('closedeploy').click(); document.getElementById('openstory').click(); })()`);
  await snap('storybook');
  await run(`(() => { document.getElementById('closestory').click(); document.getElementById('openmp').click(); })()`);
  await snap('multiplayer');
  await run(`(() => { document.getElementById('closemp').click(); document.getElementById('opensettings').click(); document.querySelector('#settings-tabs button[data-tab="controls"]').click(); })()`);
  await snap('settings-controls');
  await run(`(() => { document.getElementById('closesettings').click(); const g = window.game; g.arena = 'forest'; g.weather = 'moon'; g.world.applyAtmosphere('moon'); __fresh('endless', true); for (let i = 0; i < 12; i++) g.step(1/60); g.post.render(g.elapsed); })()`);
  await snap('arena-forest-moon');
  await run(`(() => { const g = window.game; g.arena = 'town'; g.weather = 'dusk'; g.world.applyAtmosphere('dusk'); })()`);
  await run(`(() => {
    const g = window.game; __fresh('campaign', true);
    const t = __titan('normal', 40, 14); t.root.position.x = -8; t.grabSide = 1; t.setState('swipe'); t.stateT = 0.35;
    const b = __titan('tank', 70, 18); b.root.position.x = 30; b.setState('throw'); b.stateT = 0.6;
    g.player.pos.set(0, 9, 22); g.cam.yaw = 0; g.cam.pitch = 0.05;
    g.hud.killFeed('<b>YOU</b> eliminated <em>Sprinter 9m</em>');
    g.hud.killFeed('<b>Sgt. Mira</b> eliminated <em>Standard 13m</em>');
    g.hud.damageFrom(new THREE.Vector3(-20, 9, 22));
    for (let i = 0; i < 4; i++) { g.step(1/60); g.input.endFrame(); }
    g.post.render(g.elapsed);
  })()`);
  await snap('hud-threats');
  await run(`(() => {
    const g = window.game; __fresh('campaign', true);
    const h = g.world.houses.find(x => Math.hypot(x.x, x.z - 40) < 65 && !x.dead);
    if (h) {
      g.player.pos.set(h.x, 14, h.z - 28);
      g.cam.yaw = Math.atan2(h.x - g.player.pos.x, h.z - g.player.pos.z);
      g.cam.pitch = -0.15;
      g.world.collapseHouse(h, new THREE.Vector3(h.x, 4, h.z - 6), new THREE.Vector3(0, 0.2, 1));
      for (let i = 0; i < 24; i++) { g.step(1/60); g.input.endFrame(); }
      g.post.render(g.elapsed);
    }
  })()`);
  await snap('collapse');
  await run(`(() => { const g = window.game; g.locked = false; g.syncPause(); })()`);
  await snap('paused');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1024, height: 640, deviceScaleFactor: 1, mobile: false });
  await run(`(() => { const g = window.game; __fresh('campaign', true); const t = __titan('normal', 40, 14); t.root.position.x = -8; g.player.pos.set(0, 9, 22); g.cam.yaw = 0; g.cam.pitch = 0.05; g.hud.killFeed('<b>YOU</b> eliminated <em>Sprinter 9m</em>'); dispatchEvent(new Event('resize')); for (let i = 0; i < 3; i++) g.step(1/60); g.post.render(g.elapsed); })()`);
  await sleep(240);
  await snap('hud-small');
  await run(`(() => { const g = window.game; g.returnToMenu(); g.step(1/60); g.post.render(g.elapsed); })()`);
  await snap('title-small');
}

console.log(`page errors: ${pageErrors.length ? pageErrors.join(' | ') : 'none'}`);
shutdown(failed || pageErrors.length ? 1 : 0);
