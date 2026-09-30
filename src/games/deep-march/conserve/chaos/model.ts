/**
 * The chaos of a generation (design doc §4.1–4.2, D11): decided once, at the
 * tide, from the external variable share m = Σ(N − P − B) / Σ N, and fixed
 * until the next one — stage, wall thickness, cracks. Pure.
 *
 *   stage:  0 静海 m ≥ 0.92 · 1 回响 ≥ 0.90 · 2 初裂 ≥ 0.87 · 3 渗入 ≥ 0.84 ·
 *           4 侵蚀 ≥ 0.80 or below without the gaze · 5 直视 < 0.80 and ≥ 200 abyssal locked
 *   χ_g = clamp((0.92 − m) / 0.14, 0, 1)   (0 at stage 0: the shaders skip chaos)
 */
import { CHAOS } from "./config";
import { externalShare, wallThickness } from "./wallModel";
import type { ReadonlyParticleVector } from "../particles/particleVector";

export type ChaosStage = 0 | 1 | 2 | 3 | 4 | 5;
export const CHAOS_STAGES: readonly ChaosStage[] = [0, 1, 2, 3, 4, 5];

/** A crack of the ring (§4.3), placed at its first opening and kept for good (a healed one is a scar). */
export type ChaosCrack = {
  /** Ordinal: 0 … 5 the cracks by opening threshold, 6 the main breach. */
  j: number;
  /** Arc length along the ring (m, chaos/ring.ts), fixed at the first opening. */
  s: number;
  /** m below which it is open (healing needs m ≥ mOpen + CRACKS.heal). */
  mOpen: number;
  /** The generation it first opened in. */
  bornGen: number;
  /** Opening width and depth into the wall (m); a scar keeps its last opening's. */
  width: number;
  depth: number;
  open: boolean;
  /** Healed: closed again, a dark scar where it was. */
  healed: boolean;
  /** Passable: the notch runs right through the wall. */
  through: boolean;
};

export type ChaosState = {
  /** Post-tide external share m of this generation. */
  m: number;
  stage: ChaosStage;
  /** Wall thickness T (m). */
  wallThickness: number;
  /** Every crack placed so far (open or scar), ascending j. */
  cracks: ChaosCrack[];
};

export function chaosStage(m: number, abyssalLocked: number): ChaosStage {
  const st = CHAOS.stages;
  for (let i = 0; i < st.length; i++) if (m >= st[i]) return i as ChaosStage;
  return abyssalLocked >= CHAOS.gazeAbyssal ? 5 : 4;
}

/** Global chaos intensity χ_g ∈ [0, 1]. */
export function chaosIntensity(m: number): number {
  return Math.min(1, Math.max(0, (CHAOS.chiStart - m) / CHAOS.chiSpan));
}

/** Genesis (and saves from before M6): m from the generation's input, no cracks yet. */
export function genesisChaos(allocInput: ReadonlyParticleVector, totals: ReadonlyParticleVector): ChaosState {
  const m = externalShare(allocInput, totals);
  return { m, stage: chaosStage(m, 0), wallThickness: wallThickness(m), cracks: [] };
}

export function cloneChaos(c: ChaosState): ChaosState {
  return { ...c, cracks: c.cracks.map((k) => ({ ...k })) };
}
