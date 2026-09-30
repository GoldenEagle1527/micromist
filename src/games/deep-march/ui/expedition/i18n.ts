/** Expedition HUD strings (conserve mode, plan M4): tank, absorbing, lost caches, recall. */
export type ExpeditionDict = {
  tank: string;
  tankFull: string;
  /** Particle kinds, storage order (lithic, silica, lumen, ferro, voltite, resonite, abyssal). */
  kinds: readonly string[];
  cache: string;
  left: (n: number) => string;
  holdKey: string;
  holdTouch: string;
  absorbing: string;
  blockedFull: string;
  blockedBattery: string;
  btnAbsorb: string;
  recall: string;
  recallHint: string;
  recallHolding: string;
  recallDark: string;
  lost: (n: number, evicted: boolean) => string;
  recalledEmpty: string;
  /** Recalled inside the base (M5): the tank went into storage. */
  deposited: (n: number) => string;
  cacheMark: (n: number, m: number) => string;
  /** Loading map legend: lost caches. */
  mapCache: string;
  /** Play-bar hint suffix. */
  hint: string;
  hintPanel: string;
};

export const expeditionEn: ExpeditionDict = {
  tank: "Tank",
  tankFull: "Tank full",
  kinds: ["Lithic", "Silica", "Lumen", "Ferro", "Voltite", "Resonite", "Abyssal"],
  cache: "Lost cache",
  left: (n) => `${n} left`,
  holdKey: "Hold E / left mouse to absorb",
  holdTouch: "Hold ABSORB",
  absorbing: "Absorbing…",
  blockedFull: "Tank full — can't absorb more",
  blockedBattery: "Battery flat — pump offline",
  btnAbsorb: "ABSORB",
  recall: "Emergency recall (hold X)",
  recallHint: "Hold to fire the emergency beacon: back to the entry point (the base core once built), the tank is left behind (inside the base it goes into storage)",
  recallHolding: "Emergency beacon — keep holding",
  recallDark: "Emergency beacon fired — returning",
  lost: (n, evicted) => `${n} particles left behind as a lost cache — follow the beacon to get them back${evicted ? " (the oldest cache dissolved into the tide)" : ""}`,
  recalledEmpty: "Recalled — the tank was empty, nothing lost",
  deposited: (n) => `Recalled inside the base — ${n} particles went into storage, nothing lost`,
  cacheMark: (n, m) => `Cache · ${n} · ${m} m`,
  mapCache: "Lost cache",
  hint: " · E absorb · X recall",
  hintPanel: " · ABSORB button · hold ⟲ to recall",
};

export const expeditionZh: ExpeditionDict = {
  tank: "粒子罐",
  tankFull: "粒子罐已满",
  kinds: ["岩粒", "硅粒", "灵光粒", "铁锰粒", "伏晶", "共鸣晶", "渊核"],
  cache: "遗失粒子包",
  left: (n) => `剩余 ${n}`,
  holdKey: "按住 E / 鼠标左键 吸取",
  holdTouch: "按住「吸取」",
  absorbing: "吸取中…",
  blockedFull: "粒子罐已满 · 无法继续吸取",
  blockedBattery: "电量耗尽 · 吸取泵离线",
  btnAbsorb: "吸取",
  recall: "紧急召回（按住 X）",
  recallHint: "按住发射紧急信标：回到入水点（建成基地后回到基地核心），罐中粒子留在原地（在基地范围内则存入仓储）",
  recallHolding: "紧急信标 · 继续按住",
  recallDark: "紧急信标已发射 · 正在返回",
  lost: (n, evicted) => `${n} 颗粒子留在原地成为遗失粒子包 · 循着信标回去取回${evicted ? "（最早的粒子包已被潮汐吞没）" : ""}`,
  recalledEmpty: "已召回 · 粒子罐为空，没有损失",
  deposited: (n) => `在基地范围内召回 · ${n} 颗粒子已存入仓储，没有损失`,
  cacheMark: (n, m) => `粒子包 · ${n} · ${m} 米`,
  mapCache: "遗失粒子包",
  hint: " · E 吸取 · X 召回",
  hintPanel: " · 「吸取」按钮 · 按住 ⟲ 召回",
};
