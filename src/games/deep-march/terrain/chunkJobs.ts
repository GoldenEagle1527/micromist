/**
 * Column build jobs (chunks.ts): the priority queue (popped from its end), the
 * in-flight id map, and dispatch to the JobPool (Web Workers, jobPool.ts) or, when
 * no worker is alive, to the main thread under MAIN_THREAD_BUDGET_MS. Jobs lost by
 * a dying worker go back on the queue.
 */
import type { MesherResponse } from "./protocol";
import type { JobPool, JobRequest } from "./jobPool";
import { MAIN_THREAD_BUDGET_MS, type ChunkNode } from "./chunkNode";
import type { LocalMesher } from "./chunkUpload";

export class ChunkJobs {
  queue: ChunkNode[] = [];
  readonly byId = new Map<number, ChunkNode>();
  /** Finished jobs waiting for upload. */
  readonly results: MesherResponse[] = [];
  readonly pool: JobPool;
  private readonly local: LocalMesher;
  private nextId = 1;

  constructor(pool: JobPool, local: LocalMesher) {
    this.pool = pool;
    this.local = local;
    this.pool.onLost = (ids) => {
      for (const id of ids) {
        const node = this.byId.get(id);
        if (!node || node.state !== "pending") continue;
        this.byId.delete(id);
        node.state = "queued";
        this.queue.push(node);
      }
    };
  }

  dispatch(nodes: Map<string, ChunkNode>) {
    if (this.pool.live() === 0) {
      const t0 = performance.now();
      while (this.queue.length && performance.now() - t0 < MAIN_THREAD_BUDGET_MS) {
        const e = this.queue.pop()!;
        if (e.state !== "queued" || nodes.get(e.key) !== e) continue;
        e.id = this.nextId++;
        this.byId.set(e.id, e);
        e.state = "pending";
        this.results.push(this.local.generate(e));
      }
      return;
    }
    while (this.pool.free() > 0 && this.queue.length) {
      const e = this.queue.pop()!;
      if (e.state !== "queued" || nodes.get(e.key) !== e) continue;
      e.id = this.nextId++;
      e.state = "pending";
      this.byId.set(e.id, e);
      const req: JobRequest = e.kind === "info" ? { type: "info", id: e.id, cx: e.cx, cz: e.cz } : { type: "column", id: e.id, cx: e.cx, cz: e.cz, lod: e.lod };
      this.pool.submit(req);
    }
  }
}
