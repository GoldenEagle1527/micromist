/**
 * Debug panel strings (zh / en). Part of the debug chunk, so production builds
 * ship none of them; test:i18n checks them with the game's dictionaries.
 */
import type { SectionId } from "./registry";

type Edge = "n" | "e" | "s" | "w";
type Corner = "ne" | "nw" | "se" | "sw";

export type DebugDict = {
  title: string;
  /** The touch button and the desktop key hint. */
  close: string;
  keyHint: string;
  /** The dive is still loading: runtime commands appear once it runs. */
  loading: string;
  noSave: string;
  position: (x: number, y: number, z: number) => string;
  /** Restart bar: n overrides wait for the restart. */
  pending: (n: number) => string;
  restart: string;
  resetAll: string;
  needsRestart: string;
  on: string;
  off: string;
  sections: Record<SectionId, string>;
  cmd: {
    targets: string;
    customX: string;
    customY: string;
    customZ: string;
    customHere: string;
    customGo: string;
    lightMode: string;
    ping: string;
    observe: string;
    forgetScans: string;
    fillBattery: string;
    markers: string;
    stats: string;
    chaosStage: string;
    chaosCracks: string;
    chaosScar: string;
    omenPhantoms: string;
    omenAnomaly: string;
    omenDimming: string;
    omenHomeGhost: string;
    tideSimple: string;
    rehearsal: string;
    gazeSkip: string;
    gazeAnchors: string;
    gazeReturn: string;
    gazeSeal: string;
    gazeEnd: string;
    ktx2: string;
    dpr: string;
    lodNear: string;
    fog: string;
    wasm: string;
    refine: string;
    bricks: string;
    detail: string;
    occlusion: string;
    audioOn: string;
  };
  opt: { auto: string; chaosOwn: string; fogOff: string; lightOff: string; lightBeam: string; lightHigh: string; off: string };
  target: { spawn: string; base: string; crack: (n: string) => string; edge: Record<Edge, string>; corner: Record<Corner, string> };
};

const r = Math.round;

export const debugZh: DebugDict = {
  title: "调试面板（仅测试站）",
  close: "关闭",
  keyHint: "按 ` 键开关",
  loading: "下潜载入中：传送、灯光等即时功能稍后出现",
  noSave: "这里的改动都不会写入存档；重新开始下潜和平时离开一样会保存进度",
  position: (x, y, z) => `当前位置 x ${r(x)} · y ${r(y)} · z ${r(z)}`,
  pending: (n) => `${n} 项改动要重新开始下潜才生效`,
  restart: "重新开始下潜",
  resetAll: "全部恢复默认",
  needsRestart: "需重开",
  on: "开",
  off: "关",
  sections: { teleport: "传送", chaos: "混沌预览", light: "灯光/声呐", tide: "潮汐", ending: "结局演练", resources: "资源", render: "渲染", audio: "声音", overlay: "调试叠加层" },
  cmd: {
    targets: "去往",
    customX: "自定 x（东西）",
    customY: "自定 y（高度）",
    customZ: "自定 z（南北）",
    customHere: "取当前位置",
    customGo: "传送到自定位置（在岩石里会自动抬到水中）",
    lightMode: "灯光模式",
    ping: "发射声呐脉冲（不耗电、无冷却）",
    observe: "声呐观察模式（N 键）",
    forgetScans: "清空声呐记录（存档里的也清空）",
    fillBattery: "电池充满（不存档）",
    markers: "出生点与区域标记（B 键）",
    stats: "性能信息行（帧率 / 区块 / 三角形）",
    chaosStage: "混沌阶段（仅本次预览）",
    chaosCracks: "裂缝数",
    chaosScar: "加一道愈合的伤疤",
    omenPhantoms: "预览·声呐假读数（任何阶段：打声呐偶有幻影回波，深度/航向读数跳变）",
    omenAnomaly: "预览·异常地形（裂缝周围；没有裂缝时自动开两道）",
    omenDimming: "预览·基地灯塔变暗（站在亮着的灯塔附近）",
    omenHomeGhost: "预览·基地的幽灵回波（离基地 160 m 外打声呐）",
    tideSimple: "简化潮汐（直接浊潮）",
    rehearsal: "结局演练：直视沙盒（存档副本只在内存里，不写入真实存档）",
    gazeSkip: "直视时间 +5 分钟",
    gazeAnchors: "点亮全部锚点（不耗粒子）",
    gazeReturn: "放流到预报 m ≥ 0.84",
    gazeSeal: "立即封界（两件事完成 + 原地唤来封界潮）",
    gazeEnd: "立即湮灭（只结束沙盒）",
    ktx2: "KTX2 纹理（关 = WebP）",
    dpr: "像素比",
    lodNear: "全精度半径",
    fog: "浑浊度",
    wasm: "噪声计算",
    refine: "粗筛预处理",
    bricks: "稀疏砖块网格",
    detail: "细节法线",
    occlusion: "遮挡剔除",
    audioOn: "声音（关 = 完全静音）",
  },
  opt: { auto: "默认", chaosOwn: "本世代", fogOff: "无", lightOff: "关灯", lightBeam: "光束", lightHigh: "远光", off: "关" },
  target: {
    spawn: "出生点",
    base: "基地",
    crack: (n) => `裂缝 ${n}`,
    edge: { n: "北边缘", e: "东边缘", s: "南边缘", w: "西边缘" },
    corner: { ne: "东北角", nw: "西北角", se: "东南角", sw: "西南角" },
  },
};

