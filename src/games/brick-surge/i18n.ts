export type BrickSurgeDict = {
  setupTitle: string;
  setupHint: string;
  speed: string;
  slow: string;
  normal: string;
  fast: string;
  speedBlurb: (id: "slow" | "normal" | "fast") => string;
  start: string;
  backSetup: string;
  score: string;
  best: string;
  lives: string;
  wave: string;
  mult: string;
  pause: string;
  resume: string;
  gameOver: string;
  tryAgain: string;
  clickStart: string;
  hint: string;
  stageAria: string;
  bestLine: (n: number) => string;
};

export const brickSurgeEn: BrickSurgeDict = {
  setupTitle: "Brick Surge",
  setupHint:
    "Endless 3D breakout in a dark tunnel. Clear ~75% of a wave and the next surges in. Miss the ball to lose a life — multiplier resets. No multi-ball in this graybox.",
  speed: "Speed",
  slow: "Slow",
  normal: "Normal",
  fast: "Fast",
  speedBlurb: (id) => {
    if (id === "slow") return "Gentler ball and wave pace.";
    if (id === "fast") return "Faster ball and denser pressure.";
    return "Balanced arcade pace.";
  },
  start: "Enter the tunnel",
  backSetup: "← Setup",
  score: "Score",
  best: "Best",
  lives: "Lives",
  wave: "Wave",
  mult: "×",
  pause: "Pause",
  resume: "Resume",
  gameOver: "Tunnel sealed",
  tryAgain: "Click to try again",
  clickStart: "Click / tap to launch",
  hint: "Move paddle · mouse/touch or WASD / arrows (X+Y) · click to launch",
  stageAria: "Brick Surge playfield",
  bestLine: (n) => `Best on this device: ${n}`,
};

export const brickSurgeZh: BrickSurgeDict = {
  setupTitle: "砖涌",
  setupHint:
    "黑暗隧廊里的无尽三维打砖。清掉当前波约 75% 砖块，下一波会短促推入。漏球掉命，连击倍率归零。灰盒版不含多球。",
  speed: "速度",
  slow: "慢速",
  normal: "普通",
  fast: "快速",
  speedBlurb: (id) => {
    if (id === "slow") return "球速与波次节奏更缓。";
    if (id === "fast") return "球更快，压迫感更强。";
    return "均衡街机节奏。";
  },
  start: "进入隧廊",
  backSetup: "← 返回设置",
  score: "得分",
  best: "最高",
  lives: "命",
  wave: "波次",
  mult: "×",
  pause: "暂停",
  resume: "继续",
  gameOver: "隧廊封闭",
  tryAgain: "点击再来",
  clickStart: "点击 / 轻触发球",
  hint: "移动挡板 · 鼠标/触控或 WASD / 方向键（左右+上下）· 点击发球",
  stageAria: "砖涌对局画面",
  bestLine: (n) => `本机最高分：${n}`,
};
