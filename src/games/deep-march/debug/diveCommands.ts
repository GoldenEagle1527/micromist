/**
 * Restart commands (registry.ts): edit the draft of the next dive's overrides
 * (scene/dive/params.ts) — 混沌预览, 潮汐, 渲染, 声音; the panel's 「重新开始下潜」
 * applies them. The chaos preview and the simple tide never reach the save, the
 * forecast or the tide's own chaos (conserve/platform/diveChaos.ts).
 */
import type { ChaosPreviewSpec } from "../conserve";
import type { OmenPreview } from "../scene/dive/params";
import type { ChoiceOption, DebugCommand, DebugCtx } from "./registry";

const conserve = (c: DebugCtx) => c.conserve;
const text = (value: string, t: string): ChoiceOption => ({ value, label: { text: t } });
const AUTO: ChoiceOption = { value: "", label: "auto" };

/** A toggle on a boolean override; `invert`: the switch shows "on" when the override is false. */
function flag(id: string, section: DebugCommand["section"], label: DebugCommand["label"], key: "noRefine" | "noBricks" | "detail" | "occlusion" | "tideSimple" | "webp" | "noAudio", invert = false, when?: (c: DebugCtx) => boolean): DebugCommand {
  return { id, section, label, kind: "toggle", restart: true, when, get: (c) => c.draft[key] !== invert, set: (c, on) => c.setDraft({ [key]: on !== invert }) };
}

/** A choice over numeric overrides ("" = 0, the device's own). */
function numbers(id: string, label: DebugCommand["label"], key: "dpr" | "lodNear", values: readonly number[], unit: string): DebugCommand {
  return {
    id,
    section: "render",
    label,
    kind: "choice",
    restart: true,
    options: () => [AUTO, ...values.map((v) => text(String(v), `${v}${unit}`))],
    get: (c) => (c.draft[key] > 0 ? String(c.draft[key]) : ""),
    set: (c, v) => c.setDraft({ [key]: v ? Number(v) : 0 }),
  };
}

/** A stage 3–4 omen preview switch (any stage; restart). */
function omen(key: keyof OmenPreview, label: DebugCommand["label"]): DebugCommand {
  return { id: `chaos.omen.${key}`, section: "chaos", label, kind: "toggle", restart: true, when: conserve, get: (c) => c.draft.omens[key], set: (c, on) => c.setDraft({ omens: { ...c.draft.omens, [key]: on } }) };
}

const withChaos = (c: DebugCtx, patch: Partial<ChaosPreviewSpec>) => c.setDraft({ chaos: { ...(c.draft.chaos ?? { stage: 2, cracks: 1, scar: false }), ...patch } });

export const DIVE_COMMANDS: readonly DebugCommand[] = [
  {
    id: "chaos.stage",
    section: "chaos",
    label: "chaosStage",
    kind: "choice",
    restart: true,
    when: conserve,
    options: () => [{ value: "", label: "chaosOwn" }, text("0", "0"), text("1", "1"), text("2", "2"), text("3", "3"), text("4", "4"), text("5", "5")],
    get: (c) => (c.draft.chaos ? String(c.draft.chaos.stage) : ""),
    set: (c, v) => (v === "" ? c.setDraft({ chaos: null }) : withChaos(c, { stage: Number(v) as ChaosPreviewSpec["stage"] })),
  },
  {
    id: "chaos.cracks",
    section: "chaos",
    label: "chaosCracks",
    kind: "choice",
    restart: true,
    when: (c) => c.conserve && c.draft.chaos?.stage === 2,
    options: () => [text("1", "1"), text("2", "2")],
    get: (c) => String(c.draft.chaos?.cracks ?? 1),
    set: (c, v) => withChaos(c, { cracks: v === "2" ? 2 : 1 }),
  },
  {
    id: "chaos.scar",
    section: "chaos",
    label: "chaosScar",
    kind: "toggle",
    restart: true,
    when: (c) => c.conserve && c.draft.chaos !== null,
    get: (c) => c.draft.chaos?.scar ?? false,
    set: (c, on) => withChaos(c, { scar: on }),
  },
  omen("phantoms", "omenPhantoms"),
  omen("anomaly", "omenAnomaly"),
  omen("dimming", "omenDimming"),
  omen("homeGhost", "omenHomeGhost"),
  flag("tide.simple", "tide", "tideSimple", "tideSimple", false, conserve),
  flag("render.ktx2", "render", "ktx2", "webp", true),
  numbers("render.dpr", "dpr", "dpr", [0.5, 0.75, 1, 1.5, 2], "×"),
  numbers("render.lodNear", "lodNear", "lodNear", [16, 24, 48, 64], " m"),
  {
    id: "render.fog",
    section: "render",
    label: "fog",
    kind: "choice",
    restart: true,
    options: () => [AUTO, { value: "off", label: "fogOff" }, text("30", "30 m"), text("60", "60 m"), text("120", "120 m")],
    get: (c) => c.draft.fog ?? "",
    set: (c, v) => c.setDraft({ fog: v || null }),
  },
  {
    id: "render.wasm",
    section: "render",
    label: "wasm",
    kind: "choice",
    restart: true,
    options: () => [AUTO, text("js", "JS"), text("wasm", "WASM")],
    get: (c) => (c.draft.wasm === undefined ? "" : c.draft.wasm ? "wasm" : "js"),
    set: (c, v) => c.setDraft({ wasm: v === "" ? undefined : v === "wasm" }),
  },
  flag("render.refine", "render", "refine", "noRefine", true),
  flag("render.bricks", "render", "bricks", "noBricks", true),
  flag("render.detail", "render", "detail", "detail"),
  flag("render.occlusion", "render", "occlusion", "occlusion"),
  flag("audio.on", "audio", "audioOn", "noAudio", true),
];
