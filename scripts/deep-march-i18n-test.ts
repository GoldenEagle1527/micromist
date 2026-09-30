/**
 * Deep March strings — zh / en completeness (plan M9):
 *   - the two dictionaries have the same keys and the same kinds at every depth;
 *   - every string is filled; every function takes the same number of arguments;
 *   - every function, called with the fixtures below, gives text with no
 *     "undefined" / "NaN" / "[object" (a function without a fixture fails);
 *   - the staging debug panel's dictionaries (debug/i18n.ts) under "debug.";
 *   - Chinese strings are Chinese (a short allow-list of symbols / key names),
 *     English strings carry no Chinese.
 * Run: npm run test:i18n
 */
import { deepMarchEn as gameEn, deepMarchZh as gameZh } from "../src/games/deep-march/i18n";
import { debugEn, debugZh } from "../src/games/deep-march/debug/i18n";
import type { GenerationSummary } from "../src/games/deep-march/conserve/tide/plan";
import { createChecker } from "./lib/checks";

type Tree = { [k: string]: unknown };
/** The game's dictionaries plus the staging debug panel's (debug/i18n.ts, its own chunk), checked as one tree. */
const deepMarchEn = { ...gameEn, debug: debugEn };
const deepMarchZh = { ...gameZh, debug: debugZh };
const c = createChecker();
const CJK = /[\u3400-\u9fff\uff00-\uffef\u3000-\u303f]/;
/** Chinese entries / functions that are legitimately without CJK (key names, units, counters). */
const ZH_LATIN = new Set<string>(["hints.gotItKey", "loading.diag.gpu", "loading.materialCount", "loading.world.diag.formatValue"]);

const summary: GenerationSummary = { gen: 3, biomes: [{ biome: "reef", sites: 12 }, { biome: "sand", sites: 7 }], stage: 2, m: 0.012, wallThickness: 820.4, newCracks: 1, healed: 1, open: 2 };
const fixtures: Record<string, (d: typeof deepMarchEn) => unknown[][]> = {
  "setup.slot.ready": () => [["abc", 3, 1], ["abc", 1, 4]],
  "setup.slot.ended": () => [["abc"]],
  "loading.seed": () => [["abc", "9f3a"]],
  "loading.spawnFix": () => [[120, -40, 312]],
  "loading.mapProgress": () => [[42, 8]],
  "loading.laying": () => [["reef"]],
  "loading.materialCount": () => [[3, 9, 12, 40]],
  "loading.retrying": () => [[1], [3]],
  "loading.failed": () => [["404"]],
  "loading.terrain": () => [[70]],
  "loading.battery": () => [[88]],
  "loading.lamps": () => [["flood · spot"]],
  "loading.scanRecord": () => [[0], [0.004], [0.37]],
  "loading.audioCount": () => [[2, 9, 120, 900]],
  "loading.audioPartial": () => [["ambience"]],
  "loading.diag.limitsValue": () => [[16, 1024, true], [8, 256, false]],
  "loading.world.created": () => [["abc"]],
  "loading.world.continued": () => [["abc", 2, 1], ["abc", 4, 7]],
  "loading.world.ledger": () => [[1000000]],
  "loading.world.repaired": () => [[12]],
  "loading.world.sites": () => [[64, 64, 1], [64, 64, 6]],
  "loading.world.wall": () => [[900, "stable"], [700, "thinning"], [400, "thinnest"]],
  "loading.world.diag.formatValue": () => [[3, 3, 12], [3, 1, 12]],
  "expedition.left": () => [[40]],
  "expedition.lost": () => [[30, false], [30, true]],
  "expedition.deposited": () => [[30]],
  "expedition.cacheMark": () => [[30, 120]],
  "base.rate": () => [[0.25], [-0.05]],
  "base.withdraw": () => [[null], [50]],
  "base.release": () => [[null], [50]],
  "base.switched": (d) => [[d.base.structures.lighthouse, true], [d.base.structures.lighthouse, false]],
  "base.confirmDemolish": (d) => [[d.base.structures.energy]],
  "base.tideNeeds": () => [[80.6, 150, 0, 1]],
  "base.forecast.metres": () => [[812.4]],
  "base.forecast.crackLine": () => [[{ opening: 0, healing: 0, open: 0, through: 0 }], [{ opening: 0, healing: 0, open: 2, through: 1 }], [{ opening: 1, healing: 1, open: 2, through: 1 }]],
  "base.advice.charging": () => [[5]],
  "base.homeMark": () => [[240]],
  "base.built": (d) => [[d.base.structures.core]],
  "base.refused": (d) => [[d.base.structures.energy, d.base.reasons.cost]],
  "base.moved": () => [["deposit", 30], ["withdraw", 30], ["release", 30]],
  "base.demolished": (d) => [[d.base.structures.energy]],
  "tide.coming": () => [[12.2]],
  "tide.comeBack": () => [[12.2]],
  "tide.summary": (d) => [[summary, d.regionNames], [{ ...summary, newCracks: 0, healed: 0, open: 0 }, d.regionNames]],
  "seedNow": () => [["abc"]],
  "debug.position": () => [[12.4, -30.2, 1999.6]],
  "debug.pending": () => [[1], [3]],
  "debug.target.crack": () => [["1"], ["2"]],
};

