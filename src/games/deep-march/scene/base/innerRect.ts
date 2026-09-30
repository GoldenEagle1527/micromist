/**
 * The ring wall's inner face as the base's rules see it (conserve WorldRect):
 * the world rectangle shrunk by the deepest the face can stand inside it
 * (inset + relief + swell, terrain/wallConfig.ts), corners rounded likewise.
 */
import type { WorldRect as BaseRect } from "../../conserve";
import type { WorldRect } from "../../terrain/siteLayout";
import { WALL_SHAPE } from "../../terrain/wallConfig";

export function wallInnerRect(r: WorldRect): BaseRect {
  const d = WALL_SHAPE.inset + WALL_SHAPE.relief + WALL_SHAPE.swell;
  return { minX: r.x0 + d, maxX: r.x1 - d, minZ: r.z0 + d, maxZ: r.z1 - d, corner: Math.max(0, WALL_SHAPE.cornerRadius - d) };
}
