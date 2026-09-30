/**
 * What the HUD reads of the expedition (ui/expedition), polled like the dive
 * telemetry. Plain data: no three.js, no conserve runtime.
 */
import type { AbsorbBlock, AbsorbTarget } from "./interaction";
import type { RecallPhase } from "./recall";

export type CacheMarker = {
  id: number;
  total: number;
  /** Metres from the eye. */
  distance: number;
  /** Degrees off the view heading (+ right), −180..180: the compass places it. */
  bearing: number;
  x: number;
  z: number;
};

export type ExpeditionNotice =
  /** The recall left the tank's particles behind (evicted: the oldest cache dissolved into the tide). */
  | { kind: "lost"; total: number; evicted: boolean }
  /** Recalled with an empty tank: nothing was lost. */
  | { kind: "recalled" }
  /** Recalled inside the base (M5): the tank went into the base's storage. */
  | { kind: "deposited"; total: number };

export type ExpeditionTelemetry = {
  tank: { value: number; capacity: number; ratio: number };
  target: AbsorbTarget | null;
  absorbing: boolean;
  holding: boolean;
  blocked: AbsorbBlock;
  caches: CacheMarker[];
  recall: { phase: RecallPhase; progress: number };
  notice: ExpeditionNotice | null;
  /** Nodes and caches in the draw right now (the one instanced mesh). */
  drawn: number;
};

/** Heading-convention bearing of a horizontal vector (0 = −z, + clockwise from above), degrees. */
export function bearingDeg(x: number, z: number): number {
  return (Math.atan2(x, -z) * 180) / Math.PI;
}

/** a − b wrapped to −180..180. */
export function relativeDeg(a: number, b: number): number {
  return ((((a - b + 180) % 360) + 360) % 360) - 180;
}
