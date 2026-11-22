import * as THREE from 'three';
import { closestPointOnSegment } from './util.js';

const _l = new THREE.Vector3();
const _ld = new THREE.Vector3();
const _cp = new THREE.Vector3();

export function createRayHit() {
  return {
    t: Infinity,
    normal: new THREE.Vector3(),
    point: new THREE.Vector3(),
    collider: null,
    surface: null,
    hookable: false,
    inflated: false,
    lockOwner: null,
  };
}

export class Convex {
  constructor(center, yaw, planes, radius, opts = {}) {
    this.kind = 'convex';
    this.c = center.clone();
    this.yaw = yaw;
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
    this.planes = planes;
    this.radius = radius;
    this.surface = opts.surface || 'stone';
    this.hookable = opts.hookable !== false;
    this._stamp = 0;
  }
  toLocal(p, out) {
    const dx = p.x - this.c.x, dy = p.y - this.c.y, dz = p.z - this.c.z;
    return out.set(this.cos * dx - this.sin * dz, dy, this.sin * dx + this.cos * dz);
  }
  dirToLocal(d, out) {
    return out.set(this.cos * d.x - this.sin * d.z, d.y, this.sin * d.x + this.cos * d.z);
  }
  dirToWorld(d, out) {
    return out.set(this.cos * d.x + this.sin * d.z, d.y, -this.sin * d.x + this.cos * d.z);
  }
  raycast(o, d, maxT, out) {
    const ox = o.x - this.c.x, oy = o.y - this.c.y, oz = o.z - this.c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const cc = ox * ox + oy * oy + oz * oz - this.radius * this.radius;
    if (cc > 0 && b > 0) return false;
    if (b * b - cc < 0) return false;
    this.toLocal(o, _l);
    this.dirToLocal(d, _ld);
    let tE = -Infinity, tX = Infinity, best = -1;
    const P = this.planes;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      const denom = p[0] * _ld.x + p[1] * _ld.y + p[2] * _ld.z;
      const dist = p[3] - (p[0] * _l.x + p[1] * _l.y + p[2] * _l.z);
      if (Math.abs(denom) < 1e-9) {
        if (dist < 0) return false;
        continue;
      }
      const t = dist / denom;
      if (denom < 0) { if (t > tE) { tE = t; best = i; } }
      else if (t < tX) tX = t;
      if (tE > tX) return false;
    }
    if (best < 0 || tE < 0 || tE > maxT || tE >= out.t) return false;
    out.t = tE;
    const p = P[best];
    this.dirToWorld(_cp.set(p[0], p[1], p[2]), out.normal);
    out.collider = this;
    out.surface = this.surface;
    out.hookable = this.hookable;
    return true;
  }
  sphere(p, r, outN) {
    const dx = p.x - this.c.x, dy = p.y - this.c.y, dz = p.z - this.c.z;
    if (dx * dx + dy * dy + dz * dz > (this.radius + r) * (this.radius + r)) return 0;
    this.toLocal(p, _l);
    let maxS = -Infinity, best = -1;
    const P = this.planes;
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      const s = q[0] * _l.x + q[1] * _l.y + q[2] * _l.z - q[3];
      if (s > r) return 0;
      if (s > maxS) { maxS = s; best = i; }
    }
    const q = P[best];
    this.dirToWorld(_cp.set(q[0], q[1], q[2]), outN);
    return r - maxS;
  }
}

export function boxPlanes(hx, hy, hz) {
  return [
    [1, 0, 0, hx], [-1, 0, 0, hx],
    [0, 1, 0, hy], [0, -1, 0, hy],
    [0, 0, 1, hz], [0, 0, -1, hz],
  ];
}

export function prismPlanes(hx, rh, hz) {
  const L = Math.hypot(hz, rh);
  return [
    [1, 0, 0, hx], [-1, 0, 0, hx], [0, -1, 0, 0],
    [0, hz / L, rh / L, (rh * hz) / L],
    [0, hz / L, -rh / L, (rh * hz) / L],
  ];
}

