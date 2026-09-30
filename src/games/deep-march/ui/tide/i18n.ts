/** Tide HUD strings (conserve mode, plan M7): the warning, the show's phases, the dome, the murk, the summary. */
import type { Biome, GenerationSummary, TidePhase } from "../../conserve";

export type TideDict = {
  /** Warning countdown (s), and the same outside the dome. */
  coming: (s: number) => string;
  comeBack: (s: number) => string;
  /** The warning ran past 60 s (gen + 1 still building). */
  gathering: string;
  phases: Record<TidePhase, string>;
  murk: string;
  /** Within 5 m of the dome's edge / outside it during the show. */
  edge: string;
  outside: string;
  /** Particle-ized: the black screen. */
  taken: string;
  summary: (s: GenerationSummary, biomes: Record<Biome, string>) => string;
};

const biomeList = (s: GenerationSummary, names: Record<Biome, string>, sep: string, times: string) => s.biomes.map((b) => `${names[b.biome]} ${times}${b.sites}`).join(sep);

export const tideEn: TideDict = {
  coming: (s) => `Tide in ${Math.ceil(s)} s`,
  comeBack: (s) => `Tide in ${Math.ceil(s)} s — get back inside the dome`,
  gathering: "The tide is gathering…",
  phases: { inhale: "Inhale", strip: "Stripping", currents: "Currents", gather: "Gathering", settle: "Settling" },
  murk: "Murk tide",
  edge: "Leaving the dome — the tide will dissolve you",
  outside: "Outside the dome",
  taken: "The tide took you apart… you will wake at the base core",
  summary: (s, n) =>
    `Generation ${s.gen}: ${biomeList(s, n, " · ", "×")} — chaos stage ${s.stage}, wall ${Math.round(s.wallThickness)} m` +
    (s.newCracks ? `, ${s.newCracks} new crack${s.newCracks === 1 ? "" : "s"}` : "") +
    (s.healed ? `, ${s.healed} healed` : ""),
};

export const tideZh: TideDict = {
  coming: (s) => `潮汐将至 ${Math.ceil(s)} 秒`,
  comeBack: (s) => `潮汐将至 ${Math.ceil(s)} 秒 · 回到穹顶内`,
  gathering: "潮在积蓄……",
  phases: { inhale: "吸气", strip: "剥离", currents: "洋流", gather: "凝聚", settle: "平息" },
  murk: "浊潮",
  edge: "离开穹顶会被潮汐分解",
  outside: "你在穹顶之外",
  taken: "你被潮汐分解了……将在基地核心醒来",
  summary: (s, n) =>
    `第 ${s.gen} 世代：${biomeList(s, n, " · ", "×")} · 混沌阶段 ${s.stage} · 壁厚 ${Math.round(s.wallThickness)} 米` +
    (s.newCracks ? ` · 新裂缝 ${s.newCracks} 道` : "") +
    (s.healed ? ` · 愈合 ${s.healed} 道` : ""),
};
