import { roomIdForGame } from "../../../shared/multiplayer";
import type { GamePreview } from "../../platform/play";
import { chromaEn, chromaZh } from "./i18n";

/** Keep in sync with shared/chroma-slide/engine PRESETS labels only — not the puzzle runtime. */
const PRESET_META = {
  easy: { size: 6, colorCount: 4, squareSide: 3 },
  normal: { size: 8, colorCount: 4, squareSide: 4 },
  hard: { size: 10, colorCount: 4, squareSide: 5 },
} as const;

type PresetId = keyof typeof PRESET_META;

function presetTitle(locale: "zh" | "en", id: PresetId): string {
  const ch = locale === "zh" ? chromaZh : chromaEn;
  const name = ch[id];
  const p = PRESET_META[id];
  return `${name} · ${p.size}×${p.size} · ${p.squareSide}×${p.squareSide}`;
}

/** Sync first-paint snapshot for the generic shell. Keep this file free of the session runtime. */
export const preview: GamePreview = (ctx) => {
  const ch = ctx.locale === "zh" ? chromaZh : chromaEn;
  const room = roomIdForGame(ctx.search.get("room") ?? "", "chroma-slide");
  if (room) {
    return {
      phase: "menu",
      title: ch.roomTitle,
      status: ch.roomConnecting,
    };
  }
  const preset: PresetId = "easy";
  const p = PRESET_META[preset];
  return {
    phase: "menu",
    title: ch.setupTitle,
    hint: `${ch.setupHint} ${ch.presetBlurb(p.size, p.colorCount, p.squareSide)}`,
    params: {
      fields: [
        {
          id: "preset",
          label: ch.difficulty,
          type: "select",
          value: preset,
          options: (Object.keys(PRESET_META) as PresetId[]).map((id) => ({
            value: id,
            label: presetTitle(ctx.locale, id),
          })),
        },
      ],
    },
    actions: [{ id: "start", label: ch.start, kind: "primary" }],
    records: {
      title: ch.historyTitle,
      empty: ch.emptyHistory,
      groups: [
        { id: "best", label: ch.bestLabel, rows: [] },
        { id: "recent", label: ch.recentLabel, rows: [] },
      ],
    },
  };
};