export class VCylinder {
  constructor(x, z, r, y0, y1, opts = {}) {
    this.kind = 'cyl';
    this.x = x; this.z = z; this.r = r; this.y0 = y0; this.y1 = y1;
    this.surface = opts.surface || 'wood';
    this.hookable = opts.hookable !== false;
    this._stamp = 0;
  }
  raycast(o, d, maxT, out) {
    const ox = o.x - this.x, oz = o.z - this.z;
    const a = d.x * d.x + d.z * d.z;
    let hit = false;
    if (a > 1e-9) {
      const b = ox * d.x + oz * d.z;
      const c = ox * ox + oz * oz - this.r * this.r;
      const h = b * b - a * c;
      if (h >= 0) {
        const t = (-b - Math.sqrt(h)) / a;
        if (t >= 0 && t <= maxT && t < out.t) {
          const y = o.y + d.y * t;
          if (y >= this.y0 && y <= this.y1) {
            out.t = t;
            out.normal.set(ox + d.x * t, 0, oz + d.z * t).normalize();
            hit = true;
          }
        }
      }
    }
    if (Math.abs(d.y) > 1e-6 && o.y > this.y1 && d.y < 0) {
      const t = (this.y1 - o.y) / d.y;
      if (t >= 0 && t <= maxT && t < out.t) {
        const x = ox + d.x * t, z = oz + d.z * t;
        if (x * x + z * z <= this.r * this.r) { out.t = t; out.normal.set(0, 1, 0); hit = true; }
      }
    }
    if (hit) { out.collider = this; out.surface = this.surface; out.hookable = this.hookable; }
    return hit;
  }
  sphere(p, r, outN) {
    if (p.y < this.y0 - r || p.y > this.y1 + r) return 0;
    const dx = p.x - this.x, dz = p.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d >= this.r + r) return 0;
    if (p.y > this.y1 && d < this.r) { outN.set(0, 1, 0); return this.y1 + r - p.y; }
    if (d < 1e-6) { outN.set(1, 0, 0); return this.r + r; }
    outN.set(dx / d, 0, dz / d);
    return this.r + r - d;
  }
}

const _ba = new THREE.Vector3();
const _oa = new THREE.Vector3();
const _oc = new THREE.Vector3();
export function rayCapsule(o, d, a, b, ra) {
  _ba.subVectors(b, a);
  _oa.subVectors(o, a);
  const baba = _ba.dot(_ba), bard = _ba.dot(d), baoa = _ba.dot(_oa);
  const rdoa = d.dot(_oa), oaoa = _oa.dot(_oa);
  const A = baba - bard * bard;
  const B = baba * rdoa - baoa * bard;
  const C = baba * oaoa - baoa * baoa - ra * ra * baba;
  const h = B * B - A * C;
  if (h >= 0 && Math.abs(A) > 1e-9) {
    const t = (-B - Math.sqrt(h)) / A;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t;
  }
  let best = -1;
  for (let i = 0; i < 2; i++) {
    const cpt = i === 0 ? a : b;
    _oc.subVectors(o, cpt);
    const bb = d.dot(_oc);
    const cc = _oc.dot(_oc) - ra * ra;
    const hh = bb * bb - cc;
    if (hh > 0) {
      const t = -bb - Math.sqrt(hh);
      if (t >= 0 && (best < 0 || t < best)) best = t;
    }
  }
  return best;
}

export class Capsule {
  constructor(a, b, r, opts = {}) {
    this.kind = 'capsule';
    this.a = a.clone(); this.b = b.clone(); this.r = r;
    this.surface = opts.surface || 'wood';
    this.hookable = opts.hookable !== false;
    this.owner = opts.owner || null;
    this.part = opts.part || null;
    this._stamp = 0;
  }
  raycast(o, d, maxT, out) {
    const t = rayCapsule(o, d, this.a, this.b, this.r);
    if (t < 0 || t > maxT || t >= out.t) return false;
    out.t = t;
    const p = _l.copy(o).addScaledVector(d, t);
    closestPointOnSegment(p, this.a, this.b, _cp);
    out.normal.subVectors(p, _cp).normalize();
    out.collider = this; out.surface = this.surface; out.hookable = this.hookable;
    return true;
  }
  sphere(p, r, outN) {
    closestPointOnSegment(p, this.a, this.b, _cp);
    outN.subVectors(p, _cp);
    const d = outN.length();
    if (d >= this.r + r) return 0;
    if (d < 1e-6) outN.set(0, 1, 0); else outN.multiplyScalar(1 / d);
    return this.r + r - d;
  }
}

