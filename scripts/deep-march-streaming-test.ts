/**
 * Streaming scheduler (terrain/chunks.ts) under a simulated job pool: the real
 * ChunkManager decides what to build, a virtual worker pool completes jobs after
 * modelled per-level times (measured desktop ms × device factor). Checks, on the
 * phone config swimming at 9.8 u/s along a winding path while looking around:
 *  1. after the loading gate (coverageComplete + level 0 near the diver) no point
 *     inside viewDistance is ever uncovered (8 u grid, every frame);
 *  2. the job queue stays bounded;
 *  3. reports the coverage (loading) time and how often the diver's own footprint
 *     is drawn at level 0;
 *  4. free dive: the request sequence equals the fixture recorded before the
 *     bounded world existed (scripts/fixtures/deep-march-free-streaming.json);
 *  5. bounded world (conserve site table → explicit layout): no request lies
 *     wholly outside the world, edge columns are built, the loading gate passes
 *     next to the edge, coverage never counts points outside;
 *  6. cracks (M8): without them the M7 sequence bit for bit; with one, extra
 *     columns only in its reach rectangle.
 * Run: npm run test:streaming
 */
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { buildSiteTable } from "../src/games/deep-march/conserve/world/siteTable";
import { createWorldSave } from "../src/games/deep-march/conserve/save/createSave";
import { terrainLayoutOf } from "../src/games/deep-march/conserve/platform/terrainLayout";
import { INFO_GRID, terrainForDevice, TERRAIN, type TerrainSettings } from "../src/games/deep-march/terrain/config";
import { createDensityField } from "../src/games/deep-march/terrain/density";
import { MACRO } from "../src/games/deep-march/terrain/regions";
import { insideRect, layoutRect, rectOverlaps } from "../src/games/deep-march/terrain/siteLayout";
import { createSimManager, requestSequence } from "./lib/streamingSim";
import { crackStreamingChecks } from "./lib/crackStreamingChecks";

let failed = 0;
const check = (ok: boolean, name: string, detail: string) => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
};

function run(name: string, s: TerrainSettings, workers: number, factor: number, fps: number, seconds: number) {
  const field = createDensityField(7, s);
  const { mgr, pool } = createSimManager(field, 7, workers, factor);
  const camera = new THREE.PerspectiveCamera(70, 0.5, 0.05, s.viewDistance + 40);
  const pos = new THREE.Vector3(0, -40, 0);
  const dt = 1 / fps;
  let t = 0, heading = 0, coverT = -1, frames = 0, holeFrames = 0, maxHoles = 0, maxQueue = 0, l0Frames = 0, maxNodes = 0;
  const b = s.boundsSize;
  const look = (yawOff: number) => {
    camera.position.copy(pos);
    const yaw = heading + yawOff;
    camera.lookAt(pos.x + Math.cos(yaw), pos.y - 0.15, pos.z + Math.sin(yaw));
  };
  // loading: stationary until the gate passes
  while (coverT < 0 && t < 120) {
    t += dt; pool.now = t; look(0);
    mgr.update(pos, camera, dt);
    if (mgr.nearReady(pos, 14) && mgr.coverageComplete(pos)) { coverT = t; mgr.loading = false; }
  }
  check(coverT > 0, `${name} loading gate`, `coverage complete after ${coverT.toFixed(2)} s (virtual)`);
  const t0 = t;
  while (t - t0 < seconds) {
    t += dt; pool.now = t;
    const u = t - t0;
    // winding path: slow heading drift + a sharp turn every 20 s; look around ±70°
    heading += dt * (0.12 * Math.sin(u * 0.21) + (Math.floor(u / 20) !== Math.floor((u - dt) / 20) ? Math.PI / 2 / dt : 0));
    pos.x += Math.cos(heading) * 9.8 * dt;
    pos.z += Math.sin(heading) * 9.8 * dt;
    look(1.2 * Math.sin(u * 0.6));
    mgr.update(pos, camera, dt);
    const holes = mgr.coverageHoles(pos, 8);
    frames++;
    if (holes > 0) holeFrames++;
    maxHoles = Math.max(maxHoles, holes);
    maxQueue = Math.max(maxQueue, mgr.queueLength);
    maxNodes = Math.max(maxNodes, mgr.stats().active);
    const gx = Math.floor((pos.x + b / 2) / b), gz = Math.floor((pos.z + b / 2) / b);
    if (mgr.drawnAt(0, gx, gz)) l0Frames++;
  }
  check(holeFrames === 0, `${name} no uncovered footprint in view`, `${holeFrames}/${frames} frames with holes (max ${maxHoles} grid points), ${(9.8 * seconds).toFixed(0)} u swum`);
  check(maxQueue <= 4 * maxNodes && maxQueue < 400, `${name} queue bounded`, `max queued ${maxQueue}, max active columns ${maxNodes}`);
  console.log(`  info ${name}: diver footprint drawn at level 0 in ${((100 * l0Frames) / frames).toFixed(1)}% of frames`);
  console.log(`  info ${name}: jobs by level L0..L3 ${pool.jobs.slice(0, 4).join("/")}, info ${pool.jobs[4]}`);
  mgr.dispose();
  return coverT;
}

