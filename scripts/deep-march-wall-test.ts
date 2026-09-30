/**
 * Ring wall (M3; design doc §4.1 / §4.4): conserve/chaos/wallModel, terrain/wallGeometry,
 * terrain/wallDensity + the wall paths of density.ts, the diver against it:
 *   - wall model: T(m) monotone, endpoints 160 / 24, the stage table, genesis 160 m;
 *   - geometry: locate / point round trip, arc length continuous and periodic, facets
 *     C0, periodic and within [faceMin, faceMax]; no cracks = the facets, a crack
 *     carves its notch and nothing else;
 *   - density: the inner face does not move with T (160 vs 24 m), solid through the
 *     thickness, the chaos void beyond (sealed above / below), the term an exact
 *     identity for sd ≤ skipSd, rawClass and the mask bounds contain every sample;
 *   - diver: swimming at the wall, stopped by the rock (not by the edge backstop);
 *   - meshes, material weight, far ring, performance: wallMeshChecks.ts.
 * Run: npm run test:wall   (alone: it times columns)
 */
import { WALL } from "../src/games/deep-march/conserve/config";
import { externalShare, wallStateOf, wallThickness } from "../src/games/deep-march/conserve/chaos/wallModel";
import { createWorldSave } from "../src/games/deep-march/conserve/save/createSave";
import { TERRAIN } from "../src/games/deep-march/terrain/config";
import { ALL_REGIONS_MASK, WALL_BIT, createDensityField } from "../src/games/deep-march/terrain/density";
import { createWallShape } from "../src/games/deep-march/terrain/wallGeometry";
import { WALL_SHAPE } from "../src/games/deep-march/terrain/wallConfig";
import { MACRO } from "../src/games/deep-march/terrain/regions";
import { layoutRect } from "../src/games/deep-march/terrain/siteLayout";
import { DiverController } from "../src/games/deep-march/scene/diver";
import { createChecker } from "./lib/checks";
import { genesisLayout, genesisTable, withWall } from "./lib/worldFixture";
import { meshChecks } from "./lib/wallMeshChecks";

