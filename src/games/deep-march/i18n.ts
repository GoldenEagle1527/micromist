import type { SurfaceType } from "./terrain/terrainInfo";
import type { RegionKey } from "./terrain/regions";
import type { LightMode } from "./survival";
import { loadingEn, loadingZh, type LoadingDict } from "./ui/loading/i18n";
import { setupEn, setupZh, type SetupDict } from "./ui/setup/i18n";
import { expeditionEn, expeditionZh, type ExpeditionDict } from "./ui/expedition/i18n";
import { tideEn, tideZh, type TideDict } from "./ui/tide/i18n";
import { gazeEn, gazeZh, type GazeDict } from "./ui/gaze/i18n";
import { baseEn, baseZh, type BaseDict } from "./ui/base/i18n";
import { hintsEn, hintsZh, type HintDict } from "./ui/hints/i18n";
import type { SonarHudLabels } from "./ui/SonarGauge";
import { menuEn, menuZh, type MenuDict } from "./ui/menu/i18n";

export type DeepMarchDict = {
  setupTitle: string;
  setupHint: string;
  seedLabel: string;
  randomSeed: string;
  sensitivity: string;
  invertY: string;
  /** Accessibility (M8): shallower, slower light changes near cracks. */
  calmLights: string;
  calmLightsHint: string;
  panelToggle: string;
  panelToggleHint: string;
  /** Setup: true fullscreen when the dive starts. */
  fullscreenSetting: string;
  fullscreenSettingHint: string;
  start: string;
  controlsTitle: string;
  controls: string[];
  stageAria: string;
  /** In-game ≡ menu, help sheet, desktop key chip. */
  menu: MenuDict;
  /** Region toast on entering a new region (followed by its name). */
  regionEnter: string;
  hudDepth: string;
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
  /** Setup screen: mode choice and the conserve save slot (ui/setup). */
  setup: SetupDict;
  /** Loading screen (ui/loading). */
  loading: LoadingDict;
  /** Conserve expedition HUD (ui/expedition). */
  expedition: ExpeditionDict;
  /** Conserve base HUD (ui/base, M5). */
  base: BaseDict;
  tide: TideDict;
  /** Conserve, stage 5 (直视): the gaze HUD and the endings (ui/gaze). */
  gaze: GazeDict;
  /** Conserve new-player hints (ui/hints, M9). */
  hints: HintDict;
  hudGrounded: string;
  hudCeiling: string;
  hudScrape: string;
  lockPrompt: string;
  gpuLost: string;
  shaderFailed: string;
  stateSwim: string;
  stateHover: string;
  btnUp: string;
  btnDown: string;
  btnLamp: string;
  /** Fan sector: the active sonar ping. */
  btnPing: string;
  /** Sonar strip under the battery. */
  sonarHud: SonarHudLabels;
  /** Survival HUD: battery + light modes. */
  hudBattery: string;
  lightOff: string;
  lightModes: Record<LightMode, string>;
  batteryEmpty: string;
  batteryLow: string;
  dialMove: string;
  /** Sound: setup toggle + volume (in the dive: the ≡ menu). */
  soundToggle: string;
  volume: string;
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
  calmLights: "Reduce light flicker",
  calmLightsHint: "Near cracks the lamp and the glow pulse only gently and slowly.",
  panelToggle: "On-screen control panel",
  panelToggleHint: "Dial + buttons for touch; on by default on phones and tablets.",
  fullscreenSetting: "Fullscreen dive",
  fullscreenSettingHint: "The dive always fills the browser window; this also hides the browser bars (Esc leaves). On by default on phones and tablets.",
  start: "Dive",
  controlsTitle: "Controls",
  controls: [
    "Mouse — look (click the view to capture the mouse, Esc releases)",
    "WASD / arrows — move along your heading · Space — swim up · Shift — sink",
    "Double-tap W, or hold W and press Ctrl / R — swim fast toward where you look",
    "Release W to stop swimming · F — lights on / off · L — next light mode · 1 / 2 — beam / high beam · M — mute / unmute",
    "3 — sonar ping: a cyan wavefront sweeps the terrain around you and records it (costs battery, short recharge)",
    "N — sonar observation mode: see only what your pings recorded (unscanned places stay empty; after a tide the record shows the old terrain until you ping there again) · N again returns",
    "Lights and pings run on the battery (beam drains least); it slowly recharges while nothing draws on it",
    "Esc (mouse released) — the menu: sound, fullscreen, help, leave · ? — this help",
    "Touch: left dial moves (push into the outer SWIM arc to swim, double-tap the dial to keep swimming) · drag the view to look · right fan: UP / DOWN (hold), LAMP (tap on / off, hold to switch beam / high beam), PING (tap to ping, hold for the sonar observation view); ABSORB appears when aiming at a node, BUILD inside the base · ≡ top right = menu",
  ],
  stageAria: "Deep March underwater view",
  menu: menuEn,
  regionEnter: "Entering",
  hudDepth: "Depth",
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
  setup: setupEn,
  loading: loadingEn,
  expedition: expeditionEn,
  base: baseEn,
  tide: tideEn,
  gaze: gazeEn,
  hints: hintsEn,
  hudGrounded: "Touching bottom",
  hudCeiling: "Touching ceiling",
  hudScrape: "Brushing rock",
  lockPrompt: "Click to look around · Esc releases the mouse",
  gpuLost: "Graphics context lost (GPU reset) — reload the page",
  shaderFailed: "Graphics shader failed",
  stateSwim: "SWIM",
  stateHover: "HOVER",
  btnUp: "UP",
  btnDown: "DOWN",
  btnLamp: "LAMP",
  btnPing: "PING",
  sonarHud: {
    title: "Sonar",
    ready: "READY",
    cooling: "RECHARGING",
    noBattery: "LOW BATTERY",
    observe: "VIEW",
    observeOn: "SONAR OBSERVATION",
    observeHint: "Recorded scans, not the live seabed — after a tide they show the old terrain until you ping again",
    exitKey: "N returns",
    exitTouch: "Hold PING to return",
    recorded: "Mapped",
  },
  hudBattery: "Battery",
  lightOff: "LIGHTS OFF",
  lightModes: { beam: "BEAM", high: "HIGH BEAM" },
  batteryEmpty: "Battery flat — lights offline",
  batteryLow: "Battery low",
  dialMove: "Move",
  soundToggle: "Sound effects",
  volume: "Volume",
  seedNow: (seed) => `Seed ${seed}`,
};

