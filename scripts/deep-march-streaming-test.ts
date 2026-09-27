/**
 * Streaming scheduler (terrain/chunks.ts) under a simulated job pool: the real
 * ChunkManager decides what to build, a virtual worker pool completes jobs after
 * modelled per-level times (measured desktop ms × device factor). Checks, on the
 * phone config swimming at 9.8 u/s along a winding path while looking around:
 *  1. after the loading gate (coverageComplete + level 0 near the diver) no point
 *     inside viewDistance is ever uncovered (8 u grid, every frame);
 *  2. the job queue stays bounded;
 *  3. reports the coverage (loading) time and how often the diver's own footprint
 *     is drawn at level 0.
 * Run: npm run test:streaming
 */
import * as THREE from "three";
import { terrainForDevice, TERRAIN, type TerrainSettings } from "../src/games/deep-march/terrain/config";
import { createDensityField } from "../src/games/deep-march/terrain/density";
import { ChunkManager } from "../src/games/deep-march/terrain/chunks";
import type { JobPool, JobRequest } from "../src/games/deep-march/terrain/jobPool";
import type { MesherResponse } from "../src/games/deep-march/terrain/protocol";

/** Desktop single-core ms per column job by level (node bench, sparse-brick mesher), info job ms. */
const LEVEL_MS = [200, 166, 100, 84];
const INFO_MS = 45;

class SimPool implements JobPool {
  now = 0;
  onLost: ((ids: number[]) => void) | null = null;
  private busy: { req: JobRequest; done: number }[] = [];
  constructor(private readonly slots: number, private readonly factor: number, private readonly b: number) {}
  live() { return this.slots; }
  free() { return this.slots - this.busy.length; }
  jobs = [0, 0, 0, 0, 0];
  submit(req: JobRequest) {
    this.jobs[req.type === "info" ? 4 : req.lod]++;
    const ms = req.type === "info" ? INFO_MS : LEVEL_MS[Math.min(req.lod, LEVEL_MS.length - 1)];
    this.busy.push({ req, done: this.now + (ms * this.factor) / 1000 });
  }
  drain(out: MesherResponse[]) {
    const keep: typeof this.busy = [];
    for (const j of this.busy) {
      if (j.done > this.now) { keep.push(j); continue; }
      const r = j.req;
      const size = r.type === "info" ? 10 : this.b * (1 << r.lod);
      const x0 = -this.b / 2 + r.cx * size, z0 = -this.b / 2 + r.cz * size;
      out.push({
        type: r.type, id: r.id,
        positions: new Float32Array([x0, 0, z0, x0 + size, 0, z0, x0, 0, z0 + size]),
        normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), ao: new Float32Array(3), region: new Uint8Array(24),
        indices: r.type === "info" ? new Uint16Array(0) : new Uint16Array([0, 1, 2]),
        bounds: new Float32Array([x0, -1, z0, x0 + size, 1, z0 + size]), removed: new Int32Array(0),
        stats: { floaters: 0, floaterPoints: 0, ambiguous: 0, searched: 0, noiseSamples: 0, rawPoints: 0, coarseSamples: 0 },
        info: null, infoMs: 0, ms: 0,
      });
    }
    this.busy = keep;
  }
  dispose() {}
}

let failed = 0;
const check = (ok: boolean, name: string, detail: string) => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
};

function run(name: string, s: TerrainSettings, workers: number, factor: number, fps: number, seconds: number) {
  const field = createDensityField(7, s);
  const scene = new THREE.Scene();
  const pool = new SimPool(workers, factor, s.boundsSize);
  const mat = new THREE.MeshBasicMaterial();
  const fade = () => ({ material: new THREE.MeshBasicMaterial(), fade: new THREE.Vector2() });
  const mgr = new ChunkManager(scene, field, 7, mat, workers <= 2, fade as never, pool);
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
if (failed) {
  console.log(`${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("all streaming checks passed");
