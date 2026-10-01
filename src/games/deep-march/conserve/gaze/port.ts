/**
 * What the scene and the HUD see of the gaze (types only): the phase and time
 * left, the 封界 conditions, the anchors, the squeeze under way, the ending.
 * `rehearsal`: the staging debug panel's 结局演练 controls (a sandboxed copy of
 * the save, session/rehearsal.ts) — null in every real dive.
 */
import type { GazePhase } from "./config";
import type { SqueezeStage } from "./assault";
import type { AnchorPoint } from "./anchors";

export type GazeInput = {
  dt: number;
  diver: AnchorPoint;
  /** Interact held (E / the hold button): lights an anchor within reach. */
  interact: boolean;
  /** A tide is running: the sequence waits. */
  tide: boolean;
};

export type GazeView = {
  /** A gaze is on (stage 5 and not ended). */
  active: boolean;
  phase: GazePhase;
  /** 0 … 1 through the phase; seconds played and left (of GAZE.duration). */
  phaseU: number;
  elapsed: number;
  left: number;
  /** 归还: the forecast m against the seal's. */
  forecastM: number;
  sealM: number;
  anchors: readonly (AnchorPoint & { lit: boolean })[];
  lit: number;
  /** Both conditions hold: the 封界潮 comes when the diver is back under the dome (`anywhere`: at once). */
  sealReady: boolean;
  anywhere: boolean;
  /** An anchor's price per kind index (from the tank). */
  price: readonly number[];
  /** The unlit anchor within reach (−1 none), the hold so far (0 … 1), the tank can't pay for it. */
  reach: number;
  hold: number;
  short: boolean;
  /** The building being squeezed (③). */
  squeeze: { id: number; stage: SqueezeStage; u: number; pos: readonly [number, number, number] } | null;
  /** 湮灭 happened: the save is ended, nothing more is written. */
  ended: boolean;
};

export type GazeRehearsal = {
  /** Skip ahead in the sequence (s). */
  skip(seconds: number): void;
  lightAll(): void;
  /** 放流 from base storage until the forecast m reaches the seal's. */
  returnParticles(): void;
  annihilate(): void;
  /** Both conditions at once, and the 封界潮 called wherever the diver is. */
  seal(): void;
};

export interface GazePort {
  tick(i: GazeInput): GazeView;
  view(): GazeView;
  readonly rehearsal: GazeRehearsal | null;
}
