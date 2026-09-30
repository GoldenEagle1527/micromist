/**
 * Deterministic surface anchors on the density field (mode-agnostic; conserve's
 * resource nodes, M4): a hash → a point on the rock surface of a preferred kind,
 * the same on every device (the smoothed field is identical on all presets).
 *
 * One attempt (anchorAttempt): a point in the search disc (inside the world
 * rectangle, in the wanted region), then
 *   floor / ledge / sheltered / rock (even attempts): the column's water → rock
 *     transitions going down (up-facing surfaces), one picked by the hash;
 *   wall / rock (odd attempts): a point in one of the column's water runs,
 *     marched horizontally in a hashed direction until it meets rock;
 * the crossing refined by bisection, the normal from the gradient, and the
 * surface rule checked (strict first, then relaxed to "rock"). Rock continues
 * behind the surface (never a floater); anchors keep a minimum spacing.
 */
import { ANCHOR } from "./anchorConfig";
import type { DensityField } from "./density";
import { createRegionSample, type RegionSample } from "./regions";
import { insideRect, type WorldRect } from "./siteLayout";

export type SurfaceKind = "floor" | "ledge" | "wall" | "sheltered" | "rock";

export type Anchor = { x: number; y: number; z: number; nx: number; ny: number; nz: number; strict: boolean };

export type AnchorQuery = {
  /** Search disc centre and radius (world). */
  cx: number;
  cz: number;
  radius: number;
  /** Bounded world: stay ANCHOR.worldMargin inside. */
  rect: WorldRect | null;
  /** Region the anchor must lie in (weight ≥ ANCHOR.regionMin), −1 = any. */
  region: number;
  surface: SurfaceKind;
  /** uint32 seed of the search. */
  seed: number;
};

