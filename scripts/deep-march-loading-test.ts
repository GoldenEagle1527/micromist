/**
 * Loading screen tests (node):
 * - LoadingModel: step status transitions, monotonic progress, completion only when
 *   confirmed, error / recover / warn, normalized weights, overall bar, focus order;
 * - step registry + dive gate: per-step evaluation of snapshots, diagnostics vs focus
 *   lines, automatic start, "Dive anyway" rules (shader error / GPU lost / waits);
 * - conserve mode: the "world save" step leads the list (free-dive registry unchanged),
 *   new / continued / repaired saves settle it, unreadable / annihilated / missing
 *   block the dive (no "dive anyway"), zh / en strings complete;
 * - region map rasterization: deterministic per seed (fresh fields → identical
 *   pixels), independent of how rows are sliced, differs between seeds, spawn at
 *   the centre, pixel ↔ world mapping, time per row (UI budget); bounded world
 *   (conserve): the whole 10 × 10 rectangle, void outside (never sampled), an edge
 *   line on every side, the spawn inside, slicing-independent; the map-span line
 *   and the world-save step's site-table line / diagnostics.
 * Run: npm run test:loading
 */
import { LoadingModel, formatMB, settled } from "../src/games/deep-march/ui/loading/loadingModel";
import { applyStep, canBeginDive } from "../src/games/deep-march/ui/loading/loadingGate";
import { LOADING_STEPS, type LoadingLabels, type LoadingStepDef, type StepContext } from "../src/games/deep-march/ui/loading/steps";
import { withWorldSaveStep } from "../src/games/deep-march/conserve/loading/worldSaveStep";
import { createMemoryBackend } from "../src/games/deep-march/conserve/save/saveBackend";
import { openConserveSession } from "../src/games/deep-march/conserve/session/openSession";
import { seedFromString } from "../src/games/deep-march/terrain/noise";
import { loadingEn, loadingZh } from "../src/games/deep-march/ui/loading/i18n";
import type { LoadingSnapshot } from "../src/games/deep-march/scene/world";
import { OUTSIDE, REGION_MAP, RegionMapRaster, hexToRgb, mapSpec, mapSpecFor, pixelToWorld, worldToPixel } from "../src/games/deep-march/ui/loading/regionMap";
import { MACRO } from "../src/games/deep-march/terrain/regions";
import { insideRect, layoutRect } from "../src/games/deep-march/terrain/siteLayout";
import { findSpawn } from "../src/games/deep-march/terrain/spawn";
import { genesisLayout } from "./lib/worldFixture";
import { createDensityField } from "../src/games/deep-march/terrain/density";
import { TERRAIN } from "../src/games/deep-march/terrain/config";
import { REGION_COLORS, REGION_COUNT, REGION_KEYS } from "../src/games/deep-march/terrain/regions";

