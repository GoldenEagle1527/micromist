/**
 * The dome's rules (design doc §5.6, D10): inside it the diver is free; within
 * TIDE.dome.warnM of its edge the HUD warns; once the tide has begun (the show
 * from P1, or the murk), crossing it — or being outside when it begins — takes
 * the diver: dissolved over TIDE.dome.dissolveS, then black, awake at the core
 * when the tide is over. Pure; the carried particles are the controller's.
 */
import { TIDE } from "./config";
import type { TideFrame } from "./frame";

export type DomeZone = "inside" | "edge" | "outside";

export function domeZone(dist: number, radius: number): DomeZone {
  if (dist > radius) return "outside";
  return dist >= radius - TIDE.dome.warnM ? "edge" : "inside";
}

/** The tide takes whoever is outside the dome once it has begun. */
export function tideTakes(frame: Pick<TideFrame, "state">, zone: DomeZone): boolean {
  return (frame.state === "show" || frame.state === "murk") && zone === "outside";
}

export type FateState = "free" | "dissolving" | "gone";

/** One diver's fate through a tide. */
export class DiverFate {
  private s: FateState = "free";
  private t = 0;

  get state(): FateState {
    return this.s;
  }

  /** Dissolving: 0 → 1 over TIDE.dome.dissolveS; gone: 1; free: 0. */
  get progress(): number {
    return this.s === "free" ? 0 : Math.min(1, this.t / TIDE.dome.dissolveS);
  }

  /** "dissolve" the step the tide takes the diver, "wake" the step the tide ends for a taken diver. */
  step(dt: number, frame: Pick<TideFrame, "state" | "events">, zone: DomeZone): "dissolve" | "wake" | null {
    if (this.s === "free") {
      if (!tideTakes(frame, zone)) return null;
      this.s = "dissolving";
      this.t = 0;
      return "dissolve";
    }
    this.t += Math.max(0, dt);
    if (this.s === "dissolving" && this.t >= TIDE.dome.dissolveS) this.s = "gone";
    return frame.events.includes("done") ? this.wake() : null;
  }

  private wake(): "wake" {
    this.s = "free";
    this.t = 0;
    return "wake";
  }
}
