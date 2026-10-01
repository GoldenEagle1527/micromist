/**
 * Ring-wall geometry (design doc §4.4): pure functions shared by the density term
 * (density.ts), the wall material weight, the far proxy ring (wallRing.ts) and, later,
 * placement. Base units (the density field's p / worldScale); the spec and the
 * tunables (wallConfig.ts) are metres, divided by WALL_UNIT = TERRAIN.worldScale.
 *
 *  - outline: the world rectangle with rounded corners (radius rc). locate(x, z)
 *    gives the signed distance sd (+ outward) and the arc length s ∈ [0, P) along it
 *    (counter-clockwise from the +x side's middle);
 *  - face(s, y): how far the inner face stands inside the outline (the face is
 *    sd = −face). Piecewise linear on a staggered lattice in (s, y): planar
 *    triangular facets, node offsets inset + relief·(quantised hash) + swell
 *    (periodic low-frequency octave) — minus the crack notches (M6);
 *  - the outer face is sd = thickness: the inner face never moves, the wall thins
 *    outward (§4.1).
 */
import { TERRAIN } from "./config";
import type { WorldRect } from "./siteLayout";
import { WALL_SHAPE, type WallShapeTuning } from "./wallConfig";

/**
 * A crack (M6): centre arc length, opening width and depth into the wall, metres.
 * The conserve chaos also passes `through` (the notch runs past the outer face:
 * passable) and `extent` (the opening's arc range, m) for streaming beyond the
 * wall (M8); the geometry reads s / width / depth only.
 */
export type WallCrack = { s: number; width: number; depth: number; through?: boolean; extent?: readonly [number, number] };
/** The wall of a bounded world (SiteLayout.wall): thickness in metres, cracks; anomaly: chaos stage 3+ terrain strength near the cracks (0 … 1, anomaly.ts; absent = 0). */
export type WallSpec = { thickness: number; cracks: readonly WallCrack[]; anomaly?: number };

/** Metres per base unit of the wall's spec and tunables. */
export const WALL_UNIT = TERRAIN.worldScale;
const HALF_PI = Math.PI / 2;

export type WallShape = {
  /** Outline centre, straight half-lengths (a, b), corner radius; base units. */
  cx: number;
  cz: number;
  a: number;
  b: number;
  rc: number;
  /** Outline length (period of s). */
  perimeter: number;
  thickness: number;
  /** Range of face() without cracks: [inset, inset + relief + swell]. */
  faceMin: number;
  faceMax: number;
  /** Deepest crack (face() ≥ faceMin − crackMax). */
  crackMax: number;
  /** Facet lattice: nodes along s, rows, spacings. */
  ns: number;
  nr: number;
  ds: number;
  dy: number;
  y0: number;
  /** out[0] = sd, out[1] = s. */
  locate: (x: number, z: number, out: Float64Array) => void;
  /** Outline point at arc length s moved `inward` toward the inside: out = [x, z, nx, nz] (outward normal). */
  point: (s: number, inward: number, out: Float64Array) => void;
  face: (s: number, y: number) => number;
  facet: (s: number, y: number) => number;
  crack: (s: number, y: number) => number;
  /** Open cracks in the spec (M8: the glow weight, terrain/crackWeight.ts). */
  notches: number;
  /** Crack i's opening profile at (s, y): 1 on its (jagged) centre line, 0 beyond its half-width. */
  notch: (i: number, s: number, y: number) => number;
  /** Crack i's depth into the wall (base units). */
  notchDepth: (i: number) => number;
};