export const deepMarchZh: DeepMarchDict = {
  setupTitle: "深潜",
  setupHint: "以第一人称潜水员的视角，穿行在由 Marching Cubes 实时生成、无尽延伸的海底洞穴。纯探索：无得分、无生命。同一种子，同一片海。",
  seedLabel: "种子",
  randomSeed: "随机",
  sensitivity: "视角灵敏度",
  invertY: "反转视角上下",
  calmLights: "减弱灯光起伏",
  calmLightsHint: "裂缝附近的灯光和辉光只做轻微、缓慢的变化。",
  panelToggle: "屏幕操控面板",
  panelToggleHint: "触屏用的摇盘和按钮；手机、平板上默认开启。",
  fullscreenSetting: "全屏下潜",
  fullscreenSettingHint: "下潜画面总会铺满浏览器窗口；勾选后还会隐藏浏览器界面（Esc 退出）。手机、平板上默认开启。",
  start: "下潜",
  controlsTitle: "操作",
  controls: [
    "鼠标 — 转动视角（点击画面锁定鼠标，Esc 释放）",
    "WASD / 方向键 — 沿朝向移动 · 空格 — 上浮 · Shift — 下沉",
    "双击 W，或按住 W 再按 Ctrl / R — 朝视线方向快速游泳",
    "松开 W 停止游泳 · F — 开关灯光 · L — 切换灯光模式 · 1 / 2 — 光束 / 远光 · M — 静音 / 取消静音",
    "3 — 声呐脉冲：一道青色波前扫过周围地形并记录下来（耗电，短暂冷却）",
    "N — 声呐观察模式：只显示声呐记录到的地形（没扫过的地方一片空白；潮汐之后记录仍是旧地形，要在那里重新扫描才会更新）· 再按 N 返回",
    "灯光和声呐脉冲消耗电池（光束最省电）；不耗电时电池会缓慢回充",
    "Esc（鼠标释放后）— 菜单：音效、全屏、帮助、退出 · ? — 本操作说明",
    "触屏：左摇盘移动（推到外圈「游泳」弧区即游泳，双击摇盘保持游泳）· 拖动画面转视角 · 右侧扇形：上浮 / 下沉（按住）、头灯（点按开关，长按切换光束 / 远光）、声呐（点按发射，长按进入声呐观察）；对准资源时出现「吸取」，在基地内出现「建造」· 右上角 ≡ 为菜单",
  ],
  stageAria: "深潜水下画面",
  menu: menuZh,
  regionEnter: "进入",
  hudDepth: "深度",
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
  setup: setupZh,
  loading: loadingZh,
  expedition: expeditionZh,
  base: baseZh,
  tide: tideZh,
  gaze: gazeZh,
  hints: hintsZh,
  hudGrounded: "触底",
  hudCeiling: "触顶",
  hudScrape: "擦碰岩壁",
  lockPrompt: "点击画面转动视角 · Esc 释放鼠标",
  gpuLost: "图形上下文丢失（GPU 重置）— 请刷新页面",
  shaderFailed: "图形着色器出错",
  stateSwim: "游泳",
  stateHover: "悬浮",
  btnUp: "上浮",
  btnDown: "下沉",
  btnLamp: "头灯",
  btnPing: "声呐",
  sonarHud: {
    title: "声呐",
    ready: "就绪",
    cooling: "充能",
    noBattery: "电量不足",
    observe: "观察",
    observeOn: "声呐观察模式",
    observeHint: "显示的是扫描记录，不是实时海床——潮汐之后仍是旧地形，重新扫描才会更新",
    exitKey: "按 N 返回",
    exitTouch: "长按「声呐」返回",
    recorded: "已测绘",
  },
  hudBattery: "电池",
  lightOff: "灯光关闭",
  lightModes: { beam: "光束", high: "远光" },
  batteryEmpty: "电量耗尽 · 灯光离线",
  batteryLow: "电量低",
  dialMove: "移动",
  soundToggle: "音效",
  volume: "音量",
  seedNow: (seed) => `种子 ${seed}`,
};
