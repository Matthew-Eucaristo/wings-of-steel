import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 5201;
const CDP = 9302;
const CHROME = process.env.CHROME || ['/home/ubuntu/.local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const shotDir = process.argv[2] || '/tmp/wos-audit';
mkdirSync(shotDir, { recursive: true });

const vite = spawn('node_modules/.bin/vite', ['--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  vite.stdout.on('data', (d) => d.toString().includes(String(PORT)) && resolve());
  vite.on('exit', (c) => reject(new Error('vite exited ' + c)));
});
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=/tmp/wos-audit-${Date.now()}`,
  '--window-size=1280,720', '--enable-webgl', '--ignore-gpu-blocklist', '--no-first-run', `http://localhost:${PORT}/`,
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
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
const errs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
});
const cdp = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const run = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
  return r.result?.result?.value;
};
const snap = async (name) => {
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  console.log('shot', name);
};

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
for (let i = 0; i < 50; i++) { if (await run('!!window.game')) break; await sleep(200); }

await run(`(() => {
  const g = window.game;
  window.__fresh = (mode = 'campaign') => {
    g.returnToMenu(); g.mode = mode; g.startSession(false); g.locked = true;
    g.story.skip?.(); for (const t of g.titans) { t.alive = false; t.root.visible = false; }
    g.titans.length = 0;
    for (const h of g.player.hooks) h.reset();
    g.player.grabbedBy = null;
  };
  window.__titan = (type, dist = 40, h = 13) => {
    const g = window.game;
    const t = new g.TitanClass(g, new THREE.Vector3(dist, 0, 0), { type, height: h, instant: true });
    g.titans.push(t);
    return t;
  };
  window.__aim = (tx, ty, tz) => {
    const g = window.game, p = g.player.pos;
    const dx = tx - p.x, dy = ty - (p.y + 0.55), dz = tz - p.z;
    g.cam.yaw = Math.atan2(dx, dz);
    g.cam.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    g.cam.target.copy(p); g.cam.dist = 6;
  };
  __fresh();
})()`);

// 1. titan closeup — face/eyes/teeth
await run(`(() => { const g = window.game; __fresh();
  const t = __titan('normal', 0, 13); t.root.position.set(0, 0, 100); t.heading = Math.PI; t.state = 'wander';
  g.player.pos.set(0, 8, 114); g.player.vel.set(0,0,0); __aim(t.root.position.x, t.height * 0.55, t.root.position.z);
  for (let i = 0; i < 30; i++) { g.step(1/60); g.input.endFrame(); }
  g.post.render(g.elapsed); })()`);
await snap('titan-closeup');

// 2. boulder telegraph + throw windup
await run(`(() => { const g = window.game; __fresh();
  const t = __titan('tank', 60, 16); t.root.position.set(-20, 0, 90); t.setState('throw'); t.stateT = 0.9;
  g.spawnBoulder(new THREE.Vector3(-16, 30, 96), new THREE.Vector3(0, 0, 118), 1.6);
  g.player.pos.set(0, 12, 122); g.player.vel.set(0,0,0); __aim(-14, 10, 96);
  for (let i = 0; i < 12; i++) { g.step(1/60); g.input.endFrame(); }
  g.post.render(g.elapsed); })()`);
await snap('boulder-telegraph');

// 3. combat — hooked to nape, slash trail
await run(`(() => { const g = window.game; __fresh();
  const t = __titan('normal', 0, 13); t.root.position.set(0, 0, 100); t.state = 'wander';
  const p = g.player;
  p.pos.set(3, 12, 112); p.vel.set(6, 1, -16);
  const h = p.hooks[0];
  h.state = 'attached'; h.owner = t; h.tip.copy(t.nape.c); h.target.copy(t.nape.c);
  h.local.copy(t.nape.c); h.joint = t.body; h.len = p.pos.distanceTo(t.nape.c); h.t = 1;
  p.slashT = 0.1;
  __aim(t.nape.c.x, t.nape.c.y, t.nape.c.z);
  for (let i = 0; i < 8; i++) { g.step(1/60); g.input.endFrame(); }
  g.post.render(g.elapsed); })()`);
await snap('combat-slash');

// 4. titan death fall mid
await run(`(() => { const g = window.game; __fresh();
  const t = __titan('normal', 0, 14); t.root.position.set(-2, 0, 100);
  t.die(new THREE.Vector3(0, 0, 1).normalize()); t.deadT = 1.4;
  g.player.pos.set(0, 8, 112); g.player.vel.set(0,0,0); __aim(t.root.position.x, t.height * 0.4, t.root.position.z);
  for (let i = 0; i < 20; i++) { g.step(1/60); g.input.endFrame(); }
  g.post.render(g.elapsed); })()`);
await snap('death-fall');

// 5. group wave
await run(`(() => { const g = window.game; __fresh();
  const poses = [[-8, 70], [4, 85], [-3, 105], [10, 120], [0, 140]];
  [['normal', 13], ['tank', 18], ['abnormal', 12], ['sprinter', 9], ['armored', 20]].forEach(([type, h], i) => { const t = __titan(type, 0, h); t.root.position.set(poses[i][0], 0, poses[i][1]); t.state = 'wander'; t.heading = Math.PI; });
  g.player.pos.set(0, 14, 155); g.player.vel.set(0,0,0); __aim(0, 8, 80);
  for (let i = 0; i < 40; i++) { g.step(1/60); g.input.endFrame(); }
  g.post.render(g.elapsed); })()`);
await snap('wave-group');

// 6. world/village view
await run(`(() => { const g = window.game; __fresh();
  g.player.pos.set(-40, 55, 60); g.player.vel.set(0,0,0); g.cam.yaw = Math.PI * 0.8; g.cam.pitch = -0.5;
  for (let i = 0; i < 10; i++) { g.step(1/60); g.input.endFrame(); }
  g.post.render(g.elapsed); })()`);
await snap('world-vista');

console.log('errors:', errs.join(' | ') || 'none');
shutdown(0);