function shape(en: unknown, zh: unknown, path: string, out: { strings: [string, string, string][]; fns: string[] }) {
  if (typeof en !== typeof zh) return c.check(false, `${path}: same kind`, `${typeof en} / ${typeof zh}`);
  if (typeof en === "string") return out.strings.push([path, en, zh as string]);
  if (typeof en === "function") {
    if (en.length !== (zh as () => void).length) c.check(false, `${path}: same arity`, `${en.length} / ${(zh as () => void).length}`);
    return out.fns.push(path);
  }
  if (en && typeof en === "object") {
    const a = Object.keys(en as Tree).sort();
    const b = Object.keys(zh as Tree).sort();
    const miss = [...a.filter((k) => !b.includes(k)).map((k) => `zh lacks ${k}`), ...b.filter((k) => !a.includes(k)).map((k) => `en lacks ${k}`)];
    if (miss.length) c.check(false, `${path || "(root)"}: same keys`, miss.join(", "));
    for (const k of a.filter((k) => b.includes(k))) shape((en as Tree)[k], (zh as Tree)[k], path ? `${path}.${k}` : k, out);
  }
}
const at = (d: unknown, path: string) => path.split(".").reduce<unknown>((o, k) => (o as Tree)[k], d);

const found = { strings: [] as [string, string, string][], fns: [] as string[] };
c.section("shape");
shape(deepMarchEn, deepMarchZh, "", found);
c.check(found.strings.length > 200, `${found.strings.length} strings, ${found.fns.length} functions compared`);

c.section("strings");
const empty = found.strings.filter(([, en, zh]) => !en.trim() || !zh.trim()).map(([p]) => p);
c.check(empty.length === 0, "none empty", empty.join(", "));
const notZh = found.strings.filter(([p, , zh]) => !CJK.test(zh) && !ZH_LATIN.has(p)).map(([p, , zh]) => `${p}=${zh}`);
c.check(notZh.length === 0, "Chinese entries are Chinese", notZh.join(" | "));
const zhInEn = found.strings.filter(([p, en]) => CJK.test(en) && p !== "languageName").map(([p, en]) => `${p}=${en}`);
c.check(zhInEn.length === 0, "English entries carry no Chinese", zhInEn.join(" | "));

c.section("functions");
const noFixture = found.fns.filter((p) => !fixtures[p]);
c.check(noFixture.length === 0, "every function has a fixture", noFixture.join(", "));
const bad: string[] = [];
for (const p of found.fns.filter((p) => fixtures[p])) {
  for (const [lang, d] of [["en", deepMarchEn], ["zh", deepMarchZh]] as const) {
    for (const args of fixtures[p](d)) {
      let text: unknown;
      try {
        text = (at(d, p) as (...a: unknown[]) => unknown)(...args);
      } catch (e) {
        text = `threw ${(e as Error).message} undefined`;
      }
      if (typeof text !== "string" || !text.trim() || /undefined|NaN|\[object/.test(text) || (lang === "zh" && !CJK.test(text) && !ZH_LATIN.has(p)) || (lang === "en" && CJK.test(text))) bad.push(`${lang} ${p}(${JSON.stringify(args).slice(0, 40)}) → ${String(text)}`);
    }
  }
}
c.check(bad.length === 0, "every call gives clean text in its language", bad.join("\n    "));
console.log(`  zh sample: ${deepMarchZh.tide.summary(summary, deepMarchZh.regionNames)}`);
c.finish();
