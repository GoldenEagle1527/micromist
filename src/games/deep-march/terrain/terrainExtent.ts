/**
 * Where a bounded world has terrain for the column streaming (chunks.ts) — the one
 * predicate the LOD quadtree asks both when it picks the footprints to build and
 * when it decides whether a footprint is covered by finer columns.
 *
 * The extent is a union of world rectangles:
 *  - the world's cell rectangle (siteLayout.ts layoutRect) grown by the ring wall's
 *    thickness T: the wall's outer face stands T beyond the outline, so its whole
 *    shell is terrain at every LOD level (without a wall: the rectangle itself);
 *  - each open crack's reach rectangle (crackReach.ts): a through notch runs past the
 *    outer face.
 * A footprint that touches none of them has nothing to draw; the quadtree neither
 * requests it nor waits for it (a column straddling the extent's edge is built
 * whole, and its children outside the extent count as covered).
 *
 * Endless world (no layout): no extent (null), every footprint has terrain.
 */
import { crackReachRects } from "./crackReach";
import type { DensityField } from "./density";
import { MACRO } from "./regions";
import { layoutRect, rectOverlaps, type WorldRect } from "./siteLayout";

export type TerrainExtent = { readonly rects: readonly WorldRect[] };

/** The rectangle grown by `d` on every side. */
export function growRect(r: WorldRect, d: number): WorldRect {
  return { x0: r.x0 - d, z0: r.z0 - d, x1: r.x1 + d, z1: r.z1 + d };
}

/**
 * Pure: the extent of a world rectangle with a wall `thickness` world units thick
 * (0: no wall) and the cracks' reach rectangles.
 */
export function extentOf(world: WorldRect, thickness: number, reach: readonly WorldRect[]): TerrainExtent {
  return { rects: [thickness > 0 ? growRect(world, thickness) : world, ...reach] };
}

/** The field's extent in world units; null for an endless field. */
export function terrainExtent(field: DensityField): TerrainExtent | null {
  const layout = field.regions.layout;
  if (!layout) return null;
  const s = field.settings;
  const world = layoutRect(layout, MACRO.cell * s.worldScale);
  const wall = field.wall;
  if (!wall) return extentOf(world, 0, []);
  const cracks = layout.wall?.cracks ?? [];
  const reach = cracks.length ? crackReachRects(wall.shape, cracks, s.worldScale, s.boundsSize) : [];
  return extentOf(world, wall.shape.thickness * s.worldScale, reach);
}

/** Does the square footprint [x0, x0 + size] × [z0, z0 + size] hold terrain? (null extent: always.) */
export function hasTerrain(extent: TerrainExtent | null, x0: number, z0: number, size: number): boolean {
  return !extent || extent.rects.some((r) => rectOverlaps(r, x0, z0, size));
}
