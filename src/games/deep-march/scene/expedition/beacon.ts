/**
 * Lost-cache beacon (plan M4 "sonar tick"): every BEACON.period seconds each
 * cache flashes (nodeShader.ts: the flash peaks when (time + phase) is a
 * multiple of the period) and, within BEACON.audible metres, gives a faint
 * sonar tick — quieter and more muffled with distance — so a diver can find
 * it by ear as well as on the compass. Pure timing and gain; the scene plays it.
 */
import type { ExpeditionCache } from "../../conserve";
import { BEACON } from "./config";

export type BeaconTick = { id: number; gain: number; rate: number; lowpass: number };

/** Beacon phase of a cache (s): the glow flash and the audio tick share it. */
export function cachePhase(id: number): number {
  return (id * 1.37) % BEACON.period;
}

export class CacheBeacon {
  private readonly last = new Map<number, number>();

  /** Ticks due this frame (`time` = the node material's clock, s). */
  update(time: number, caches: readonly ExpeditionCache[], eye: readonly [number, number, number]): BeaconTick[] {
    const out: BeaconTick[] = [];
    const live = new Set<number>();
    for (const c of caches) {
      live.add(c.id);
      const beat = Math.floor((time + cachePhase(c.id)) / BEACON.period);
      const prev = this.last.get(c.id);
      this.last.set(c.id, beat);
      if (prev === undefined || beat === prev) continue;
      const d = Math.hypot(c.pos[0] - eye[0], c.pos[1] - eye[1], c.pos[2] - eye[2]);
      if (d > BEACON.audible) continue;
      const near = 1 - d / BEACON.audible;
      out.push({ id: c.id, gain: BEACON.gain * (0.25 + 0.75 * near * near), rate: BEACON.rate, lowpass: BEACON.lowpassFar + (BEACON.lowpassNear - BEACON.lowpassFar) * near });
    }
    for (const id of [...this.last.keys()]) if (!live.has(id)) this.last.delete(id);
    return out;
  }
}
