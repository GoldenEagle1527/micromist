/** Strings of the conserve-mode "world save" loading step (plugged into LoadingDict as `world`). */
export type WorldSaveDict = {
  created: (seed: string) => string;
  continued: (seed: string, gen: number, dives: number) => string;
  ledger: (total: string) => string;
  ledgerBroken: string;
  repaired: (count: string) => string;
  sites: (x: number, z: number, biomes: number) => string;
  /** The ring wall: thickness (m) and its state (σ = 1 / between / 0). */
  wall: (metres: number, state: "stable" | "thinning" | "thinnest") => string;
  unreadable: string;
  ended: string;
  missing: string;
  diag: { slot: string; format: string; formatValue: (version: number, from: number, kb: string) => string; pools: string; repairs: string; reason: string; biomes: string; bias: string; wall: string };
};

export const worldSaveEn: WorldSaveDict = {
  created: (seed) => `New world · seed ${seed} · generation 1`,
  continued: (seed, gen, dives) => `Continuing · seed ${seed} · generation ${gen} · ${dives} dive${dives === 1 ? "" : "s"}`,
  ledger: (total) => `Particle ledger ${total} · conserved ✓`,
  ledgerBroken: "Particle ledger does not conserve",
  repaired: (count) => `The save did not add up: ${count} particles corrected into the suspended pool`,
  sites: (x, z, biomes) => `Site table ${x} × ${z} · ${biomes} biome${biomes === 1 ? "" : "s"} · bounded world`,
  wall: (m, state) => `Ring wall ${m} m thick · ${state === "stable" ? "stable" : state === "thinning" ? "thinning" : "at its thinnest"}`,
  unreadable: "The world save can't be read (kept as it is, not overwritten)",
  ended: "This world has been annihilated — it can only be looked back on",
  missing: "There is no world to continue",
  diag: {
    slot: "Save slot",
    format: "Save format",
    formatValue: (v, from, kb) => `v${v}${from !== v ? ` (migrated from v${from})` : ""} · ${kb} KB`,
    pools: "Pools W · P · B · S · L",
    repairs: "Repairs",
    reason: "Reason",
    biomes: "Sites per biome",
    bias: "Terrain bias δ",
    wall: "Ring wall (external share m · stability σ · thickness)",
  },
};

export const worldSaveZh: WorldSaveDict = {
  created: (seed) => `新世界 · 种子 ${seed} · 第 1 代`,
  continued: (seed, gen, dives) => `继续世界 · 种子 ${seed} · 第 ${gen} 代 · 已下潜 ${dives} 次`,
  ledger: (total) => `粒子账本 ${total} · 守恒 ✓`,
  ledgerBroken: "粒子账本不守恒",
  repaired: (count) => `存档账本对不上：已把 ${count} 粒差额修正进悬浮池`,
  sites: (x, z, biomes) => `站点表 ${x} × ${z} · ${biomes} 种群系 · 有界世界`,
  wall: (m, state) => `界壁厚 ${m} 米 · ${state === "stable" ? "稳固" : state === "thinning" ? "正在变薄" : "已薄到极限"}`,
  unreadable: "世界存档无法读取（原档已保留，未覆盖）",
  ended: "这个世界已经湮灭，只能回看",
  missing: "没有可以继续的世界",
  diag: {
    slot: "存档槽",
    format: "存档格式",
    formatValue: (v, from, kb) => `v${v}${from !== v ? `（由 v${from} 迁移）` : ""} · ${kb} KB`,
    pools: "粒子池 W · P · B · S · L",
    repairs: "修正记录",
    reason: "原因",
    biomes: "各群系站点数",
    bias: "地形偏置 δ",
    wall: "界壁（外源占比 m · 稳定度 σ · 厚度）",
  },
};
