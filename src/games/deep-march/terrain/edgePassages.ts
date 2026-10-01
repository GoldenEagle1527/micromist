/**
 * The diver's hard edge in a bounded world with through cracks (backlog
 * "diver.edge"). The edge is the world rectangle (DiverController.edge); a through
 * (passable) crack's notch runs past it to the wall's outer face, so each through
 * crack's reach rectangle (crackReach.ts) is a passage the edge opens into. The
 * diver is held inside the union: inside any rectangle → untouched; outside all →
 * clamped into the nearest one (the least movement), so a diver in a passage is
 * stopped at its far end — one column past the outer face — never thrown back.
 * Non-through notches end in rock, which stops the diver on its own.
 */
import type { DensityField } from "./density";
import { crackReachRects } from "./crackReach";
import { clampInsideRect, insideRect, type WorldRect } from "./siteLayout";

/** The field's through cracks' reach rectangles (world units); [] without any. */
export function edgePassages(field: DensityField): WorldRect[] {
  const wall = field.wall, cracks = field.regions.layout?.wall?.cracks ?? [];
  const through = cracks.filter((c) => c.through);
  if (!wall || !through.length) return [];
  const s = field.settings;
  return crackReachRects(wall.shape, through, s.worldScale, s.boundsSize);
}

/**
 * Clamp p into the union of `rects` (margin inside each), zeroing the outward
 * velocity; returns the removed outward speed (0 = nothing hit).
 */
export function clampInsideUnion(rects: readonly WorldRect[], margin: number, p: { x: number; z: number }, v: { x: number; z: number }): number {
  if (rects.length === 1 || rects.some((r) => insideRect(r, p.x, p.z, margin))) return rects.length === 1 ? clampInsideRect(rects[0], margin, p, v) : 0;
  let best = rects[0], bestD = Infinity;
  for (const r of rects) {
    const dx = Math.max(r.x0 + margin - p.x, 0, p.x - (r.x1 - margin));
    const dz = Math.max(r.z0 + margin - p.z, 0, p.z - (r.z1 - margin));
    const d = dx * dx + dz * dz;
    if (d < bestD) (bestD = d), (best = r);
  }
  return clampInsideRect(best, margin, p, v);
}
