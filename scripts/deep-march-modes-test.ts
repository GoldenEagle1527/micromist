/**
 * Mode split (conserve world vs free dive):
 *   - mode setting: parsing, default free, old settings without a mode stay free;
 *   - setup start plan for every conserve slot state (continue / new / replace);
 *   - bundle separation (esbuild, code splitting, the game's entry): nothing under
 *     conserve/ is statically reachable from DeepMarchGame — the conserve modules
 *     sit in a chunk of their own behind the single dynamic import;
 *   - module boundaries (source scan): shared code refers to conserve/ only through
 *     type-only imports and modes/conserveLoader.ts; outside conserve/, the conserve
 *     code imports only the game-store (platform/gameStoreBackend.ts); the pure logic
 *     folders import nothing outside conserve/ and touch no DOM; no conserve file imports
 *     rendering (three, react, scene/); no conserve file over 200 lines.
 * Run: npm run test:modes
 */
import { build, type Metafile } from "esbuild";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { gameStoreSet } from "../src/lib/game-store";
import { DEFAULT_MODE, GAME_MODES, parseMode } from "../src/games/deep-march/modes/gameMode";
import type { SlotView } from "../src/games/deep-march/modes/useConserveSlot";
import { DEEP_MARCH_GAME, loadSettings, saveSettings } from "../src/games/deep-march/settings";
import { conserveStart } from "../src/games/deep-march/ui/setup/conserveStart";
import { createChecker } from "./lib/checks";

const c = createChecker();
const GAME_DIR = "src/games/deep-march";
const CONSERVE_DIR = `${GAME_DIR}/conserve`;
const ENTRY = `${GAME_DIR}/DeepMarchGame.tsx`;
const LOADER = `${GAME_DIR}/modes/conserveLoader.ts`;
const MAX_LINES = 200;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

type ImportRef = { spec: string; typeOnly: boolean; dynamic: boolean };

function importsOf(file: string): ImportRef[] {
  const src = readFileSync(file, "utf8");
  const refs: ImportRef[] = [];
  for (const m of src.matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gm)) refs.push({ spec: m[3], typeOnly: !!m[2], dynamic: false });
  for (const m of src.matchAll(/^\s*import\s+"([^"]+)"/gm)) refs.push({ spec: m[1], typeOnly: false, dynamic: false });
  for (const m of src.matchAll(/(?<!typeof\s)\bimport\(\s*"([^"]+)"\s*\)/g)) refs.push({ spec: m[1], typeOnly: false, dynamic: true });
  return refs;
}

const resolvesInto = (file: string, spec: string, dir: string) => spec.startsWith(".") && `${resolve(dirname(file), spec)}/`.startsWith(`${resolve(dir)}/`);

c.section("mode setting");
{
  c.check(GAME_MODES.join() === "conserve,free" && DEFAULT_MODE === "free", "two modes, default free dive");
  c.check(parseMode("conserve") === "conserve" && parseMode("free") === "free" && parseMode("world") === "free" && parseMode(undefined) === "free", "parseMode: known values, anything else → free");
  gameStoreSet(DEEP_MARCH_GAME, "settings", { seed: "42", sensitivity: 1.2, invertY: false, panel: null, sound: { muted: false, volume: 0.5 } });
  c.check(loadSettings().mode === "free" && loadSettings().seed === "42", "settings stored before the mode existed → free dive, rest kept");
  saveSettings({ ...loadSettings(), mode: "conserve" });
  c.check(loadSettings().mode === "conserve", "mode persisted");
}

c.section("setup start plan (conserve)");
{
  const ready: SlotView = { state: "ready", seedText: "7", gen: 3, divesStarted: 5, savedAt: 1 };
  const cases: [string, SlotView, boolean, string][] = [
    ["loading", { state: "loading" }, false, "blocked"],
    ["module failed", { state: "failed" }, false, "blocked"],
    ["empty slot", { state: "empty" }, false, "new/newWorld/seed"],
    ["stored world", ready, false, "continue/continueWorld"],
    ["stored world, new requested", ready, true, "new/overwrite/seed"],
    ["annihilated", { state: "ended", seedText: "7", gen: 9 }, false, "new/overwrite/seed"],
    ["unreadable", { state: "unreadable", reason: "x" }, false, "new/overwrite/seed"],
  ];
  for (const [name, view, requested, want] of cases) {
    const p = conserveStart(view, requested);
    const got = !p.canStart ? "blocked" : [p.intent, p.label, ...(p.showSeed ? ["seed"] : [])].join("/");
    c.check(got === want, name, got);
  }
  c.check(conserveStart(ready, false).showNewWorldButton && !conserveStart({ state: "empty" }, false).showNewWorldButton, "'new world…' offered only next to a stored world");
}

