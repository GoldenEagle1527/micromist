/**
 * Seabed multi-material tests (node, no GPU):
 * - catalogue: 22 layers, every one used by some region, big-feature sets (rot
 *   "always") only in B slots, main ≠ alt, every region's look distinct;
 * - catalogue keys match the asset pipeline (scripts/deep-march-materials.py) and
 *   every shipped file exists with the expected KTX2 encoding / size / mip chain;
 * - MaterialStream: startup set, priority order, stand-in groups, cross-fade,
 *   sticky stand-ins after the reveal, failures and reset (fallback path).
 */
import { readFileSync, existsSync } from "node:fs";
import { B_SLOTS, LAYERS, LAYER_COUNT, PALETTE_COUNT, REGION_PALETTES, layersOfRegion, paletteOf, regionsOfLayer } from "../src/games/deep-march/scene/materialCatalog";
import { MaterialStream } from "../src/games/deep-march/scene/materialStream";
import { MAT_DECLS } from "../src/games/deep-march/scene/materialShader";
import { REGION_COUNT } from "../src/games/deep-march/terrain/regions";

let fails = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    fails++;
    console.error("FAIL", msg);
  }
};

// ---- catalogue
check(LAYER_COUNT === 22, `22 layers (got ${LAYER_COUNT})`);
check(REGION_PALETTES.length === REGION_COUNT && PALETTE_COUNT === 2 * REGION_COUNT, "one main+alt palette per region");
check(new Set(LAYERS.map((l) => l.key)).size === LAYER_COUNT, "unique keys");
for (let i = 0; i < LAYER_COUNT; i++) check(regionsOfLayer(i).length > 0, `layer ${LAYERS[i].key} used by a region`);
for (let p = 0; p < PALETTE_COUNT; p++) {
  const pal = paletteOf(p);
  check(pal.length === 5 && pal.every((l) => l >= 0 && l < LAYER_COUNT), `palette ${p} valid`);
  pal.forEach((l, s) => {
    if (LAYERS[l].rot === "always") check((B_SLOTS as readonly number[]).includes(s), `big-feature ${LAYERS[l].key} only in B slots (palette ${p} slot ${s})`);
  });
  check(pal[0] !== pal[1], `palette ${p}: floor A ≠ floor B`);
}
for (const key of ["basalt", "coralcrust", "lichen"]) check(LAYERS.find((l) => l.key === key)?.rot === "always", `${key} uses the rotated second scale`);
for (let r = 0; r < REGION_COUNT; r++) {
  const { main, alt, altAt } = REGION_PALETTES[r];
  check(main.join() !== alt.join(), `region ${r}: alt differs from main`);
  check(altAt > 0.3 && altAt < 0.8, `region ${r}: alt patches cover part of the region`);
  for (let q = 0; q < r; q++) {
    const a = REGION_PALETTES[q].main;
    const same = main.filter((l, s) => a[s] === l).length;
    check(same <= 3, `regions ${q} and ${r} main palettes distinct (${same}/5 slots equal)`);
    check(new Set(layersOfRegion(r)).size !== new Set(layersOfRegion(q)).size || layersOfRegion(r).some((l) => !layersOfRegion(q).includes(l)), `regions ${q}/${r} layer sets differ`);
  }
}
// the shader's merged entry list holds every (layer, floor/side) pair two blending regions can need
{
  const cap = Number(/#define DM_ENTRIES (\d+)/.exec(MAT_DECLS)?.[1]);
  let worst = 0;
  for (let a = 0; a < REGION_COUNT; a++) for (let b = 0; b < REGION_COUNT; b++) {
    const e = new Set<string>();
    for (const r of [a, b]) for (const pal of [REGION_PALETTES[r].main, REGION_PALETTES[r].alt]) pal.forEach((l, s) => e.add(`${l}:${s < 2}`));
    worst = Math.max(worst, e.size);
  }
  check(worst <= cap, `shader entry list (${cap}) fits the worst region pair (${worst})`);
}
// terrace keeps the original 4-set look as its main palette
const T = REGION_PALETTES[4].main.map((l) => LAYERS[l].key);
check(T.join() === "sand,gravel,rock,moss,rock", `terrace main = original look (${T})`);

// ---- pipeline / assets
const py = readFileSync("scripts/deep-march-materials.py", "utf8");
const pyKeys = [...py.slice(py.indexOf("SETS = ["), py.indexOf("]", py.indexOf("SETS = ["))).matchAll(/\("(\w+)", "(acg|ph)"/g)].map((m) => m[1]);
check(pyKeys.join() === LAYERS.map((l) => l.key).join(), `pipeline SETS order = catalogue (${pyKeys.join()})`);
const credits = readFileSync("src/games/deep-march/assets/CREDITS.md", "utf8");
const dir = "src/games/deep-march/assets/materials";
const ktx = (f: string) => {
  const b = readFileSync(`${dir}/${f}`);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const id = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
  check(id.every((x, k) => b[k] === x), `${f}: KTX2 identifier`);
  return { vk: v.getUint32(12, true), w: v.getUint32(20, true), h: v.getUint32(24, true), levels: v.getUint32(40, true), scheme: v.getUint32(44, true) };
};
for (const l of LAYERS) {
  check(credits.includes(`\`${l.key}\``), `CREDITS lists ${l.key}`);
  for (const f of ["a1024.ktx2", "a512.ktx2", "n512.ktx2", "a512.webp", "n512.webp"]) check(existsSync(`${dir}/${l.key}_${f}`), `${l.key}_${f} exists`);
  for (const [f, size, scheme] of [["a1024", 1024, 1], ["a512", 512, 1], ["n512", 512, 2]] as const) {
    if (!existsSync(`${dir}/${l.key}_${f}.ktx2`)) continue;
    const h = ktx(`${l.key}_${f}.ktx2`);
    check(h.vk === 0 && h.w === size && h.h === size, `${l.key}_${f}: ${size}² Basis (vk ${h.vk}, ${h.w}×${h.h})`);
    check(h.levels === Math.log2(size) + 1, `${l.key}_${f}: full mip chain (${h.levels})`);
    check(h.scheme === scheme, `${l.key}_${f}: ${scheme === 1 ? "ETC1S/BasisLZ" : "UASTC+zstd"} (scheme ${h.scheme})`);
  }
}

// ---- MaterialStream
{
  const s = new MaterialStream(1);
  const present = new Float64Array(REGION_COUNT);
  present[1] = 1; // reef only
  const startup = s.setStartup(present);
  check(startup.join() === layersOfRegion(1).sort((a, b) => a - b).join(), "startup = the spawn region's layers");
  check(!s.startupDone(), "startup not done before loading");
  // priority: startup layers first regardless of the priority function
  const order: number[] = [];
  for (let k = 0; k < startup.length; k++) order.push(s.next((l) => -l));
  check(order.every((l) => startup.includes(l)), "startup layers are fetched first");
  check(s.next(() => 0) >= 0, "then others");
  check(s.state.some((st, i) => st === "loading" && !startup.includes(i)), "a non-startup layer in flight");
  // non-startup priority: lowest value first
  const s2 = new MaterialStream(1);
  s2.setStartup(new Float64Array(REGION_COUNT));
  const pick = s2.next((l) => Math.abs(l - 13));
  check(pick === 13, `priority picks the nearest layer (got ${pick})`);
  // startup loads are instant; stand-ins come from the same group
  startup.forEach((l) => s.loaded(l, true));
  check(s.startupDone(), "startup done");
  startup.forEach((l) => check(s.ready[l] === 1 && s.shown(l) === l, `startup layer ${LAYERS[l].key} shown instantly`));
  for (let i = 0; i < LAYER_COUNT; i++) {
    if (startup.includes(i)) continue;
    const f = s.fallback[i];
    check(f >= 0 && s.ready[f] === 1, `layer ${LAYERS[i].key} has a loaded stand-in`);
    const sameGroup = startup.some((l) => LAYERS[l].group === LAYERS[i].group);
    if (sameGroup) check(LAYERS[f].group === LAYERS[i].group, `stand-in for ${LAYERS[i].key} from its group (${LAYERS[f].key})`);
  }
  // a later layer cross-fades (no pop) and keeps its stand-in until fully shown
  const late = s.state.findIndex((st, i) => st === "loading" && !startup.includes(i));
  const standIn = s.fallback[late];
  s.loaded(late, false);
  check(s.ready[late] === 0 && s.shown(late) === standIn, "late layer starts at 0 with its stand-in");
  check(s.update(0.5), "update reports a change while fading");
  check(Math.abs(s.ready[late] - 0.5) < 1e-6 && s.fallback[late] === standIn, "half-way: mix of stand-in and layer");
  s.update(0.6);
  check(s.ready[late] === 1 && s.shown(late) === late, "fade completes");
  check(!s.update(0.1), "no change when idle");
  // sticky: a better-matching layer arriving later doesn't swap an existing stand-in
  const before = Array.from(s.fallback);
  const idle = s.next(() => 0);
  s.loaded(idle, false);
  s.update(2);
  for (let i = 0; i < LAYER_COUNT; i++) if (i !== idle && s.ready[i] < 1) check(s.fallback[i] === before[i], `stand-in of ${LAYERS[i].key} sticky after reveal`);
  // failure keeps the stand-in, settles
  const bad = s.next(() => 0);
  const badStand = s.fallback[bad];
  s.failed(bad);
  check(s.state[bad] === "failed" && s.fallback[bad] === badStand && s.shown(bad) === badStand, "failed layer keeps its stand-in");
  let n;
  while ((n = s.next(() => 0)) >= 0) s.loaded(n, false);
  s.update(5);
  check(s.allSettled(), "all settled");
  // reset (fallback-path switch) returns a layer to idle
  s.reset(startup[0]);
  check(s.state[startup[0]] === "idle" && s.ready[startup[0]] === 0 && !s.allSettled(), "reset → idle");
  // nothing loaded: no stand-in
  const s3 = new MaterialStream();
  s3.setStartup(present);
  s3.failed(s3.next(() => 0));
  check(Array.from(s3.fallback).every((f) => f === -1), "no stand-in before anything loaded");
}

if (fails) {
  console.error(`${fails} material test(s) failed`);
  process.exit(1);
}
console.log("materials ok");
