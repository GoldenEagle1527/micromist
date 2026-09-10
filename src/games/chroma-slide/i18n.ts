export type ChromaDict = {
  setupTitle: string;
  setupHint: string;
  difficulty: string;
  small: string;
  medium: string;
  large: string;
  colors: string;
  presetBlurb: (size: number, colors: number, each: number) => string;
  start: string;
  backSetup: string;
  stepsHud: string;
  playHint: string;
  winMessage: (steps: number) => string;
  reshuffle: string;
  adjustSettings: string;
  playAgain: string;
  confirmReshuffleTitle: string;
  confirmReshuffleBody: string;
  confirmSetupTitle: string;
  confirmSetupBody: string;
  confirmCancel: string;
  confirmOk: string;
  boardAria: string;
  emptyAria: string;
  tileAria: (color: number, row: number, col: number) => string;
  historyTitle: string;
  bestLabel: string;
  recentLabel: string;
  emptyHistory: string;
  playedAt: (at: number) => string;
  durationLabel: (ms: number) => string;
  stepsCount: (steps: number) => string;
  winModalTitle: string;
  newBestBadge: string;
};

function formatDurationEn(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return min ? `${h}h ${min}m` : `${h}h`;
}

function formatDurationZh(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m} 分 ${rem} 秒` : `${m} 分`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return min ? `${h} 小时 ${min} 分` : `${h} 小时`;
}

export const chromaEn: ChromaDict = {
  setupTitle: "Chroma Slide",
  setupHint:
    "Gather each color into one axis-aligned rectangle (empty may be anywhere). Click a tile on the empty cell's row or column to slide the whole run — that counts as 1 step.",
  difficulty: "Difficulty",
  small: "Small",
  medium: "Medium",
  large: "Large",
  colors: "colors",
  presetBlurb: (size, colors, each) =>
    `${size}×${size} board · ${colors} colors · ${each} tiles each (plus 1 gap)`,
  start: "Start",
  backSetup: "← Setup",
  stepsHud: "Steps",
  playHint:
    "Click a tile on the empty cell's row or column to slide. Goal: each color forms one axis-aligned rectangle (the empty may sit in a corner of a block).",
  winMessage: (steps) => `Cleared in ${steps} steps!`,
  reshuffle: "Shuffle",
  adjustSettings: "Setup",
  playAgain: "Play again",
  confirmReshuffleTitle: "Shuffle again?",
  confirmReshuffleBody: "Steps reset to zero and the board is randomized.",
  confirmSetupTitle: "Back to setup?",
  confirmSetupBody: "Leave this puzzle and return to difficulty settings.",
  confirmCancel: "Cancel",
  confirmOk: "Confirm",
  boardAria: "Chroma Slide board",
  emptyAria: "Empty cell",
  tileAria: (color, row, col) => `Color ${color}, row ${row}, column ${col}`,
  historyTitle: "Score history",
  bestLabel: "Best",
  recentLabel: "Recent",
  emptyHistory: "No clears yet — finish a puzzle to see history here.",
  playedAt: (at) =>
    new Date(at).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  durationLabel: formatDurationEn,
  stepsCount: (steps) => `${steps} steps`,
  winModalTitle: "Puzzle cleared",
  newBestBadge: "New best",
};

export const chromaZh: ChromaDict = {
  setupTitle: "滑动色块",
  setupHint:
    "把每种颜色收成一块矩形（空位位置不限）。点击与空格同行或同列的色块，整段滑向空格，计 1 步。",
  difficulty: "难度",
  small: "小",
  medium: "中",
  large: "大",
  colors: "色",
  presetBlurb: (size, colors, each) =>
    `${size}×${size} 棋盘 · ${colors} 种颜色 · 每种 ${each} 格，另有 1 个空位`,
  start: "开始游戏",
  backSetup: "← 返回设置",
  stepsHud: "步数",
  playHint:
    "点击与空格同行或同列的色块，整段滑过去。目标：每种颜色收成一块矩形（空位可在盘角，也可卡在某色块角上）。",
  winMessage: (steps) => `完成！共用 ${steps} 步`,
  reshuffle: "洗牌",
  adjustSettings: "设置",
  playAgain: "再来一局",
  confirmReshuffleTitle: "重新洗牌？",
  confirmReshuffleBody: "当前步数会清零，棋盘会重新随机摆放。",
  confirmSetupTitle: "返回设置？",
  confirmSetupBody: "将离开当前对局并回到难度选择。",
  confirmCancel: "取消",
  confirmOk: "确定",
  boardAria: "滑动色块棋盘",
  emptyAria: "空位",
  tileAria: (color, row, col) => `颜色 ${color}，第 ${row} 行第 ${col} 列`,
  historyTitle: "成绩记录",
  bestLabel: "最佳",
  recentLabel: "最近",
  emptyHistory: "还没有通关记录，完成一局后会显示在这里。",
  playedAt: (at) =>
    new Date(at).toLocaleString("zh-CN", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  durationLabel: formatDurationZh,
  stepsCount: (steps) => `${steps} 步`,
  winModalTitle: "通关",
  newBestBadge: "新最佳",
};
