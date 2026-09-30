/**
 * Conserve worlds only: the chaos presentation wired into the dive (world.ts,
 * MVP plan M8). The seabed's chaos uniforms exist for every conserve dive (the
 * tide may bring a generation that shows chaos); the columns use the chaos
 * program only while their generation needs it (chaos/chaosDirector.ts
 * needsChaosProgram). The free dive builds none of this.
 *
 * Debug preview (harmless: never saved; conserve/chaos/preview.ts):
 *   ?chaos=0|1|2 [&cracks=1|2] [&scar=1] — the generation's chaos for this dive;
 *   ?at=crack — start in open water ≈ 90 m inside the first open crack, facing it.
 */
import type { ChaosView } from "../../conserve";
import type { DensityField } from "../../terrain/density";

export type Viewpoint = { x: number; y: number; z: number; yaw: number; pitch: number };

/** How far inside the outline the ?at=crack viewpoint stands (m), and its eye height above the floor. */
const CRACK_VIEW = { inside: 90, eye: 7, pitchDeg: 4 } as const;

/** ?at=crack: open water in front of the first open crack, facing it; null without one. */
export function crackViewpoint(at: string | null, view: ChaosView | null, field: DensityField): Viewpoint | null {
  const c = at === "crack" ? view?.cracks[0] : undefined;
  if (!c) return null;
  const x = c.x - c.nx * CRACK_VIEW.inside, z = c.z - c.nz * CRACK_VIEW.inside;
  const W = field.settings.worldScale, iso = field.settings.isoLevel;
  let floor = NaN;
  for (let y = -32 * W; y <= 24 * W; y += 0.5) {
    if (field.sample(x, y, z) < iso) {
      floor = y;
      break;
    }
  }
  const y = Number.isNaN(floor) ? 5 * W : floor + CRACK_VIEW.eye;
  // forward = (−sin yaw, 0, −cos yaw) along the outward normal
  return { x, y, z, yaw: Math.atan2(-c.nx, -c.nz), pitch: (CRACK_VIEW.pitchDeg * Math.PI) / 180 };
}
