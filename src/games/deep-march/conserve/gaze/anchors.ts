/**
 * Where the four 封界 anchors stand (design doc §9.1 锁界): on the wall's outer
 * face, in the gap beyond the main breach, spread along it at two heights —
 * within the passage the breach opens (T + one terrain column past the outline).
 * Pure: from the generation's chaos and the world size.
 */
import { BREACH } from "../chaos/config";
import type { ChaosState } from "../chaos/model";
import { chaosViewOf, type ChaosCrackView } from "../chaos/view";
import { GAZE } from "./config";

export type AnchorPoint = { x: number; y: number; z: number };

/** The open main breach of a generation, as the scene places it (null when shut). */
export function breachOf(chaos: ChaosState, size: { sitesX: number; sitesZ: number }): ChaosCrackView | null {
  return chaosViewOf(chaos, size).cracks.find((c) => c.j === BREACH.j) ?? null;
}

/** The anchors around a breach mouth (thickness: the wall's T, m). */
export function anchorPointsOf(breach: ChaosCrackView, thickness: number): AnchorPoint[] {
  const A = GAZE.anchors, out = thickness + A.beyond;
  return A.along.map((a, i) => ({
    x: breach.x + breach.nx * out + breach.tx * a * breach.width,
    y: A.heights[i],
    z: breach.z + breach.nz * out + breach.tz * a * breach.width,
  }));
}

export function anchorPoints(chaos: ChaosState, size: { sitesX: number; sitesZ: number }): AnchorPoint[] {
  const b = breachOf(chaos, size);
  return b ? anchorPointsOf(b, chaos.wallThickness) : [];
}

/** The unlit anchor within reach of the diver (closest), or −1. */
export function anchorInReach(points: readonly AnchorPoint[], lit: readonly boolean[], p: AnchorPoint): number {
  let best = -1;
  let bestD: number = GAZE.anchors.reach;
  points.forEach((a, i) => {
    const d = Math.hypot(a.x - p.x, a.y - p.y, a.z - p.z);
    if (!lit[i] && d <= bestD) [best, bestD] = [i, d];
  });
  return best;
}
