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
    "First-person glide through endless seeded particle biomes. Same seed remakes the same world — wander, look around, no score and no fail state.",
  seed: "Seed",
  seedPlaceholder: "text or number",
  randomSeed: "New random seed",
  cruise: "Cruise",
  slow: "Slow",
  normal: "Normal",
  fast: "Fast",
  cruiseBlurb: (id) => {
    if (id === "slow") return "Gentle drift — easy on motion comfort.";
    if (id === "fast") return "Swift glide — still exploratory, not a score chase.";
    return "Balanced cruise through the weave.";
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
  hint: "Drag to look · A/D strafe · W/S cruise boost/brake · ↑/Space up · ↓/Shift down",
  stageAria: "Lumen Weave explore field",
};

export const lumenZh: LumenDict = {
  setupTitle: "织光",
  setupHint:
    "第一人称漫游无尽的种子粒子生态域。同一种子复现同一世界 — 随意穿梭环顾，无得分、无失败。",
  seed: "种子",
  seedPlaceholder: "文字或数字",
  randomSeed: "随机新种子",
  cruise: "巡航",
  slow: "慢速",
  normal: "普通",
  fast: "快速",
  cruiseBlurb: (id) => {
    if (id === "slow") return "缓速漂游 — 更舒适的动感。";
    if (id === "fast") return "疾速滑翔 — 仍是漫游，不是竞速计分。";
    return "均衡巡航，穿行织界。";
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
  hint: "拖动环顾 · A/D 横移 · W/S 加速/减速 · ↑/空格 上升 · ↓/Shift 下降",
  stageAria: "织光漫游区",
};
