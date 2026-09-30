/** Base HUD strings (conserve mode, plans M5–M6): build mode, the base panel, storage, energy, the tide stub and its forecast. */
import type { StructureKind } from "../../conserve";
import type { BuildReason } from "../../scene/base/buildMode";
import { forecastEn, forecastZh, type ForecastDict } from "./forecastI18n";

export type BaseDict = {
  structures: Record<StructureKind, string>;
  /** One line under the building card. */
  notes: Record<StructureKind, string>;
  reasons: Record<BuildReason, string>;
  btnBuild: string;
  btnPlace: string;
  btnBase: string;
  buildTitle: string;
  buildKeys: string;
  buildTouch: string;
  cancel: string;
  close: string;
  panelTitle: string;
  notFounded: string;
  energy: string;
  rate: (perSec: number) => string;
  brownout: string;
  docked: string;
  storage: string;
  tank: string;
  kind: string;
  onlyAtBase: string;
  depositAll: string;
  deposit: string;
  withdraw: (n: number | null) => string;
  release: (n: number | null) => string;
  releaseNote: string;
  buildings: string;
  working: string;
  idle: string;
  demolish: string;
  confirmDemolish: (name: string) => string;
  yes: string;
  no: string;
  tideTitle: string;
  tideNeeds: (energy: number, energyNeed: number, dives: number, divesNeed: number) => string;
  /** The tide forecast card (M6). */
  forecast: ForecastDict;
  tideSoon: string;
  tideBtn: string;
  homeMark: (m: number) => string;
  built: (name: string) => string;
  refused: (name: string, reason: string) => string;
  moved: (action: "deposit" | "withdraw" | "release", n: number) => string;
  demolished: (name: string) => string;
  /** Play-bar hint suffix. */
  hint: string;
  hintPanel: string;
};

export const baseEn: BaseDict = {
  structures: { core: "Base core", lighthouse: "Lighthouse", energy: "Energy tower", storage: "Storage" },
  notes: {
    core: "Founds the base: freezes the 3 × 3 sites around it; +energy",
    lighthouse: "Lights 80 m around it; burns lumen; widens the base",
    energy: "Stores energy; dock here to charge the battery",
    storage: "+1000 storage; widens the base",
  },
  reasons: {
    ok: "Can be placed here",
    "no-core": "Build the base core first",
    "has-core": "The base core already stands",
    wall: "Too close to the ring wall",
    radius: "Outside the base's protection radius",
    grid: "Too far from the core / an energy tower",
    overlap: "Overlaps another building",
    limit: "Building limit reached",
    cost: "Not enough particles",
    "no-ground": "No seabed in reach",
    slope: "Ground too steep",
    rough: "Ground too rough",
    clearance: "Not enough open water above",
    blend: "Too close to a region border",
    frozen: "The frozen zone here would disturb the terrain",
  },
  btnBuild: "BUILD",
  btnPlace: "PLACE",
  btnBase: "Base (Q)",
  buildTitle: "Build mode",
  buildKeys: "Aim at the seabed · E / click place · T next · G leave",
  buildTouch: "Aim at the seabed · PLACE · tap a card to choose",
  cancel: "Leave",
  close: "Close",
  panelTitle: "Base",
  notFounded: "No base yet — press G (or BUILD) and place the base core on flat seabed. Until then the lander cargo is your storage.",
  energy: "Energy",
  rate: (r) => `${r >= 0 ? "+" : ""}${r.toFixed(2)}/s`,
  brownout: "Brown-out — lighthouses off",
  docked: "Docked — charging",
  storage: "Storage",
  tank: "Tank",
  kind: "Particle",
  onlyAtBase: "Storage moves only inside the base radius",
  depositAll: "Deposit all",
  deposit: "In",
  withdraw: (n) => (n === null ? "Out all" : `Out ${n}`),
  release: (n) => (n === null ? "Release all" : `Release ${n}`),
  releaseNote: "Release: back into the sea (suspended), no limit",
  buildings: "Buildings",
  working: "on",
  idle: "off",
  demolish: "Demolish",
  confirmDemolish: (name) => `Demolish the ${name}? Its full cost goes back into storage.`,
  yes: "Demolish",
  no: "Keep",
  tideTitle: "Call the tide",
  tideNeeds: (e, en, d, dn) => `Energy ${Math.floor(e)}/${en} · departures ${d}/${dn}`,
  forecast: forecastEn,
  tideSoon: "The tide sequence opens in a later version",
  tideBtn: "Call the tide",
  homeMark: (m) => `Base · ${m} m`,
  built: (n) => `${n} built`,
  refused: (n, r) => `Can't build the ${n}: ${r}`,
  moved: (a, n) => (a === "deposit" ? `${n} particles deposited` : a === "withdraw" ? `${n} particles taken` : `${n} particles released into the sea`),
  demolished: (n) => `${n} demolished — cost refunded`,
  hint: " · G build · Q base",
  hintPanel: " · BUILD in the fan · Base button",
};

