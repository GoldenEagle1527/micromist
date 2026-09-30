/**
 * Chaos previews for staging (MVP plan M8; the staging debug panel's 混沌预览,
 * debug/): a generation at stage 0 | 1 | 2 — at stage 2 one or two open cracks,
 * optionally one healed crack (a scar) as well — without playing the tides there. The preview only replaces
 * what this dive draws (wall, cracks, effects); the save, the forecast and the
 * next tide keep the generation's real chaos. Pure and deterministic: the cracks
 * are placed by the tide's own rules (cracks.ts) for this world and base.
 */
import { evolveCracks, type CrackContext } from "./cracks";
import { chaosStage, type ChaosState } from "./model";
import { wallThickness } from "./wallModel";

export type ChaosPreviewSpec = { stage: 0 | 1 | 2; cracks: 1 | 2; scar: boolean };

/** What the preview's tides need besides m (the world, its base, the generation). */
export type PreviewContext = Omit<CrackContext, "m" | "thickness" | "gaze">;

/** m of the previewed generation: mid-band, crack 0 alone (m < 0.90) or cracks 0 and 1 (m < 0.875). */
const TARGET = { 0: 0.93, 1: 0.91, 2: { 1: 0.886, 2: 0.872 } } as const;
/** A tide before the target that opens the crack the target then heals (≥ its mOpen + 0.01). */
const SCAR_FROM = { 0: 0.886, 1: 0.886, 2: 0.872 } as const;

export function previewTarget(spec: ChaosPreviewSpec): number {
  return spec.stage === 2 ? TARGET[2][spec.cracks] : TARGET[spec.stage];
}

/** The previewed generation's chaos (stage, T, cracks) from a crack-free world. */
export function previewChaos(spec: ChaosPreviewSpec, ctx: PreviewContext): ChaosState {
  const ms = [...(spec.scar ? [SCAR_FROM[spec.stage]] : []), previewTarget(spec)];
  let cracks: ChaosState["cracks"] = [];
  for (const m of ms) cracks = evolveCracks(cracks, { ...ctx, m, thickness: wallThickness(m), gaze: false });
  const m = ms[ms.length - 1];
  return { m, stage: chaosStage(m, 0), wallThickness: wallThickness(m), cracks };
}
