import type { EnvironmentKind, SurfaceType } from "./terrain/terrainInfo";
import type { RegionKey } from "./terrain/regions";
import type { LightMode } from "./survival";

export type DeepMarchDict = {
  setupTitle: string;
  setupHint: string;
  seedLabel: string;
  randomSeed: string;
  sensitivity: string;
  invertY: string;
  panelToggle: string;
  panelToggleHint: string;
  start: string;
  backSetup: string;
  controlsTitle: string;
  controls: string[];
  hint: string;
  hintPanel: string;
  stageAria: string;
  hudDepth: string;
  hudSpeed: string;
  hudHeading: string;
  hudChunks: string;
  /** Debug stat-line words (numbers stay as they are). */
  hudFloaters: string;
  hudTris: string;
  hudMainThread: string;
  hudClassify: string;
  /** Debug spawn-candidate overlay. */
  spawnDebugTitle: string;
  surfaceTypes: Record<SurfaceType, string>;
  /** Debug region panel. */
  regionDebugTitle: string;
  regionEdge: string;
  /** HUD region chip. */
  hudRegion: string;
  regionNames: Record<RegionKey, string>;
  hudLoading: string;
  hudGrounded: string;
  hudCeiling: string;
  hudScrape: string;
  hudTerrain: string;
  terrainKinds: Record<EnvironmentKind, string>;
  lockPrompt: string;
  stateSwim: string;
  stateHover: string;
  btnUp: string;
  btnDown: string;
  btnSwim: string;
  btnLamp: string;
  /** Survival HUD: battery + light modes. */
  hudBattery: string;
  lightOff: string;
  lightModes: Record<LightMode, string>;
  batteryEmpty: string;
  batteryCharging: string;
  dialMove: string;
  showPanel: string;
  hidePanel: string;
  exit: string;
  flip: string;
  seedNow: (seed: string) => string;
};

export const deepMarchEn: DeepMarchDict = {
  setupTitle: "Deep March",
  setupHint:
    "Dive (first person) through an endless marching-cubes cavern sea. Exploration only — no score, no lives. Same seed, same world.",
  seedLabel: "Seed",
  randomSeed: "Random",
  sensitivity: "Look sensitivity",
  invertY: "Invert look Y",
  panelToggle: "On-screen control panel",
  panelToggleHint: "Dial + buttons for touch; on by default on phones and tablets.",
  start: "Dive",
  backSetup: "← Setup",
  controlsTitle: "Controls",
  controls: [
    "Mouse — look (click the view to capture the mouse, Esc releases)",
    "WASD / arrows — move along your heading · Space — swim up · Shift — sink",
    "Double-tap W, or hold W and press Ctrl / R — swim fast toward where you look",
    "Release W to stop swimming · F — lights on / off · L — next light mode · 1 / 2 / 3 — beam / high beam / night vision",
    "Lights run on the battery (beam drains least, night vision most); it slowly recharges while the lights are off",
    "Touch panel: left dial moves (push to the outer SWIM arc to swim), right fan = up / down / swim / lamp / light mode, drag elsewhere to look",
  ],
  hint: "Click to look · WASD move · double-tap W swim · Space/Shift up/down · F lights · L mode",
  hintPanel: "Left dial moves · right fan acts · drag the view to look",
  stageAria: "Deep March underwater view",
  hudDepth: "Depth",
  hudSpeed: "Speed",
  hudHeading: "Heading",
  hudChunks: "chunks",
  hudFloaters: "float",
  hudTris: "tri",
  hudMainThread: "main",
  hudClassify: "cls",
  spawnDebugTitle: "Spawn points (B)",
  surfaceTypes: {
    "floor-flat": "floor-flat",
    "floor-slope": "floor-slope",
    wall: "wall",
    ceiling: "ceiling",
    "ledge-top": "ledge-top",
    crevice: "crevice",
    ridge: "ridge",
    "cave-floor": "cave-floor",
  },
  regionDebugTitle: "Regions",
  regionEdge: "edge",
  hudRegion: "Region",
  regionNames: {
    sand: "Sand Plains",
    reef: "Reef Forest",
    canyon: "Canyon Belt",
    cave: "Cave Warren",
    terrace: "Cliff Terraces",
    trench: "Deep Trench",
  },
  hudLoading: "Generating seabed…",
  hudGrounded: "Touching bottom",
  hudCeiling: "Touching ceiling",
  hudScrape: "Brushing rock",
  hudTerrain: "Terrain",
  terrainKinds: {
    open: "Open water",
    flat: "Flat seabed",
    slope: "Slope",
    cliff: "Cliff",
    cave: "Cave",
    overhang: "Overhang",
    canyon: "Canyon",
    ridge: "Ridge / peak",
  },
  lockPrompt: "Click to look around · Esc releases the mouse",
  stateSwim: "SWIM",
  stateHover: "HOVER",
  btnUp: "UP",
  btnDown: "DOWN",
  btnSwim: "SWIM",
  btnLamp: "LAMP",
  hudBattery: "Battery",
  lightOff: "LIGHTS OFF",
  lightModes: { beam: "BEAM", high: "HIGH BEAM", night: "NIGHT VIS" },
  batteryEmpty: "Battery flat — lights offline",
  batteryCharging: "Recharging…",
  dialMove: "Move",
  showPanel: "Show control panel",
  hidePanel: "Hide control panel",
  exit: "Exit dive",
  flip: "Flip view 180°",
  seedNow: (seed) => `Seed ${seed}`,
};

