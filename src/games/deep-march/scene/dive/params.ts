/**
 * The dive's debug overrides, set by the staging debug panel (debug/, 渲染 / 混沌预览
 * / 潮汐 / 声音) and read once when a dive is built — a change takes the panel's
 * 「重新开始下潜」. Session-only, in memory: no URL, no storage, never saved.
 * Production builds have no panel, so every dive there uses DEFAULT_DIVE_PARAMS.
 */
import type { ChaosPreviewSpec, GazePhase } from "../../conserve";
import { terrainForDevice, type TerrainSettings } from "../../terrain/config";

/** Conserve previews of the stage 3–4 omens (debug panel 混沌预览): on at any stage, first event within seconds, never saved. */
export type OmenPreview = {
  /** 声呐假读数: phantom contacts in the pings, readings jumping (anywhere). */
  phantoms: boolean;
  /** 异常地形 at full strength around the open cracks (none open: a stage-2 preview with two). */
  anomaly: boolean;
  /** 基地灯塔偶尔变暗 near a lit lighthouse. */
  dimming: boolean;
  /** 基地的幽灵回波 (no base yet: the lander spawn stands in). */
  homeGhost: boolean;
};

export const NO_OMEN_PREVIEW: Readonly<OmenPreview> = Object.freeze({ phantoms: false, anomaly: false, dimming: false, homeGhost: false });

export type DiveParams = {
  /** Pinned pixel ratio (> 0), else 0 (adaptive). */
  dpr: number;
  /** Full-resolution ring radius override (> 0), else 0 (the preset's). */
  lodNear: number;
  /** Full noise evaluation in mesh jobs (no coarse pre-pass, terrain/refine.ts). */
  noRefine: boolean;
  /** Dense mesher passes instead of sparse 8³ bricks (terrain/bricks.ts; same output). */
  noBricks: boolean;
  /** WebAssembly noise (bit-exact) on / off; undefined = the preset's (JS). */
  wasm: boolean | undefined;
  /** Turbidity (fog.ts parseFogParam): null = defaults, "off", "60" (beam m), "50,80". */
  fog: string | null;
  /** Shader detail normal (detailNormal.ts). */
  detail: boolean;
  /** GPU occlusion culling of terrain columns (occlusion.ts). */
  occlusion: boolean;
  /** Conserve: always the tide's 浊潮 murk instead of its show. */
  tideSimple: boolean;
  /** Conserve: a chaos preview for this dive (conserve/chaos/preview.ts; never saved), null = the generation's own. */
  chaos: ChaosPreviewSpec | null;
  /** Conserve: the stage 3–4 omen previews. */
  omens: Readonly<OmenPreview>;
  /**
   * Conserve: 结局演练 — this dive plays a sandboxed stage-5 copy of the save with the gaze at this
   * phase (0 ① … 3 ④; conserve/session/rehearsal.ts); null = the real save.
   */
  rehearsal: GazePhase | null;
  /** Material textures as WebP instead of KTX2 (materialLibrary.ts). */
  webp: boolean;
  /** No audio context at all (the dive runs silent, no mute button). */
  noAudio: boolean;
};

export const DEFAULT_DIVE_PARAMS: Readonly<DiveParams> = Object.freeze({
  dpr: 0,
  lodNear: 0,
  noRefine: false,
  noBricks: false,
  wasm: undefined,
  fog: null,
  detail: true,
  occlusion: true,
  tideSimple: false,
  chaos: null,
  omens: NO_OMEN_PREVIEW,
  rehearsal: null,
  webp: false,
  noAudio: false,
});

let current: Readonly<DiveParams> = DEFAULT_DIVE_PARAMS;

/** The overrides the next dive is built with. */
export function diveParams(): Readonly<DiveParams> {
  return current;
}

/** Debug panel only: the overrides for the next dive (the panel restarts it). */
export function setDiveParams(next: DiveParams): void {
  current = Object.freeze({ ...next });
}

/** The device's terrain preset with the overrides. */
export function diveTerrain(lowSpec: boolean, p: Readonly<DiveParams>): TerrainSettings {
  const base = p.lodNear > 0 ? { ...terrainForDevice(lowSpec), lodNear: p.lodNear } : terrainForDevice(lowSpec);
  return {
    ...base,
    ...(p.noRefine ? { refine: false } : {}),
    ...(p.noBricks ? { bricks: false } : {}),
    ...(p.wasm !== undefined ? { wasm: p.wasm } : {}),
  };
}
