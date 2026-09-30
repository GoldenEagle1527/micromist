/**
 * What the HUD reads of the tide (ui/tide), polled like the dive telemetry.
 * Plain data, types only.
 */
import type { DomeZone, FateState, GenerationSummary, TideFallback, TidePhase, TideState } from "../../conserve";

export type TideTelemetry = {
  state: TideState;
  /** Warning: seconds left, and whether it runs past its 60 s (「潮在积蓄」). */
  left: number;
  extended: boolean;
  phase: TidePhase | null;
  u: number;
  fallback: TideFallback | null;
  /** The diver against the dome (null without a base). */
  zone: DomeZone | null;
  fate: FateState;
  fateU: number;
  /** The generation being played. */
  gen: number;
  /** The last tide's summary: shown in P5 and for a while after (null otherwise). */
  summary: GenerationSummary | null;
  /** 唤潮 is possible now (ready, at the base, no tide running). */
  callable: boolean;
};