console.log("streaming scheduler (simulated pool, seed 7)");
const phone = terrainForDevice(true);
run("phone ×4 (2 workers)", phone, 2, 4, 30, 120);
run("phone ×5 (2 workers)", phone, 2, 5, 30, 120);
run("desktop (4 workers)", TERRAIN, 4, 1, 60, 90);

console.log("free dive: request sequence vs the pre-bounded-world fixture");
{
  const fx = JSON.parse(readFileSync(new URL("./fixtures/deep-march-free-streaming.json", `file://${process.cwd()}/scripts/`), "utf8"));
  for (const [name, st, w, f, fps] of [["phone", terrainForDevice(true), 2, 4, 30], ["desktop", TERRAIN, 4, 1, 60]] as const) {
    const r = requestSequence(createDensityField(7, st), 7, w, f, fps, 40);
    const want = fx[name] as { hash: string; requests: number };
    check(r.hash === want.hash && r.log.length === want.requests, `${name} free request sequence unchanged`, `${r.log.length} requests, hash ${r.hash} (fixture ${want.requests} / ${want.hash})`);
  }
}

console.log("bounded world (seed 7, 10 × 10 site table)");
{
  const save = createWorldSave({ id: "main", seedText: "7", seed: 7, now: 0 });
  const layout = terrainLayoutOf(buildSiteTable({ seed: 7, gen: 1, allocInput: save.generation.allocInput, totals: save.totals }));
  for (const [name, st, w, f, fps] of [["phone", terrainForDevice(true), 2, 4, 30], ["desktop", TERRAIN, 4, 1, 60]] as const) {
    const field = createDensityField(7, st, undefined, layout);
    const rect = layoutRect(layout, MACRO.cell * st.worldScale);
    // start 180 u inside the east edge, swim toward it (stops short of it)
    const start = new THREE.Vector3(rect.x1 - 180, -40, 0);
    const r = requestSequence(field, 7, w, f, fps, 15, start, 0);
    const b = st.boundsSize;
    const foot = (q: (typeof r.log)[number]) => {
      const size = q.type === "info" ? INFO_GRID.boundsSize * st.worldScale : b * (1 << q.lod);
      const o = q.type === "info" ? -size / 2 : -b / 2;
      return { x0: o + q.cx * size, z0: o + q.cz * size, size };
    };
    const outside = r.log.filter((q) => { const p = foot(q); return !rectOverlaps(rect, p.x0, p.z0, p.size); });
    const straddle = r.log.filter((q) => { const p = foot(q); return p.x0 < rect.x1 && p.x0 + p.size > rect.x1; });
    check(r.covered, `${name} loading gate next to the edge`, `coverage complete 180 u from the edge (view ${st.viewDistance} u)`);
    check(outside.length === 0, `${name} no request outside the world`, `${outside.length} of ${r.log.length} requests`);
    check(straddle.length > 0, `${name} edge columns built`, `${straddle.length} requests straddle x = ${rect.x1}`);
    check(r.path.every((p) => insideRect(rect, p.x, p.z)), `${name} swim stayed inside`, `last x ${r.path[r.path.length - 1].x.toFixed(0)}`);
  }
}
crackStreamingChecks(check);
if (failed) {
  console.log(`${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("all streaming checks passed");
