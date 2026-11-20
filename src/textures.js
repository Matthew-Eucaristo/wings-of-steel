import * as THREE from 'three';
import { mulberry32 } from './util.js';

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

class Noise {
  constructor(seed = 1, size = 256) {
    const r = mulberry32(seed);
    this.size = size;
    this.p = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) this.p[i] = r();
  }
  get(x, y, period) {
    const s = Math.min(period || this.size, this.size);
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % s) + s) % s, y0 = ((yi % s) + s) % s;
    const x1 = (x0 + 1) % s, y1 = (y0 + 1) % s;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const S = this.size;
    const a = this.p[y0 * S + x0], b = this.p[y0 * S + x1], c = this.p[y1 * S + x0], d = this.p[y1 * S + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  // tileable fbm: x,y in [0,1)
  fbm(x, y, period = 8, oct = 4) {
    let f = 0, amp = 0.5, fr = 1, n = 0;
    for (let i = 0; i < oct; i++) {
      const p = period * fr;
      f += amp * this.get(x * p, y * p, p);
      n += amp; amp *= 0.5; fr *= 2;
    }
    return f / n;
  }
}

const noiseA = new Noise(7);
const noiseB = new Noise(13);

function toTexture(canvas, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// height: Float32Array (w*h) in [0,1]
function heightToNormal(height, w, h, strength = 2) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const H = (x, y) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx = (H(x - 1, y) - H(x + 1, y)) * strength;
      let ny = (H(x, y + 1) - H(x, y - 1)) * strength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, false);
}

function readHeight(canvas) {
  const ctx = canvas.getContext('2d');
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const out = new Float32Array(canvas.width * canvas.height);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
  return out;
}

// multiply colour canvas with tileable noise for grime
function grime(canvas, amount = 0.18, period = 6, seedNoise = noiseA, tint = [0, 0, 0]) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = seedNoise.fbm(x / w, y / h, period, 5);
      const k = 1 - amount + amount * 2 * n;
      const i = (y * w + x) * 4;
      d[i] = Math.min(255, d[i] * k + tint[0] * (1 - n));
      d[i + 1] = Math.min(255, d[i + 1] * k + tint[1] * (1 - n));
      d[i + 2] = Math.min(255, d[i + 2] * k + tint[2] * (1 - n));
    }
  }
  ctx.putImageData(img, 0, 0);
}

function addHeightNoise(height, w, h, amount, period, n = noiseB) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) height[y * w + x] += (n.fbm(x / w, y / h, period, 4) - 0.5) * amount;
}

