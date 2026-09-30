/**
 * Where the diver wakes once the core stands (plan M5: recall / death return
 * to the base core): open water just off the core on the side it was built
 * facing, looking at it. Before the founding: null (the lander spawn).
 */
import type { BaseView } from "../../conserve";
import type { DensityField } from "../../terrain/density";
import { findOpenWater } from "../../terrain/openWater";
import type { WorldRect } from "../../terrain/siteLayout";

/** Metres off the core's footprint, and above its ground point. */
export const HOME_OFFSET = { out: 14, up: 10 } as const;

export type HomeSpot = { x: number; y: number; z: number; yaw: number };

export function homeSpawn(field: DensityField, rect: WorldRect | null, view: BaseView, coreRadius: number): HomeSpot | null {
  const core = view.buildings.find((b) => b.kind === "core");
  if (!core) return null;
  const d = coreRadius + HOME_OFFSET.out;
  const [cx, cy, cz] = core.pos;
  const spot = findOpenWater(field, cx + Math.sin(core.yaw) * d, cy + HOME_OFFSET.up, cz + Math.cos(core.yaw) * d, rect, 2);
  // forward = (−sin yaw, 0, −cos yaw): look at the core
  return { x: spot.x, y: spot.y, z: spot.z, yaw: Math.atan2(-(cx - spot.x), -(cz - spot.z)) };
}
