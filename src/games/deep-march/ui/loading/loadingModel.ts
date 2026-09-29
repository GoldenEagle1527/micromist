/**
 * Loading-screen step model (pure, node-tested): status per registered step
 * (pending / active / done / warn / error), monotonic progress and the weighted
 * overall bar. Steps come from the registry (steps/index.ts); weights are relative
 * and normalized here, so adding a step never needs the others retuned. Steps may
 * run in parallel (textures download while the map and terrain are built); the UI
 * lists them in registry order.
 */
export type StepStatus = "pending" | "active" | "done" | "warn" | "error";

/** What the model needs to know about a step. */
export type StepSpec = {
  readonly id: string;
  /** Relative share of the overall bar (roughly the time the step takes). */
  readonly weight: number;
};

/** Progress shown for a step that reports full completion but isn't confirmed done yet. */
const UNCONFIRMED_MAX = 0.99;

/** Finished for the gate: done, or done with a warning (optional step that fell back). */
export const settled = (s: StepStatus) => s === "done" || s === "warn";

export class LoadingModel {
  readonly ids: readonly string[];
  readonly status: Record<string, StepStatus> = {};
  readonly progress: Record<string, number> = {};
  private readonly share: Record<string, number> = {};

  constructor(steps: readonly StepSpec[]) {
    this.ids = steps.map((s) => s.id);
    const sum = steps.reduce((s, d) => s + Math.max(0, d.weight), 0);
    for (const d of steps) {
      this.status[d.id] = "pending";
      this.progress[d.id] = 0;
      this.share[d.id] = sum > 0 ? Math.max(0, d.weight) / sum : 1 / steps.length;
    }
  }

  /** Normalized share of the overall bar (all shares sum to 1). */
  weight(id: string): number {
    return this.share[id] ?? 0;
  }

  /** Step `id` has done / total units of real work (never goes backwards). */
  report(id: string, done: number, total: number) {
    if (settled(this.status[id])) return;
    if (this.status[id] === "pending") this.status[id] = "active";
    const f = total > 0 ? Math.min(UNCONFIRMED_MAX, Math.max(0, done / total)) : 0;
    if (f > this.progress[id]) this.progress[id] = f;
  }

  /** Mark a step started without measurable progress yet. */
  start(id: string) {
    if (this.status[id] === "pending") this.status[id] = "active";
  }

  complete(id: string) {
    if (this.status[id] === "warn") return;
    this.status[id] = "done";
    this.progress[id] = 1;
  }

  /** Finished, but degraded (e.g. sounds missing → silent dive). Counts as settled. */
  warn(id: string) {
    if (this.status[id] === "done") return;
    this.status[id] = "warn";
    this.progress[id] = 1;
  }

  fail(id: string) {
    if (!settled(this.status[id])) this.status[id] = "error";
  }

  /** Error cleared (e.g. retry started): back to active, progress kept. */
  recover(id: string) {
    if (this.status[id] === "error") this.status[id] = "active";
  }

  overall(): number {
    let s = 0;
    for (const id of this.ids) s += this.share[id] * this.progress[id];
    // normalized shares may sum to 1 − ε in floating point
    return this.allDone() ? 1 : Math.min(1, s);
  }

  /** Every step done or warned. */
  allDone(): boolean {
    return this.ids.every((id) => settled(this.status[id]));
  }

  /** The step to headline: first error, else first active, else first pending (null = all settled). */
  focus(): string | null {
    const find = (s: StepStatus) => this.ids.find((id) => this.status[id] === s);
    return find("error") ?? find("active") ?? find("pending") ?? null;
  }
}

/** Bytes → "12.3" (MB, 1 decimal). */
export function formatMB(bytes: number): string {
  return (bytes / 1e6).toFixed(1);
}
