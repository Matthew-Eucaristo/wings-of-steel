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
  };
  window.__titan = (type, dist = 40, h = 13) => {
    const g = window.game;
    const t = new g.TitanClass(g, type, h);
    t.root.position.set(dist, 0, 0); g.titans.push(t);
    return t;
  };
  __fresh();
})()`);

// 1. titan closeup — face/eyes/teeth
await run(`(() => { const g = window.game; __fresh();
  const t = __titan('normal', 0, 13); t.root.position.set(-6, 0, -4); t.heading = Math.PI * 0.8;
  g.player.pos.set(0, 8, 8); g.cam.yaw = Math.PI * 0.05; g.cam.pitch = -0.15;
  for (let i = 0; i < 30; i++) { g.step(1/60); g.input.endFrame(); }
  g.post.render(g.elapsed); })()`);
await snap('titan-closeup');

// 2. boulder telegraph + throw windup
await run(`(() => { const g = window.game; __fresh();
  const t = __titan('tank', 60, 16); t.setState('throw'); t.stateT = 0.9;
  g.spawnBoulder(new THREE.Vector3(30, 30, -40), new THREE.Vector3(0, 0, 0), 1.6);
  g.player.pos.set(6, 12, 10); g.cam.yaw = Math.PI; g.cam.pitch = -0.35;
  for (let i = 0; i < 12; i++) { g.step(1/60); g.input.endFrame(); }
  g.post.render(g.elapsed); })()`);
await snap('boulder-telegraph');

// 3. combat — hooked to nape, slash trail
await run(`(() => { const g = window.game; __fresh();
  const t = __titan('normal', 0, 13); t.root.position.set(0, 0, -10);
  const p = g.player;
  p.pos.set(2, 12, 4); p.vel.set(8, 2, -18);
  p.hooks[0].state = 'attached'; p.hooks[0].tip.copy(t.nape.c); p.hooks[0].side = -1;
  p.slashT = 0.1;
  g.cam.yaw = Math.PI; g.cam.pitch = -0.2;
  for (let i = 0; i < 8; i++) { g.step(1/60); g.input.endFrame(); }
  g.post.render(g.elapsed); })()`);
await snap('combat-slash');

// 4. titan death fall mid
await run(`(() => { const g = window.game; __fresh();
  const t = __titan('normal', 0, 14); t.root.position.set(-4, 0, -8);
  t.die(new THREE.Vector3(0, 0, 1).normalize()); t.stateT = 0.7;
  g.player.pos.set(0, 6, 6); g.cam.yaw = Math.PI; g.cam.pitch = -0.25;
  for (let i = 0; i < 20; i++) { g.step(1/60); g.input.endFrame(); }
  g.post.render(g.elapsed); })()`);
await snap('death-fall');

// 5. group wave
await run(`(() => { const g = window.game; __fresh();
  for (let i = 0; i < 5; i++) { const t = __titan(['normal','sprinter','abnormal','tank','normal'][i], 0, 10 + i * 2); t.root.position.set(-30 + i * 14, 0, -40 - i * 10); }
  g.player.pos.set(0, 10, 15); g.cam.yaw = Math.PI; g.cam.pitch = -0.12;
  for (let i = 0; i < 40; i++) { g.step(1/60); g.input.endFrame(); }
  g.post.render(g.elapsed); })()`);
await snap('wave-group');

// 6. world/village view
await run(`(() => { const g = window.game; __fresh();
  g.player.pos.set(-40, 55, 60); g.cam.yaw = Math.PI * 0.8; g.cam.pitch = -0.5;
  for (let i = 0; i < 10; i++) { g.step(1/60); g.input.endFrame(); }
  g.post.render(g.elapsed); })()`);
await snap('world-vista');

console.log('errors:', errs.join(' | ') || 'none');
shutdown(0);
