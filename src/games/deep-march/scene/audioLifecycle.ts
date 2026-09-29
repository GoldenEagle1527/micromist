/**
 * Keeps the dive's AudioContext running when it should and stopped when it shouldn't.
 *
 * Holds: reasons to keep audio stopped ("hidden" tab, "gpu" context lost, "muted").
 * With no hold active the context is resumed; with any hold it is suspended.
 *
 * Resuming is not always allowed without a user gesture: iOS Safari leaves a context
 * "interrupted" after a call / app switch and may refuse resume() until the next
 * touch, so every gesture (touchend / click / pointerup / keydown: the events WebKit
 * counts as user activation, pointerdown alone is not enough there) retries it, and
 * so do statechange, visibilitychange and pageshow (back-forward cache).
 */
export type HoldReason = "hidden" | "gpu" | "muted";

/** The part of AudioContext this needs (fakeable in node tests). */
export type LifecycleContext = {
  readonly state: string;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  addEventListener(type: "statechange", fn: () => void): void;
  removeEventListener(type: "statechange", fn: () => void): void;
};

export type LifecycleEnv = {
  /** Gesture target (window). */
  win: EventTarget;
  /** visibilitychange target (document). */
  doc: EventTarget;
  isHidden: () => boolean;
};

export const UNLOCK_EVENTS = ["touchend", "click", "pointerup", "keydown"] as const;

export class AudioLifecycle {
  private readonly holds = new Set<HoldReason>();
  private disposed = false;
  private readonly ctx: LifecycleContext;
  private readonly env: LifecycleEnv;

  constructor(ctx: LifecycleContext, env: LifecycleEnv) {
    this.ctx = ctx;
    this.env = env;
    for (const t of UNLOCK_EVENTS) env.win.addEventListener(t, this.onGesture, { capture: true, passive: true });
    env.win.addEventListener("pageshow", this.onWake);
    env.doc.addEventListener("visibilitychange", this.onVisibility);
    ctx.addEventListener("statechange", this.onWake);
    if (env.isHidden()) this.holds.add("hidden");
    this.apply();
  }

  /** Audio should play: no hold and not disposed. */
  get wanted(): boolean {
    return !this.disposed && this.holds.size === 0;
  }

  hold(reason: HoldReason, on: boolean): void {
    if (on) this.holds.add(reason);
    else this.holds.delete(reason);
    this.apply();
  }

  has(reason: HoldReason): boolean {
    return this.holds.has(reason);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const t of UNLOCK_EVENTS) this.env.win.removeEventListener(t, this.onGesture, { capture: true });
    this.env.win.removeEventListener("pageshow", this.onWake);
    this.env.doc.removeEventListener("visibilitychange", this.onVisibility);
    this.ctx.removeEventListener("statechange", this.onWake);
  }

  private apply(): void {
    if (this.disposed) return;
    const s = this.ctx.state;
    if (s === "closed") return;
    if (this.wanted) {
      if (s !== "running") this.tryResume();
    } else if (s === "running") {
      this.ctx.suspend().catch(() => {});
    }
  }

  private tryResume(): void {
    try {
      // may reject without a gesture (iOS "interrupted"); the next gesture retries
      this.ctx.resume().catch(() => {});
    } catch {
      /* resume unsupported in this state */
    }
  }

  private readonly onGesture = () => {
    if (this.wanted && this.ctx.state !== "running" && this.ctx.state !== "closed") this.tryResume();
  };

  private readonly onVisibility = () => {
    this.hold("hidden", this.env.isHidden());
  };

  /** statechange / pageshow: something outside us changed the context (or the page came back). */
  private readonly onWake = () => {
    if (this.env.isHidden() !== this.holds.has("hidden")) this.onVisibility();
    else this.apply();
  };
}
