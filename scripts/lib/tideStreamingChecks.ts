/**
 * test:tide — the double-buffered terrain (plan M7): two ChunkManagers on one
 * simulated worker pool through the PoolRouter (terrain/poolRouter.ts) —
 * gen + 1 requested with its generation, responses and crashed-slot losses
 * routed back to the asking manager, the old set released at the switch (the
 * column count back to the baseline), the memory peak (resident columns, ≈
 * vertex buffers: every column has the same lattice size) ≤ 2.1 × the
 * baseline, the precompute time (modelled job times ÷ workers), and the
 * dissolve front's draw classes.
 */
import * as THREE from "three";
import { wallStateOfChaos } from "../../src/games/deep-march/conserve/chaos/wallModel";
import { terrainLayoutOf } from "../../src/games/deep-march/conserve/platform/terrainLayout";
import { ChunkManager } from "../../src/games/deep-march/terrain/chunks";
import { TERRAIN, terrainForDevice, type TerrainSettings } from "../../src/games/deep-march/terrain/config";
import { createDensityField } from "../../src/games/deep-march/terrain/density";
import type { JobRequest } from "../../src/games/deep-march/terrain/jobPool";
import { PoolRouter } from "../../src/games/deep-march/terrain/poolRouter";
import type { SiteLayout } from "../../src/games/deep-march/terrain/siteLayout";
import { TIDE_VIEW } from "../../src/games/deep-march/scene/tide/config";
import { frontReach, frontRadius } from "../../src/games/deep-march/scene/tide/frontSchedule";
import { TerrainFront } from "../../src/games/deep-march/scene/tide/terrainFront";
import type { Checker } from "./checks";
import { INFO_MS, LEVEL_MS, SimPool } from "./streamingSim";
import { tideRig } from "./tideFixture";

class GenSimPool extends SimPool {
  readonly adds: number[] = [];
  readonly drops: number[] = [];
  addGen(gen: number) {
    this.adds.push(gen);
  }
  dropGen(gen: number) {
    this.drops.push(gen);
  }
}

const fade = () => ({ material: new THREE.MeshBasicMaterial(), fade: new THREE.Vector2() });
const jobMs = (r: JobRequest) => (r.type === "info" ? INFO_MS : LEVEL_MS[Math.min(r.lod, LEVEL_MS.length - 1)]);

function run(c: Checker, name: string, settings: TerrainSettings, workers: number, factor: number, layouts: [SiteLayout, SiteLayout], seed: number, at: THREE.Vector3) {
  const perf = globalThis.performance;
  const realNow = perf.now.bind(perf);
  let t = 0;
  perf.now = () => t * 1000;
  try {
    const pool = new GenSimPool(workers, factor, settings.boundsSize);
    const router = new PoolRouter(pool);
    const scene = new THREE.Scene();
    const mat = new THREE.MeshBasicMaterial();
    const camera = new THREE.PerspectiveCamera(70, 0.5, 0.05, settings.viewDistance + 40);
    camera.position.copy(at);
    camera.lookAt(at.x + 1, at.y - 0.1, at.z);
    camera.updateMatrixWorld();
    const dt = 1 / 30;
    const step = (...ms: ChunkManager[]) => {
      t += dt;
      pool.now = t;
      for (const m of ms) m.update(at, camera, dt);
    };
    // the tide's readiness (nextTerrain.ts): the view covered and the set settled
    const ready = (m: ChunkManager) => m.nearReady(at, 14) && m.coverageComplete(at) && m.queueLength === 0 && m.stats().pending === 0;
    const cur = new ChunkManager(scene, createDensityField(seed, settings, undefined, layouts[0]), seed, mat, workers <= 2, fade as never, router.view(0));
    while (!ready(cur) && t < 120) step(cur);
    cur.loading = false;
    for (let i = 0; i < 90; i++) step(cur);
    const base = cur.stats().meshes;
    const logFrom = pool.log.length;
    const next = new ChunkManager(scene, createDensityField(seed, settings, undefined, layouts[1]), seed, mat, workers <= 2, fade as never, router.view(2, layouts[1]));
    next.meshGroup.visible = false;
    const t0 = t;
    let peak = base;
    while (!ready(next) && t - t0 < 120) {
      step(cur, next);
      peak = Math.max(peak, cur.stats().meshes + next.stats().meshes);
    }
    const tReady = t - t0;
    const nextLog = pool.log.slice(logFrom).filter((r) => (r as JobRequest & { gen?: number }).gen === 2);
    const serial = nextLog.reduce((a, r) => a + jobMs(r), 0) / 1000;
    c.check(pool.adds.join() === "2", `${name}: gen + 1's layout sent to the workers once (addGen)`, pool.adds.join());
    c.check(nextLog.length > 0 && pool.log.slice(0, logFrom).every((r) => (r as { gen?: number }).gen === undefined), `${name}: gen + 1's jobs carry their generation, the current ones none`, `${nextLog.length} gen-2 jobs`);
    c.check(tReady < 60, `${name}: gen + 1 covers the view and settles within the 60 s warning (modelled job times)`, `${tReady.toFixed(1)} s with ${workers} workers × ${factor} (serial ${serial.toFixed(1)} s)`);
    c.check(peak / base <= 2.1, `${name}: memory peak while both sets are resident ≤ 2.1 × baseline`, `${peak} / ${base} columns = ${(peak / base).toFixed(2)}×`);
    c.check(!next.meshGroup.visible && cur.meshGroup.visible, `${name}: until the switch only the current set is drawn (draws = baseline)`, "");
    // the switch: the old set goes, its generation is dropped in the workers
    cur.dispose();
    for (let i = 0; i < 150; i++) step(next);
    c.check(pool.drops.join() === "0" && router.viewCount === 1, `${name}: old set released (dropGen 0), one view left`, `drops ${pool.drops.join()}`);
    const after = next.stats().meshes;
    c.check(cur.meshGroup.children.length === 0 && after <= Math.ceil(base * 1.1), `${name}: resident columns back to the baseline`, `${after} (baseline ${base})`);
    // the front in P4 half way: plain inside, dither band, beyond not drawn
    const tideMat = new THREE.MeshBasicMaterial();
    const front = new TerrainFront({ material: tideMat, front: new THREE.Vector4(), glow: new THREE.Color() });
    const domeR = 60, reach = frontReach(domeR, settings.viewDistance, TIDE_VIEW.front.width);
    front.apply(next, mat, at.x, at.z, frontRadius({ state: "show", phase: "gather", u: 0.5 }, domeR, reach));
    const k = front.counts, total = k.drawn + k.band + k.hidden;
    c.check(total === after && k.hidden > 0 && k.band > 0 && k.band <= 0.5 * total, `${name}: front at P4 ½ — plain / dither band / hidden`, `${k.drawn} / ${k.band} / ${k.hidden} of ${total}`);
    front.clear(mat);
    c.check(next.meshGroup.children.every((m) => m.layers.mask === 1 && (m as THREE.Mesh).material !== tideMat), `${name}: clear() restores every column`, "");
    next.dispose();
    router.dispose();
    return tReady;
  } finally {
    perf.now = realNow;
  }
}

