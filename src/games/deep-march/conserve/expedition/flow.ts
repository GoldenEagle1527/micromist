/**
 * Hold-to-absorb pacing: a steady rate (particles / s) turned into whole
 * particles per frame. Credit carries between frames; whatever cannot move
 * (target empty, tank full, pool short) is dropped, never banked.
 */
export class FlowMeter {
  private credit = 0;
  private target = -1;

  /** Whole particles due this step toward `target` at `rate` / s, at most `limit`. */
  step(target: number, rate: number, dt: number, limit: number): number {
    if (target !== this.target) {
      this.target = target;
      this.credit = 0;
    }
    this.credit += Math.max(0, rate) * Math.max(0, dt);
    const due = Math.floor(this.credit + 1e-9);
    const n = Math.max(0, Math.min(due, limit));
    this.credit = n < due ? 0 : Math.max(0, this.credit - n);
    return n;
  }

  reset(): void {
    this.credit = 0;
    this.target = -1;
  }
}
