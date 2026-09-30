/**
 * The tide's state machine (design doc §5.5, plan M7): the warning (P0, 60 s,
 * extended by up to 30 s while gen + 1 is not precomputed), then the show
 * (P1 吸气 … P5 平息, ~35 s) or the murk (浊潮, ~12 s), then done. Pure and
 * clock-free: the owner steps it with dt and the frame's facts.
 *
 * Save order: `commit` is emitted in the step that ends the warning, before any
 * show frame, so gen + 1 is on disk before P1 (a page closed during the show
 * cold-starts in the new generation; closed during P0 it is still the old one).
 *
 * Murk triggers: the debug panel's simple tide, a low-memory device, the precompute not done at
 * +30 s, the frame-time governor (TIDE.governor), a lost WebGL context. A context
 * lost during the show switches at once and ends the tide.
 */
import { TIDE, phaseStarts, TIDE_PHASES, type TidePhase } from "./config";
import type { TideEvent, TideFallback, TideFrame, TideState, TideStepInput } from "./frame";
import { FrameGovernor } from "./governor";

export type TideStart = { simple: boolean; lowMemory: boolean };

const G = TIDE.governor;
const { starts: STARTS, total: SHOW_S } = phaseStarts();

export class TideMachine {
  private state: TideState = "idle";
  private t = 0;
  private extended = false;
  private forced: TideFallback | null = null;
  private fallback: TideFallback | null = null;
  private committed = false;
  private swapped = false;
  private lost = false;
  private swapAt = -1;
  private pending: TideEvent[] = [];
  private readonly gov = new FrameGovernor(Math.max(G.warnWindowS, G.showWindowS) + 1);

  /** Warning, show or murk (the done frame is already over). */
  get active(): boolean {
    return this.state === "warning" || this.state === "show" || this.state === "murk";
  }

  /** Begin the warning; false while a tide is already running. */
  start(o: TideStart): boolean {
    if (this.active) return false;
    this.state = "warning";
    this.t = 0;
    this.extended = this.committed = this.swapped = this.lost = false;
    this.fallback = null;
    this.swapAt = -1;
    this.forced = o.simple ? "simple" : o.lowMemory ? "memory" : null;
    this.gov.reset();
    this.pending = ["precompute"];
    return true;
  }

  step(i: TideStepInput): TideFrame {
    const events = this.pending;
    this.pending = [];
    if (this.state === "done") this.state = "idle";
    if (this.state === "idle") return this.frame(events);
    this.t += Math.max(0, i.dt);
    this.gov.push(i.frameMs);
    this.lost ||= i.contextLost;
    if (this.state === "warning") this.stepWarning(i, events);
    else if (this.state === "show") this.stepShow(events);
    else this.stepMurk(i, events);
    return this.frame(events);
  }

  private stepWarning(i: TideStepInput, events: TideEvent[]): void {
    if (this.t < TIDE.warnS) return;
    const timeout = this.t >= TIDE.warnS + TIDE.extendS;
    if (!i.nextReady && !timeout && !this.forced && !this.lost) {
      this.extended = true;
      return;
    }
    this.fallback = this.forced ?? (this.lost ? "gpu" : !i.nextReady ? "timeout" : this.gov.slow(G.warnWindowS, G.warnMaxMs) ? "perf" : null);
    this.committed = true;
    events.push("commit");
    this.enter(this.fallback ? "murk" : "show");
  }

  private stepShow(events: TideEvent[]): void {
    if (this.lost) return this.abort(events);
    if (!this.swapped && this.t >= STARTS[TIDE.swapPhase]) this.swap(events);
    if (!this.swapped && this.t >= G.showWindowS && this.gov.slow(G.showWindowS, G.showMaxMs)) {
      this.fallback = "perf";
      return this.enter("murk");
    }
    if (this.t >= SHOW_S) this.finish(events);
  }

  private stepMurk(i: TideStepInput, events: TideEvent[]): void {
    if (this.lost) return this.abort(events);
    const M = TIDE.murk;
    if (!this.swapped) {
      const held = this.t - M.darkS;
      if (held >= M.holdMinS && (i.nextReady || held >= M.holdMaxS)) this.swap(events);
    } else if (this.t - this.swapAt >= M.clearS) this.finish(events);
  }

  private enter(state: "show" | "murk"): void {
    this.state = state;
    this.t = 0;
  }

  private swap(events: TideEvent[]): void {
    this.swapped = true;
    this.swapAt = this.t;
    events.push("swap");
  }

  /** Context lost mid-tide: switch now and end (no show to watch). */
  private abort(events: TideEvent[]): void {
    if (!this.swapped) this.swap(events);
    this.finish(events);
  }

  private finish(events: TideEvent[]): void {
    this.state = "done";
    events.push("done");
  }

  private frame(events: readonly TideEvent[]): TideFrame {
    const { state, t } = this;
    const show = state === "show";
    const phase = show ? phaseAt(t) : null;
    const M = TIDE.murk;
    const dark = state !== "murk" ? 0 : !this.swapped ? Math.min(1, t / M.darkS) : Math.max(0, 1 - (t - this.swapAt) / M.clearS);
    return {
      state,
      t,
      left: state === "warning" ? Math.max(0, (this.extended ? TIDE.warnS + TIDE.extendS : TIDE.warnS) - t) : 0,
      extended: state === "warning" && this.extended,
      phase,
      u: phase ? Math.min(1, (t - STARTS[phase]) / TIDE.phaseS[phase]) : 0,
      showT: show ? t : -1,
      dark,
      committed: this.committed,
      swapped: this.swapped,
      fallback: this.fallback,
      events,
    };
  }
}

/** The show's phase at t seconds (the last one past the end). */
export function phaseAt(t: number): TidePhase {
  let p: TidePhase = TIDE_PHASES[0];
  for (const q of TIDE_PHASES) if (t >= STARTS[q]) p = q;
  return p;
}

export const SHOW_SECONDS = SHOW_S;
