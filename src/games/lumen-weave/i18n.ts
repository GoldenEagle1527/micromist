import type { BiomeId } from "./biomeIds";

export type LumenCruise = "slow" | "normal" | "fast";

export type LumenDict = {
  setupTitle: string;
  setupHint: string;
  seed: string;
  seedPlaceholder: string;
  randomSeed: string;
  cruise: string;
  slow: string;
  normal: string;
  fast: string;
  cruiseBlurb: (id: LumenCruise) => string;
  start: string;
  backSetup: string;
  biome: string;
  biomeName: (id: BiomeId) => string;
  hint: string;
  stageAria: string;
};

export const lumenEn: LumenDict = {
  setupTitle: "Lumen Weave",
  setupHint:
    "Skim a continuous seeded particle ocean — landforms morph softly beneath you. Same seed remakes the same sea. Steer left and right only; auto-forward sightseeing, no score and no fail state.",
  seed: "Seed",
  seedPlaceholder: "text or number",
  randomSeed: "New random seed",
  cruise: "Cruise",
  slow: "Slow",
  normal: "Normal",
  fast: "Fast",
  cruiseBlurb: (id) => {
    if (id === "slow") return "Gentle skim — easy on motion comfort.";
    if (id === "fast") return "Swift skim across the particle sea.";
    return "Balanced glide over the weave ocean.";
  },
  start: "Enter the weave",
  backSetup: "← Setup",
  biome: "Biome",
  biomeName: (id) => {
    if (id === "dunes") return "Cyan dunes";
    if (id === "helix") return "Amber helix";
    if (id === "warp") return "Warp filaments";
    if (id === "void") return "Star void";
    return "Magenta ridges";
  },
  hint: "Glide left-right on the particle sea · A/D or ←/→ or horizontal drag · auto-forward",
  stageAria: "Lumen Weave particle sea",
};

export const lumenZh: LumenDict = {
  setupTitle: "织光",
  setupHint:
    "在连续的种子粒子海面上滑翔参观 — 地貌随生态域柔和渐变。同一种子复现同一片海。只需左右转向；自动前进而观光，无得分、无失败。",
  seed: "种子",
  seedPlaceholder: "文字或数字",
  randomSeed: "随机新种子",
  cruise: "巡航",
  slow: "慢速",
  normal: "普通",
  fast: "快速",
  cruiseBlurb: (id) => {
    if (id === "slow") return "缓速贴面滑翔 — 更舒适的动感。";
    if (id === "fast") return "疾速划过粒子海面。";
    return "均衡滑翔，穿行织界之海。";
  },
  start: "进入织界",
  backSetup: "← 返回设置",
  biome: "生态域",
  biomeName: (id) => {
    if (id === "dunes") return "青砂丘浪";
    if (id === "helix") return "琥珀螺旋";
    if (id === "warp") return "曲丝隧廊";
    if (id === "void") return "星空虚空";
    return "品红脊格";
  },
  hint: "左右滑翔参观粒子海 · A/D 或 ←/→ 或左右拖动 · 自动前进",
  stageAria: "织光粒子海",
};
