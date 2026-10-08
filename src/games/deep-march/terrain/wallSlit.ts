/**
 * The ring wall's cracks as slits torn through a thin shell (design doc §4.3 / §4.4;
 * playtest: "a thin face with a tear in it, not a recess"). Base units like
 * wallGeometry.ts; the tunables (WALL_SHAPE) are metres.
 *
 *  - flat(s): near a crack the facet relief flattens (crackRelief of it kept), so the
 *    wall round a tear reads as one taut shell and its face stands a known
 *    inset … inset + crackRelief · (relief + swell) in (the gaze anchors rely on it);
 *  - lateral(s, y): < 0 inside the opening — a lens (half width w / 2, half height
 *    slitHalfH round slitY) whose centre line snakes and whose width wobbles with two
 *    incommensurate triangle waves: torn, moderately angular edges, rounded tips;
 *  - cavity(sd, u, s, y) = max(lateral, sd − back, −K·u), u = sd + face: < 0 inside the
 *    cut, which runs from the face through the shell to sd = back — short of the
 *    thinnest wall, so a crack never goes through. K steepens the front: in front of
 *    the face the cut cannot reach terrain values beyond RAW_CAP / K base units.
 * The density (wallDensity.ts) clamps the field to iso + g·cavity, so the cut also
 * clears terrain inside it; the dark beyond the lip is the mesher's crack weight.
 */
import { WALL_SHAPE, type WallShapeTuning } from "./wallConfig";
import { TERRAIN } from "./config";
import type { WallCrack } from "./wallGeometry";

export type WallSlits = {
  /** Open cracks (0: every function below is a no-op). */
  count: number;
  /** Where the cut ends past the outline (base units). */
  back: number;
  /** Relief flattening near the cracks at arc length s: 0 … 1. */
  flat: (s: number) => number;
  /** Signed lens distance to the nearest opening (< 0 inside), base units. */
  lateral: (s: number, y: number) => number;
  /** < 0 inside the cut (u = sd + face). */
  cavity: (sd: number, u: number, s: number, y: number) => number;
  /** Can cavity(sd, ·, s, ·) be below `reach` for some y (given faceMax)? */
  near: (sd: number, s: number, reach: number) => boolean;
};

/** The wall's seeded hash in [0, 1) (facet levels, swell phases, jag phases). */
export function wallHash01(seed: number, i: number, j: number): number {
  let h = (seed ^ 0x2545f491) >>> 0;
  h = Math.imul(h ^ i, 0x85ebca6b) >>> 0;
  h = Math.imul((h ^ (h >>> 13)) ^ j, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const smooth01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** Triangle wave, period 1, in [−1, 1]. */
const tri = (u: number) => 2 * Math.abs(2 * (u - Math.floor(u + 0.5))) - 1;

/** perimeter: the outline's length; faceMax: the uncracked face's deepest inset (base units). */
export function createWallSlits(cracks: readonly WallCrack[], seed: number, perimeter: number, faceMax: number, t: WallShapeTuning = WALL_SHAPE): WallSlits {
  const U = TERRAIN.worldScale, P = perimeter; // = WALL_UNIT (no import cycle)
  const list = cracks.map((c) => ({
    s: c.s / U,
    half: Math.max(1e-6, c.width / U / 2),
    jag: Math.min(t.crackJag * c.width, t.crackJagMax) / U,
    ph1: wallHash01(seed, Math.round(c.s), 3),
    ph2: wallHash01(seed, Math.round(c.s), 5),
  }));
  const p1 = t.crackJagPeriod / U, p2 = t.crackJagPeriod2 / U;
  const yc = t.slitY / U, hh = t.slitHalfH / U, back = t.slitBack / U, K = t.slitFront;
  const pad = t.crackFlat / U, blend = t.crackBlend / U;
  const wrap = (d: number) => d - P * Math.round(d / P);

  const flat = (s: number): number => {
    let f = 0;
    for (const c of list) {
      const d = Math.abs(wrap(s - c.s)) - c.half - c.jag - pad;
      const w = d <= 0 ? 1 : smooth01(1 - d / blend);
      if (w > f) f = w;
    }
    return f;
  };

  // the snake moves both edges by ≤ 0.7 jag, the wobble each by ≤ 0.3 jag: |edge shift| ≤ jag
  const lateral = (s: number, y: number): number => {
    const q = (y - yc) / hh;
    let best = Infinity;
    for (const c of list) {
      const ds = wrap(s - c.s) + 0.7 * c.jag * tri(y / p1 + c.ph1);
      const hw = c.half + 0.3 * c.jag * tri(y / p2 + c.ph2);
      const a = ds / hw;
      const l = hw * (Math.sqrt(a * a + q * q) - 1);
      if (l < best) best = l;
    }
    return best;
  };

  const cavity = (sd: number, u: number, s: number, y: number): number => {
    const f = -K * u, b = sd - back;
    const m = f > b ? f : b;
    const l = lateral(s, y);
    return l > m ? l : m;
  };

  // lateral ≥ |ds| − half − jag; −K·u ≥ −K·(sd + faceMax); sd − back
  const near = (sd: number, s: number, reach: number): boolean => {
    if (sd - back >= reach || -K * (sd + faceMax) >= reach) return false;
    for (const c of list) if (Math.abs(wrap(s - c.s)) - c.half - c.jag < reach) return true;
    return false;
  };

  return { count: list.length, back, flat, lateral, cavity, near };
}