// Half-timbered facade. Texture spans 8m x 6.4m (2 bays x 2 storeys)
export function facadeTextures() {
  const W = 512, Hh = 512;
  const col = makeCanvas(W, Hh), hc = makeCanvas(W, Hh), em = makeCanvas(W, Hh);
  const c = col.getContext('2d'), h = hc.getContext('2d'), e = em.getContext('2d');
  const r = mulberry32(42);
  c.fillStyle = '#efe7d6'; c.fillRect(0, 0, W, Hh);
  h.fillStyle = '#808080'; h.fillRect(0, 0, W, Hh);
  e.fillStyle = '#000'; e.fillRect(0, 0, W, Hh);
  const beam = '#4b3322', beamH = '#d8d8d8';
  const both = (fn) => { fn(c, beam); fn(h, beamH); };
  for (let by = 0; by < 2; by++) {
    for (let bx = 0; bx < 2; bx++) {
      const x0 = bx * 256, y0 = by * 256;
      // window
      const ww = 92, wh = 128, wx = x0 + 128 - ww / 2, wy = y0 + 72;
      // shutters
      c.fillStyle = r() < 0.5 ? '#3d4a35' : '#5a3a26';
      c.fillRect(wx - 30, wy - 4, 26, wh + 8); c.fillRect(wx + ww + 4, wy - 4, 26, wh + 8);
      h.fillStyle = '#a8a8a8';
      h.fillRect(wx - 30, wy - 4, 26, wh + 8); h.fillRect(wx + ww + 4, wy - 4, 26, wh + 8);
      for (let k = 0; k < 6; k++) {
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.fillRect(wx - 30, wy + k * 22, 26, 2); c.fillRect(wx + ww + 4, wy + k * 22, 26, 2);
      }
      // frame
      c.fillStyle = '#d9cdb5'; c.fillRect(wx - 8, wy - 8, ww + 16, wh + 16);
      h.fillStyle = '#b0b0b0'; h.fillRect(wx - 8, wy - 8, ww + 16, wh + 16);
      // glass
      const lit = r() < 0.35;
      const g = c.createLinearGradient(wx, wy, wx + ww, wy + wh);
      g.addColorStop(0, lit ? '#e8b060' : '#2c3640'); g.addColorStop(0.5, lit ? '#b8743a' : '#151b22'); g.addColorStop(1, lit ? '#7a4422' : '#3a4650');
      c.fillStyle = g; c.fillRect(wx, wy, ww, wh);
      h.fillStyle = '#202020'; h.fillRect(wx, wy, ww, wh);
      if (lit) {
        const eg = e.createRadialGradient(wx + ww / 2, wy + wh * 0.6, 4, wx + ww / 2, wy + wh * 0.6, wh * 0.7);
        eg.addColorStop(0, '#ffb35c'); eg.addColorStop(1, '#5a2a08');
        e.fillStyle = eg; e.fillRect(wx, wy, ww, wh);
      }
      // mullions
      c.fillStyle = '#3a2a1c'; c.fillRect(wx + ww / 2 - 4, wy, 8, wh); c.fillRect(wx, wy + wh / 2 - 4, ww, 8);
      e.fillStyle = '#000'; e.fillRect(wx + ww / 2 - 4, wy, 8, wh); e.fillRect(wx, wy + wh / 2 - 4, ww, 8);
      h.fillStyle = '#909090'; h.fillRect(wx + ww / 2 - 4, wy, 8, wh); h.fillRect(wx, wy + wh / 2 - 4, ww, 8);
      // sill
      c.fillStyle = '#6a4a30'; c.fillRect(wx - 14, wy + wh + 6, ww + 28, 10);
      h.fillStyle = '#e0e0e0'; h.fillRect(wx - 14, wy + wh + 6, ww + 28, 10);
      // flower box
      if (r() < 0.4) {
        c.fillStyle = '#5b3b25'; c.fillRect(wx - 6, wy + wh + 16, ww + 12, 16);
        for (let k = 0; k < 9; k++) {
          c.fillStyle = ['#c0392b', '#e8c13a', '#d35d9c', '#5f8a3a'][Math.floor(r() * 4)];
          c.beginPath(); c.arc(wx + 4 + k * 11, wy + wh + 14, 6, 0, Math.PI * 2); c.fill();
        }
      }
      // timber: posts & floor beams & braces
      both((ctx, s) => {
        ctx.fillStyle = s;
        ctx.fillRect(x0, y0, 10, 256); ctx.fillRect(x0 + 246, y0, 10, 256);
        ctx.fillRect(x0, y0, 256, 12); ctx.fillRect(x0, y0 + 244, 256, 12);
        ctx.fillRect(x0, y0 + 222, 256, 10);
        ctx.strokeStyle = s; ctx.lineWidth = 12;
        const brace = r();
        if (brace < 0.6) {
          ctx.beginPath(); ctx.moveTo(x0 + 8, y0 + 228); ctx.lineTo(x0 + 44, y0 + 12); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x0 + 248, y0 + 228); ctx.lineTo(x0 + 212, y0 + 12); ctx.stroke();
        }
        if (brace < 0.3) {
          ctx.beginPath(); ctx.moveTo(x0 + 8, y0 + 12); ctx.lineTo(x0 + 34, y0 + 60); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x0 + 248, y0 + 12); ctx.lineTo(x0 + 222, y0 + 60); ctx.stroke();
        }
      });
    }
  }
  grime(col, 0.16, 8, noiseA, [20, 14, 6]);
  // vertical streak stains
  for (let i = 0; i < 40; i++) {
    const x = r() * W, y = r() * Hh, l = 30 + r() * 120;
    const g = c.createLinearGradient(0, y, 0, y + l);
    g.addColorStop(0, 'rgba(60,45,30,0.12)'); g.addColorStop(1, 'rgba(60,45,30,0)');
    c.fillStyle = g; c.fillRect(x, y, 4 + r() * 8, l);
  }
  const height = readHeight(hc);
  addHeightNoise(height, W, Hh, 0.25, 16);
  return { map: toTexture(col), normalMap: heightToNormal(height, W, Hh, 3), emissiveMap: toTexture(em) };
}

