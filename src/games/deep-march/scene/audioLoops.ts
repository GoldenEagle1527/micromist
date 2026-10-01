/**
 * The dive's loops (audio.ts mixer): which clip each one plays and how. A loop
 * may reuse another loop's clip with its own playback rate and low-pass, so one
 * licensed file can carry two sounds (the gaze's growl is the dread clip, lower
 * and muffled, under the surge's own dread loop).
 *   ambience, swim — always running (swim's gain follows the speed);
 *   flow    — absorbing (expedition/absorbFlow.ts);
 *   dread   — the chaos surge, stage 4+ (chaos/deepChaos.ts);
 *   reactor — the volt reactor's hum near a working one (base/reactorHum.ts);
 *   growl   — 直视's drone floor, stage 5 (gaze/atmosphere.ts).
 * All but ambience / swim start on first use (target gain > 0) and then idle at
 * gain 0. Every loop goes through the master, so mute, volume and the pause hold
 * (the ≡ menu suspends the context, audioLifecycle.ts) apply to all of them.
 */
import type { ClipId } from "./audioManifest";

export type LoopSpec = {
  clip: ClipId;
  /** Started with the mixer (else on first use). */
  always?: boolean;
  /** Playback rate before the chaos detune (default 1). */
  rate?: number;
  /** Low-pass cutoff (Hz), none if absent. */
  lowpass?: number;
};

export const LOOPS = {
  ambience: { clip: "ambience", always: true },
  swim: { clip: "swim", always: true },
  flow: { clip: "flow" },
  dread: { clip: "dread" },
  reactor: { clip: "reactor" },
  growl: { clip: "dread", rate: 0.78, lowpass: 820 },
} as const satisfies Record<string, LoopSpec>;

export type LoopId = keyof typeof LOOPS;
export const LOOP_IDS = Object.keys(LOOPS) as LoopId[];

/** Every loop's target gain, 0 (silent). */
export function silentTargets(): Record<LoopId, number> {
  return Object.fromEntries(LOOP_IDS.map((id) => [id, 0])) as Record<LoopId, number>;
}
