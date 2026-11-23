import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 5199;
const CDP = 9301;
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
const shutdown = (code) => { chrome.kill('SIGKILL'); vite.kill('SIGKILL'); process.exit(code); };

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
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
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
  window.__fresh = (mode = 'campaign', fp = false) => {
    g.mode = mode; g.restart(); g.locked = true; g.syncPause(); g.cam.fp = fp;
  };
  window.__titan = (type, z, h) => {
    const t = new g.TitanClass(g, new THREE.Vector3(0, 0, z), { type, height: h, instant: true });
    t.heading = 0; t.root.rotation.y = 0; t.update(0.016); g.titans.push(t); return t;
  };
})()`);

const cases = {
  'kill 3rd person': `__fresh(); const t = __titan('normal', 60, 14); g.player.pos.copy(t.nape.c).add(new THREE.Vector3(0, 0.4, -6)); g.player.vel.set(0, 0, 30); g.cam.yaw = 0; g.cam.pitch = -0.05; g.step(1/60); g.input.mouse.l = true; g.input.mouse.lPressed = true; return { ...__frames(45), kills: g.kills };`,
  'kill 1st person': `__fresh('campaign', true); const t = __titan('normal', 60, 14); g.player.pos.copy(t.nape.c).add(new THREE.Vector3(0, 0.4, -6)); g.player.vel.set(0, 0, 30); g.cam.yaw = 0; g.cam.pitch = -0.05; g.step(1/60); g.input.mouse.l = true; g.input.mouse.lPressed = true; return { ...__frames(45), kills: g.kills };`,
  'limb cut': `__fresh(); const t = __titan('tank', 60, 18); const a = t.parts.find(p => p.part === 'arm'); g.player.pos.copy(a.a).add(new THREE.Vector3(0, 0, -1.2)); g.input.mouse.l = true; g.input.mouse.lPressed = true; return __frames(30);`,
  'armor + spear blast': `__fresh(); const t = __titan('armored', 60, 20); g.player.pos.copy(t.nape.c).add(new THREE.Vector3(0, 1, -9)); g.explode(t.nape.c.clone()); return __frames(30);`,
  'hard landing': `__fresh(); g.player.pos.set(0, 4, 22); g.player.vel.set(0, -35, 5); return __frames(20);`,
  'particle fuzz': `__fresh(); const pt = g.player.pos.clone().add(new THREE.Vector3(0, 0, 4)); g.vfx.flash(pt, 5, 0xffaa33); g.vfx.flash(pt, 5, '#44ccff'); g.vfx.add.spawn(pt, { x: NaN, y: Infinity, z: 0 }, { color: NaN, size0: NaN, alpha: NaN, life: NaN }); return __frames(15);`,
};

let failed = false;
for (const [name, body] of Object.entries(cases)) {
  const r = await run(`(() => { const g = window.game; ${body} })()`);
  const ok = r.maxBlack < 0.05 && r.minAvg > 0.25 && (!('kills' in r) || r.kills >= 1);
  failed ||= !ok;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name.padEnd(20)} minLum=${r.minAvg} black=${r.maxBlack} minTimeScale=${r.minTs}${'kills' in r ? ' kills=' + r.kills : ''}`);
}

const sys = await run(`(() => {
  const g = window.game;
  __fresh();
  let minConvoy = 1e9;
  for (let w = 0; w < 3; w++) { g.spawnWave(); for (const t of g.titans) minConvoy = Math.min(minConvoy, t.root.position.distanceTo(g.engineers.convoyPos)); }
  __fresh();
  g.player.pos.set(0, 35, 0); g.player.vel.set(0, 0, 34); g.cam.yaw = Math.PI / 2; g.cam.pitch = 0;
  g.input.keys.add('ShiftLeft'); g.input.keys.add('KeyW');
  for (let i = 0; i < 28; i++) g.step(1/60);
  g.input.keys.clear();
  const turn = Math.atan2(g.player.vel.x, g.player.vel.z) * 180 / Math.PI;
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
  for (let c = 0; c < 4; c++) { g.spawnWave(); g.world.destroyNear(new THREE.Vector3(60, 2, 60), 25); for (let i = 0; i < 10; i++) { g.step(1/60); g.post.render(g.elapsed); } g.restart(); g.locked = true; }
  g.post.render(g.elapsed);
  const m1 = { ...g.renderer.info.memory };
  return { minConvoy: Math.round(minConvoy), turn: Math.round(turn), maxAttackers, geoDelta: m1.geometries - m0.geometries, texDelta: m1.textures - m0.textures, boulderMark: marked, boulderErr: +boulderErr.toFixed(1) };
})()`);
const sysOk = sys.minConvoy >= 130 && sys.turn >= 60 && sys.maxAttackers >= 1 && sys.maxAttackers <= 2 && sys.geoDelta <= 0 && sys.texDelta <= 0 && sys.boulderMark === true && sys.boulderErr >= 0 && sys.boulderErr < 8;
failed ||= !sysOk;
console.log(`${sysOk ? 'PASS' : 'FAIL'} systems              ${JSON.stringify(sys)}`);

