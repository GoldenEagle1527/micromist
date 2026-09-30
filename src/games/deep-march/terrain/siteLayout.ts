/**
 * Explicit finite site layout — a mode-agnostic override of the macro-region site
 * grid (regions.ts) for a bounded world.
 *
 * The region field places one site per MACRO.cell grid cell. A layout replaces the
 * sites of a rectangle of cells (nx × nz cells from (cx0, cz0), base units) with
 * given data: jitter hashes, region id, variation hash and a density bias δ (raw
 * base density units, added as Σ_i w_i δ_i, see density.ts). Cells outside keep the
 * seeded default sites ("pseudo-sites" beyond the world edge: they shape the
 * blend along the border but carry no bias), so the field stays continuous.
 *
 * `wall` (optional): the ring wall along the rectangle (wallGeometry.ts) — its
 * thickness from the world's wall model, and cracks (M6).
 *
 * Plain data (typed arrays): crosses postMessage to the mesher workers unchanged.
 * Without a layout every term is an identity — the free dive is unaffected.
 */
import type { WallSpec } from "./wallGeometry";

export type SiteLayout = {
  /** First cell of the rectangle (base-unit site grid). */
  cx0: number;
  cz0: number;
  /** Cells across (x) and down (z). */
  nx: number;
  nz: number;
  /** Per site, row-major (i = iz·nx + ix): jitter hashes in [0, 1) → position in the cell. */
  jx: Float64Array;
  jz: Float64Array;
  /** Region id (0 … 5). */
  region: Int8Array;
  /** Variation hash in [0, 1) (canyon axis etc.). */
  hash: Float64Array;
  /** Density bias δ (raw base units; > 0 more rock). */
  bias: Float64Array;
  /** Ring wall along the rectangle; absent / null = none (open edge). */
  wall?: WallSpec | null;
};

/** World-space rectangle (x0 ≤ x ≤ x1, z0 ≤ z ≤ z1). */
export type WorldRect = { x0: number; z0: number; x1: number; z1: number };

/** Site index of cell (cx, cz), or −1 outside the layout. */
export function layoutIndex(l: SiteLayout, cx: number, cz: number): number {
  const ix = cx - l.cx0, iz = cz - l.cz0;
  if (ix < 0 || iz < 0 || ix >= l.nx || iz >= l.nz) return -1;
  return iz * l.nx + ix;
}

/** [min, max] of the bias over the layout, including 0 (pseudo-sites outside). */
export function layoutBiasRange(l: SiteLayout | null | undefined): [number, number] {
  let lo = 0, hi = 0;
  if (l) for (let i = 0; i < l.bias.length; i++) {
    if (l.bias[i] < lo) lo = l.bias[i];
    if (l.bias[i] > hi) hi = l.bias[i];
  }
  return [lo, hi];
}

/** The layout's cell rectangle in world units; cellSize = MACRO.cell × worldScale. */
export function layoutRect(l: SiteLayout, cellSize: number): WorldRect {
  const G = cellSize;
  return { x0: l.cx0 * G, z0: l.cz0 * G, x1: (l.cx0 + l.nx) * G, z1: (l.cz0 + l.nz) * G };
}

/** Does the square footprint [x0, x0 + size] × [z0, z0 + size] touch the rectangle? */
export function rectOverlaps(r: WorldRect, x0: number, z0: number, size: number): boolean {
  return x0 < r.x1 && x0 + size > r.x0 && z0 < r.z1 && z0 + size > r.z0;
}

/** Is (x, z) at least `margin` inside the rectangle? */
export function insideRect(r: WorldRect, x: number, z: number, margin = 0): boolean {
  return x >= r.x0 + margin && x <= r.x1 - margin && z >= r.z0 + margin && z <= r.z1 - margin;
}

/** Throws on a malformed layout (wrong lengths, region ids, non-finite values). */
export function assertSiteLayout(l: SiteLayout, regionCount: number): void {
  const n = l.nx * l.nz;
  if (!(Number.isInteger(l.nx) && Number.isInteger(l.nz) && l.nx > 0 && l.nz > 0)) throw new Error("SiteLayout: bad size");
  if (!(Number.isInteger(l.cx0) && Number.isInteger(l.cz0))) throw new Error("SiteLayout: bad origin");
  for (const a of [l.jx, l.jz, l.region, l.hash, l.bias]) if (a.length !== n) throw new Error("SiteLayout: array length");
  for (let i = 0; i < n; i++) {
    if (!(l.region[i] >= 0 && l.region[i] < regionCount)) throw new Error("SiteLayout: region id");
    for (const v of [l.jx[i], l.jz[i], l.hash[i]]) if (!(v >= 0 && v < 1)) throw new Error("SiteLayout: hash out of [0, 1)");
    if (!Number.isFinite(l.bias[i])) throw new Error("SiteLayout: bias");
  }
  if (l.wall) {
    if (!(l.wall.thickness > 0 && Number.isFinite(l.wall.thickness))) throw new Error("SiteLayout: wall thickness");
    for (const c of l.wall.cracks) if (![c.s, c.width, c.depth].every(Number.isFinite) || c.width <= 0 || c.depth < 0) throw new Error("SiteLayout: wall crack");
  }
}

/**
 * Keep point p (x, z) at least `margin` inside the rectangle: clamp the position
 * and remove the outward velocity component. Returns the largest outward speed
 * removed (0 when p was inside) — a hard edge for the bounded world.
 */
export function clampInsideRect(r: WorldRect, margin: number, p: { x: number; z: number }, v: { x: number; z: number }): number {
  let hit = 0;
  const lx = r.x0 + margin, hx = r.x1 - margin, lz = r.z0 + margin, hz = r.z1 - margin;
  if (p.x < lx || p.x > hx) {
    p.x = p.x < lx ? lx : hx;
    if ((p.x === lx && v.x < 0) || (p.x === hx && v.x > 0)) {
      hit = Math.max(hit, Math.abs(v.x));
      v.x = 0;
    }
  }
  if (p.z < lz || p.z > hz) {
    p.z = p.z < lz ? lz : hz;
    if ((p.z === lz && v.z < 0) || (p.z === hz && v.z > 0)) {
      hit = Math.max(hit, Math.abs(v.z));
      v.z = 0;
    }
  }
  return hit;
}
