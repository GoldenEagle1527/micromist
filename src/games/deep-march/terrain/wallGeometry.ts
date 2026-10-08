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
 *    (periodic low-frequency octave), flattened near the cracks (wallSlit.ts);
 *  - the cracks: slits through a thin shell (wallSlit.ts; the density cuts them);
 *  - the outer face is sd = thickness: the inner face never moves, the wall thins
 *    outward (§4.1).
 */
import { TERRAIN } from "./config";
import type { WorldRect } from "./siteLayout";
import { WALL_SHAPE, type WallShapeTuning } from "./wallConfig";
import { createWallSlits, wallHash01 as hash01, type WallSlits } from "./wallSlit";

/**
 * A crack (M6): centre arc length and opening width, metres. The conserve chaos also
 * passes its model depth, `through` and `extent` (the opening's arc range, m); the
 * terrain draws every crack the same way — a slit through the shell, never passable
 * (wallSlit.ts) — and reads s / width only.
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
  /** Range of face(): [inset, inset + relief + swell] (the cracks only flatten it). */
  faceMin: number;
  faceMax: number;
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
  /** How far the inner face stands inside the outline (the face is sd = −face). */
  face: (s: number, y: number) => number;
  /** The face without the cracks' flattening. */
  facet: (s: number, y: number) => number;
  /** The open cracks' slits (count 0: none). */
  slits: WallSlits;
};

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

  const faceMax = inset + relief + swell;
  const slits = createWallSlits(spec.cracks, seed, P, faceMax, t);
  const keep = 1 - t.crackRelief;
  const face = slits.count
    ? (s: number, y: number) => {
        const h = facet(s, y), f = slits.flat(s);
        return f > 0 ? inset + (h - inset) * (1 - f * keep) : h;
      }
    : facet;

  return {
    cx, cz, a, b, rc, perimeter: P, thickness: spec.thickness / U,
    faceMin: inset, faceMax,
    ns, nr, ds, dy, y0, locate, point, face, facet, slits,
  };
}
