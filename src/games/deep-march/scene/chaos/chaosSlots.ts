/**
 * Fills the chaos program's per-crack uniform slots (seabedChaos.ts) — the nearest
 * open cracks' light and the nearest scars — from the generation's view. Only the
 * slot arrays are touched (no allocation per frame beyond a small sort).
 */
import type * as THREE from "three";
import type { ChaosCrackView } from "../../conserve";
import { WALL_SHAPE } from "../../terrain/wallConfig";
import { CHAOS_LOOK } from "./config";
import { clearScarSlot } from "./seabedChaos";

/** The `n` items nearest (x, z), nearest first. */
export function nearest<T extends { x: number; z: number }>(items: readonly T[], x: number, z: number, n: number): T[] {
  if (items.length <= 1) return items.slice(0, n);
  return [...items].sort((a, b) => (a.x - x) ** 2 + (a.z - z) ** 2 - ((b.x - x) ** 2 + (b.z - z) ** 2)).slice(0, n);
}

/** Crack light slots: x, z, haze radius (m), intensity (0 = unused). */
export function fillCrackSlots(slots: THREE.Vector4[], cracks: readonly ChaosCrackView[], gain: (c: ChaosCrackView) => number): void {
  const r = CHAOS_LOOK.glow.hazeRadius;
  slots.forEach((s, i) => {
    const c = cracks[i];
    if (c) s.set(c.x, c.z, r + 0.5 * c.width, gain(c));
    else s.set(0, 0, 1, 0);
  });
}

/** Scar slots: centre, half-width, jag; tangent, jag phase, jag period — a streak where the notch was. */
export function fillScarSlots(slots: THREE.Vector4[], tangents: THREE.Vector4[], scars: readonly ChaosCrackView[]): void {
  slots.forEach((s, i) => {
    const c = scars[i];
    if (!c) return clearScarSlot(s, tangents[i]);
    s.set(c.x, c.z, Math.max(3, 0.5 * c.width + 2), WALL_SHAPE.crackJag * c.width);
    tangents[i].set(c.tx, c.tz, ((c.j * 0.618034) % 1 + 1) % 1, WALL_SHAPE.crackJagPeriod);
  });
}
