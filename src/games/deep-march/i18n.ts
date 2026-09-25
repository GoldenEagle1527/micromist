export type DeepMarchDict = {
  setupTitle: string;
  setupHint: string;
  seedLabel: string;
  randomSeed: string;
  invertPitch: string;
  start: string;
  backSetup: string;
  controlsTitle: string;
  controls: string[];
  hint: string;
  faster: string;
  slower: string;
  boost: string;
  stageAria: string;
  hudDepth: string;
  hudSpeed: string;
  hudHeading: string;
  hudChunks: string;
  hudLoading: string;
  hudGrounded: string;
  hudCeiling: string;
  hudScrape: string;
  seedNow: (seed: string) => string;
};

export const deepMarchEn: DeepMarchDict = {
  setupTitle: "Deep March",
  setupHint:
    "Pilot a tiny submarine (first person) through an endless marching-cubes cavern sea. Exploration only — no score, no lives. Same seed, same world.",
  seedLabel: "Seed",
  randomSeed: "Random",
  invertPitch: "Invert pitch (W = nose down)",
  start: "Dive",
  backSetup: "← Setup",
  controlsTitle: "Controls",
  controls: [
    "W/S or ↑/↓ — pitch · A/D or ←/→ — turn",
    "E / Q or mouse wheel — throttle up / down · Shift/Space — boost",
    "Drag on the view (mouse or touch) — steer like a stick",
  ],
  hint: "WASD / arrows steer · E/Q throttle · drag to steer",
  faster: "Throttle +",
  slower: "Throttle −",
  boost: "Boost",
  stageAria: "Deep March underwater view",
  hudDepth: "Depth",
  hudSpeed: "Speed",
  hudHeading: "Heading",
  hudChunks: "chunks",
  hudLoading: "Generating seabed…",
  hudGrounded: "Hull grounded",
  hudCeiling: "Hitting ceiling",
  hudScrape: "Scraping rock",
  seedNow: (seed) => `Seed ${seed}`,
};

export const deepMarchZh: DeepMarchDict = {
  setupTitle: "深潜",
  setupHint: "以第一人称驾驶小潜艇穿行在由 Marching Cubes 实时生成、无尽延伸的海底洞穴。纯探索：无得分、无生命。同一种子，同一片海。",
  seedLabel: "种子",
  randomSeed: "随机",
  invertPitch: "反转俯仰（W = 低头）",
  start: "下潜",
  backSetup: "← 返回设置",
  controlsTitle: "操作",
  controls: [
    "W/S 或 ↑/↓ — 俯仰 · A/D 或 ←/→ — 转向",
    "E / Q 或鼠标滚轮 — 加 / 减油门 · Shift/空格 — 冲刺",
    "在画面上拖动（鼠标或触屏）— 像摇杆一样操舵",
  ],
  hint: "WASD / 方向键操舵 · E/Q 油门 · 拖动转向",
  faster: "油门 +",
  slower: "油门 −",
  boost: "冲刺",
  stageAria: "深潜水下画面",
  hudDepth: "深度",
  hudSpeed: "航速",
  hudHeading: "航向",
  hudChunks: "区块",
  hudLoading: "正在生成海床…",
  hudGrounded: "船体触底",
  hudCeiling: "触顶",
  hudScrape: "擦碰岩壁",
  seedNow: (seed) => `种子 ${seed}`,
};
