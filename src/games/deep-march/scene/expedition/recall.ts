/**
 * Emergency recall (plan M4's death, until oxygen and creatures exist): hold
 * the recall control (X or the HUD button) for RECALL.holdSeconds and the
 * suit's beacon fires — the screen goes black, everything in the tank is left
 * behind as a lost cache where the diver was (P → L, the port evicts the
 * oldest beyond 5), the diver wakes at the dive's start point with a full
 * battery, and the screen fades back in. Pure timing: the scene supplies the
 * effect (`fire`) and draws `blackout()`.
 */
import { RECALL } from "./config";

export type RecallPhase = "idle" | "holding" | "out" | "dark" | "in";

export class RecallSequence {
  private phase: RecallPhase = "idle";
  private t = 0;
  private fired = false;

  /** `hold`: the control is down; `fire` runs once, in the dark. */
  update(dt: number, hold: boolean, enabled: boolean, fire: () => void): void {
    switch (this.phase) {
      case "idle":
        if (enabled && hold) this.go("holding");
        break;
      case "holding":
        if (!enabled || !hold) this.go("idle");
        else if ((this.t += dt) >= RECALL.holdSeconds) this.go("out");
        break;
      case "out":
        if ((this.t += dt) >= RECALL.fadeOut) this.go("dark");
        break;
      case "dark":
        if (!this.fired) {
          this.fired = true;
          fire();
        }
        if ((this.t += dt) >= RECALL.hold) this.go("in");
        break;
      case "in":
        if ((this.t += dt) >= RECALL.fadeIn) this.go("idle");
        break;
    }
  }

  private go(p: RecallPhase): void {
    this.phase = p;
    this.t = 0;
    if (p === "out") this.fired = false;
  }

  current(): RecallPhase {
    return this.phase;
  }

  /** Hold progress 0..1 (1 once the beacon fired, until the fade-in ends). */
  progress(): number {
    if (this.phase === "holding") return Math.min(1, this.t / RECALL.holdSeconds);
    return this.phase === "idle" ? 0 : 1;
  }

  /** The diver can't act (black screen). */
  busy(): boolean {
    return this.phase === "out" || this.phase === "dark" || this.phase === "in";
  }

  /** Black overlay opacity 0..1. */
  blackout(): number {
    if (this.phase === "out") return Math.min(1, this.t / RECALL.fadeOut);
    if (this.phase === "dark") return 1;
    if (this.phase === "in") return 1 - Math.min(1, this.t / RECALL.fadeIn);
    return 0;
  }
}
