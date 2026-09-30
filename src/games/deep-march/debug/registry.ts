/**
 * The debug panel's command registry: every command is a small declarative entry
 * { id, section, label, kind, … } over a DebugCtx — no DOM, no React (ui/ renders
 * it; test:debug runs it in node). Two kinds of effect:
 *   - runtime commands act on the running dive through its port (teleport, light,
 *     overlay, battery) at once;
 *   - `restart` commands edit the draft of the next dive's overrides
 *     (scene/dive/params.ts); the panel's 「重新开始下潜」 applies the draft.
 * Nothing writes a save.
 */
import type { DiveParams } from "../scene/dive/params";
import type { DebugDict } from "./i18n";
import type { DebugPort, TeleportTarget } from "./types";

export const SECTIONS = ["teleport", "chaos", "light", "tide", "resources", "render", "audio", "overlay"] as const;
export type SectionId = (typeof SECTIONS)[number];

export type DebugCtx = {
  /** The running dive's port; null while it loads (runtime commands are hidden). */
  port: DebugPort | null;
  /** Conserve world (chaos preview, tide); false in the free dive. */
  conserve: boolean;
  /** The next dive's overrides (applied by the restart). */
  draft: Readonly<DiveParams>;
  setDraft: (patch: Partial<DiveParams>) => void;
  /** The custom teleport point (panel state). */
  custom: { x: number; y: number; z: number };
  setCustom: (patch: Partial<{ x: number; y: number; z: number }>) => void;
};

export type OptionLabel = keyof DebugDict["opt"] | { text: string };
export type ChoiceOption = { value: string; label: OptionLabel };

type Common = {
  id: string;
  section: SectionId;
  label: keyof DebugDict["cmd"];
  /** Shown only when this holds (default: always). */
  when?: (c: DebugCtx) => boolean;
  /** Edits the draft: takes effect when the dive restarts. */
  restart?: true;
};

export type DebugCommand = Common &
  (
    | { kind: "action"; apply: (c: DebugCtx) => void }
    | { kind: "toggle"; get: (c: DebugCtx) => boolean; set: (c: DebugCtx, on: boolean) => void }
    | { kind: "choice"; options: (c: DebugCtx) => readonly ChoiceOption[]; get: (c: DebugCtx) => string; set: (c: DebugCtx, v: string) => void }
    | { kind: "stepper"; steps: readonly number[]; min: number; max: number; get: (c: DebugCtx) => number; set: (c: DebugCtx, v: number) => void }
    | { kind: "targets"; items: (c: DebugCtx) => TeleportTarget[]; go: (c: DebugCtx, t: TeleportTarget) => void }
  );

/** Commands of a section that apply now (their `when`). */
export function visibleCommands(all: readonly DebugCommand[], section: SectionId, c: DebugCtx): DebugCommand[] {
  return all.filter((k) => k.section === section && (k.when?.(c) ?? true));
}

/** A stepper's next value: one step, clamped (and snapped to whole metres). */
export function stepValue(k: { min: number; max: number }, v: number, delta: number): number {
  return Math.round(Math.min(k.max, Math.max(k.min, v + delta)));
}

/** Draft keys that differ from the running dive's overrides (a restart is pending when any). */
export function pendingKeys(draft: Readonly<DiveParams>, running: Readonly<DiveParams>): (keyof DiveParams)[] {
  return (Object.keys(running) as (keyof DiveParams)[]).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(running[k]));
}
