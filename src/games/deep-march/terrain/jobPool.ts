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

/**
 * Mesher workers for this device. Desktop: min(4, cores − 2) keeps two cores for
 * the main thread + GPU driver (6 workers made the main thread stutter while
 * streaming); low-spec: 2. 0 without Worker support (main-thread fallback).
 */
export function mesherWorkerCount(lowSpec: boolean): number {
  if (typeof Worker === "undefined") return 0;
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  return lowSpec ? Math.max(1, Math.min(2, cores - 1)) : Math.max(1, Math.min(4, cores - 2));
}

/** A pool whose workers can hold several terrain generations (poolRouter.ts). */
export interface GenerationHost {
  addGen(gen: number, layout: SiteLayout | null): void;
  dropGen(gen: number): void;
}

type Slot = { worker: Worker; inFlight: Set<number>; alive: boolean };

export class WorkerPool implements JobPool, GenerationHost {
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

  addGen(gen: number, layout: SiteLayout | null) {
    this.post({ type: "addGen", gen, layout });
  }

  dropGen(gen: number) {
    this.post({ type: "dropGen", gen });
  }

  private post(msg: MesherRequest) {
    for (const s of this.slots) if (s.alive) s.worker.postMessage(msg);
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
