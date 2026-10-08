/**
 * Where the four 封界 anchors stand (design doc §9.1 锁界): in the main slit's mouth,
 * two by each edge at two heights, at the opening's plane — lit from inside the
 * world (the slit cannot be swum through; darkness and the eye lie beyond it).
 * Pure: from the generation's chaos and the world size (the ring outline, metres).
 */
import { BREACH } from "../chaos/config";
import type { ChaosState } from "../chaos/model";
import { ringOf } from "../chaos/ring";
import { GAZE } from "./config";

export type AnchorPoint = { x: number; y: number; z: number };

/** Half the arc step used for the outline's normal (m). */
const H = 0.5;

/** The anchors in the mouth of a slit centred at arc length s, `width` wide. */
export function anchorPointsAt(s: number, width: number, size: { sitesX: number; sitesZ: number }): AnchorPoint[] {
  const A = GAZE.anchors, ring = ringOf(size);
  return A.heights.map((y, i) => {
    const q = (y - A.slit.y) / A.slit.halfH;
    const edge = Math.max(0, (width / 2) * Math.sqrt(Math.max(0, 1 - q * q)) - A.edgeIn);
    const at = s + A.side[i] * edge;
    const p = ring.point(at), a = ring.point(at - H), b = ring.point(at + H);
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    // outward normal (tz, −tx) of the counter-clockwise tangent; the anchor stands `inward` m in
    const nx = (b.z - a.z) / l, nz = -(b.x - a.x) / l;
    return { x: p.x - nx * A.inward, y, z: p.z - nz * A.inward };
  });
}

export function anchorPoints(chaos: ChaosState, size: { sitesX: number; sitesZ: number }): AnchorPoint[] {
  const c = chaos.cracks.find((k) => k.j === BREACH.j && k.open);
  return c ? anchorPointsAt(c.s, c.width, size) : [];
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
