/**
 * Simulated streaming for the scheduler tests (terrain/chunks.ts): a virtual job
 * pool that completes jobs after modelled per-level times, and a deterministic
 * swim along a winding path. Uses only the ChunkManager / DensityField API, so the
 * same code records the free-dive request-sequence fixture on older builds.
 */
import * as THREE from "three";
import type { DensityField } from "../../src/games/deep-march/terrain/density";
import { ChunkManager } from "../../src/games/deep-march/terrain/chunks";
import type { JobPool, JobRequest } from "../../src/games/deep-march/terrain/jobPool";
import type { MesherResponse } from "../../src/games/deep-march/terrain/protocol";

/** Desktop single-core ms per column job by level (node bench, sparse-brick mesher), info job ms. */
export const LEVEL_MS = [200, 166, 100, 84];
export const INFO_MS = 45;

export class SimPool implements JobPool {
  now = 0;
  onLost: ((ids: number[]) => void) | null = null;
  jobs = [0, 0, 0, 0, 0];
  /** Every submitted request, in order. */
  readonly log: JobRequest[] = [];
  private busy: { req: JobRequest; done: number }[] = [];
  constructor(private readonly slots: number, private readonly factor: number, private readonly b: number) {}
  live() { return this.slots; }
  free() { return this.slots - this.busy.length; }
  submit(req: JobRequest) {
    this.log.push(req);
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

export function createSimManager(field: DensityField, seed: number, workers: number, factor: number) {
  const pool = new SimPool(workers, factor, field.settings.boundsSize);
  const fade = () => ({ material: new THREE.MeshBasicMaterial(), fade: new THREE.Vector2() });
  const mgr = new ChunkManager(new THREE.Scene(), field, seed, new THREE.MeshBasicMaterial(), workers <= 2, fade as never, pool);
  return { mgr, pool };
}

/** FNV-1a over the request sequence (type, level, cx, cz — ids excluded). */
export function hashRequests(log: readonly JobRequest[]): string {
  let h = 0x811c9dc5;
  const add = (v: number) => {
    for (let s = 0; s < 32; s += 8) h = Math.imul(h ^ ((v >>> s) & 255), 0x01000193);
  };
  for (const r of log) {
    add(r.type === "info" ? 1 : 2);
    add(r.type === "info" ? 0 : r.lod);
    add(r.cx);
    add(r.cz);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Deterministic run for the request-sequence check: virtual clock (performance.now
 * frozen within a frame, so the per-frame budgets never cut in), loading gate at
 * `start`, then a winding swim of `seconds` at 9.8 u/s heading `heading0`.
 */
export function requestSequence(field: DensityField, seed: number, workers: number, factor: number, fps: number, seconds: number, start = new THREE.Vector3(0, -40, 0), heading0 = 0) {
  const perf = globalThis.performance;
  const realNow = perf.now.bind(perf);
  let virtualMs = 0;
  perf.now = () => virtualMs;
  try {
    const { mgr, pool } = createSimManager(field, seed, workers, factor);
    const camera = new THREE.PerspectiveCamera(70, 0.5, 0.05, field.settings.viewDistance + 40);
    const pos = start.clone();
    const dt = 1 / fps;
    let t = 0, heading = heading0, covered = false;
    const step = (yawOff: number) => {
      t += dt;
      pool.now = t;
      virtualMs = t * 1000;
      camera.position.copy(pos);
      const yaw = heading + yawOff;
      camera.lookAt(pos.x + Math.cos(yaw), pos.y - 0.15, pos.z + Math.sin(yaw));
      mgr.update(pos, camera, dt);
    };
    while (!covered && t < 120) {
      step(0);
      if (mgr.nearReady(pos, 14) && mgr.coverageComplete(pos)) { covered = true; mgr.loading = false; }
    }
    const t0 = t;
    const path: THREE.Vector3[] = [];
    while (t - t0 < seconds) {
      const u = t - t0;
      heading += dt * 0.12 * Math.sin(u * 0.21);
      pos.x += Math.cos(heading) * 9.8 * dt;
      pos.z += Math.sin(heading) * 9.8 * dt;
      step(1.2 * Math.sin(u * 0.6));
      path.push(pos.clone());
    }
    const out = { covered, log: pool.log.slice(), hash: hashRequests(pool.log), path, mgr };
    mgr.dispose();
    return out;
  } finally {
    perf.now = realNow;
  }
}