// Roof tiles: 4m x 4m, greyscale to be tinted
export function roofTextures() {
  const W = 512;
  const col = makeCanvas(W), hc = makeCanvas(W);
  const c = col.getContext('2d'), h = hc.getContext('2d');
  const r = mulberry32(5);
  c.fillStyle = '#555'; c.fillRect(0, 0, W, W);
  h.fillStyle = '#000'; h.fillRect(0, 0, W, W);
  const rows = 16, cols = 12;
  const th = W / rows, tw = W / cols;
  for (let ry = 0; ry < rows; ry++) {
    const off = (ry % 2) * tw * 0.5;
    for (let cx = -1; cx <= cols; cx++) {
      const x = cx * tw + off, y = ry * th;
      const b = 170 + r() * 70;
      const g = c.createLinearGradient(0, y, 0, y + th);
      g.addColorStop(0, `rgb(${b * 0.7},${b * 0.7},${b * 0.7})`); g.addColorStop(1, `rgb(${b},${b},${b})`);
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(x + 1, y);
      c.lineTo(x + tw - 1, y);
      c.lineTo(x + tw - 1, y + th * 0.7);
      c.quadraticCurveTo(x + tw / 2, y + th * 1.15, x + 1, y + th * 0.7);
      c.closePath(); c.fill();
      const hg = h.createLinearGradient(0, y, 0, y + th);
      hg.addColorStop(0, '#303030'); hg.addColorStop(1, '#f0f0f0');
      h.fillStyle = hg;
      h.beginPath();
      h.moveTo(x + 1, y); h.lineTo(x + tw - 1, y); h.lineTo(x + tw - 1, y + th * 0.7);
      h.quadraticCurveTo(x + tw / 2, y + th * 1.15, x + 1, y + th * 0.7); h.closePath(); h.fill();
    }
  }
  grime(col, 0.25, 6, noiseB, [10, 14, 4]);
  const height = readHeight(hc);
  return { map: toTexture(col), normalMap: heightToNormal(height, W, W, 4) };
}

export function cobbleTextures() {
  const W = 512;
  const col = makeCanvas(W), hc = makeCanvas(W);
  const c = col.getContext('2d'), h = hc.getContext('2d');
  const r = mulberry32(9);
  c.fillStyle = '#3d362d'; c.fillRect(0, 0, W, W);
  h.fillStyle = '#000'; h.fillRect(0, 0, W, W);
  const n = 14, cell = W / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const off = (y % 2) * cell * 0.5;
      const cx = x * cell + off + (r() - 0.5) * cell * 0.2, cy = y * cell + cell / 2 + (r() - 0.5) * cell * 0.2;
      const rx = cell * (0.4 + r() * 0.06), ry = cell * (0.38 + r() * 0.06);
      const b = 95 + r() * 60;
      for (const [dx, dy] of [[0, 0], [W, 0], [-W, 0], [0, W], [0, -W]]) {
        const g = c.createRadialGradient(cx + dx - rx * 0.3, cy + dy - ry * 0.3, 1, cx + dx, cy + dy, rx * 1.1);
        g.addColorStop(0, `rgb(${b + 30},${b + 24},${b + 16})`); g.addColorStop(1, `rgb(${b * 0.7},${b * 0.65},${b * 0.58})`);
        c.fillStyle = g;
        c.beginPath(); c.ellipse(cx + dx, cy + dy, rx, ry, r() * 0.4, 0, Math.PI * 2); c.fill();
        const hg = h.createRadialGradient(cx + dx, cy + dy, 1, cx + dx, cy + dy, rx);
        hg.addColorStop(0, '#fff'); hg.addColorStop(0.7, '#aaa'); hg.addColorStop(1, '#222');
        h.fillStyle = hg;
        h.beginPath(); h.ellipse(cx + dx, cy + dy, rx, ry, 0, 0, Math.PI * 2); h.fill();
      }
    }
  }
  grime(col, 0.3, 4, noiseA, [12, 10, 4]);
  const height = readHeight(hc);
  addHeightNoise(height, W, W, 0.3, 32);
  return { map: toTexture(col), normalMap: heightToNormal(height, W, W, 2.5) };
}

