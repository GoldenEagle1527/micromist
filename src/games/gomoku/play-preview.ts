import type { GamePreview } from "../../platform/play";

export const preview: GamePreview = (ctx) => {
  const zh = ctx.locale === "zh";
  return {
    phase: "menu",
    title: zh ? "对局设置" : "Match setup",
    hint: zh
      ? "十五路棋盘，黑棋先行，横、竖、斜连成五子即胜。本局为自由五子棋，没有禁手。"
      : "A 15×15 board. Black goes first; five in a row wins. Freestyle rules, no forbidden moves.",
    params: {
      fields: [
        {
          id: "mode",
          label: zh ? "对局方式" : "Mode",
          type: "select",
          value: "ai",
          options: [
            { value: "ai", label: zh ? "对战 AI" : "vs AI" },
            { value: "local", label: zh ? "热座双人" : "Hotseat" },
          ],
        },
      ],
    },
    actions: [{ id: "start", label: zh ? "开始" : "Start", kind: "primary" }],
  };
};