/** (seed, a, b) → [0, 1), integer mixing only. */
export function anchorHash(seed: number, a: number, b: number): number {
  let h = Math.imul(seed ^ 0x2c1b3c6d, 0x9e3779b1) ^ Math.imul(a + 0x632be5ab, 0x85ebca77) ^ Math.imul(b + 0x1b873593, 0xc2b2ae3d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const HDIRS = [0, 1, 2, 3, 4, 5].map((i) => [Math.cos((i * Math.PI) / 3), Math.sin((i * Math.PI) / 3)]);
export class AnchorProbe {
  private readonly field: DensityField;
  private readonly iso: number;
  private readonly g = new Float64Array(3);
  private readonly rs: RegionSample = createRegionSample();

  constructor(field: DensityField) {
    this.field = field;
    this.iso = field.settings.isoLevel;
  }

  solid(x: number, y: number, z: number): boolean {
    return this.field.sample(x, y, z) >= this.iso;
  }

  /** Bisection between a water point a and a rock point b (t along a → b). */
  private crossing(ax: number, ay: number, az: number, bx: number, by: number, bz: number): [number, number, number] {
    let lo = 0, hi = 1;
    for (let i = 0; i < ANCHOR.refine; i++) {
      const m = (lo + hi) / 2;
      if (this.solid(ax + (bx - ax) * m, ay + (by - ay) * m, az + (bz - az) * m)) hi = m;
      else lo = m;
    }
    const t = (lo + hi) / 2;
    return [ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t];
  }

  private anchorAt(p: [number, number, number]): Anchor {
    this.field.gradient(p[0], p[1], p[2], this.g, 0.25);
    const l = Math.hypot(this.g[0], this.g[1], this.g[2]) || 1;
    return { x: p[0], y: p[1], z: p[2], nx: -this.g[0] / l, ny: -this.g[1] / l, nz: -this.g[2] / l, strict: true };
  }

  /** Up-facing crossings of a column, top first. */
  floors(x: number, z: number): Anchor[] {
    const out: Anchor[] = [];
    let prevSolid = this.solid(x, ANCHOR.yTop, z);
    for (let y = ANCHOR.yTop - ANCHOR.scanStep; y >= ANCHOR.yBottom; y -= ANCHOR.scanStep) {
      const s = this.solid(x, y, z);
      if (s && !prevSolid) out.push(this.anchorAt(this.crossing(x, y + ANCHOR.scanStep, z, x, y, z)));
      prevSolid = s;
    }
    return out;
  }

  /** Water runs of a column: [bottom, top] pairs, top first. */
  waterRuns(x: number, z: number): [number, number][] {
    const runs: [number, number][] = [];
    let top = NaN;
    for (let y = ANCHOR.yTop; y >= ANCHOR.yBottom; y -= ANCHOR.scanStep) {
      const water = !this.solid(x, y, z);
      if (water && Number.isNaN(top)) top = y;
      if (!water && !Number.isNaN(top)) {
        runs.push([y + ANCHOR.scanStep, top]);
        top = NaN;
      }
    }
    return runs;
  }

  /** First rock along a horizontal ray from a water point, or null. */
  wallHit(x: number, y: number, z: number, dx: number, dz: number): Anchor | null {
    for (let t = ANCHOR.wallStep; t <= ANCHOR.wallReach; t += ANCHOR.wallStep) {
      if (this.solid(x + dx * t, y, z + dz * t)) {
        const b = t - ANCHOR.wallStep;
        return this.anchorAt(this.crossing(x + dx * b, y, z + dz * b, x + dx * t, y, z + dz * t));
      }
    }
    return null;
  }

  regionWeight(x: number, z: number, region: number): number {
    return region < 0 ? 1 : this.field.regions.sample(x, z, this.rs).w[region];
  }

  private openAbove(a: Anchor): boolean {
    return [1.5, ANCHOR.openAbove / 2, ANCHOR.openAbove].every((d) => !this.solid(a.x, a.y + d, a.z));
  }

  private roofAbove(a: Anchor): boolean {
    for (let d = 3; d <= ANCHOR.roofReach; d += 1.5) if (this.solid(a.x, a.y + d, a.z)) return true;
    return false;
  }

  private dropNearby(a: Anchor): boolean {
    const r = ANCHOR.ledgeReach;
    return HDIRS.some(([dx, dz]) => !this.solid(a.x + dx * r, a.y - ANCHOR.ledgeDrop, a.z + dz * r));
  }

  /** Rock behind the surface along −n (no floater). */
  grounded(a: Anchor): boolean {
    return ANCHOR.rockBehind.every((d) => this.solid(a.x - a.nx * d, a.y - a.ny * d, a.z - a.nz * d));
  }

  fits(a: Anchor, kind: SurfaceKind): boolean {
    switch (kind) {
      case "floor":
        return a.ny >= ANCHOR.floorNy && this.openAbove(a);
      case "ledge":
        return a.ny >= ANCHOR.ledgeNy && this.openAbove(a) && this.dropNearby(a);
      case "wall":
        return Math.abs(a.ny) <= ANCHOR.wallNy;
      case "sheltered":
        return a.ny >= ANCHOR.ledgeNy && this.roofAbove(a);
      case "rock":
        return a.ny >= ANCHOR.rockNy;
    }
  }
}

/** One attempt of the search (0-based); null when this attempt finds nothing acceptable. */
export function anchorAttempt(probe: AnchorProbe, q: AnchorQuery, attempt: number, taken: readonly Anchor[]): Anchor | null {
  const strict = attempt < ANCHOR.strictAttempts;
  const kind: SurfaceKind = strict ? q.surface : "rock";
  const h = (j: number) => anchorHash(q.seed, attempt, j);
  const r = q.radius * Math.sqrt(h(0)), a = 2 * Math.PI * h(1);
  const x = q.cx + r * Math.cos(a), z = q.cz + r * Math.sin(a);
  if (q.rect && !insideRect(q.rect, x, z, ANCHOR.worldMargin)) return null;
  if (probe.regionWeight(x, z, q.region) < ANCHOR.regionMin) return null;
  const horizontal = kind === "wall" || (kind === "rock" && attempt % 2 === 1);
  let hit: Anchor | null = null;
  if (horizontal) {
    const runs = probe.waterRuns(x, z).filter(([lo, hi]) => hi - lo >= 4);
    if (runs.length === 0) return null;
    const [lo, hi] = runs[Math.floor(h(2) * runs.length)];
    const y = lo + 1.5 + (hi - lo - 3) * h(3);
    const ang = 2 * Math.PI * h(4);
    hit = probe.wallHit(x, y, z, Math.cos(ang), Math.sin(ang));
  } else {
    const floors = probe.floors(x, z);
    if (floors.length === 0) return null;
    hit = floors[Math.floor(h(2) * floors.length)];
  }
  if (!hit || !probe.fits(hit, kind) || !probe.grounded(hit)) return null;
  if (q.rect && !insideRect(q.rect, hit.x, hit.z, ANCHOR.worldMargin)) return null;
  if (horizontal && probe.regionWeight(hit.x, hit.z, q.region) < ANCHOR.regionMin) return null;
  if (taken.some((t) => Math.hypot(t.x - hit.x, t.y - hit.y, t.z - hit.z) < ANCHOR.spacing)) return null;
  hit.strict = strict;
  return hit;
}

/** Attempts per anchor (strict first, then relaxed); the caller spreads them over frames (placement.ts). */
export const ANCHOR_ATTEMPTS = ANCHOR.strictAttempts + ANCHOR.relaxedAttempts;
