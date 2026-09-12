/** Deterministic seeding helpers for lumen-weave worlds. */

export function hashString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hashInts(a: number, b: number, c = 0, d = 0): number {
  let h = 2166136261 >>> 0;
  const mix = (n: number) => {
    h ^= n >>> 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  };
  mix(a);
  mix(b);
  mix(c);
  mix(d);
  return h >>> 0;
}

/** Mulberry32 — returns [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromInput(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) return ((Math.random() * 0xffffffff) >>> 0) || 1;
  if (/^-?\d+$/.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10);
    if (Number.isFinite(n)) return (n >>> 0) || 1;
  }
  return hashString(trimmed) || 1;
}

export function randomSeedString(): string {
  return String(((Math.random() * 0xffffffff) >>> 0) || 1);
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lattice(seed: number, ix: number, iy: number): number {
  return (hashInts(seed, ix | 0, iy | 0) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1). */
export function valueNoise2D(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const n00 = lattice(seed, x0, y0);
  const n10 = lattice(seed, x0 + 1, y0);
  const n01 = lattice(seed, x0, y0 + 1);
  const n11 = lattice(seed, x0 + 1, y0 + 1);
  return lerp(lerp(n00, n10, fx), lerp(n01, n11, fx), fy);
}

export function fbm2D(seed: number, x: number, y: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise2D(seed + i * 97, x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.05;
  }
  return norm > 0 ? sum / norm : 0;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
