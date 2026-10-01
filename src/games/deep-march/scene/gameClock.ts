/**
 * The dive's one game clock (≡ menu pause, hidden tab). Every game timer — the
 * dive loop's simulation (survival battery drain, the conserve layer and base
 * energy, the tide's timeline, the chaos schedulers, sonar pulses and their
 * cooldown) — reads its time from here or from the loop that does, so a pause
 * freezes them all at once and they continue where they stopped: paused time
 * is cut out of the timeline. UI timers follow through `subscribe` (useOnce).
 * Single player only: a multiplayer dive must never hold "menu" (none exists).
 */
export type PauseReason = "menu" | "hidden";

/** What readers get: the time (ms, frozen while paused), the state and its changes. */
export type ClockView = {
  now(): number;
  readonly paused: boolean;
  /** Called with the new state on every pause / resume; returns the unsubscribe. */
  subscribe(fn: (paused: boolean) => void): () => void;
};

export class GameClock implements ClockView {
  private readonly holds = new Set<PauseReason>();
  private readonly fns = new Set<(paused: boolean) => void>();
  private readonly raw: () => number;
  /** Paused time cut out so far (ms), and when the current pause began (raw ms). */
  private cut = 0;
  private since = 0;

  constructor(raw: () => number = () => performance.now()) {
    this.raw = raw;
  }

  get paused(): boolean {
    return this.holds.size > 0;
  }

  /** Game time (ms): the raw clock minus every pause; constant while paused. */
  now(): number {
    return (this.paused ? this.since : this.raw()) - this.cut;
  }

  /** Whether `reason` holds the clock. */
  held(reason: PauseReason): boolean {
    return this.holds.has(reason);
  }

  hold(reason: PauseReason, on: boolean): void {
    const was = this.paused;
    if (on) this.holds.add(reason);
    else this.holds.delete(reason);
    const is = this.paused;
    if (was === is) return;
    if (is) this.since = this.raw();
    else this.cut += this.raw() - this.since;
    for (const fn of [...this.fns]) fn(is);
  }

  subscribe(fn: (paused: boolean) => void): () => void {
    this.fns.add(fn);
    return () => void this.fns.delete(fn);
  }

  /** Drop every hold and listener (the dive ends). */
  dispose(): void {
    this.holds.clear();
    this.fns.clear();
  }
}