export function grassTextures() {
  const W = 512;
  const col = makeCanvas(W), hc = makeCanvas(W);
  const c = col.getContext('2d');
  const img = c.createImageData(W, W);
  const height = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const n = noiseA.fbm(x / W, y / W, 4, 5);
      const m = noiseB.fbm(x / W, y / W, 32, 3);
      const i = (y * W + x) * 4;
      img.data[i] = 70 + n * 60 + m * 30;
      img.data[i + 1] = 95 + n * 55 + m * 25;
      img.data[i + 2] = 35 + n * 20;
      img.data[i + 3] = 255;
      height[y * W + x] = m;
    }
  }
  c.putImageData(img, 0, 0);
  const r = mulberry32(3);
  for (let i = 0; i < 9000; i++) {
    const x = r() * W, y = r() * W, l = 3 + r() * 7;
    c.strokeStyle = r() < 0.5 ? 'rgba(150,170,70,0.5)' : 'rgba(40,60,20,0.5)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 3, y - l); c.stroke();
  }
  return { map: toTexture(col), normalMap: heightToNormal(height, W, W, 1.5) };
}

export function stoneWallTextures() {
  const W = 512;
  const col = makeCanvas(W), hc = makeCanvas(W);
  const c = col.getContext('2d'), h = hc.getContext('2d');
  const r = mulberry32(21);
  c.fillStyle = '#5c564c'; c.fillRect(0, 0, W, W);
  h.fillStyle = '#000'; h.fillRect(0, 0, W, W);
  const rows = 8;
  const rh = W / rows;
  for (let y = 0; y < rows; y++) {
    let x = -r() * 60;
    while (x < W) {
      const bw = 80 + r() * 110;
      const b = 140 + r() * 50;
      const tone = r();
      c.fillStyle = `rgb(${b},${b * (0.94 + tone * 0.04)},${b * (0.86 + tone * 0.05)})`;
      c.fillRect(x + 3, y * rh + 3, bw - 6, rh - 6);
      h.fillStyle = `rgb(${200 + r() * 40},0,0)`;
      h.fillStyle = '#d0d0d0';
      h.fillRect(x + 3, y * rh + 3, bw - 6, rh - 6);
      h.fillStyle = '#ffffff';
      h.fillRect(x + 8, y * rh + 8, bw - 16, rh - 16);
      if (x + bw > W) { // wrap
        c.fillRect(x + 3 - W, y * rh + 3, bw - 6, rh - 6);
        h.fillRect(x + 8 - W, y * rh + 8, bw - 16, rh - 16);
      }
      x += bw;
    }
  }
  grime(col, 0.35, 4, noiseA, [10, 16, 4]);
  const height = readHeight(hc);
  addHeightNoise(height, W, W, 0.5, 16);
  return { map: toTexture(col), normalMap: heightToNormal(height, W, W, 2.2) };
}

export function barkTextures() {
  const W = 256, H = 512;
  const col = makeCanvas(W, H);
  const c = col.getContext('2d');
  const img = c.createImageData(W, H);
  const height = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n1 = noiseA.fbm(x / W, (y / H) * 0.25, 16, 4);
      const n2 = noiseB.fbm(x / W, y / H, 8, 5);
      const ridge = Math.pow(Math.abs(Math.sin((x / W) * Math.PI * 22 + n2 * 6)), 0.6);
      const v = ridge * 0.7 + n1 * 0.3;
      const i = (y * W + x) * 4;
      img.data[i] = 50 + v * 70;
      img.data[i + 1] = 38 + v * 50;
      img.data[i + 2] = 28 + v * 34;
      img.data[i + 3] = 255;
      height[y * W + x] = v;
    }
  }
  c.putImageData(img, 0, 0);
  return { map: toTexture(col), normalMap: heightToNormal(height, W, H, 4) };
}

export function skinTextures() {
  const W = 256;
  const col = makeCanvas(W);
  const c = col.getContext('2d');
  const img = c.createImageData(W, W);
  const height = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const n = noiseA.fbm(x / W, y / W, 8, 5);
      const m = noiseB.fbm(x / W, y / W, 32, 3);
      const i = (y * W + x) * 4;
      img.data[i] = 225 + n * 30;
      img.data[i + 1] = 205 + n * 30 - m * 18;
      img.data[i + 2] = 200 + n * 25 - m * 20;
      img.data[i + 3] = 255;
      height[y * W + x] = n * 0.6 + m * 0.4;
    }
  }
  c.putImageData(img, 0, 0);
  return { map: toTexture(col), normalMap: heightToNormal(height, W, W, 1.2) };
}