export const debugEn: DebugDict = {
  title: "Debug panel (staging only)",
  close: "Close",
  keyHint: "Press ` to toggle",
  loading: "The dive is loading: teleport, lights and other live tools appear shortly",
  noSave: "Nothing here is written to the save; restarting the dive saves progress like leaving does",
  position: (x, y, z) => `Position x ${r(x)} · y ${r(y)} · z ${r(z)}`,
  pending: (n) => `${n} change${n === 1 ? "" : "s"} take effect when the dive restarts`,
  restart: "Restart dive",
  resetAll: "Reset all",
  needsRestart: "restart",
  on: "On",
  off: "Off",
  sections: { teleport: "Teleport", chaos: "Chaos preview", light: "Lights / sonar", tide: "Tide", ending: "Ending rehearsal", resources: "Resources", render: "Rendering", audio: "Sound", overlay: "Debug overlay" },
  cmd: {
    targets: "Go to",
    customX: "Custom x (east–west)",
    customY: "Custom y (height)",
    customZ: "Custom z (north–south)",
    customHere: "Use current position",
    customGo: "Teleport to custom point (lifted out of rock)",
    lightMode: "Light mode",
    ping: "Sonar ping (free, no cooldown)",
    observe: "Sonar observation mode (N)",
    forgetScans: "Forget the sonar scan record (the saved one too)",
    fillBattery: "Fill battery (not saved)",
    markers: "Spawn and region markers (B)",
    stats: "Performance line (fps / chunks / triangles)",
    chaosStage: "Chaos stage (preview only)",
    chaosCracks: "Cracks",
    chaosScar: "Add a healed scar",
    omenPhantoms: "Preview · false sonar readings (any stage: phantom returns on pings, depth / heading jumps)",
    omenAnomaly: "Preview · anomalous terrain (around cracks; two are opened if there are none)",
    omenDimming: "Preview · base lighthouse dimming (stay near a lit lighthouse)",
    omenHomeGhost: "Preview · the base's ghost echo (ping 160 m or more from the base)",
    tideSimple: "Simple tide (murk right away)",
    rehearsal: "Ending rehearsal: a gaze sandbox (a copy of the save in memory; the real save is never written)",
    gazeSkip: "Gaze time +5 minutes",
    gazeAnchors: "Light every anchor (free)",
    gazeReturn: "Release until the forecast m ≥ 0.84",
    gazeSeal: "Seal now (both conditions + the sealing tide here)",
    gazeEnd: "Annihilate now (ends the sandbox only)",
    ktx2: "KTX2 textures (off = WebP)",
    dpr: "Pixel ratio",
    lodNear: "Full-detail radius",
    fog: "Turbidity",
    wasm: "Noise engine",
    refine: "Coarse pre-pass",
    bricks: "Sparse brick meshing",
    detail: "Detail normals",
    occlusion: "Occlusion culling",
    audioOn: "Sound (off = fully silent)",
  },
  opt: { auto: "Default", chaosOwn: "This generation", fogOff: "None", lightOff: "Off", lightBeam: "Beam", lightHigh: "High beam", off: "Off" },
  target: {
    spawn: "Spawn",
    base: "Base",
    crack: (n) => `Crack ${n}`,
    edge: { n: "North edge", e: "East edge", s: "South edge", w: "West edge" },
    corner: { ne: "NE corner", nw: "NW corner", se: "SE corner", sw: "SW corner" },
  },
};
