/**
 * Which nodes / caches are drawn and which one the diver is aiming at (pure, no
 * three.js: test:nodes checks the counts and the aim rule directly).
 *   visible: every cache (≤ 5) plus the nodes within the draw radius, nearest
 *            first, at most `max` in all;
 *   target:  within reach of the eye, inside the aim cone (or very close),
 *            the one nearest the view axis weighted by distance.
 */
export type Candidate = {
  /** node id · 2, or cache id · 2 + 1 */
  key: number;
  kind: "node" | "cache";
  id: number;
  /** Aim point (world). */
  x: number;
  y: number;
  z: number;
};

export const nodeKey = (id: number): number => id * 2;
export const cacheKey = (id: number): number => id * 2 + 1;

export function selectVisible<T extends Candidate>(items: readonly T[], ex: number, ey: number, ez: number, radius: number, max: number): T[] {
  const caches = items.filter((c) => c.kind === "cache");
  const near = items
    .filter((c) => c.kind === "node")
    .map((c) => ({ c, d: Math.hypot(c.x - ex, c.y - ey, c.z - ez) }))
    .filter((e) => e.d <= radius)
    .sort((a, b) => a.d - b.d || a.c.key - b.c.key)
    .map((e) => e.c);
  return [...caches, ...near].slice(0, max);
}

export type Aim = { reach: number; cone: number; closeReach: number };

/** f = unit view direction. */
export function pickTarget<T extends Candidate>(items: readonly T[], ex: number, ey: number, ez: number, fx: number, fy: number, fz: number, aim: Aim): T | null {
  let best: T | null = null, bestScore = Infinity;
  for (const c of items) {
    const dx = c.x - ex, dy = c.y - ey, dz = c.z - ez;
    const d = Math.hypot(dx, dy, dz);
    if (d > aim.reach) continue;
    const cos = d > 1e-6 ? (dx * fx + dy * fy + dz * fz) / d : 1;
    if (d > aim.closeReach && cos < aim.cone) continue;
    const score = d * (2 - cos);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}
