import type { GamePreview } from "../../platform/play";
import { explosiveEn, explosiveZh } from "./i18n";

/** Sync first-paint snapshot for the generic shell. Keep this file free of the session runtime. */
export const preview: GamePreview = (ctx) => {
  const ex = ctx.locale === "zh" ? explosiveZh : explosiveEn;
  const room = (ctx.search.get("room") ?? "").trim();
  if (room) {
    return {
      phase: "menu",
      title: ex.setupTitle,
      hint: ex.setupHint,
      status: ex.connecting,
      actions: [{ id: "join-room", label: ex.joinRoom, kind: "primary", disabled: true }],
    };
  }
  return {
    phase: "menu",
    title: ex.setupTitle,
    hint: ex.setupHint,
    menu: {
      items: [
        { id: "solo", label: ex.solo },
        { id: "online", label: ex.online },
      ],
      canBack: false,
      backLabel: ex.backSetup,
    },
  };
};
