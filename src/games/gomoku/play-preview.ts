import { roomIdForGame } from "../../../shared/multiplayer";
import type { GamePreview } from "../../platform/play";
import { gomokuEn, gomokuZh } from "./i18n";

export const preview: GamePreview = (ctx) => {
  const g = ctx.locale === "zh" ? gomokuZh : gomokuEn;
  const room = roomIdForGame(ctx.search.get("room") ?? "", "gomoku");
  if (room) {
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
        {
          id: "rules",
          label: g.rules,
          type: "select",
          value: "classic",
          options: [
            { value: "classic", label: g.rulesClassic },
            { value: "series", label: g.rulesSeries },
          ],
        },
      ],
    },
    actions: [{ id: "start", label: g.start, kind: "primary" }],
  };
};
