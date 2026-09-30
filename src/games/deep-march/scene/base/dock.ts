/**
 * The diver and the base (plan M5), pure: when a departure counts (leaving the
 * protection radius, with a margin so wobbling on the rim counts once), and
 * whether the diver is docked at an energy tower (battery charging).
 */
import type { BaseView } from "../../conserve";
import { DOCK } from "./config";

/** Metres past the radius before leaving counts. */
export const DEPART_MARGIN = 6;

export class DepartureWatch {
  private inside: boolean | null = null;

  /** Distance to the core and the protection radius → true on the frame the diver leaves. */
  update(dist: number, radius: number): boolean {
    if (dist <= radius) {
      this.inside = true;
      return false;
    }
    if (dist > radius + DEPART_MARGIN) {
      const left = this.inside === true;
      this.inside = false;
      return left;
    }
    return false;
  }

  reset(): void {
    this.inside = null;
  }
}

/** Docked: within DOCK.range of an energy tower of a base that has energy. */
export function docked(view: BaseView, x: number, y: number, z: number): boolean {
  if (!view.founded || view.energy <= 0) return false;
  return view.buildings.some((b) => b.kind === "energy" && Math.hypot(b.pos[0] - x, b.pos[1] + 12 - y, b.pos[2] - z) <= DOCK.range);
}
