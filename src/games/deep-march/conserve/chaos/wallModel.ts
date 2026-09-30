/**
 * The ring wall model (design doc §4.1, D6 / D11): how much of the world is still
 * "external variable" decides how thick the wall is.
 *
 *   M = Σ_k R_k = Σ_k (N_k − P_k − B_k)     (world + suspended + lost, at the tide)
 *   m = M / N,  σ = clamp((m − mBreak) / (mFull − mBreak), 0, 1)
 *   T = T_min + (T_0 − T_min) · smoothstep(σ)
 *
 * R is the generation's allocation input (save: generation.allocInput), fixed from
 * one tide to the next, so the wall never changes during a generation. Pure; the
 * geometry that uses T lives in terrain/wallGeometry.ts. Cracks come with M6: the
 * state carries them already (none yet), so the terrain side takes them as params.
 */
import { WALL } from "../config";
import type { ReadonlyParticleVector } from "../particles/particleVector";

export type WallTuning = { readonly fullThickness: number; readonly minThickness: number; readonly mFull: number; readonly mBreak: number };

/** A crack of the ring (M6): arc length along the wall, opening width and depth, metres. */
export type WallCrackState = { s: number; width: number; depth: number };

export type WallState = {
  /** External variable share m = Σ R / Σ N. */
  m: number;
  /** Stability σ ∈ [0, 1]. */
  sigma: number;
  /** Wall thickness T, metres. */
  thickness: number;
  cracks: WallCrackState[];
};

const sum = (v: ReadonlyParticleVector) => v.reduce((a, b) => a + b, 0);

/** m = Σ R / Σ N (1 for an empty world). */
export function externalShare(allocInput: ReadonlyParticleVector, totals: ReadonlyParticleVector): number {
  const n = sum(totals);
  return n > 0 ? sum(allocInput) / n : 1;
}

export function wallStability(m: number, t: WallTuning = WALL): number {
  return Math.min(1, Math.max(0, (m - t.mBreak) / (t.mFull - t.mBreak)));
}

export function wallThickness(m: number, t: WallTuning = WALL): number {
  const s = wallStability(m, t);
  return t.minThickness + (t.fullThickness - t.minThickness) * s * s * (3 - 2 * s);
}

/** The wall of a generation. */
export function wallStateOf(allocInput: ReadonlyParticleVector, totals: ReadonlyParticleVector, t: WallTuning = WALL): WallState {
  const m = externalShare(allocInput, totals);
  return { m, sigma: wallStability(m, t), thickness: wallThickness(m, t), cracks: [] };
}
