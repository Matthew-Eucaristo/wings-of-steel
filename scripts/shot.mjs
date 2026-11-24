// Fast visual iteration harness: node scripts/shot.mjs <outdir> <scenario.js expressions...>
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 5600 + (process.pid % 300);
const CDP = 9700 + (process.pid % 200);
const CHROME = process.env.CHROME || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(existsSync);
const shotDir = process.argv[2] || '/tmp/wos-shot';
mkdirSync(shotDir, { recursive: true });

const vite = spawn('node_modules/.bin/vite', ['--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  vite.stdout.on('data', (d) => d.toString().includes(String(PORT)) && resolve());
  vite.on('exit', (c) => reject(new Error('vite exited ' + c)));
});
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=/tmp/wos-shot-${Date.now()}`,
  '--window-size=1440,900', '--enable-webgl', '--ignore-gpu-blocklist', '--no-first-run', `http://localhost:${PORT}/`,
], { stdio: 'ignore' });
const shutdown = (code) => { try { chrome.kill('SIGKILL'); } catch {} try { vite.kill('SIGKILL'); } catch {} process.exit(code); };
process.on('uncaughtException', (e) => { console.error(e); shutdown(1); });
process.on('unhandledRejection', (e) => { console.error(e); shutdown(1); });

let wsUrl;
for (let i = 0; i < 60 && !wsUrl; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
    wsUrl = list.find((x) => x.type === 'page' && x.url.includes(String(PORT)))?.webSocketDebuggerUrl;
  } catch {}
  if (!wsUrl) await sleep(200);
}
if (!wsUrl) { console.error('no chrome'); shutdown(1); }
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
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.slice(0, 400) || 'eval failed');
  return r.result?.result?.value;
};
const snap = async (name) => {
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  console.log('shot', name);
};

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
for (let i = 0; i < 60; i++) { if (await run('!!window.game')) break; await sleep(200); }
if (!(await run('!!window.game'))) { console.error('no game'); shutdown(1); }

await run(`(() => {
  const g = window.game;
  g.frozen = true;
  window.__step = (n = 1) => { for (let i = 0; i < n; i++) { g.step(1/60); g.input.endFrame(); } g.post.render(g.elapsed); };
  window.__titan = (type, x, z, h = 13) => {
    const t = new g.TitanClass(g, new THREE.Vector3(x, 0, z), { type, height: h, instant: true });
    g.titans.push(t); return t;
  };
  window.__fresh = (mode = 'campaign', fp = true) => {
    g.mode = mode; g.restart(); g.locked = true; g.syncPause(); g.cam.fp = fp;
    for (const t of g.titans) { t.alive = false; t.root.visible = false; }
    g.titans.length = 0;
  };
  window.__aim = (tx, ty, tz) => {
    const p = g.player.pos;
    const dx = tx - p.x, dy = ty - (p.y + 0.55), dz = tz - p.z;
    g.cam.yaw = Math.atan2(dx, dz);
    g.cam.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    g.cam.target.copy(p); g.cam.dist = 6;
  };
})()`);

const scenario = process.argv[3] || 'wardrobe';
const scenarios = {
  wardrobe: async () => {
    await run(`(() => { const g = window.game; g.returnToMenu(); document.getElementById('opencust').click(); __step(30); })()`);
    await snap('wardrobe-full');
    await run(`(() => { document.getElementById('cust-face').click(); __step(25); })()`);
    await snap('wardrobe-face');
    await run(`(() => { const g = window.game; g.cam.wardrobeAngle = 2.6; __step(20); })()`);
    await snap('wardrobe-back');
  },
  titans: async () => {
    await run(`(() => { const g = window.game; __fresh('campaign', false);
      const poses = [[-8, 70, 'normal', 13], [4, 85, 'tank', 18], [-3, 105, 'abnormal', 12], [10, 120, 'sprinter', 9], [0, 140, 'armored', 20]];
      for (const [x, z, type, h] of poses) { const t = __titan(type, x, z, h); t.state = 'wander'; t.heading = Math.PI; t.root.rotation.y = Math.PI; }
      g.player.pos.set(0, 14, 155); g.player.vel.set(0,0,0); __aim(0, 8, 80);
      __step(40); })()`);
    await snap('titan-group');
    await run(`(() => { const g = window.game; const t = g.titans[0];
      g.cam.fp = false;
      g.player.pos.set(t.root.position.x + 2, 7.5, t.root.position.z - 9); g.player.vel.set(0,0,0);
      __aim(t.root.position.x, t.height * 0.72, t.root.position.z);
      g.cam.dist = 4; __step(8); })()`);
    await snap('titan-closeup');
  },
  weather: async () => {
    for (const w of ['moon', 'storm', 'dawn', 'dusk']) {
      await run(`(() => { const g = window.game; g.weather = '${w}'; g.world.applyAtmosphere('${w}'); __fresh('endless', true);
        g.player.pos.set(-30, 42, 80); g.player.vel.set(0,0,0); g.cam.yaw = Math.PI * 0.9; g.cam.pitch = -0.28; __step(10); })()`);
      await snap('weather-' + w);
    }
  },
  face: async () => {
    await run(`(() => { const g = window.game; __fresh('campaign', false);
      const t = __titan('normal', 0, 100, 13); t.state = 'wander'; t.heading = Math.PI; t.root.rotation.y = Math.PI;
      g.player.pos.set(0.5, 10.6, 93.4); g.player.vel.set(0,0,0);
      __aim(0, 11.15, 100);
      g.cam.dist = 3.2; __step(10); })()`);
    await snap('titan-face');
    await run(`(() => { const g = window.game;
      const t = g.titans[0];
      g.player.pos.set(-1.2, 10.2, 94.5); g.player.vel.set(0,0,0);
      __aim(0, 10.9, 100);
      g.cam.dist = 2.6; __step(4); })()`);
    await snap('titan-face2');
  },
  forest: async () => {
    await run(`(() => { const g = window.game; g.arena = 'forest'; g.weather = 'dusk'; g.world.applyAtmosphere('dusk'); __fresh('endless', true); __step(15); })()`);
    await snap('forest-spawn');
  },
};
await scenarios[scenario]();
console.log('errors:', errs.join(' | ').slice(0, 500) || 'none');
shutdown(0);
