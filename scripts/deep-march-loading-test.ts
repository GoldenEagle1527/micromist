/**
 * Loading screen tests (node):
 * - LoadingModel: step status transitions, monotonic progress, completion only when
 *   confirmed, error / recover, weighted overall bar, focus order;
 * - region map rasterization: deterministic per seed (fresh fields → identical
 *   pixels), independent of how rows are sliced, differs between seeds, spawn at
 *   the centre, pixel ↔ world mapping, time per row (UI budget).
 * Run: npm run test:loading
 */
import { LoadingModel, STEPS, STEP_WEIGHT, formatMB } from "../src/games/deep-march/ui/loading/loadingModel";
import { REGION_MAP, RegionMapRaster, hexToRgb, mapSpec, pixelToWorld, worldToPixel } from "../src/games/deep-march/ui/loading/regionMap";
import { createDensityField } from "../src/games/deep-march/terrain/density";
import { TERRAIN } from "../src/games/deep-march/terrain/config";
import { REGION_COLORS, REGION_COUNT } from "../src/games/deep-march/terrain/regions";

let fails = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${msg}`);
  if (!ok) fails++;
};

console.log("loading model");
{
  const w = STEPS.reduce((s, id) => s + STEP_WEIGHT[id], 0);
  check(Math.abs(w - 1) < 1e-9, `step weights sum to 1 (${w})`);
  check(STEPS.join() === "coords,regions,materials,terrain,system", "5 steps in order");
  const m = new LoadingModel();
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
  check(Math.abs(before - (STEP_WEIGHT.materials + STEP_WEIGHT.terrain * 0)) < 1e-9, `overall = weighted sum (${before.toFixed(3)})`);
  check(!m.allDone(), "not all done");
  for (const id of STEPS) m.complete(id);
  check(m.allDone() && m.overall() === 1 && m.focus() === null, "all done → overall 1, no focus");
  check(formatMB(11436569) === "11.4" && formatMB(0) === "0.0", "MB formatting");
  // overall is monotonic for any interleaving of monotonic reports
  const m2 = new LoadingModel();
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
}

if (fails) {
  console.log(`${fails} loading check(s) FAILED`);
  process.exit(1);
}
console.log("all loading checks passed");
