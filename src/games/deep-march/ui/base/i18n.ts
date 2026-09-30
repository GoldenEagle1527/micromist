/** Base HUD strings (conserve mode, plans M5–M9): build mode, the base panel, storage, energy, the lighthouse switch, 唤潮, its forecast and advice. */
import type { StructureKind } from "../../conserve";
import type { BuildReason } from "../../scene/base/buildMode";
import { forecastEn, forecastZh, type ForecastDict } from "./forecastI18n";
import { reasonsEn, reasonsZh } from "./reasonsI18n";

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
  /** The lighthouse switch (M9). */
  switchOn: string;
  switchOff: string;
  switched: (name: string, on: boolean) => string;
  confirmDemolish: (name: string) => string;
  yes: string;
  no: string;
  tideTitle: string;
  tideNeeds: (energy: number, energyNeed: number, dives: number, divesNeed: number) => string;
  /** The tide forecast card (M6). */
  forecast: ForecastDict;
  tideBtn: string;
  /** 唤潮 notices, and the note while the diver is away from the base / a tide runs. */
  tideCalled: string;
  tideAway: string;
  tideNotReady: string;
  tideRunning: string;
  /** Why the tide can't be called yet, and what to do (ui/base/tideAdvice.ts, M9). */
  advice: { cap: string; drain: string; charging: (minutes: number) => string; dive: string };
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
  reasons: reasonsEn,
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
  switchOn: "Switch on",
  switchOff: "Switch off",
  switched: (n, on) => `${n} switched ${on ? "on" : "off"}`,
  confirmDemolish: (name) => `Demolish the ${name}? Its full cost goes back into storage.`,
  yes: "Demolish",
  no: "Keep",
  tideTitle: "Call the tide",
  tideNeeds: (e, en, d, dn) => `Energy ${Math.floor(e)}/${en} · departures ${d}/${dn}`,
  forecast: forecastEn,
  tideBtn: "Call the tide",
  tideCalled: "The tide is coming — 60 s. Stay inside the dome.",
  tideAway: "Call the tide from inside the base",
  tideNotReady: "The tide can't be called yet",
  tideRunning: "A tide is running",
  advice: {
    cap: "Energy capacity is below 150 — build an energy tower",
    drain: "Energy is falling — switch the lighthouses off to save up for the tide",
    charging: (min) => `Enough energy in about ${min} min`,
    dive: "Make one dive first: leave the base and come back",
  },
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
  reasons: reasonsZh,
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
  switchOn: "开启",
  switchOff: "关闭",
  switched: (n, on) => `${n}已${on ? "开启" : "关闭"}`,
  confirmDemolish: (n) => `确定拆除${n}？建造材料将全额退回仓储。`,
  yes: "拆除",
  no: "保留",
  tideTitle: "唤潮",
  tideNeeds: (e, en, d, dn) => `能量 ${Math.floor(e)}/${en} · 本代出航 ${d}/${dn}`,
  forecast: forecastZh,
  tideBtn: "唤潮",
  tideCalled: "潮汐将在 60 秒后到来 · 请留在穹顶内",
  tideAway: "请在基地保护范围内唤潮",
  tideNotReady: "现在还不能唤潮",
  tideRunning: "潮汐进行中",
  advice: {
    cap: "能量上限不足 150 · 先建一座储能塔",
    drain: "能量在下降 · 关闭灯塔来为唤潮攒能量",
    charging: (min) => `约 ${min} 分钟后能量足够`,
    dive: "先出航一次：离开基地再回来",
  },
  homeMark: (m) => `基地 · ${m} 米`,
  built: (n) => `${n}已建成`,
  refused: (n, r) => `无法建造${n}：${r}`,
  moved: (a, n) => (a === "deposit" ? `已存入 ${n} 颗粒子` : a === "withdraw" ? `已取出 ${n} 颗粒子` : `已放流 ${n} 颗粒子`),
  demolished: (n) => `${n}已拆除 · 材料已退回`,
  hint: " · G 建造 · Q 基地",
  hintPanel: " · 扇形「建造」 · 「基地」按钮",
};