const flow = { phases: [] };
await run(`(() => { const g = window.game; g.returnToMenu(); g.mode = 'campaign'; g.startSession(true); g.locked = true; })()`);
for (const t of [1.5, 3.2, 6.4, 7.6, 10.4, 11.6, 13.2, 14.8]) {
  const st = await run(`(() => { const g = window.game; while (g.story.t < ${t} && g.story.active) { g.step(1/60); g.input.endFrame(); } g.post.render(g.elapsed); return { phase: g.story.phase, t: +g.story.t.toFixed(1), cap: document.getElementById('cap').textContent, fade: +document.getElementById('fade').style.opacity, lum: +__lum().avg.toFixed(3) }; })()`);
  flow.phases.push(st);
  await snap('intro-' + t);
}
flow.afterIntro = await run(`(() => { const g = window.game; for (let i = 0; i < 1200 && g.story.active; i++) { g.step(1/60); g.input.endFrame(); } g.step(1/60); g.post.render(g.elapsed); return { phase: g.story.phase, started: g.started, hud: !document.getElementById('hud').classList.contains('hidden'), tut: !document.getElementById('tut').classList.contains('hidden') }; })()`);
await snap('tutorial');
flow.afterSkip = await run(`(() => { const g = window.game; g.input.edge.add('Enter'); g.step(1/60); g.input.endFrame(); for (let i = 0; i < 400; i++) { g.step(1/60); g.input.endFrame(); } return { phase: g.story.phase, wave: g.wave, titans: g.titans.filter(t => t.alive).length }; })()`);
const introLums = flow.phases.filter((p) => p.fade < 0.5).map((p) => p.lum);
const flowOk = flow.afterIntro.phase === 'tut' && flow.afterIntro.started && flow.afterIntro.hud && flow.afterIntro.tut && flow.afterSkip.phase === 'play' && flow.afterSkip.wave >= 1 && Math.min(...introLums) > 0.12;
failed ||= !flowOk;
console.log(`${flowOk ? 'PASS' : 'FAIL'} story flow           ${JSON.stringify({ introLums, ...flow.afterIntro, skip: flow.afterSkip })}`);
for (const p of flow.phases) console.log(`     t=${p.t} cap="${p.cap}" fade=${p.fade} lum=${p.lum}`);

if (shotDir) {
  await run(`(() => { const g = window.game; __fresh(); for (let i = 0; i < 4; i++) { g.step(1/60); } g.post.render(g.elapsed); })()`);
  await run(`(() => { const g = window.game; g.mode = 'campaign'; g.returnToMenu(); g.step(1/60); g.post.render(g.elapsed); })()`);
  await snap('title');
  await run(`(() => {
    const g = window.game; __fresh();
    const t = __titan('normal', 40, 14); t.root.position.x = -8; t.grabSide = 1; t.setState('swipe'); t.stateT = 0.35;
    const b = __titan('tank', 70, 18); b.root.position.x = 30; b.setState('throw'); b.stateT = 0.6;
    g.player.pos.set(0, 9, 22); g.cam.yaw = 0; g.cam.pitch = 0.05;
    g.hud.killFeed('<b>KAMU</b> mengeksekusi <em>Titan Pelari 9m</em>');
    g.hud.killFeed('<b>Sersan Mira</b> mengeksekusi <em>Titan Biasa 13m</em>');
    g.hud.damageFrom(new THREE.Vector3(-20, 9, 22));
    for (let i = 0; i < 3; i++) { g.step(1/60); g.input.endFrame(); }
    g.post.render(g.elapsed);
  })()`);
  await snap('hud-threats');
  await run(`(() => { const g = window.game; g.locked = false; g.syncPause(); })()`);
  await snap('paused');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1024, height: 640, deviceScaleFactor: 1, mobile: false });
  await run(`(() => { const g = window.game; g.locked = true; g.syncPause(); dispatchEvent(new Event('resize')); g.step(1/60); g.post.render(g.elapsed); })()`);
  await snap('hud-small');
  await run(`(() => { const g = window.game; g.returnToMenu(); g.step(1/60); g.post.render(g.elapsed); })()`);
  await snap('title-small');
}

console.log(`page errors: ${pageErrors.length ? pageErrors.join(' | ') : 'none'}`);
shutdown(failed || pageErrors.length ? 1 : 0);