export class RingWall {
  constructor(R, T, H, gapCenter, gapHalf) {
    this.kind = 'ring';
    this.R = R; this.T = T; this.H = H;
    this.gapCenter = gapCenter; this.gapHalf = gapHalf;
    this.sealed = false;
    this.surface = 'stone';
    this.hookable = true;
    this._stamp = 0;
  }
  inGap(x, z) {
    if (this.sealed) return false;
    let a = Math.atan2(x, z) - this.gapCenter;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    return Math.abs(a) < this.gapHalf;
  }
  _circle(o, d, R, far) {
    const a = d.x * d.x + d.z * d.z;
    if (a < 1e-9) return -1;
    const b = o.x * d.x + o.z * d.z;
    const c = o.x * o.x + o.z * o.z - R * R;
    const h = b * b - a * c;
    if (h < 0) return -1;
    const s = Math.sqrt(h);
    return far ? (-b + s) / a : (-b - s) / a;
  }
  raycast(o, d, maxT, out) {
    const rho = Math.hypot(o.x, o.z);
    let hit = false;
    const test = (t, nx, ny, nz) => {
      if (t < 0 || t > maxT || t >= out.t) return;
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (this.inGap(x, z)) return;
      if (ny === 0 && (y < 0 || y > this.H)) return;
      out.t = t; out.normal.set(nx, ny, nz); hit = true;
      if (ny === 0) {
        const l = Math.hypot(x, z);
        out.normal.set((x / l) * nx, 0, (z / l) * nx);
      }
    };
    if (rho < this.R) test(this._circle(o, d, this.R, true), -1, 0, 0);
    else if (rho > this.R + this.T) test(this._circle(o, d, this.R + this.T, false), 1, 0, 0);
    if (o.y > this.H && d.y < 0) {
      const t = (this.H - o.y) / d.y;
      const x = o.x + d.x * t, z = o.z + d.z * t;
      const r = Math.hypot(x, z);
      if (r >= this.R && r <= this.R + this.T) test(t, 0, 1, 0);
    }
    if (hit) { out.collider = this; out.surface = 'stone'; out.hookable = true; }
    return hit;
  }
  sphere(p, r, outN) {
    if (p.y > this.H + r) return 0;
    const rho = Math.hypot(p.x, p.z);
    if (rho < this.R - r || rho > this.R + this.T + r) return 0;
    if (this.inGap(p.x, p.z)) return 0;
    const nx = p.x / rho, nz = p.z / rho;
    if (p.y > this.H && rho > this.R && rho < this.R + this.T) { outN.set(0, 1, 0); return this.H + r - p.y; }
    const mid = this.R + this.T / 2;
    if (rho < mid) {
      const pen = rho + r - this.R;
      if (pen <= 0) return 0;
      if (p.y > this.H - 0.3 && this.H + r - p.y < pen) { outN.set(0, 1, 0); return this.H + r - p.y; }
      outN.set(-nx, 0, -nz); return pen;
    }
    const pen = this.R + this.T + r - rho;
    if (pen <= 0) return 0;
    if (p.y > this.H - 0.3 && this.H + r - p.y < pen) { outN.set(0, 1, 0); return this.H + r - p.y; }
    outN.set(nx, 0, nz); return pen;
  }
}

