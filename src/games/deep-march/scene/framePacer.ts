/**
 * Frame pacing for the render loop:
 *  - caps rendering at `maxFps` (drift-corrected, so 120/144 Hz displays average 60);
 *  - adaptive resolution: lowers the pixel ratio in steps when rendered frames can't
 *    hold the cap, raises it again once they hold it steadily (with a growing
 *    cooldown so it doesn't oscillate). A fixed ratio (?dpr=) disables adaptation.
 */
export type FramePacerOptions = {
  maxFps: number;
  minRatio: number;
  maxRatio: number;
  /** Fixed pixel ratio (debug / screenshots): no adaptation. */
  fixed?: number;
};

const STEP = 0.125;
const WINDOW_MS = 1000;
/** Lower when the window's mean frame interval exceeds cap × this (≈ 53 fps at a 60 cap). */
const SLOW = 1.12;
/** Count a window as "holding the cap" below cap × this. */
const HOLD = 1.05;
const HOLD_WINDOWS = 3;

export class FramePacer {
  ratio: number;
  private readonly opts: FramePacerOptions;
  private readonly interval: number;
  private next = 0;
  private lastRender = -1;
  private winStart = -1;
  private winSum = 0;
  private winCount = 0;
  private holdWindows = 0;
  private cooldownUntil = 0;
  private cooldown = 4000;
  private lastRaise = -1e9;

  constructor(opts: FramePacerOptions) {
    this.opts = opts;
    this.interval = 1000 / opts.maxFps;
    this.ratio = opts.fixed ?? opts.maxRatio;
  }

  /** Call on every rAF; false = skip this frame (cap). */
  shouldRender(now: number): boolean {
    if (now + 1 < this.next) return false;
    this.next = now - this.next > this.interval ? now + this.interval : this.next + this.interval;
    return true;
  }

  /** Forget timing history (after a pause / tab switch). */
  reset(now: number) {
    this.next = now;
    this.lastRender = -1;
    this.winStart = -1;
    this.winSum = 0;
    this.winCount = 0;
    this.holdWindows = 0;
  }

  /**
   * Call after each rendered frame. Returns true when the pixel ratio changed
   * (the caller resizes the renderer).
   */
  frameDone(now: number): boolean {
    const prev = this.lastRender;
    this.lastRender = now;
    if (this.opts.fixed !== undefined || prev < 0) return false;
    if (this.winStart < 0) this.winStart = now;
    this.winSum += now - prev;
    this.winCount++;
    if (now - this.winStart < WINDOW_MS) return false;
    const mean = this.winSum / this.winCount;
    this.winStart = now;
    this.winSum = 0;
    this.winCount = 0;
    const { minRatio, maxRatio } = this.opts;
    if (mean > this.interval * SLOW) {
      this.holdWindows = 0;
      if (this.ratio <= minRatio) return false;
      // dropped soon after a raise → the raise was too optimistic: back off longer
      if (now - this.lastRaise < 6000) this.cooldown = Math.min(this.cooldown * 2, 64000);
      this.cooldownUntil = now + this.cooldown;
      this.ratio = Math.max(minRatio, this.ratio - STEP);
      return true;
    }
    if (mean < this.interval * HOLD) {
      this.holdWindows++;
      if (this.holdWindows >= HOLD_WINDOWS && now >= this.cooldownUntil && this.ratio < maxRatio) {
        this.holdWindows = 0;
        this.lastRaise = now;
        this.ratio = Math.min(maxRatio, this.ratio + STEP);
        return true;
      }
    } else this.holdWindows = 0;
    return false;
  }
}