function routing(c: Checker): void {
  c.section("pool router (terrain/poolRouter.ts)");
  const pool = new GenSimPool(2, 1, 32);
  const router = new PoolRouter(pool);
  const a = router.view(0), b = router.view(5, null);
  const lostA: number[] = [];
  a.onLost = (ids) => lostA.push(...ids);
  a.submit({ type: "column", id: 1, cx: 0, cz: 0, lod: 0 });
  b.submit({ type: "column", id: 1, cx: 3, cz: 0, lod: 0 });
  const [ga, gb] = pool.log.map((r) => r.id);
  c.check(ga !== gb && (pool.log[1] as { gen?: number }).gen === 5, "ids remapped to pool-global ids; view 5's requests name gen 5", `${ga}, ${gb}`);
  pool.now = 10;
  const outA: { id: number }[] = [], outB: { id: number }[] = [];
  b.drain(outB as never);
  a.drain(outA as never);
  c.check(outA.length === 1 && outB.length === 1 && outA[0].id === 1 && outB[0].id === 1, "each response back to its view, with its own id", `${outA.length} + ${outB.length}`);
  a.submit({ type: "column", id: 7, cx: 1, cz: 1, lod: 0 });
  pool.onLost?.([pool.log[2].id]);
  c.check(lostA.join() === "7" && router.inFlight === 0, "a crashed slot's job returns to its view as lost", lostA.join());
  b.submit({ type: "info", id: 9, cx: 0, cz: 0 });
  b.dispose();
  pool.now = 20;
  a.drain([]);
  c.check(pool.drops.join() === "5" && router.inFlight === 0 && b.live() === 0, "a disposed view drops its generation; its late results are discarded", pool.drops.join());
  router.dispose();
}

export function tideStreamingChecks(c: Checker): void {
  routing(c);
  c.section("front schedule (scene/tide/frontSchedule.ts)");
  const R = 60, reach = 400;
  const at = (phase: "inhale" | "strip" | "currents" | "gather" | "settle", u: number) => frontRadius({ state: "show", phase, u }, R, reach);
  c.check(frontRadius({ state: "warning", phase: null, u: 0 }, R, reach) === null && frontRadius({ state: "murk", phase: null, u: 0 }, R, reach) === null, "no front in the warning or the murk", "");
  c.check(at("inhale", 0.5) === null && at("settle", 0.5) === null, "P1 / P5: all terrain drawn", "");
  c.check(at("strip", 0) === reach && at("strip", 1) === R && at("strip", 0.5) === (R + reach) / 2, "P2: the front sweeps from beyond the view in to the dome (linear)", `${at("strip", 0)} → ${at("strip", 1)}`);
  c.check(at("currents", 0.3) === R, "P3: only the dome's terrain (the frozen 3 × 3)", "");
  c.check(at("gather", 0) === R && at("gather", 1) === reach, "P4: the new terrain grows back out from the dome", "");
  c.section("double-buffered terrain on one pool (streaming)");
  const { session: s, spot } = tideRig("abyss");
  s.tide.call({ simple: false, lowMemory: false });
  const plan = s.tide.pending!;
  const layouts: [SiteLayout, SiteLayout] = [terrainLayoutOf(s.siteTable, s.wall), terrainLayoutOf(plan.table, wallStateOfChaos(plan.chaos))];
  const y = s.base.view().center![1] + 2;
  const p = new THREE.Vector3(spot.x, y, spot.z);
  const desk = run(c, "desktop", TERRAIN, 4, 1, layouts, s.seed, p);
  const phone = run(c, "phone", terrainForDevice(true), 2, 2.5, layouts, s.seed, p);
  console.log(`  INFO precompute estimate: desktop ${desk.toFixed(1)} s (4 workers), phone ${phone.toFixed(1)} s (2 workers, job times × 2.5) — the warning is 60 s (+30 s)`);
}
