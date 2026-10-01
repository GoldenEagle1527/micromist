/**
 * What the HUD reads of the gaze (ui/gaze), polled like the dive telemetry.
 * Plain data, types only.
 */
import type { GazeView } from "../../conserve";

export type GazeTelemetry = GazeView & {
  /** The 封界潮 is running / finished in this dive (the seal's closing lines). */
  sealing: boolean;
  sealed: boolean;
  /** Seconds since 湮灭 (0 before): the ending's lines follow it. */
  endedFor: number;
};
