import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);
export const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];

export function dampVec3(v, target, lambda, dt) {
  const t = 1 - Math.exp(-lambda * dt);
  v.x += (target.x - v.x) * t;
  v.y += (target.y - v.y) * t;
  v.z += (target.z - v.z) * t;
  return v;
}

const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
export function closestPointOnSegment(p, a, b, out) {
  _ab.subVectors(b, a);
  const len2 = _ab.lengthSq();
  let t = len2 > 1e-9 ? _ap.subVectors(p, a).dot(_ab) / len2 : 0;
  t = clamp(t, 0, 1);
  return out.copy(a).addScaledVector(_ab, t);
}

const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _r = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();
export function segSegDist2(p1, q1, p2, q2, outA, outB) {
  _d1.subVectors(q1, p1);
  _d2.subVectors(q2, p2);
  _r.subVectors(p1, p2);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  let s, t;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) {
    s = t = 0;
  } else if (a <= EPS) {
    s = 0; t = clamp(f / e, 0, 1);
  } else {
    const c = _d1.dot(_r);
    if (e <= EPS) {
      t = 0; s = clamp(-c / a, 0, 1);
    } else {
      const b = _d1.dot(_d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  _c1.copy(p1).addScaledVector(_d1, s);
  _c2.copy(p2).addScaledVector(_d2, t);
  if (outA) outA.copy(_c1);
  if (outB) outB.copy(_c2);
  return _c1.distanceToSquared(_c2);
}

export const DEFAULT_BINDS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  hookL: 'KeyQ',
  hookR: 'KeyE',
  reel: 'Space',
  boost: 'ShiftLeft',
  reloadBlade: 'KeyR',
  reloadGas: 'KeyC',
  spear: 'KeyX',
  command: 'KeyT',
  hookMode: 'KeyF',
  viewToggle: 'KeyV',
  help: 'KeyH',
};

export const BIND_LABELS = [
  ['forward', 'Move Forward'],
  ['back', 'Move Backward'],
  ['left', 'Move Left'],
  ['right', 'Move Right'],
  ['hookL', 'Left Grapple Hook'],
  ['hookR', 'Right Grapple Hook'],
  ['reel', 'Winch Reel / Jump / Wall-Kick'],
  ['boost', 'Gas Boost / Vector Steer'],
  ['reloadBlade', 'Swap Blades'],
  ['reloadGas', 'Replace Gas Canister'],
  ['spear', 'Fire / Detonate Thunder Spear'],
  ['command', 'Squad Order & Artillery'],
  ['hookMode', 'Toggle Grapple Mode (Smart / Focus)'],
  ['viewToggle', 'Toggle Camera View (1st / 3rd)'],
  ['help', 'Toggle Controls Overlay'],
];

export function formatKey(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map = {
    Space: 'SPACE',
    ShiftLeft: 'L-SHIFT',
    ShiftRight: 'R-SHIFT',
    ControlLeft: 'L-CTRL',
    ControlRight: 'R-CTRL',
    AltLeft: 'L-ALT',
    AltRight: 'R-ALT',
    Tab: 'TAB',
    CapsLock: 'CAPS',
    Backquote: '`',
    BracketLeft: '[',
    BracketRight: ']',
    ArrowUp: 'UP',
    ArrowDown: 'DOWN',
    ArrowLeft: 'LEFT',
    ArrowRight: 'RIGHT',
  };
  return map[code] || code.toUpperCase();
}

const STORAGE_KEY = 'wos-prefs-v2';
export function loadPrefs(defaults) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaults, binds: { ...DEFAULT_BINDS, ...(defaults.binds || {}) } };
    const parsed = JSON.parse(raw);
    return {
      ...defaults,
      ...parsed,
      binds: { ...DEFAULT_BINDS, ...(defaults.binds || {}), ...(parsed.binds || {}) },
    };
  } catch {
    return { ...defaults, binds: { ...DEFAULT_BINDS, ...(defaults.binds || {}) } };
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}
