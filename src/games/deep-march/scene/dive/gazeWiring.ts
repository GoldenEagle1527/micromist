/**
 * The gaze director's wiring (conserve, stage 5; scene/gaze/): the session's
 * gaze port from the options, the base of the generation being played (new
 * after each tide), the diver's lamp.
 */
import type { Survival } from "../../survival";
import { GazeDirector, type GazeDirectorDeps } from "../gaze/gazeDirector";
import type { DeepMarchOptions } from "./types";

export type GazeWiring = Omit<GazeDirectorDeps, "port" | "base" | "lampOn"> & { survival: Survival };

export function createGazeDirector(opts: DeepMarchOptions, d: GazeWiring): GazeDirector {
  return new GazeDirector({
    ...d,
    port: opts.gaze ?? null,
    base: () => opts.tide?.ports().base ?? opts.base ?? null,
    lampOn: () => d.survival.lights.state().on,
  });
}