let fails = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${msg}`);
  if (!ok) fails++;
};

console.log("loading model");
{
  const STEPS = LOADING_STEPS.map((d) => d.id);
  const model0 = new LoadingModel(LOADING_STEPS);
  const w = STEPS.reduce((s, id) => s + model0.weight(id), 0);
  check(Math.abs(w - 1) < 1e-9, `normalized step weights sum to 1 (${w})`);
  check(STEPS.join() === "coords,regions,materials,terrain,system,audio", "registry order: coords, regions, materials, terrain, system, audio");
  check(new Set(STEPS).size === STEPS.length, "step ids unique");
  // relative weights: adding a step rescales the others, never needs retuning
  const extra = new LoadingModel([...LOADING_STEPS, { id: "extra", weight: 25 }]);
  const sumExtra = [...STEPS, "extra"].reduce((s, id) => s + extra.weight(id), 0);
  const ratio = extra.weight("materials") / extra.weight("terrain");
  check(Math.abs(sumExtra - 1) < 1e-9 && Math.abs(ratio - model0.weight("materials") / model0.weight("terrain")) < 1e-9, "adding a step: shares renormalize, ratios kept");
  const m = new LoadingModel(LOADING_STEPS);
  check(STEPS.every((id) => m.status[id] === "pending" && m.progress[id] === 0) && m.overall() === 0, "all pending at 0");
  check(m.focus() === "coords", "focus: first pending");
  m.report("materials", 5, 10);
  check(m.status.materials === "active" && Math.abs(m.progress.materials - 0.5) < 1e-9, "report activates, fraction");
  check(m.focus() === "materials", "focus: the active step");
  m.report("materials", 2, 10);
  check(Math.abs(m.progress.materials - 0.5) < 1e-9, "progress never goes backwards (total grew)");
  m.report("materials", 10, 10);
  check(m.status.materials === "active" && m.progress.materials < 1, "full count alone isn't done (unconfirmed < 1)");
  m.report("terrain", 3, 0);
  check(m.status.terrain === "active" && m.progress.terrain === 0, "zero total → active at 0");
  m.fail("materials");
  check(m.status.materials === "error" && m.focus() === "materials", "error status, focused first");
  m.recover("materials");
  check(m.status.materials === "active" && m.progress.materials > 0.9, "recover keeps progress");
  m.complete("materials");
  m.report("materials", 0, 10);
  m.fail("materials");
  check(m.status.materials === "done" && m.progress.materials === 1, "done is final");
  const before = m.overall();
  check(Math.abs(before - m.weight("materials")) < 1e-9, `overall = weighted sum (${before.toFixed(3)})`);
  check(!m.allDone(), "not all done");
  // warn: settled, final, full progress
  m.warn("terrain");
  m.fail("terrain");
  m.complete("terrain");
  check(m.status.terrain === "warn" && m.progress.terrain === 1 && settled("warn") && !settled("error"), "warn is settled and final");
  for (const id of STEPS) m.complete(id);
  check(m.allDone() && m.overall() === 1 && m.focus() === null, "all settled → overall 1, no focus");
  check(formatMB(11436569) === "11.4" && formatMB(0) === "0.0", "MB formatting");
  // overall is monotonic for any interleaving of monotonic reports
  const m2 = new LoadingModel(LOADING_STEPS);
  let prev = 0, mono = true;
  for (let k = 0; k <= 100; k++) {
    m2.report("regions", k, 100);
    m2.report("materials", k * 3, 300 + k); // total grows while bytes arrive
    m2.report("terrain", k, 100 + (k % 7));
    const o = m2.overall();
    if (o < prev) mono = false;
    prev = o;
  }
  check(mono && prev < 1, `overall monotonic under growing totals (${prev.toFixed(3)})`);
}

console.log("loading steps + dive gate");
{
  const L = (dict: typeof loadingEn): LoadingLabels => ({
    ...dict,
    regionNames: Object.fromEntries(REGION_KEYS.map((k) => [k, k])) as LoadingLabels["regionNames"],
    lightModes: { beam: "Beam", high: "High", sonar: "Sonar" },
  });
  const LONG_GPU = "ANGLE (Qualcomm, Adreno (TM) 650, OpenGL ES 3.2 V@0502.0 (GIT@35f8e2e, I2e7e0f1d23, 1601883186) (Date:10/05/20))";
  const snapOf = (o: Partial<{ mat: Partial<LoadingSnapshot["materials"]>; terrain: Partial<LoadingSnapshot["terrain"]>; sys: Partial<LoadingSnapshot["system"]>; audio: Partial<LoadingSnapshot["audio"]>; loaded: boolean; extra: Record<string, unknown> }> = {}): LoadingSnapshot => {
    const audio = { state: "ready", settled: true, late: false, done: 7, failed: 0, total: 7, bytes: 146e3, totalBytes: 146e3, format: "webm", missing: [], ...o.audio } as LoadingSnapshot["audio"];
    const materials = { path: "ktx2", done: 22, total: 22, bytes: 13e6, totalBytes: 13e6, last: 21, failed: 0, fellBack: false, retrying: 0, ready: true, error: null, ...o.mat } as LoadingSnapshot["materials"];
    const terrain = { done: 10, total: 10, ready: true, ...o.terrain };
    const system = { battery: 1, lamps: ["beam"], sonar: true, shaders: true, shaderError: null, gpu: { renderer: LONG_GPU, textureUnits: 16, fragmentVectors: 1024, highp: true }, gpuLost: false, ...o.sys } as LoadingSnapshot["system"];
    const loaded = o.loaded ?? (terrain.ready && materials.ready && system.shaders && !system.shaderError && !system.gpuLost && audio.settled);
    return { seed: 1, spawn: { x: 1, y: 60, z: 2 }, regions: null as unknown as LoadingSnapshot["regions"], materials, terrain, system, audio, loaded, diving: false, ...o.extra } as LoadingSnapshot;
  };
  const run = (snap: LoadingSnapshot | null, mapRows = 256, dict = loadingEn) => {
    const model = new LoadingModel(LOADING_STEPS);
    const ctx: StepContext = { L: L(dict), seedText: "1", seed: 1, mapRows, mapSize: 256 };
    const evals = LOADING_STEPS.map((d) => [d.id, d.evaluate(snap, ctx)] as const);
    for (const [id, ev] of evals) applyStep(model, id, ev);
    return { model, evals: new Map(evals) };
  };
  for (const [name, dict] of [["en", loadingEn], ["zh", loadingZh]] as const) {
    check(LOADING_STEPS.every((d) => typeof dict.steps[d.id] === "string" && dict.steps[d.id].length > 0), `${name}: every registered step has a name`);
    check(["pending", "active", "done", "warn", "error"].every((s) => (dict.status as Record<string, string>)[s]), `${name}: every status has a label`);
  }
  // no world yet: coordinates active, everything else pending
  {
    const { model } = run(null, 0);
    check(model.status.coords === "active" && LOADING_STEPS.slice(1).every((d) => model.status[d.id] === "pending"), "no world: coords active, rest pending");
  }
  // all in → gate opens
  {
    const snap = snapOf();
    const { model, evals } = run(snap);
    check(model.allDone() && canBeginDive(model, LOADING_STEPS, snap, false), "everything loaded → begin dive");
    const sys = evals.get("system")!;
    check(sys.lines.every((l) => !l.includes(LONG_GPU)) && (sys.diag ?? []).some((e) => e.value === LONG_GPU), "GPU renderer string only in diagnostics, not in the focus lines");
    check(sys.lines.length <= 3, `system focus lines ≤ 3 (${sys.lines.length})`);
  }
  // map not finished → no gate
  {
    const snap = snapOf();
    const { model } = run(snap, 100);
    check(model.status.regions === "active" && !canBeginDive(model, LOADING_STEPS, snap, false), "map still drawing → wait");
  }
  // materials missing → no gate, force does nothing
  {
    const snap = snapOf({ mat: { ready: false, done: 10, bytes: 5e6 } });
    const { model } = run(snap);
    check(!canBeginDive(model, LOADING_STEPS, snap, false) && !canBeginDive(model, LOADING_STEPS, snap, true), "textures still loading → wait (dive anyway can't skip it)");
  }
  // materials failed → error + retry action
  {
    const snap = snapOf({ mat: { ready: false, error: "404", done: 21 } });
    const { model, evals } = run(snap);
    check(model.status.materials === "error" && (evals.get("materials")!.actions ?? []).includes("retryMaterials") && !canBeginDive(model, LOADING_STEPS, snap, true), "texture failure → error + retry, no dive");
  }
  // shader error: blocked normally; "dive anyway" starts it
  {
    const snap = snapOf({ sys: { shaderError: "program: link failed" } });
    const { model, evals } = run(snap);
    const sys = evals.get("system")!;
    check(model.status.system === "error" && (sys.actions ?? []).includes("diveAnyway"), "shader error → error + dive-anyway action");
    check((sys.diag ?? []).some((e) => e.value === "program: link failed") && sys.lines.every((l) => !l.includes("link failed")), "full shader log in diagnostics only");
    check(!canBeginDive(model, LOADING_STEPS, snap, false), "shader error → no automatic start");
    check(canBeginDive(model, LOADING_STEPS, snap, true), "shader error + dive anyway → start");
  }
  // shader error while terrain still loading: dive anyway waits for terrain
  {
    const snap = snapOf({ sys: { shaderError: "x" }, terrain: { ready: false, done: 3 } });
    const { model } = run(snap);
    check(!canBeginDive(model, LOADING_STEPS, snap, true), "dive anyway still waits for terrain");
  }
  // GPU lost: never
  {
    const snap = snapOf({ sys: { gpuLost: true } });
    const { model, evals } = run(snap);
    check(model.status.system === "error" && !(evals.get("system")!.actions ?? []).includes("diveAnyway") && !canBeginDive(model, LOADING_STEPS, snap, true), "GPU lost → error, no dive-anyway");
  }
  // programs not checked yet: dive anyway not allowed
  {
    const snap = snapOf({ sys: { shaders: false, shaderError: "x" } });
    const { model } = run(snap);
    check(!canBeginDive(model, LOADING_STEPS, snap, true), "programs not checked yet → dive anyway waits");
  }
  // world says not loaded although steps look done → wait (world gate is authoritative)
  {
    const snap = snapOf({ loaded: false });
    const { model } = run(snap);
    check(model.allDone() && !canBeginDive(model, LOADING_STEPS, snap, false), "steps settled but world not loaded → wait");
  }
  // audio: optional step
  check(LOADING_STEPS.find((d) => d.id === "audio")?.required === false, "audio step registered as optional");
  {
    const snap = snapOf({ audio: { state: "loading", settled: false, done: 3, bytes: 60e3 } });
    const { model, evals } = run(snap);
    check(model.status.audio === "active" && model.progress.audio > 0.3 && model.progress.audio < 0.5 && !canBeginDive(model, LOADING_STEPS, snap, false), "audio loading → byte progress, dive waits");
    check(!canBeginDive(model, LOADING_STEPS, snap, true), "dive anyway also waits for the (short) audio gate");
    check(evals.get("audio")!.lines[0].includes("3/7"), "audio focus line counts clips");
  }
  for (const [name, a] of [
    ["files missing (silent)", { state: "silent", done: 0, failed: 7, missing: ["ambience"] }],
    ["some missing (partial)", { state: "partial", done: 5, failed: 2, missing: ["bump", "warn"] }],
    ["world stopped waiting (late)", { state: "loading", settled: true, late: true, done: 4 }],
  ] as const) {
    const snap = snapOf({ audio: a as Partial<LoadingSnapshot["audio"]> });
    const { model } = run(snap);
    check(model.status.audio === "warn" && canBeginDive(model, LOADING_STEPS, snap, false), `audio ${name} → warn, dive starts`);
  }
  {
    const snap = snapOf({ audio: { state: "off", settled: true, done: 0, total: 0, totalBytes: 0, bytes: 0 } });
    const { model, evals } = run(snap);
    check(model.status.audio === "done" && evals.get("audio")!.lines[0] === loadingEn.audioOff && canBeginDive(model, LOADING_STEPS, snap, false), "audio off (sound off) → done, dive starts");
  }
  {
    const snap = snapOf({ audio: { missing: [] } });
    const { evals } = run(snap);
    check((evals.get("audio")!.diag ?? []).some((e) => e.value === "Opus (WebM)"), "audio format in diagnostics");
  }
  // zh strings flow through
  {
    const { evals } = run(snapOf(), 256, loadingZh);
    check(evals.get("terrain")!.lines[0] === loadingZh.terrain(100), "zh lines");
  }

  // conserve mode: "world save" step first, the shared registry unchanged after it
  {
    const runSteps = (steps: readonly LoadingStepDef[], snap: LoadingSnapshot | null, dict = loadingEn) => {
      const model = new LoadingModel(steps);
      const ctx: StepContext = { L: L(dict), seedText: "1", seed: 1, mapRows: 256, mapSize: 256 };
      const evals = new Map(steps.map((d) => [d.id, d.evaluate(snap, ctx)] as const));
      for (const [id, ev] of evals) applyStep(model, id, ev);
      return { model, evals };
    };
    const backend = createMemoryBackend();
    const opened = openConserveSession({ backend, intent: { kind: "new", seedText: "reef" }, hashSeed: seedFromString });
    if (!opened.ok) throw new Error("conserve session did not open");
    const steps = withWorldSaveStep(LOADING_STEPS, opened.session.report);
    check(steps.map((d) => d.id).join() === `worldSave,${LOADING_STEPS.map((d) => d.id).join()}` && LOADING_STEPS.length === 6, "conserve: worldSave first, then the 6 shared steps (free-dive registry unchanged)");
    const snap = snapOf();
    const created = runSteps(steps, snap);
    const ws = created.evals.get("worldSave")!;
    // genesis N = 66,000 lithic + 17,000 lumen + 17,000 ferro + 4,500 voltite (伏晶) + 500 abyssal (渊核); B holds the 680 lander cargo
    check(created.model.status.worldSave === "done" && ws.lines[0] === loadingEn.world.created("reef") && ws.lines[1] === loadingEn.world.ledger("105,000"), "new world: done, seed + conserved ledger lines");
    check((ws.diag ?? []).some((e) => e.value === "save/main") && (ws.diag ?? []).some((e) => e.value === "104,320 · 0 · 680 · 0 · 0"), "diagnostics: slot key, pool totals W · P · B · S · L");
    check(ws.lines[2] === loadingEn.world.sites(10, 10, Object.values(opened.session.report.sites.byBiome).filter((n) => n > 0).length), "new world: site-table line (10 × 10, biome count)");
    check(ws.lines[3] === loadingEn.world.wall(160, "stable") && opened.session.report.wall.thickness === opened.session.wall.thickness && (ws.diag ?? []).some((e) => e.label === loadingEn.world.diag.wall && e.value.endsWith("160.0 m")), "new world: ring-wall line (160 m, stable) = the session's wall");
    check((ws.diag ?? []).some((e) => e.label === loadingEn.world.diag.biomes && e.value.startsWith("sand ")) && (ws.diag ?? []).some((e) => e.label === loadingEn.world.diag.bias && e.value.includes("…")), "diagnostics: sites per biome, δ range");
    check(canBeginDive(created.model, steps, snap, false), "world save done + everything loaded → begin dive");
    check(runSteps(steps, null).model.status.worldSave === "done", "settled before the world exists (the seed comes from the save)");
    opened.session.close();
    const tampered = structuredClone(backend.read("save/main")) as { ledger: { world: number[] } };
    tampered.ledger.world[0] -= 12;
    const repaired = openConserveSession({ backend: createMemoryBackend({ "save/main": tampered }), intent: { kind: "continue" }, hashSeed: seedFromString });
    if (!repaired.ok) throw new Error("repaired session did not open");
    const rep = runSteps(withWorldSaveStep(LOADING_STEPS, repaired.session.report), snap, loadingZh).evals.get("worldSave")!;
    check(rep.state === "done" && rep.lines[0] === loadingZh.world.continued("reef", 1, 0) && rep.lines[2] === loadingZh.world.repaired("12"), "continued + repaired (zh): repair line shown");
    for (const [kind, line] of [["ended", loadingEn.world.ended], ["unreadable", loadingEn.world.unreadable], ["missing", loadingEn.world.missing]] as const) {
      const blockedSteps = withWorldSaveStep(LOADING_STEPS, { kind, slotKey: "save/main", reason: "test" });
      const r = runSteps(blockedSteps, snap);
      check(r.model.status.worldSave === "error" && r.evals.get("worldSave")!.lines[0] === line && !canBeginDive(r.model, blockedSteps, snap, false) && !canBeginDive(r.model, blockedSteps, snap, true), `${kind}: error, no dive (not even "dive anyway")`);
    }
    for (const [name, dict] of [["en", loadingEn], ["zh", loadingZh]] as const) {
      const w = dict.world;
      const strings = [dict.steps.worldSave, w.created("1"), w.continued("1", 2, 3), w.ledger("1"), w.ledgerBroken, w.repaired("1"), w.sites(10, 10, 6), w.wall(160, "stable"), w.wall(98, "thinning"), w.wall(24, "thinnest"), w.unreadable, w.ended, w.missing, ...Object.values(w.diag).map((v) => (typeof v === "function" ? v(1, 1, "1") : v))];
      check(strings.every((x) => typeof x === "string" && x.length > 0), `${name}: every world-save string present`);
    }
  }
}

console.log("region map");
{
  const colors = REGION_COLORS.map(hexToRgb);
  const hash = (a: ArrayLike<number>) => {
    let h = 2166136261;
    for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619) >>> 0;
    return h.toString(16);
  };
  const raster = (seed: number, slice: number) => {
    const regions = createDensityField(seed, TERRAIN).regions;
    const c = regions.coresOf(regions.spawnRegion(), 1)[0];
    const r = new RegionMapRaster(regions, mapSpec(c.x, c.z));
    const rgba = new Uint8ClampedArray(REGION_MAP.size * REGION_MAP.size * 4);
    let worst = 0;
    while (!r.done) {
      const y0 = r.rows;
      const t0 = performance.now();
      r.computeRows(slice);
      r.paintRows(rgba, y0, r.rows, colors);
      worst = Math.max(worst, (performance.now() - t0) / (r.rows - y0));
    }
    return { r, rgba, c, regions, worst };
  };
  const t0 = performance.now();
  const a = raster(7, REGION_MAP.size);
  const full = performance.now() - t0;
  const b = raster(7, 1);
  const c3 = raster(7, 3);
  check(hash(a.r.ids) === hash(b.r.ids) && hash(a.rgba) === hash(b.rgba) && hash(a.rgba) === hash(c3.rgba), `seed 7: same pixels from fresh fields, any row slicing (${hash(a.rgba)})`);
  const d = raster(8, 5);
  check(hash(d.rgba) !== hash(a.rgba), "another seed draws another map");
  check(a.rgba.every((v, i) => (i & 3) !== 3 || v === 255), "opaque");
  // spawn at the centre; mapping round trip
  const S = REGION_MAP.size;
  const [px, py] = worldToPixel(a.r.spec, a.c.x, a.c.z);
  check(Math.abs(px - S / 2) < 1e-9 && Math.abs(py - S / 2) < 1e-9, "spawn maps to the centre");
  const [wx, wz] = pixelToWorld(a.r.spec, 10, 20);
  const [bx, by] = worldToPixel(a.r.spec, wx, wz);
  check(Math.abs(bx - 10.5) < 1e-9 && Math.abs(by - 20.5) < 1e-9, "pixel ↔ world round trip");
  const centreId = a.r.ids[(S / 2) * S + S / 2];
  check(centreId === a.regions.spawnRegion(), `centre pixel is the spawn region (${centreId})`);
  // content: several landforms around the spawn for most seeds
  let multi = 0;
  const seen = new Set<number>();
  for (const seed of [1, 2, 3, 7, 42, 12345]) {
    const r = seed === 7 ? a.r : raster(seed, 16).r;
    const ids = new Set(r.ids);
    ids.forEach((i) => seen.add(i));
    if (ids.size >= 2) multi++;
    check([...ids].every((i) => i < REGION_COUNT), `seed ${seed}: ${ids.size} regions on the map`);
  }
  check(multi >= 5, `≥ 2 landforms on the map for most seeds (${multi}/6)`);
  check(seen.size === REGION_COUNT, `all 6 landforms appear across seeds (${seen.size})`);
  console.log(`  info map ${S}² px over ${REGION_MAP.span} u: full raster ${full.toFixed(0)} ms · worst ${a.worst.toFixed(2)} ms/row (sliced ${b.worst.toFixed(2)})`);
  check(b.worst < 8, `one row fits a frame slice (${b.worst.toFixed(2)} ms)`);

  // bounded world (conserve): the whole 10 × 10 rectangle
  const layout = genesisLayout(7);
  const field = createDensityField(7, TERRAIN, undefined, layout);
  const rect = layoutRect(layout, MACRO.cell * TERRAIN.worldScale);
  const spawn = findSpawn(field);
  const bounded = (slice: number) => {
    const r = new RegionMapRaster(field.regions, mapSpecFor(spawn, rect));
    const rgba = new Uint8ClampedArray(S * S * 4);
    let worst = 0;
    while (!r.done) {
      const y0 = r.rows;
      const t = performance.now();
      r.computeRows(slice);
      r.paintRows(rgba, y0, r.rows, colors);
      worst = Math.max(worst, (performance.now() - t) / (r.rows - y0));
    }
    return { r, rgba, worst };
  };
  const m1 = bounded(1), m7 = bounded(7), mAll = bounded(S);
  check(hash(m1.rgba) === hash(m7.rgba) && hash(m1.rgba) === hash(mAll.rgba), `bounded map: same pixels for any row slicing (${hash(m1.rgba)})`);
  const spec = m1.r.spec;
  check(spec.world === rect && Math.abs(spec.span - 4160 * (1 + 2 * REGION_MAP.worldPad)) < 1e-9 && spec.cx === 0 && spec.cz === 0, `bounded map: centred on the world, span ${spec.span.toFixed(0)} u (10 × 416 m + margin)`);
  let wrongSide = 0, outside = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const [wx, wz] = pixelToWorld(spec, x, y);
    const out = !insideRect(rect, wx, wz);
    if (out) outside++;
    if (out !== (m1.r.ids[y * S + x] === OUTSIDE)) wrongSide++;
  }
  check(wrongSide === 0 && outside > 0, `bounded map: void exactly outside the world (${outside} px), regions inside`);
  const rgbAt = (x: number, y: number) => Array.from(m1.rgba.slice((y * S + x) * 4, (y * S + x) * 4 + 3)).join();
  const line = [98, 243, 255].join();
  const [ex0] = worldToPixel(spec, rect.x0, 0), [ex1] = worldToPixel(spec, rect.x1, 0);
  const mid = S / 2;
  const nearLine = (x: number, y: number) => [-1, 0, 1].some((d) => rgbAt(x + d, y) === line);
  const nearLineV = (x: number, y: number) => [-1, 0, 1].some((d) => rgbAt(x, y + d) === line);
  check(nearLine(Math.round(ex0), mid) && nearLine(Math.round(ex1), mid) && nearLineV(mid, Math.round(worldToPixel(spec, 0, rect.z0)[1])) && nearLineV(mid, Math.round(worldToPixel(spec, 0, rect.z1)[1])), "bounded map: edge line on all four sides");
  check(rgbAt(0, 0) !== line && m1.r.ids[0] === OUTSIDE, "bounded map: corner is void");
  const inner = new Set(Array.from(m1.r.ids).filter((i) => i !== OUTSIDE));
  check(inner.size >= 4, `bounded map: ${inner.size} landforms inside the world`);
  const [sx, sy] = worldToPixel(spec, spawn.x, spawn.z);
  check(sx > 0 && sy > 0 && sx < S && sy < S && m1.r.ids[Math.floor(sy) * S + Math.floor(sx)] !== OUTSIDE, `bounded map: spawn marker inside (${sx.toFixed(0)}, ${sy.toFixed(0)})`);
  check(m1.worst < 8, `bounded map: one row fits a frame slice (${m1.worst.toFixed(2)} ms)`);
  const regionsStep = LOADING_STEPS.find((d) => d.id === "regions")!;
  const labels = { ...loadingEn, regionNames: Object.fromEntries(REGION_KEYS.map((k) => [k, k])), lightModes: { beam: "Beam", high: "High", sonar: "Sonar" } } as LoadingLabels;
  const ctxB: StepContext = { L: labels, seedText: "7", seed: 7, mapRows: S, mapSize: S };
  const snapB = { world: rect } as unknown as LoadingSnapshot, snapF = { world: null } as unknown as LoadingSnapshot;
  check(regionsStep.evaluate(snapB, ctxB).lines[0] === loadingEn.mapProgress(100, "4.2") && regionsStep.evaluate(snapF, ctxB).lines[0] === loadingEn.mapProgress(100, (REGION_MAP.span / 1000).toFixed(1)), "map line: the bounded world's width (4.2 km), the fixed window otherwise");
}

if (fails) {
  console.log(`${fails} loading check(s) FAILED`);
  process.exit(1);
}
console.log("all loading checks passed");