export class CollisionWorld {
  constructor() {
    this.statics = [];
    this.dynamics = [];
    this.cellSize = 40;
    this.grid = new Map();
    this.unbounded = [];
    this._stamp = 1;
  }
  add(c) {
    this.statics.push(c);
    return c;
  }
  remove(c) {
    const i = this.statics.indexOf(c);
    if (i >= 0) this.statics.splice(i, 1);
  }
  build() {
    this.grid.clear();
    this.unbounded.length = 0;
    const s = this.cellSize;
    for (let idx = 0; idx < this.statics.length; idx++) {
      const c = this.statics[idx];
      let x, z, rad;
      if (c.kind === 'convex') { x = c.c.x; z = c.c.z; rad = c.radius; }
      else if (c.kind === 'cyl') { x = c.x; z = c.z; rad = c.r; }
      else if (c.kind === 'capsule') { x = (c.a.x + c.b.x) * 0.5; z = (c.a.z + c.b.z) * 0.5; rad = c.a.distanceTo(c.b) * 0.5 + c.r; }
      else { this.unbounded.push(c); continue; }
      const x0 = Math.floor((x - rad) / s), x1 = Math.floor((x + rad) / s);
      const z0 = Math.floor((z - rad) / s), z1 = Math.floor((z + rad) / s);
      for (let i = x0; i <= x1; i++) {
        for (let j = z0; j <= z1; j++) {
          const k = i * 100003 + j;
          let arr = this.grid.get(k);
          if (!arr) this.grid.set(k, (arr = []));
          arr.push(c);
        }
      }
    }
  }
  nearby(p, out) {
    out.length = 0;
    const s = this.cellSize;
    const i = Math.floor(p.x / s), j = Math.floor(p.z / s);
    const stamp = ++this._stamp;
    for (let a = i - 1; a <= i + 1; a++) {
      for (let b = j - 1; b <= j + 1; b++) {
        const arr = this.grid.get(a * 100003 + b);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const c = arr[k];
          if (c._stamp !== stamp) { c._stamp = stamp; out.push(c); }
        }
      }
    }
    for (let k = 0; k < this.unbounded.length; k++) out.push(this.unbounded[k]);
    return out;
  }
  raycast(o, d, maxT, opts = {}, out = null) {
    const hit = out || createRayHit();
    hit.t = Infinity;
    hit.collider = null;
    hit.surface = null;
    hit.hookable = false;
    hit.inflated = false;
    hit.lockOwner = null;
    if (d.y < -1e-6) {
      const t = -o.y / d.y;
      if (t >= 0 && t <= maxT) {
        hit.t = t;
        hit.normal.set(0, 1, 0);
        hit.surface = 'ground';
        hit.hookable = true;
      }
    }
    for (let i = 0; i < this.unbounded.length; i++) {
      this.unbounded[i].raycast(o, d, maxT, hit);
    }
    const s = this.cellSize;
    const stamp = ++this._stamp;
    const h2 = d.x * d.x + d.z * d.z;
    if (h2 < 1e-10) {
      const arr = this.grid.get(Math.floor(o.x / s) * 100003 + Math.floor(o.z / s));
      if (arr) {
        for (let k = 0; k < arr.length; k++) arr[k].raycast(o, d, maxT, hit);
      }
    } else {
      let cx = Math.floor(o.x / s), cz = Math.floor(o.z / s);
      const stepX = d.x >= 0 ? 1 : -1;
      const stepZ = d.z >= 0 ? 1 : -1;
      const tDeltaX = Math.abs(d.x) > 1e-8 ? Math.abs(s / d.x) : 1e30;
      const tDeltaZ = Math.abs(d.z) > 1e-8 ? Math.abs(s / d.z) : 1e30;
      let tMaxX = Math.abs(d.x) > 1e-8 ? ((d.x >= 0 ? (cx + 1) * s - o.x : o.x - cx * s) / Math.abs(d.x)) : 1e30;
      let tMaxZ = Math.abs(d.z) > 1e-8 ? ((d.z >= 0 ? (cz + 1) * s - o.z : o.z - cz * s) / Math.abs(d.z)) : 1e30;
      let tCell = 0;
      for (let steps = 0; steps < 64; steps++) {
        if (tCell > maxT || tCell > hit.t) break;
        const arr = this.grid.get(cx * 100003 + cz);
        if (arr) {
          const capT = Math.min(maxT, hit.t);
          for (let k = 0; k < arr.length; k++) {
            const c = arr[k];
            if (c._stamp === stamp) continue;
            c._stamp = stamp;
            c.raycast(o, d, capT, hit);
          }
        }
        if (tMaxX < tMaxZ) { tCell = tMaxX; tMaxX += tDeltaX; cx += stepX; }
        else { tCell = tMaxZ; tMaxZ += tDeltaZ; cz += stepZ; }
      }
    }
    if (opts.dynamics !== false) {
      const inf = opts.inflate || 0;
      for (let i = 0; i < this.dynamics.length; i++) {
        const c = this.dynamics[i];
        if (inf) {
          const r0 = c.r; c.r *= inf;
          if (c.raycast(o, d, maxT, hit)) hit.inflated = true;
          c.r = r0;
        } else c.raycast(o, d, maxT, hit);
      }
    }
    if (hit.t === Infinity) return null;
    hit.point.copy(o).addScaledVector(d, hit.t);
    return hit;
  }
}
