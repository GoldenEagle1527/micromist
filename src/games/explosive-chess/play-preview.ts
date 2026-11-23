import { roomIdForGame } from "../../../shared/multiplayer";
import type { GamePreview } from "../../platform/play";
import { explosiveEn, explosiveZh } from "./i18n";

/** Sync first-paint snapshot for the generic shell. Keep this file free of the session runtime. */
export const preview: GamePreview = (ctx) => {
  const ex = ctx.locale === "zh" ? explosiveZh : explosiveEn;
  const room = roomIdForGame(ctx.search.get("room") ?? "", "explosive-chess");
  if (room) {
    return {
      phase: "menu",
      title: ex.setupTitle,
      hint: ex.onlineHint,
      status: ex.connecting,
    };
  }
  return {
    phase: "menu",
    title: ex.setupTitle,
    hint: ex.setupHint,
    params: {
      fields: [
        {
          id: "mode",
          label: ex.mode,
          type: "select",
          value: "ai",
          options: [
            { value: "ai", label: ex.vsAi },
            { value: "local", label: ex.hotseat },
            { value: "online", label: ex.online },
          ],
        },
        {
          id: "boardSize",
          label: ex.board,
          type: "select",
          value: "9",
          options: [
            { value: "9", label: "9×9" },
            { value: "11", label: "11×11" },
            { value: "13", label: "13×13" },
          ],
        },
        {
          id: "winMode",
          label: ex.winMode,
          type: "select",
          value: "annihilation",
          options: [
            { value: "annihilation", label: ex.annihilation },
            { value: "steps", label: ex.steps },
            { value: "area", label: ex.area },
          ],
        },
        {
          id: "difficulty",
          label: ex.aiDifficulty,
          type: "select",
          value: "medium",
          options: [
            { value: "easy", label: ex.easy },
            { value: "medium", label: ex.medium },
            { value: "hard", label: ex.hard },
            { value: "hell", label: ex.hell },
          ],
        },
        {
          id: "redOwner",
          label: ex.redFirst,
          type: "select",
          value: "player",
          options: [
            { value: "player", label: ex.me },
            { value: "ai", label: ex.ai },
          ],
        },
      ],
    },
    actions: [{ id: "start", label: ex.start, kind: "primary" }],
  };
};