export function leafTextures() {
  const W = 256;
  const col = makeCanvas(W);
  const c = col.getContext('2d');
  const img = c.createImageData(W, W);
  const height = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const n = noiseA.fbm(x / W, y / W, 16, 4);
      const v = Math.pow(n, 1.5);
      const i = (y * W + x) * 4;
      img.data[i] = 40 + v * 70;
      img.data[i + 1] = 70 + v * 90;
      img.data[i + 2] = 25 + v * 30;
      img.data[i + 3] = 255;
      height[y * W + x] = n;
    }
  }
  c.putImageData(img, 0, 0);
  return { map: toTexture(col), normalMap: heightToNormal(height, W, W, 6) };
}

export function capeTexture() {
  const W = 256, H = 384;
  const col = makeCanvas(W, H);
  const c = col.getContext('2d');
  c.fillStyle = '#2f4a2c'; c.fillRect(0, 0, W, H);
  // weave
  for (let y = 0; y < H; y += 2) { c.fillStyle = y % 4 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.04)'; c.fillRect(0, y, W, 1); }
  for (let x = 0; x < W; x += 2) { c.fillStyle = 'rgba(0,0,0,0.06)'; c.fillRect(x, 0, 1, H); }
  grime(col, 0.2, 4, noiseA);
  // emblem: two overlapping stylised wings on a shield
  const cx = W / 2, cy = H * 0.34;
  c.save();
  c.translate(cx, cy);
  c.fillStyle = '#e8e1cc';
  c.beginPath();
  c.moveTo(-52, -48); c.lineTo(52, -48); c.lineTo(52, 10); c.quadraticCurveTo(52, 52, 0, 66); c.quadraticCurveTo(-52, 52, -52, 10); c.closePath();
  c.fill();
  c.fillStyle = '#3a2c20';
  c.beginPath();
  c.moveTo(-46, -42); c.lineTo(46, -42); c.lineTo(46, 10); c.quadraticCurveTo(46, 46, 0, 59); c.quadraticCurveTo(-46, 46, -46, 10); c.closePath();
  c.fill();
  const wing = (dir, color) => {
    c.fillStyle = color;
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      const y0 = -26 + i * 13;
      c.moveTo(0, y0 + 26);
      c.quadraticCurveTo(dir * 18, y0 - 6, dir * (38 - i * 4), y0 - 4);
      c.quadraticCurveTo(dir * (30 - i * 4), y0 + 8, dir * 6, y0 + 30);
      c.closePath(); c.fill();
    }
  };
  wing(-1, '#f2efe6');
  wing(1, '#3f6fb0');
  c.restore();
  return toTexture(col, true, false);
}

export function smokeSprite() {
  const W = 128;
  const col = makeCanvas(W);
  const c = col.getContext('2d');
  const img = c.createImageData(W, W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x / W - 0.5, dy = y / W - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      const n = noiseA.fbm(x / W, y / W, 4, 5);
      let a = Math.max(0, 1 - d) ;
      a = Math.pow(a, 1.2) * (0.55 + n * 0.9);
      a = Math.min(1, Math.max(0, a * 1.1 - 0.05));
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 * (0.82 + n * 0.18);
      img.data[i + 3] = a * 255;
    }
  }
  c.putImageData(img, 0, 0);
  return toTexture(col, true, false);
}

export function glowSprite() {
  const W = 64;
  const col = makeCanvas(W);
  const c = col.getContext('2d');
  const g = c.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, W, W);
  return toTexture(col, true, false);
}

export function cloudSprite(seed = 1) {
  const W = 256;
  const col = makeCanvas(W);
  const c = col.getContext('2d');
  const img = c.createImageData(W, W);
  const nz = new Noise(seed * 31 + 3);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x / W - 0.5) * 2, dy = (y / W - 0.55) * 3.2;
      const d = Math.sqrt(dx * dx + dy * dy);
      const n = nz.fbm(x / W, y / W, 4, 6);
      let a = Math.max(0, (1 - d) * 1.6 + (n - 0.5) * 1.6);
      a = Math.min(1, a);
      const shade = 0.7 + 0.3 * (1 - y / W) + (n - 0.5) * 0.2;
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 * Math.min(1, shade);
      img.data[i + 3] = a * a * 255;
    }
  }
  c.putImageData(img, 0, 0);
  return toTexture(col, true, false);
}

export function metalTexture() {
  const W = 128;
  const col = makeCanvas(W);
  const c = col.getContext('2d');
  c.fillStyle = '#9aa0a6'; c.fillRect(0, 0, W, W);
  for (let i = 0; i < W; i++) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`; c.fillRect(0, i, W, 1); }
  return toTexture(col);
}
