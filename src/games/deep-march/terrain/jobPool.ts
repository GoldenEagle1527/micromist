/**
 * Where column / info jobs run (chunks.ts). The ChunkManager only schedules:
 * it hands requests to a JobPool while the pool has free slots and collects
 * finished responses once per frame.
 * - WorkerPool: the Web Worker pool used in the game;
 * - tests inject a simulated pool (virtual job times) to exercise the scheduler.
 *
 * Cancellation: the manager drops stale queued jobs and discards stale results.
 * A job already running in a worker can't be interrupted cheaply: without
 * cross-origin isolation (no COOP/COEP on the site → no SharedArrayBuffer) a
 * worker never sees a message until its current job returns, so `cancel()` only
 * removes the id from the pool's bookkeeping.
 */
import type { TerrainSettings } from "./config";
import type { MesherRequest, MesherResponse } from "./protocol";
import type { SiteLayout } from "./siteLayout";

export type JobRequest = Extract<MesherRequest, { type: "column" } | { type: "info" }>;

export interface JobPool {
  /** Live slots; 0 → the manager builds on the main thread instead. */
  live(): number;
  /** Slots able to take a job right now. */
  free(): number;
  submit(req: JobRequest): void;
  /** Move the responses finished since the last call into `out`. */
  drain(out: MesherResponse[]): void;
  /** Job ids lost with a crashed slot (the manager requeues them). */
  onLost: ((ids: number[]) => void) | null;
  dispose(): void;
}

const MAX_IN_FLIGHT_PER_WORKER = 1;

type Slot = { worker: Worker; inFlight: Set<number>; alive: boolean };

export class WorkerPool implements JobPool {
  private readonly slots: Slot[] = [];
  private readonly done: MesherResponse[] = [];
  onLost: ((ids: number[]) => void) | null = null;

  constructor(seed: number, settings: TerrainSettings, count: number, layout: SiteLayout | null = null) {
    for (let i = 0; i < count; i++) {
      try {
        const worker = new Worker(new URL("./mesher.worker.ts", import.meta.url), { type: "module" });
        const slot: Slot = { worker, inFlight: new Set(), alive: true };
        worker.onmessage = (ev: MessageEvent<MesherResponse>) => {
          slot.inFlight.delete(ev.data.id);
          this.done.push(ev.data);
        };
        worker.onerror = (ev) => {
          ev.preventDefault();
          this.kill(slot);
        };
        const init: MesherRequest = { type: "init", seed, settings, layout };
        worker.postMessage(init);
        this.slots.push(slot);
      } catch {
        break;
      }
    }
  }

  private kill(slot: Slot) {
    if (!slot.alive) return;
    slot.alive = false;
    slot.worker.terminate();
    const ids = [...slot.inFlight];
    slot.inFlight.clear();
    if (ids.length) this.onLost?.(ids);
  }

  live(): number {
    let n = 0;
    for (const s of this.slots) if (s.alive) n++;
    return n;
  }

  free(): number {
    let n = 0;
    for (const s of this.slots) if (s.alive) n += Math.max(0, MAX_IN_FLIGHT_PER_WORKER - s.inFlight.size);
    return n;
  }

  submit(req: JobRequest) {
    let best: Slot | null = null;
    for (const s of this.slots) if (s.alive && s.inFlight.size < MAX_IN_FLIGHT_PER_WORKER && (!best || s.inFlight.size < best.inFlight.size)) best = s;
    if (!best) throw new Error("WorkerPool.submit: no free slot");
    best.inFlight.add(req.id);
    best.worker.postMessage(req);
  }

  drain(out: MesherResponse[]) {
    for (const r of this.done) out.push(r);
    this.done.length = 0;
  }

  dispose() {
    for (const s of this.slots) {
      s.alive = false;
      s.worker.terminate();
    }
  }
}
