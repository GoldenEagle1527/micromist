/**
 * Frame-time governor (the tide's measurable performance criterion, TIDE.governor):
 * a sliding window of frame times; `mean(windowS)` over the frames of the last
 * windowS seconds. Pure — the scene feeds it the raw frame intervals.
 */
export class FrameGovernor {
  private readonly ms: number[] = [];
  private readonly span: number;

  /** span: seconds of history kept (≥ every window asked for). */
  constructor(spanS: number) {
    this.span = spanS * 1000;
  }

  push(frameMs: number): void {
    if (!(frameMs > 0) || !Number.isFinite(frameMs)) return;
    this.ms.push(frameMs);
    let sum = 0;
    for (let i = this.ms.length - 1; i >= 0; i--) {
      sum += this.ms[i];
      if (sum > this.span) {
        this.ms.splice(0, i);
        break;
      }
    }
  }

  /** Mean frame time (ms) over the last windowS seconds; 0 until that much time was seen. */
  mean(windowS: number): number {
    const want = windowS * 1000;
    let sum = 0, n = 0;
    for (let i = this.ms.length - 1; i >= 0 && sum < want; i--, n++) sum += this.ms[i];
    return sum >= want && n > 0 ? sum / n : 0;
  }

  /** The window's mean exceeds maxMs (false while the window is not full). */
  slow(windowS: number, maxMs: number): boolean {
    return this.mean(windowS) > maxMs;
  }

  reset(): void {
    this.ms.length = 0;
  }
}
