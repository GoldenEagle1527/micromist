/**
 * What the chaos does to the dive, as numbers (MVP plan M8, design doc §4.5). Pure:
 *  - levels: the generation's strengths — its stage's row of CHAOS_LOOK, grown
 *    with χ_g inside the stage's band. Fixed for the generation (D11): computed
 *    once from the view, never from the live ledger. Stage 0: every one 0;
 *  - local intensity χ_l = max over open cracks of exp(−d² / r²), d the horizontal
 *    distance to the crack, r = 150 … 400 m by its width;
 *  - the slow light wave (≤ 3 Hz sines, no strobe; 「减弱灯光起伏」 keeps the
 *    slowest only, at a quarter of the depth) and the per-frame effect values.
 */
import type { ChaosCrackView, ChaosView } from "../../conserve";
import { CHAOS_LOOK, type ChaosStageLook } from "./config";

export const NO_CHAOS: ChaosStageLook = CHAOS_LOOK.stages[0];

export function chaosLevels(view: ChaosView | null): ChaosStageLook {
  if (!view || view.stage === 0) return NO_CHAOS;
  const row = CHAOS_LOOK.stages[view.stage];
  const k = CHAOS_LOOK.withinStage + (1 - CHAOS_LOOK.withinStage) * view.within;
  return { veins: row.veins * k, glow: row.glow * k, fog: row.fog * k, flicker: row.flicker * k, detune: row.detune * k, ghost: row.ghost, omen: row.omen };
}

/** Local reach r of a crack's effects (m), by its width. */
export function crackRadius(width: number): number {
  const L = CHAOS_LOOK.local;
  const u = Math.min(1, Math.max(0, (width - L.wMin) / (L.wMax - L.wMin)));
  return L.rMin + (L.rMax - L.rMin) * u;
}

/** χ_l at (x, z): 0 without open cracks. */
export function localChaos(cracks: readonly ChaosCrackView[], x: number, z: number): number {
  let chi = 0;
  for (const c of cracks) {
    const r = crackRadius(c.width);
    const d2 = (x - c.x) ** 2 + (z - c.z) ** 2;
    chi = Math.max(chi, Math.exp(-d2 / (r * r)));
  }
  return chi;
}

/** Slow light wave in [0, 1] at time t (s): weighted sines, every one at ≤ flicker.maxHz. */
export function slowWave(t: number, calm: boolean): number {
  const parts = CHAOS_LOOK.flicker.parts;
  const used = calm ? parts.slice(0, 1) : parts;
  let sum = 0, weight = 0;
  used.forEach(([hz, w], i) => {
    sum += w * (0.5 + 0.5 * Math.sin(2 * Math.PI * hz * t + 1.7 * i));
    weight += w;
  });
  return weight > 0 ? sum / weight : 0;
}

/** Highest frequency the light wave uses (Hz). */
export function slowWaveMaxHz(calm: boolean): number {
  const parts = CHAOS_LOOK.flicker.parts;
  return Math.max(...(calm ? parts.slice(0, 1) : parts).map(([hz]) => hz));
}

export type ChaosFrame = {
  /** Lamp intensity multiplier (1 = unchanged, never below 1 − 0.4). */
  lamp: number;
  /** Share of the chaos murk colour in the fog (0 = unchanged). */
  fog: number;
  /** Audio wetness (0 = the insert is an identity bypass). */
  audio: number;
  /** Vein glow gain (seabed uChaos.x). */
  veins: number;
  /** Crack light gain before the per-crack "follow" (seabed uChaos.y). */
  glow: number;
};

/** The frame's effect values at local intensity chiL, time t (s). */
export function chaosFrame(levels: ChaosStageLook, chiL: number, t: number, calm: boolean): ChaosFrame {
  const L = CHAOS_LOOK;
  const depth = levels.flicker * (calm ? L.flicker.calm : 1);
  const breath = (hz: number, share: number) => (calm ? 1 : 1 - share * (0.5 + 0.5 * Math.sin(2 * Math.PI * hz * t)));
  return {
    lamp: depth > 0 ? 1 - depth * chiL * slowWave(t, calm) : 1,
    fog: levels.fog * chiL,
    audio: levels.detune * chiL,
    veins: levels.veins > 0 ? levels.veins * breath(L.veins.breathHz, L.veins.breath) : 0,
    glow: levels.glow > 0 ? levels.glow * breath(L.glow.breathHz, L.glow.breath) : 0,
  };
}

/**
 * "It watches": a crack's light is brighter while the (lagged) diver stands in
 * front of it — 1 − follow · (1 − facing), facing = the diver's side of the wall
 * (0 … 1 across ±90°).
 */
export function followFactor(c: ChaosCrackView, lagX: number, lagZ: number): number {
  const dx = lagX - c.x, dz = lagZ - c.z;
  const d = Math.hypot(dx, dz) || 1;
  const facing = Math.max(0, -(dx * c.nx + dz * c.nz) / d);
  return 1 - CHAOS_LOOK.glow.follow * (1 - facing);
}

/**
 * Near-crack fog colour shift, in place: toward the chaos murk's hue at the same
 * luminance (the fog neither brightens nor darkens), by `share` (0 = unchanged).
 */
export function shiftFog(c: { r: number; g: number; b: number }, share: number): void {
  if (share <= 0) return;
  const [r, g, b] = CHAOS_LOOK.fog.color;
  const lum = (x: number, y: number, z: number) => 0.2126 * x + 0.7152 * y + 0.0722 * z;
  const k = lum(c.r, c.g, c.b) / lum(r, g, b);
  c.r += (r * k - c.r) * share;
  c.g += (g * k - c.g) * share;
  c.b += (b * k - c.b) * share;
}

/** Audio insert settings at wetness w and time t (identity at w = 0: rate 1, wet 0). */
export function chaosAudioParams(w: number, t: number): { rate: number; wet: number; cutoff: number; delay: number; feedback: number } {
  const A = CHAOS_LOOK.audio;
  if (w <= 0) return { rate: 1, wet: 0, cutoff: A.cutoff[1], delay: A.delayS, feedback: 0 };
  const s = Math.sin(2 * Math.PI * A.wobbleHz * t);
  const cents = w * (A.detuneCents + A.wobbleCents * s);
  return { rate: Math.pow(2, cents / 1200), wet: w * A.wetGain, cutoff: A.cutoff[1] - (A.cutoff[1] - A.cutoff[0]) * w * (0.5 + 0.5 * s), delay: A.delayS, feedback: A.feedback * w };
}
