/**
 * What the tide looks like to the scene each frame (the state machine's output,
 * machine.ts). Plain data; the scene imports these types only.
 */
import type { TidePhase } from "./config";

export type { TidePhase };

/** idle → warning (P0) → show (P1–P5) or murk (浊潮) → done → idle. */
export type TideState = "idle" | "warning" | "show" | "murk" | "done";

/**
 * One-frame events, in the order they happen:
 * - precompute: the warning began; build gen + 1 (TidePort.nextLayout) in the background;
 * - commit: gen + 1 was written to the save (before the show: closing now cold-starts in it);
 *   the scene takes the new generation's ports;
 * - swap: terrain and collision switch to gen + 1 (P4 start, or in the murk's dark);
 * - done: the tide is over; normal streaming takes over, the old terrain is freed.
 */
export type TideEvent = "precompute" | "commit" | "swap" | "done";

/** Why the show was replaced by the murk. */
export type TideFallback = "simple" | "memory" | "timeout" | "perf" | "gpu";

export type TideStepInput = {
  /** Seconds since the last step. */
  dt: number;
  /** gen + 1's terrain covers the view (the precompute is done). */
  nextReady: boolean;
  /** The last raw frame interval (ms), for the frame-time governor. */
  frameMs: number;
  /** The WebGL context was lost. */
  contextLost: boolean;
};

export type TideFrame = {
  state: TideState;
  /** Seconds into the current state. */
  t: number;
  /** Warning: seconds until the tide (the extension adds to it). */
  left: number;
  /** The warning ran past its 60 s: 「潮在积蓄」. */
  extended: boolean;
  /** The show's phase (null outside the show) and its progress 0…1. */
  phase: TidePhase | null;
  u: number;
  /** Seconds into the show (the particles' clock), −1 outside it. */
  showT: number;
  /** Murk: darkness 0…1 (0 outside the murk). */
  dark: number;
  committed: boolean;
  swapped: boolean;
  fallback: TideFallback | null;
  events: readonly TideEvent[];
};
