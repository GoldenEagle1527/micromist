import type { GamePreview } from "../../platform/play";
import { gomokuEn, gomokuZh } from "./i18n";

export const preview: GamePreview = (ctx) => {
  const g = ctx.locale === "zh" ? gomokuZh : gomokuEn;
  const room = (ctx.search.get("room") ?? "").trim().toLowerCase();
  if (/^[a-z0-9]+$/.test(room)) {
    return {
      phase: "menu",
      title: g.roomCodeLabel(room),
      status: g.roomConnecting,
    };
  }
  return {
    phase: "menu",
    title: g.setupTitle,
    hint: g.setupHint,
    params: {
      fields: [
        {
          id: "mode",
          label: g.mode,
          type: "select",
          value: "ai",
          options: [
            { value: "ai", label: g.vsAi },
            { value: "local", label: g.hotseat },
            { value: "online", label: g.online },
          ],
        },
        {
          id: "difficulty",
          label: g.difficulty,
          type: "select",
          value: "normal",
          options: [
            { value: "easy", label: g.easy },
            { value: "normal", label: g.normal },
            { value: "hard", label: g.hard },
          ],
        },
        {
          id: "humanColor",
          label: g.yourColor,
          type: "select",
          value: "1",
          options: [
            { value: "1", label: g.playBlack },
            { value: "2", label: g.playWhite },
          ],
        },
      ],
    },
    actions: [{ id: "start", label: g.start, kind: "primary" }],
  };
};
