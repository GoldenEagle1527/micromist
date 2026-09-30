/**
 * Nearest open-water point with a clearance (mode-agnostic; conserve's lost
 * caches, M4: "the nearest safe water point, clearance ≥ 1.8 m"). Shells of 26
 * directions around the start, 1 m apart; a point is open when every one of 26
 * rays stays in water for the whole clearance. Deterministic; the start itself
 * wins when it is open. Falls back to the most open point probed.
 */
import { OPEN_WATER } from "./anchorConfig";
import type { DensityField } from "./density";
import { insideRect, type WorldRect } from "./siteLayout";

const DIRS: [number, number, number][] = [];
for (let dz = -1; dz <= 1; dz++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy && !dz) continue;
      const l = Math.hypot(dx, dy, dz);
      DIRS.push([dx / l, dy / l, dz / l]);
    }

export type OpenWaterSpot = { x: number; y: number; z: number; clearance: number };

/** Shortest water reach over the 26 rays, capped at `max`. */
export function clearanceAt(field: DensityField, x: number, y: number, z: number, max: number = OPEN_WATER.clearance): number {
  const iso = field.settings.isoLevel;
  if (field.sample(x, y, z) >= iso) return 0;
  let min = max;
  for (const [dx, dy, dz] of DIRS) {
    for (let t = OPEN_WATER.probeStep; t < min + 1e-9; t += OPEN_WATER.probeStep) {
      if (field.sample(x + dx * t, y + dy * t, z + dz * t) >= iso) {
        min = Math.min(min, t - OPEN_WATER.probeStep);
        break;
      }
    }
    if (min <= 0) return 0;
  }
  return min;
}

export function findOpenWater(field: DensityField, x: number, y: number, z: number, rect: WorldRect | null = null, margin = 0): OpenWaterSpot {
  const need = OPEN_WATER.clearance;
  let best: OpenWaterSpot = { x, y, z, clearance: -1 };
  for (let shell = 0; shell <= OPEN_WATER.shells; shell++) {
    const r = shell * OPEN_WATER.shellStep;
    const points = shell === 0 ? [[0, 0, 0] as [number, number, number]] : DIRS;
    for (const [dx, dy, dz] of points) {
      const px = x + dx * r, py = y + dy * r, pz = z + dz * r;
      if (rect && !insideRect(rect, px, pz, margin)) continue;
      const c = clearanceAt(field, px, py, pz, need);
      if (c >= need - 1e-9) return { x: px, y: py, z: pz, clearance: c };
      if (c > best.clearance) best = { x: px, y: py, z: pz, clearance: c };
    }
  }
  return best;
}
