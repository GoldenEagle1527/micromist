/**
 * The gaze (直视) as saved with the generation's chaos (chaos.gaze): the game
 * seconds played since the eye turned, and which 封界 anchors are lit. Present
 * exactly while the generation is at stage 5; a tide that seals clears it.
 * Pure.
 */
import { GAZE, type GazePhase } from "./config";

export type GazeState = {
  /** Game seconds of the sequence played (0 … GAZE.duration). */
  elapsed: number;
  /** The four anchors beyond the breach, lit or not. */
  anchors: boolean[];
};

export function freshGaze(elapsed = 0): GazeState {
  return { elapsed, anchors: new Array<boolean>(GAZE.anchors.count).fill(false) };
}

export function cloneGaze(g: GazeState): GazeState {
  return { elapsed: g.elapsed, anchors: g.anchors.slice() };
}

export function phaseOf(elapsed: number): GazePhase {
  const p = GAZE.phases;
  return (elapsed >= p[3] ? 3 : elapsed >= p[2] ? 2 : elapsed >= p[1] ? 1 : 0) as GazePhase;
}

/** 0 … 1 through the current phase. */
export function phaseProgress(elapsed: number): number {
  const ph = phaseOf(elapsed), p = GAZE.phases;
  const end = ph === 3 ? GAZE.duration : p[ph + 1];
  return Math.min(1, Math.max(0, (elapsed - p[ph]) / (end - p[ph])));
}

export function litCount(g: GazeState): number {
  return g.anchors.filter(Boolean).length;
}

/** Shape check (save validation). */
export function isGazeState(v: unknown): v is GazeState {
  if (typeof v !== "object" || v === null) return false;
  const g = v as Record<string, unknown>;
  const elapsed = g.elapsed, anchors = g.anchors;
  return typeof elapsed === "number" && Number.isFinite(elapsed) && elapsed >= 0 && Array.isArray(anchors) && anchors.length === GAZE.anchors.count && anchors.every((a) => typeof a === "boolean");
}