export const deepMarchZh: DeepMarchDict = {
  setupTitle: "深潜",
  setupHint: "以第一人称潜水员的视角，穿行在由 Marching Cubes 实时生成、无尽延伸的海底洞穴。纯探索：无得分、无生命。同一种子，同一片海。",
  seedLabel: "种子",
  randomSeed: "随机",
  sensitivity: "视角灵敏度",
  invertY: "反转视角上下",
  panelToggle: "屏幕操控面板",
  panelToggleHint: "触屏用的摇盘和按钮；手机、平板上默认开启。",
  start: "下潜",
  backSetup: "← 返回设置",
  controlsTitle: "操作",
  controls: [
    "鼠标 — 转动视角（点击画面锁定鼠标，Esc 释放）",
    "WASD / 方向键 — 沿朝向移动 · 空格 — 上浮 · Shift — 下沉",
    "双击 W，或按住 W 再按 Ctrl / R — 朝视线方向快速游泳",
    "松开 W 停止游泳 · F — 开关灯光 · L — 切换灯光模式 · 1 / 2 / 3 — 光束 / 远光 / 夜视",
    "灯光消耗电池（光束最省电，夜视最耗电）；关灯时电池会缓慢回充",
    "触屏面板：左侧摇盘移动（推到外圈「游泳」弧区即游泳），右侧扇形按钮为上浮 / 下沉 / 游泳 / 头灯 / 灯光模式，拖动其余画面转动视角",
  ],
  hint: "点击画面转视角 · WASD 移动 · 双击 W 游泳 · 空格/Shift 上浮/下沉 · F 灯光 · L 模式",
  hintPanel: "左摇盘移动 · 右扇形按钮操作 · 拖动画面转视角",
  stageAria: "深潜水下画面",
  hudDepth: "深度",
  hudSpeed: "速度",
  hudHeading: "航向",
  hudChunks: "区块",
  hudFloaters: "浮岩",
  hudTris: "三角",
  hudMainThread: "主线程",
  hudClassify: "分类",
  spawnDebugTitle: "刷新点（B）",
  surfaceTypes: {
    "floor-flat": "平地",
    "floor-slope": "缓坡",
    wall: "岩壁",
    ceiling: "洞顶",
    "ledge-top": "岩架顶",
    crevice: "缝隙",
    ridge: "脊",
    "cave-floor": "洞底",
  },
  regionDebugTitle: "区域",
  regionEdge: "距边界",
  hudRegion: "区域",
  regionNames: {
    sand: "沙原",
    reef: "礁石林",
    canyon: "峡谷带",
    cave: "洞穴群",
    terrace: "峭壁台地",
    trench: "深沟",
  },
  hudLoading: "正在生成海床…",
  hudGrounded: "触底",
  hudCeiling: "触顶",
  hudScrape: "擦碰岩壁",
  hudTerrain: "地形",
  terrainKinds: {
    open: "开阔水域",
    flat: "海床平地",
    slope: "斜坡",
    cliff: "峭壁",
    cave: "洞穴",
    overhang: "岩檐/拱下",
    canyon: "峡谷/沟槽",
    ridge: "山脊/峰顶",
  },
  lockPrompt: "点击画面转动视角 · Esc 释放鼠标",
  stateSwim: "游泳",
  stateHover: "悬浮",
  btnUp: "上浮",
  btnDown: "下沉",
  btnSwim: "游泳",
  btnLamp: "头灯",
  hudBattery: "电池",
  lightOff: "灯光关闭",
  lightModes: { beam: "光束", high: "远光", night: "夜视" },
  batteryEmpty: "电量耗尽 · 灯光离线",
  batteryCharging: "回充中…",
  dialMove: "移动",
  showPanel: "显示操控面板",
  hidePanel: "隐藏操控面板",
  exit: "退出下潜",
  flip: "画面翻转 180°",
  seedNow: (seed) => `种子 ${seed}`,
};
