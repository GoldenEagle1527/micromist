/**
 * Streaming beyond the world rectangle at the cracks (MVP plan follow-up "M3
 * deviation #5", M8). The bounded world streams no column wholly outside its cell
 * rectangle (chunks.ts), but a crack's notch runs outward past the outline: a
 * stage-2 crack 40–70 % of the thickness T deep, a through crack T + margin. Each
 * open crack adds one world rectangle: its opening's arc range (plus the jag, a
 * side) from the outline out to its reach — T for a through crack, else its
 * depth — plus one column of margin. Columns overlapping it are streamed too.
 * No cracks → no rectangles: the request sequence is exactly the rectangle-only one.
 */
import type { WorldRect } from "./siteLayout";
import { WALL_SHAPE } from "./wallConfig";
import { WALL_UNIT, type WallCrack, type WallShape } from "./wallGeometry";

/** Outline samples across an opening (the outline is straight or a circular arc there). */
const SAMPLES = 9;

/**
 * shape: the wall (base units); cracks: its spec's open cracks (metres); worldScale:
 * world units per base unit; margin: extra world units all round (one column).
 */
export function crackReachRects(shape: WallShape, cracks: readonly WallCrack[], worldScale: number, margin: number): WorldRect[] {
  const out = new Float64Array(4);
  return cracks.map((c) => {
    const half = (c.width / 2) * (1 + 2 * WALL_SHAPE.crackJag) / WALL_UNIT;
    const reach = (c.through ? shape.thickness * WALL_UNIT : c.depth) / WALL_UNIT;
    const r = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
    for (let i = 0; i < SAMPLES; i++) {
      const s = c.s / WALL_UNIT - half + (2 * half * i) / (SAMPLES - 1);
      for (const inward of [shape.faceMax, -reach]) {
        shape.point(s, inward, out);
        r.x0 = Math.min(r.x0, out[0]);
        r.z0 = Math.min(r.z0, out[1]);
        r.x1 = Math.max(r.x1, out[0]);
        r.z1 = Math.max(r.z1, out[1]);
      }
    }
    return { x0: r.x0 * worldScale - margin, z0: r.z0 * worldScale - margin, x1: r.x1 * worldScale + margin, z1: r.z1 * worldScale + margin };
  });
}
