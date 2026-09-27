/**
 * Loading-screen step model (pure, node-tested): the five real initialization
 * steps, their status (pending / active / done / error), monotonic progress and the
 * weighted overall bar. Steps may run in parallel (textures download while the map
 * and terrain are built); the UI lists them in order.
 */
export type StepId = "coords" | "regions" | "materials" | "terrain" | "system";
export type StepStatus = "pending" | "active" | "done" | "error";

export const STEPS: readonly StepId[] = ["coords", "regions", "materials", "terrain", "system"];

/** Share of the overall bar (sums to 1; roughly the time each step takes). */
export const STEP_WEIGHT: Readonly<Record<StepId, number>> = { coords: 0.04, regions: 0.12, materials: 0.5, terrain: 0.29, system: 0.05 };

/** Progress shown for a step that reports full completion but isn't confirmed done yet. */
const UNCONFIRMED_MAX = 0.99;

const record = <T,>(v: T): Record<StepId, T> => ({ coords: v, regions: v, materials: v, terrain: v, system: v });

export class LoadingModel {
  readonly status: Record<StepId, StepStatus> = record<StepStatus>("pending");
  readonly progress: Record<StepId, number> = record(0);

  /** Step `id` has done / total units of real work (never goes backwards). */
  report(id: StepId, done: number, total: number) {
    if (this.status[id] === "done") return;
    if (this.status[id] === "pending") this.status[id] = "active";
    const f = total > 0 ? Math.min(UNCONFIRMED_MAX, Math.max(0, done / total)) : 0;
    if (f > this.progress[id]) this.progress[id] = f;
  }

  /** Mark a step started without measurable progress yet. */
  start(id: StepId) {
    if (this.status[id] === "pending") this.status[id] = "active";
  }

  complete(id: StepId) {
    this.status[id] = "done";
    this.progress[id] = 1;
  }

  fail(id: StepId) {
    if (this.status[id] !== "done") this.status[id] = "error";
  }

  /** Error cleared (e.g. retry started): back to active, progress kept. */
  recover(id: StepId) {
    if (this.status[id] === "error") this.status[id] = "active";
  }

  overall(): number {
    let s = 0;
    for (const id of STEPS) s += STEP_WEIGHT[id] * this.progress[id];
    return Math.min(1, s);
  }

  allDone(): boolean {
    return STEPS.every((id) => this.status[id] === "done");
  }

  /** The step to headline: first error, else first active, else first pending (null = all done). */
  focus(): StepId | null {
    return STEPS.find((id) => this.status[id] === "error") ?? STEPS.find((id) => this.status[id] === "active") ?? STEPS.find((id) => this.status[id] === "pending") ?? null;
  }
}

/** Bytes → "12.3" (MB, 1 decimal). */
export function formatMB(bytes: number): string {
  return (bytes / 1e6).toFixed(1);
}
