/**
 * Cracks of the ring (design doc §4.3, D9), evolved only at a tide:
 *  - crack j opens when m < mOpen[j] (the main breach: m < 0.80 with the gaze);
 *  - width 4 m + 4 m per 0.01 below the threshold (≤ 60 m), depth 40 % + 10 %
 *    per 0.01 of the thickness (≤ 100 %); through (passable) at full depth and
 *    ≥ 30 m wide;
 *  - its spot is chosen at the first opening and saved: candidates every 32 m
 *    of the ring, score = 0.35 thinness noise + 0.35 harvested share of the wall
 *    site + 0.15 toward the base + 0.15 hash; ≥ 600 m from the base core, ≥ 500 m
 *    from every other crack or scar;
 *  - it heals when m ≥ mOpen + 0.01 (hysteresis), leaving a scar, and reopens
 *    at the same spot.
 * Pure and deterministic.
 */
import { HASH_SALT, siteHash } from "../world/siteHash";
import { BREACH, CRACKS } from "./config";
import type { ChaosCrack } from "./model";
import { ringDistance, type Ring, type RingPoint } from "./ring";

/** What a tide's cracks depend on. */
export type CrackContext = {
  /** Post-tide m and wall thickness (m). */
  m: number;
  thickness: number;
  /** The generation the tide starts (a new crack's bornGen). */
  gen: number;
  seed: number;
  ring: Ring;
  /** The base core (world x / z, m); null before the founding. */
  base: { x: number; z: number } | null;
  /** Per site (row-major): share of its node particles absorbed this generation, 0 … 1. */
  siteHarvest: ArrayLike<number>;
  /** Stage 5 condition (m < 0.80 and the abyssal lock): the main breach may open. */
  gaze: boolean;
};

export type CrackSize = { width: number; depth: number; through: boolean };

export function crackSize(mOpen: number, m: number, thickness: number, breach = false): CrackSize {
  const steps = Math.max(0, 100 * (mOpen - m));
  if (breach) return { width: Math.min(BREACH.widthMax, BREACH.width + CRACKS.widthPerStep * steps), depth: thickness + CRACKS.throughMargin, through: true };
  const width = Math.min(CRACKS.widthMax, CRACKS.widthBase + CRACKS.widthPerStep * steps);
  const frac = Math.min(1, CRACKS.depthBase + CRACKS.depthPerStep * steps);
  const through = frac >= 1 && width >= CRACKS.throughWidth;
  return { width, depth: through ? thickness + CRACKS.throughMargin : frac * thickness, through };
}

/** Opening arc range [s − w/2, s + w/2] (m, unwrapped: may pass 0 or the perimeter). */
export function crackExtent(c: Pick<ChaosCrack, "s" | "width">): [number, number] {
  return [c.s - c.width / 2, c.s + c.width / 2];
}

/** Low-frequency "thin wall" noise along the ring, periodic, 0 … 1. */
export function thinness(seed: number, ring: Ring, s: number): number {
  const knots = Math.max(4, Math.round(ring.perimeter / CRACKS.thinWave));
  const u = ((s / ring.perimeter) * knots) % knots;
  const i = Math.floor(u), f = u - i;
  const a = siteHash(seed, 0, i, HASH_SALT.crackThin), b = siteHash(seed, 0, (i + 1) % knots, HASH_SALT.crackThin);
  return a + (b - a) * f * f * (3 - 2 * f);
}

/** Candidate spots (arc length, m): `CRACKS.step` apart, evenly round the ring. */
export function crackCandidates(ring: Ring): number[] {
  const n = Math.max(1, Math.round(ring.perimeter / CRACKS.step));
  return Array.from({ length: n }, (_, i) => (i * ring.perimeter) / n);
}

export function crackScore(j: number, i: number, s: number, ctx: CrackContext): number {
  const w = CRACKS.weights;
  const p = ctx.ring.point(s);
  const toward = ctx.base ? 1 - ringDistance(p, ctx.base.x, ctx.base.z) / ctx.ring.diagonal : 0;
  const harvest = Math.min(1, Math.max(0, ctx.siteHarvest[ctx.ring.siteAt(s)] ?? 0));
  return w.thin * thinness(ctx.seed, ctx.ring, s) + w.harvest * harvest + w.base * toward + w.hash * siteHash(ctx.seed, j, i, HASH_SALT.crackPick);
}

/** Does a crack at `p` keep the distance rules against the base and the cracks placed so far? */
export function crackAllowed(p: RingPoint, ctx: CrackContext, placed: readonly ChaosCrack[]): boolean {
  if (ctx.base && ringDistance(p, ctx.base.x, ctx.base.z) < CRACKS.minBaseDistance) return false;
  return placed.every((c) => {
    const q = ctx.ring.point(c.s);
    return ringDistance(p, q.x, q.z) >= CRACKS.minSpacing;
  });
}

/** The best allowed spot for crack j, or null when none is left. */
export function placeCrack(j: number, ctx: CrackContext, placed: readonly ChaosCrack[]): number | null {
  let best = -Infinity, at: number | null = null;
  crackCandidates(ctx.ring).forEach((s, i) => {
    if (!crackAllowed(ctx.ring.point(s), ctx, placed)) return;
    const score = crackScore(j, i, s, ctx);
    if (score > best) [best, at] = [score, s];
  });
  return at;
}

/** Float slack of the healing threshold (e.g. 0.81 + 0.01 is 0.8200000000000001). */
const EPS = 1e-9;

const thresholds = (): { j: number; mOpen: number }[] => [...CRACKS.mOpen.map((mOpen, j) => ({ j, mOpen })), { j: BREACH.j, mOpen: BREACH.mOpen }];

/** The cracks after a tide (a new array; `prev` is not touched). */
export function evolveCracks(prev: readonly ChaosCrack[], ctx: CrackContext): ChaosCrack[] {
  const out = prev.map((c) => ({ ...c }));
  for (const { j, mOpen: threshold } of thresholds()) {
    const breach = j === BREACH.j;
    let c = out.find((k) => k.j === j);
    const mOpen = c?.mOpen ?? threshold;
    const wantOpen = ctx.m < mOpen && (!breach || ctx.gaze);
    if (wantOpen && !c) {
      const s = placeCrack(j, ctx, out);
      if (s === null) continue;
      c = { j, s, mOpen, bornGen: ctx.gen, width: 0, depth: 0, open: false, healed: false, through: false };
      out.push(c);
    }
    if (!c) continue;
    if (wantOpen || (c.open && ctx.m < mOpen + CRACKS.heal - EPS && (!breach || ctx.gaze))) Object.assign(c, crackSize(mOpen, ctx.m, ctx.thickness, breach), { open: true, healed: false });
    else if (c.open) Object.assign(c, { open: false, healed: true, through: false });
  }
  return out.sort((a, b) => a.j - b.j);
}