export const baseZh: BaseDict = {
  structures: { core: "基地核心", lighthouse: "灯塔", energy: "储能塔", storage: "仓储" },
  notes: {
    core: "建立基地：冻结周围 3×3 地块；产能",
    lighthouse: "照亮周围 80 米；消耗灵光粒；扩大基地",
    energy: "储存能量；停靠可为电池充电",
    storage: "仓储 +1000；扩大基地",
  },
  reasons: {
    ok: "可以放置",
    "no-core": "请先建造基地核心",
    "has-core": "基地核心已建成",
    wall: "离环壁太近",
    radius: "超出基地保护半径",
    grid: "离核心 / 储能塔太远",
    overlap: "与其他建筑重叠",
    limit: "建筑数量已达上限",
    cost: "粒子不足",
    "no-ground": "瞄准范围内没有海床",
    slope: "地面太陡",
    rough: "地面太崎岖",
    clearance: "上方水域不够开阔",
    blend: "离区域边界太近",
    frozen: "此处的冻结区会破坏地形",
  },
  btnBuild: "建造",
  btnPlace: "放置",
  btnBase: "基地（Q）",
  buildTitle: "建造模式",
  buildKeys: "瞄准海床 · E / 左键 放置 · T 切换 · G 退出",
  buildTouch: "瞄准海床 · 点「放置」 · 点卡片切换建筑",
  cancel: "退出",
  close: "关闭",
  panelTitle: "基地",
  notFounded: "尚未建立基地 — 按 G（或「建造」）在平坦海床放置基地核心。在此之前，着陆舱货舱就是你的仓储。",
  energy: "能量",
  rate: (r) => `${r >= 0 ? "+" : ""}${r.toFixed(2)}/秒`,
  brownout: "能量耗尽 · 灯塔已熄灭",
  docked: "已停靠 · 充电中",
  storage: "仓储",
  tank: "粒子罐",
  kind: "粒子",
  onlyAtBase: "仅在基地范围内可以存取",
  depositAll: "全部存入",
  deposit: "存入",
  withdraw: (n) => (n === null ? "全部取出" : `取 ${n}`),
  release: (n) => (n === null ? "全部放流" : `放流 ${n}`),
  releaseNote: "放流：把粒子放回海中（悬浮态），不限数量",
  buildings: "建筑",
  working: "运行",
  idle: "停机",
  demolish: "拆除",
  confirmDemolish: (n) => `确定拆除${n}？建造材料将全额退回仓储。`,
  yes: "拆除",
  no: "保留",
  tideTitle: "唤潮",
  tideNeeds: (e, en, d, dn) => `能量 ${Math.floor(e)}/${en} · 本代出航 ${d}/${dn}`,
  forecast: forecastZh,
  tideSoon: "潮汐演出将在后续版本开放",
  tideBtn: "唤潮",
  homeMark: (m) => `基地 · ${m} 米`,
  built: (n) => `${n}已建成`,
  refused: (n, r) => `无法建造${n}：${r}`,
  moved: (a, n) => (a === "deposit" ? `已存入 ${n} 颗粒子` : a === "withdraw" ? `已取出 ${n} 颗粒子` : `已放流 ${n} 颗粒子`),
  demolished: (n) => `${n}已拆除 · 材料已退回`,
  hint: " · G 建造 · Q 基地",
  hintPanel: " · 扇形「建造」 · 「基地」按钮",
};
