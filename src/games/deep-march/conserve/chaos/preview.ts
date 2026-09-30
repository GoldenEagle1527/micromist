/**
 * Chaos previews for staging (MVP plan M8): `?chaos=0|1|2` shows a generation at
 * that stage — `&cracks=2` two open cracks at stage 2, `&scar=1` one healed crack
 * (a scar) as well — without playing the tides there. The preview only replaces
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

/** ?chaos=0|1|2 [&cracks=1|2] [&scar=1] → the spec, or null (no / bad parameter). */
export function parseChaosPreview(search: string): ChaosPreviewSpec | null {
  const qs = new URLSearchParams(search);
  const stage = Number(qs.get("chaos"));
  if (qs.get("chaos") === null || !(stage === 0 || stage === 1 || stage === 2)) return null;
  return { stage, cracks: qs.get("cracks") === "2" ? 2 : 1, scar: qs.get("scar") === "1" };
}

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