const c = createChecker();
const S = TERRAIN.worldScale, iso = TERRAIN.isoLevel;
let rs = 12345;
const rnd = () => ((rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296);

c.section("wall model (§4.1)");
{
  const ms = Array.from({ length: 401 }, (_, i) => 0.6 + i * 0.001);
  const Ts = ms.map((m) => wallThickness(m));
  c.check(Ts.every((t, i) => i === 0 || t >= Ts[i - 1]), "T(m) monotone non-decreasing", `${Ts[0]} … ${Ts[Ts.length - 1]} m`);
  c.check(wallThickness(WALL.mFull) === 160 && wallThickness(1) === 160 && wallThickness(WALL.mBreak) === 24 && wallThickness(0.5) === 24, "endpoints: 160 m at m ≥ 0.95, 24 m at m ≤ 0.78");
  const stage: [number, number][] = [[0.93, 155], [0.92, 149], [0.9, 132], [0.87, 98], [0.84, 63], [0.8, 29]];
  const worst = Math.max(...stage.map(([m, t]) => Math.abs(wallThickness(m) - t)));
  c.check(worst < 1, "stage table T(0.93 … 0.80) = 155 / 149 / 132 / 98 / 63 / 29 m", stage.map(([m]) => wallThickness(m).toFixed(1)).join(" / "));
  const t = genesisTable(7), save = createWorldSave({ id: "main", seedText: "7", seed: 7, now: 0 });
  const w = wallStateOf(t.allocInput, save.totals);
  c.check(w.m > 0.95 && w.m <= 1 && w.sigma === 1 && w.thickness === 160 && w.cracks.length === 0, "genesis: m ≈ 0.99, σ = 1, T = 160 m, no cracks", `m ${w.m.toFixed(4)}`);
  c.check(externalShare([0, 0], [0, 0]) === 1, "empty world: m = 1");
}

const layout = genesisLayout(7);
const field = createDensityField(7, TERRAIN, undefined, layout);
const shape = field.wall!.shape;
const loc = new Float64Array(2), pt = new Float64Array(4);
/** World point at arc length s (base), signed distance sd (base, + outward), height y (m). */
const at = (s: number, sd: number) => (shape.point(s, -sd, pt), [pt[0] * S, pt[1] * S] as const);

c.section("geometry");
{
  let worst = 0;
  for (let i = 0; i < 4000; i++) {
    const s = rnd() * shape.perimeter, d = (rnd() - 0.7) * 60;
    shape.point(s, -d, pt);
    shape.locate(pt[0], pt[1], loc);
    let e = Math.abs(loc[1] - s);
    e = Math.min(e, shape.perimeter - e);
    worst = Math.max(worst, Math.abs(loc[0] - d), e);
  }
  c.check(worst < 1e-6, "locate(point(s, d)) = (d, s)", `max error ${worst.toExponential(1)} base`);
  const P = shape.perimeter, n = 20000;
  let jump = 0, wraps = 0;
  for (let i = 0; i < n; i++) {
    shape.point((i * P) / n, 0, pt);
    shape.locate(pt[0], pt[1], loc);
    const s0 = loc[1];
    shape.point((((i + 1) % n) * P) / n, 0, pt);
    shape.locate(pt[0], pt[1], loc);
    const d = loc[1] - s0;
    if (d < 0) wraps++;
    else jump = Math.max(jump, Math.abs(d - P / n));
  }
  c.check(wraps === 1 && jump < 1e-6, "arc length continuous around the ring, one wrap at P", `P = ${(P * S).toFixed(0)} m, ${wraps} wrap`);
  let lip = 0, lo = Infinity, hi = -Infinity, per = 0;
  const h = 0.01;
  for (let i = 0; i < 20000; i++) {
    const s = rnd() * P, y = (rnd() * 260 - 140) / S, f = shape.facet(s, y);
    lip = Math.max(lip, Math.abs(shape.facet(s + h, y) - f) / h, Math.abs(shape.facet(s, y + h) - f) / h);
    lo = Math.min(lo, f);
    hi = Math.max(hi, f);
    per = Math.max(per, Math.abs(shape.facet(s + P, y) - f), Math.abs(shape.facet(s - P, y) - f));
  }
  c.check(lip < 2, "facets continuous (C0: bounded slope, no seams)", `max slope ${lip.toFixed(2)}`);
  c.check(lo >= shape.faceMin - 1e-9 && hi <= shape.faceMax + 1e-9, "face within [faceMin, faceMax]", `${(lo * S).toFixed(1)} … ${(hi * S).toFixed(1)} m of [${(shape.faceMin * S).toFixed(0)}, ${(shape.faceMax * S).toFixed(0)}]`);
  c.check(per < 1e-9, "facets periodic in s", per.toExponential(1));
  c.check(shape.face === shape.facet && shape.crackMax === 0, "no cracks: face = facets");
  const crack = { s: 40, width: 36, depth: 70 }; // straddles s = 0 (periodicity)
  const cs = createWallShape(layoutRect(layout, MACRO.cell), { thickness: 160, cracks: [crack] }, 7);
  let deepest = 0, outside = 0;
  for (let y = -30; y <= 30; y += 0.5) deepest = Math.max(deepest, cs.crack(crack.s / S, y / S));
  for (let i = 0; i < 4000; i++) {
    const s = rnd() * P, ds = Math.min(Math.abs(s - crack.s / S), P - Math.abs(s - crack.s / S)), y = (rnd() * 200 - 100) / S;
    if (ds * S > crack.width / 2 * (1 + 2 * WALL_SHAPE.crackJag) && cs.face(s, y) !== cs.facet(s, y)) outside++;
  }
  c.check(deepest * S > 0.95 * crack.depth && deepest * S <= crack.depth + 1e-9 && outside === 0, "a crack carves its notch (full depth at the centre) and nothing beyond its width", `depth ${(deepest * S).toFixed(1)} m of ${crack.depth}, ${outside} points outside touched`);
}

c.section("density");
{
  const thin = createDensityField(7, TERRAIN, undefined, withWall(layout, { thickness: 24, cracks: [] }));
  const none = createDensityField(7, TERRAIN, undefined, withWall(layout, null));
  let moved = 0, n = 0, hollow = 0, wet = 0, dry = 0, skipDiff = 0, skipN = 0;
  for (let i = 0; i < 6000; i++) {
    const s = rnd() * shape.perimeter, y = -100 + rnd() * 156;
    const sd = -15 + rnd() * (5.5 + 15); // up to 22 m past the outline (< 24 m)
    const [x, z] = at(s, sd);
    if (field.sampleRaw(x, y, z) > iso !== thin.sampleRaw(x, y, z) > iso || field.sample(x, y, z) > iso !== thin.sample(x, y, z) > iso) moved++;
    n++;
    const sb = -shape.face(s, y / S) + 0.5 + rnd() * (shape.thickness + shape.face(s, y / S) - 1);
    const [x2, z2] = at(s, sb);
    if (field.sampleRaw(x2, y, z2) <= iso || field.sample(x2, y, z2) <= iso) hollow++;
    const [x3, z3] = at(s, shape.thickness + 1 + rnd() * 30);
    const yv = WALL_SHAPE.voidLo + 4 + rnd() * (WALL_SHAPE.voidHi - WALL_SHAPE.voidLo - 8);
    if (field.sample(x3, yv, z3) >= iso) wet++;
    const ys = rnd() < 0.5 ? WALL_SHAPE.voidLo - 4 - rnd() * 40 : WALL_SHAPE.voidHi + 4 + rnd() * 40;
    if (field.sample(x3, ys, z3) <= iso) dry++;
  }
  c.check(moved === 0, "inner face independent of m: solid / water identical for T = 160 and 24 m", `${moved} of ${n} points differ`);
  c.check(hollow === 0, "solid from 2 m behind the face through the thickness", `${hollow} water points`);
  c.check(wet === 0 && dry === 0, "beyond the outer face: open chaos void in the band, sealed above / below", `${wet} solid in the void, ${dry} open outside it`);
  const cls = new Float64Array(1), cls0 = new Float64Array(1), b = new Float64Array(2), rb = new Float64Array(2);
  let classDiff = 0, classBad = 0, boundBad = 0;
  const rect = layoutRect(layout, MACRO.cell * S);
  for (let i = 0; i < 20000; i++) {
    const near = i % 2 === 0;
    let x: number, z: number;
    if (near) [x, z] = at(rnd() * shape.perimeter, field.wall!.skipSd - 2 + rnd() * (shape.thickness + 24));
    else [x, z] = [rect.x0 + rnd() * (rect.x1 - rect.x0), rect.z0 + rnd() * (rect.z1 - rect.z0)];
    const y = -130 + rnd() * 200;
    shape.locate(x / S, z / S, loc);
    const v = field.sampleRaw(x, y, z), k = field.rawClass(x, y, z, cls);
    if (loc[0] <= field.wall!.skipSd) {
      skipN++;
      const k0 = none.rawClass(x, y, z, cls0);
      if (v !== none.sampleRaw(x, y, z) || field.sample(x, y, z) !== none.sample(x, y, z)) skipDiff++;
      if (k !== k0 || (k !== 0 && cls[0] !== cls0[0])) classDiff++;
    }
    if ((k === 2 && v !== cls[0]) || (k === 1 && !(v <= cls[0] && cls[0] < iso))) classBad++;
    field.rawBoundsForMask(ALL_REGIONS_MASK | WALL_BIT, y, rb);
    field.bounds(y, b);
    const sm = field.sample(x, y, z);
    if (v < rb[0] || v > rb[1] || sm < b[0] || sm > b[1]) boundBad++;
  }
  c.check(skipDiff === 0 && classDiff === 0, "sd ≤ skipSd: bit-identical to the field without a wall (values and rawClass)", `${skipN} points (${skipDiff} values, ${classDiff} classes differ), skipSd ${(field.wall!.skipSd * S).toFixed(1)} m`);
  c.check(classBad === 0, "rawClass exact / conservative with the wall", `${classBad} violations`);
  c.check(boundBad === 0, "raw / smoothed bounds (mask | WALL_BIT) contain every sample", `${boundBad} outside`);
}

c.section("diver");
{
  const rect = layoutRect(layout, MACRO.cell * S);
  const d = new DiverController(field);
  d.edge = rect;
  // open water 120 m in from the east outline, clear for 60 m toward the wall
  let start: [number, number] | null = null;
  for (let z = -300; z <= 300 && !start; z += 20) for (let y = 30; y >= -20 && !start; y -= 2) {
    let clear = true;
    for (let x = rect.x1 - 120; x <= rect.x1 - 60 && clear; x += 2) for (const dy of [-2, 0, 2]) if (field.sample(x, y + dy, z) >= iso - 0.5) clear = false;
    if (clear) start = [y, z];
  }
  c.check(!!start, "found open water near the east wall");
  if (start) {
    d.spawnAt(rect.x1 - 120, start[0], start[1], -Math.PI / 2);
    let maxSd = -Infinity, inRock = 0;
    for (let i = 0; i < 400; i++) {
      d.update(0.05, { forward: 1, strafe: 0, up: false, down: false, sprint: true });
      shape.locate(d.position.x / S, d.position.z / S, loc);
      maxSd = Math.max(maxSd, loc[0] * S);
      if (field.sample(d.position.x, d.position.y, d.position.z) > iso + 0.5) inRock++;
    }
    c.check(maxSd < -2 && inRock === 0, "diver swimming at the wall is stopped by its rock, in front of the outline", `closest ${maxSd.toFixed(1)} m from the outline (the edge backstop would hold it at −2 m), ${inRock} ticks inside rock`);
  }
}

meshChecks(c, field, layout);
c.finish();
