export type LumenDifficulty = "easy" | "normal" | "hard";

export type LumenDict = {
  setupTitle: string;
  setupHint: string;
  difficulty: string;
  easy: string;
  normal: string;
  hard: string;
  difficultyBlurb: (id: LumenDifficulty) => string;
  start: string;
  bestLabel: string;
  bestValue: (n: number) => string;
  emptyBest: string;
  backSetup: string;
  score: string;
  best: string;
  lives: string;
  nearMiss: string;
  gameOver: string;
  tryAgain: string;
  hint: string;
  stageAria: string;
};

export const lumenEn: LumenDict = {
  setupTitle: "Lumen Weave",
  setupHint:
    "Rush a glowing craft through a tunnel of woven light. Steer between neon beams; skim close for near-miss bonuses. Solo — best score stays on this device.",
  difficulty: "Pace",
  easy: "Slow",
  normal: "Normal",
  hard: "Fast",
  difficultyBlurb: (id) => {
    if (id === "easy") return "Gentle rush — wider gaps, slower beams.";
    if (id === "hard") return "Dense weave — tight gaps, relentless speed.";
    return "Balanced tunnel — fair gaps and climb.";
  },
  start: "Enter the weave",
  bestLabel: "Best",
  bestValue: (n) => `${n}`,
  emptyBest: "No best yet — weave your first run.",
  backSetup: "← Setup",
  score: "Score",
  best: "Best",
  lives: "Lives",
  nearMiss: "Near miss +",
  gameOver: "Weave broken",
  tryAgain: "Click to weave again",
  hint: "Drag or A/D · ←/→ to steer; W/S · ↑/↓ for light vertical. Avoid solid beams.",
  stageAria: "Lumen Weave playfield",
};

export const lumenZh: LumenDict = {
  setupTitle: "织光",
  setupHint:
    "驾驶微光载具冲入光带织成的隧道。左右穿梭躲开亮束，擦边掠过可拿近失加成。单机本地，最高分只存本机。",
  difficulty: "节奏",
  easy: "慢速",
  normal: "普通",
  hard: "快速",
  difficultyBlurb: (id) => {
    if (id === "easy") return "缓速穿梭 — 空隙更宽，光束更慢。";
    if (id === "hard") return "密织狂奔 — 空隙更窄，速度不停爬升。";
    return "均衡隧道 — 空隙与加速适中。";
  },
  start: "进入织光",
  bestLabel: "最高",
  bestValue: (n) => `${n}`,
  emptyBest: "还没有最高分 — 织出第一局吧。",
  backSetup: "← 返回设置",
  score: "得分",
  best: "最高",
  lives: "命",
  nearMiss: "擦边 +",
  gameOver: "织线断裂",
  tryAgain: "点击再织一局",
  hint: "拖动或 A/D · ←/→ 转向；W/S · ↑/↓ 轻微上下。躲开实心光束。",
  stageAria: "织光游玩区",
};