function hash01(seed: number, i: number, j: number): number {
  let h = (seed ^ 0x2545f491) >>> 0;
  h = Math.imul(h ^ i, 0x85ebca6b) >>> 0;
  h = Math.imul((h ^ (h >>> 13)) ^ j, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const smooth01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** rect: the world rectangle in base units. */
export function createWallShape(rect: WorldRect, spec: WallSpec, seed: number, t: WallShapeTuning = WALL_SHAPE): WallShape {
  const U = WALL_UNIT;
  const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
  const hx = (rect.x1 - rect.x0) / 2, hz = (rect.z1 - rect.z0) / 2;
  const rc = Math.min(t.cornerRadius / U, hx, hz);
  const a = hx - rc, b = hz - rc;
  const Q = b + rc * HALF_PI + a;
  const P = 4 * Q;
  const ns = Math.max(8, Math.round(P / (t.facetAlong / U)));
  const ds = P / ns;
  const dy = t.facetRow / U, y0 = t.yMin / U;
  const nr = Math.max(2, Math.ceil((t.yMax - t.yMin) / t.facetRow) + 1);
  const inset = t.inset / U, relief = t.relief / U, swell = t.swell / U;
  const k1 = Math.max(1, Math.round(P / (t.swellWave / U)));
  const ph1 = hash01(seed, 7, 1) * 2 * Math.PI, ph2 = hash01(seed, 7, 2) * 2 * Math.PI;
  const h = new Float64Array(ns * nr);
  for (let j = 0; j < nr; j++) {
    for (let i = 0; i < ns; i++) {
      const s = (i + 0.5 * (j & 1)) * ds;
      const q = Math.min(t.levels - 1, Math.floor(hash01(seed, i, j) * t.levels)) / Math.max(1, t.levels - 1);
      const wave = 0.6 * Math.sin((2 * Math.PI * k1 * s) / P + ph1) + 0.4 * Math.sin((2 * Math.PI * (2 * k1 + 1) * s) / P + ph2);
      h[j * ns + i] = inset + relief * q + swell * (0.5 + 0.5 * wave);
    }
  }
  const cracks = spec.cracks.map((c) => ({ s: c.s / U, half: Math.max(1e-6, c.width / U / 2), depth: c.depth / U, jag: (t.crackJag * c.width) / U, ph: hash01(seed, Math.round(c.s), 3) }));
  const jagP = t.crackJagPeriod / U;

  const locate = (x: number, z: number, out: Float64Array) => {
    const dx = x - cx, dz = z - cz;
    const ax = Math.abs(dx), az = Math.abs(dz);
    const qx = ax - a, qz = az - b;
    let sd: number, u: number;
    if (qx > 0 && qz > 0) {
      sd = Math.sqrt(qx * qx + qz * qz) - rc;
      u = b + rc * Math.atan2(qz, qx);
    } else if (qx >= qz) {
      sd = qx - rc;
      u = Math.min(az, b);
    } else {
      sd = qz - rc;
      u = b + rc * HALF_PI + (a - Math.min(ax, a));
    }
    let s = dx >= 0 ? (dz >= 0 ? u : 4 * Q - u) : dz >= 0 ? 2 * Q - u : 2 * Q + u;
    if (s >= P) s -= P;
    out[0] = sd;
    out[1] = s;
  };

  const point = (s: number, inward: number, out: Float64Array) => {
    s = ((s % P) + P) % P;
    const q = Math.min(3, Math.floor(s / Q));
    const u = q === 0 ? s : q === 1 ? 2 * Q - s : q === 2 ? s - 2 * Q : 4 * Q - s;
    let px: number, pz: number, nx: number, nz: number;
    if (u <= b) [px, pz, nx, nz] = [a + rc, u, 1, 0];
    else if (u <= b + rc * HALF_PI) {
      const th = (u - b) / rc;
      [nx, nz] = [Math.cos(th), Math.sin(th)];
      [px, pz] = [a + rc * nx, b + rc * nz];
    } else [px, pz, nx, nz] = [a - (u - b - rc * HALF_PI), b + rc, 0, 1];
    const sx = q === 0 || q === 3 ? 1 : -1, sz = q <= 1 ? 1 : -1;
    out[2] = nx * sx;
    out[3] = nz * sz;
    out[0] = cx + px * sx - out[2] * inward;
    out[1] = cz + pz * sz - out[3] * inward;
  };

  const facet = (s: number, y: number): number => {
    let v = (y - y0) / dy;
    let j = Math.floor(v);
    if (j < 0) {
      j = 0;
      v = 0;
    } else if (j > nr - 2) {
      j = nr - 2;
      v = 1;
    } else v -= j;
    const odd = j & 1;
    const u = s / ds - 0.5 * odd - (odd ? -0.5 : 0.5) * v;
    let i = Math.floor(u);
    const fu = u - i;
    i = ((i % ns) + ns) % ns;
    const i1 = i + 1 === ns ? 0 : i + 1;
    const B0 = h[j * ns + i], B1 = h[j * ns + i1], T0 = h[(j + 1) * ns + i], T1 = h[(j + 1) * ns + i1];
    if (!odd) return fu + v <= 1 ? B0 + (B1 - B0) * fu + (T0 - B0) * v : T1 + (T0 - T1) * (1 - fu) + (B1 - T1) * (1 - v);
    return fu >= v ? B0 + (B1 - B0) * fu + (T1 - B1) * v : B0 + (T0 - B0) * v + (T1 - T0) * fu;
  };

  const profile = (c: (typeof cracks)[number], s: number, y: number): number => {
    let ds_ = s - c.s;
    ds_ -= P * Math.round(ds_ / P);
    const tri = 2 * Math.abs(2 * ((y / jagP + c.ph) - Math.floor(y / jagP + c.ph + 0.5))) - 1;
    return smooth01(1 - Math.abs(ds_ + c.jag * tri) / c.half);
  };
  const crack = (s: number, y: number): number => {
    let d = 0;
    for (const c of cracks) {
      const p = profile(c, s, y);
      if (p * c.depth > d) d = p * c.depth;
    }
    return d;
  };
  const face = cracks.length ? (s: number, y: number) => facet(s, y) - crack(s, y) : facet;

  return {
    cx, cz, a, b, rc, perimeter: P, thickness: spec.thickness / U,
    faceMin: inset, faceMax: inset + relief + swell, crackMax: cracks.reduce((m, c) => Math.max(m, c.depth), 0),
    ns, nr, ds, dy, y0, locate, point, face, facet, crack,
    notches: cracks.length,
    notch: (i, s, y) => profile(cracks[i], s, y),
    notchDepth: (i) => cracks[i].depth,
  };
}