c.section("bundle separation");
{
  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    outdir: "node_modules/.cache/dm-modes-bundle",
    write: false,
    metafile: true,
    packages: "external",
    jsx: "automatic",
    loader: { ".css": "empty" },
    logLevel: "silent",
  });
  const meta: Metafile = result.metafile;
  const outputs = meta.outputs;
  const entryOut = Object.keys(outputs).find((o) => outputs[o].entryPoint === ENTRY);
  const staticClosure = new Set<string>();
  const visit = (out: string) => {
    if (staticClosure.has(out)) return;
    staticClosure.add(out);
    for (const imp of outputs[out].imports) if (imp.kind === "import-statement" && outputs[imp.path]) visit(imp.path);
  };
  if (entryOut) visit(entryOut);
  const staticInputs = [...staticClosure].flatMap((o) => Object.keys(outputs[o].inputs));
  const leaked = staticInputs.filter((p) => p.startsWith(`${CONSERVE_DIR}/`));
  c.check(!!entryOut && staticInputs.includes(ENTRY), "entry chunk found", `${staticClosure.size} statically loaded chunk(s), ${staticInputs.length} modules`);
  c.check(leaked.length === 0, "free-dive bundle holds no conserve module", leaked.join(", ") || "none");
  const dynamicTargets = entryOut ? [...staticClosure].flatMap((o) => outputs[o].imports.filter((i) => i.kind === "dynamic-import").map((i) => i.path)) : [];
  const conserveChunk = dynamicTargets.find((o) => outputs[o] && Object.keys(outputs[o].inputs).includes(`${CONSERVE_DIR}/index.ts`));
  c.check(!!conserveChunk, "conserve/ is a dynamically imported chunk", conserveChunk ?? "missing");
  if (conserveChunk) {
    const ins = Object.keys(outputs[conserveChunk].inputs);
    const foreign = ins.filter((p) => !p.startsWith(`${CONSERVE_DIR}/`));
    c.check(foreign.length === 0 && ins.length >= 10, "conserve chunk: only conserve modules", `${ins.length} modules, ${(outputs[conserveChunk].bytes / 1024).toFixed(1)} KB unminified`);
  }
}

c.section("module boundaries");
{
  const gameFiles = sourceFiles(GAME_DIR);
  const shared = gameFiles.filter((f) => !f.startsWith(`${CONSERVE_DIR}/`));
  const conserve = gameFiles.filter((f) => f.startsWith(`${CONSERVE_DIR}/`));
  const intoConserve = shared.flatMap((f) => importsOf(f).filter((r) => resolvesInto(f, r.spec, CONSERVE_DIR)).map((r) => ({ f, r })));
  const badShared = intoConserve.filter(({ f, r }) => !r.typeOnly && !(r.dynamic && f === LOADER));
  c.check(intoConserve.length > 0 && badShared.length === 0, "shared code → conserve/: type-only imports, plus the one dynamic import in modes/conserveLoader.ts", badShared.map(({ f, r }) => `${relative(GAME_DIR, f)} → ${r.spec}`).join(", ") || `${intoConserve.length} refs`);
  const dynamicLoads = intoConserve.filter(({ r }) => r.dynamic);
  c.check(dynamicLoads.length === 1 && dynamicLoads[0].f === LOADER, "exactly one dynamic import of conserve/");

  const runtimeOutside = conserve.flatMap((f) => importsOf(f).filter((r) => !r.typeOnly && !resolvesInto(f, r.spec, CONSERVE_DIR)).map((r) => `${relative(CONSERVE_DIR, f)} → ${r.spec}`));
  const allowedOutside = ["platform/gameStoreBackend.ts → ../../../../lib/game-store", "platform/gameStoreBackend.ts → ../../settings"];
  const unexpected = runtimeOutside.filter((x) => !allowedOutside.includes(x));
  c.check(unexpected.length === 0, "conserve runtime imports outside conserve/: only platform/gameStoreBackend.ts", unexpected.join(", ") || runtimeOutside.join(", "));

  const pureDirs = ["particles", "ledger", "world", "chaos", "nodes", "expedition", "base", "save", "session", "tide"].map((d) => `${CONSERVE_DIR}/${d}/`);
  const impure = conserve.filter((f) => pureDirs.some((d) => f.startsWith(d))).flatMap((f) => importsOf(f).filter((r) => !resolvesInto(f, r.spec, CONSERVE_DIR)).map((r) => `${relative(CONSERVE_DIR, f)} → ${r.spec}`));
  c.check(impure.length === 0, "pure logic folders (particles, ledger, world, chaos, nodes, expedition, base, save, session, tide) import only conserve/", impure.join(", ") || "ok");
  const domUse = conserve.filter((f) => pureDirs.some((d) => f.startsWith(d)) && /\b(window|document|localStorage|indexedDB)\./.test(readFileSync(f, "utf8"))).map((f) => relative(CONSERVE_DIR, f));
  c.check(domUse.length === 0, "pure logic folders touch no DOM / storage globals (browser glue lives in platform/)", domUse.join(", ") || "ok");

  const rendering = conserve.flatMap((f) => importsOf(f).filter((r) => r.spec === "three" || r.spec.startsWith("react") || r.spec.includes("/scene/")).map((r) => `${relative(CONSERVE_DIR, f)} → ${r.spec}`));
  c.check(rendering.length === 0, "no conserve module imports rendering (three / react / scene)", rendering.join(", ") || "ok");

  const long = conserve.map((f) => [f, readFileSync(f, "utf8").split("\n").length] as const).filter(([, n]) => n > MAX_LINES);
  c.check(long.length === 0, `every conserve file ≤ ${MAX_LINES} lines`, long.map(([f, n]) => `${relative(CONSERVE_DIR, f)} ${n}`).join(", ") || `${conserve.length} files`);
}

c.finish();
