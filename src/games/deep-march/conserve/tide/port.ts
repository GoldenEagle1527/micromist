/**
 * What the scene sees of the tide (plan M7), type-only. The object is the
 * session's TideController, wrapped with the terrain layout of gen + 1
 * (platform/tidePort.ts).
 */
import type { TideReadiness } from "../base/port";
import type { FateState, DomeZone } from "./dome";
import type { TideFrame, TideStepInput } from "./frame";
import type { TideStart } from "./machine";
import type { GenerationSummary } from "./plan";

export type { DomeZone, FateState, GenerationSummary, TideStart };

export type TideInput = TideStepInput & {
  /** The diver (world x / z, m). */
  diver: { x: number; z: number };
};

export type TideView = TideFrame & {
  /** The generation being played (gen + 1 once committed). */
  gen: number;
  /** The dome: the base core and its protection radius; the diver's zone. Null without a base. */
  dome: { x: number; y: number; z: number; radius: number; zone: DomeZone } | null;
  fate: FateState;
  /** Dissolving progress 0 … 1. */
  fateU: number;
  /** This step: particles the tide took from the tank (P → S of gen + 1), and the wake at the core. */
  dissolved: number;
  wake: boolean;
};

export interface TideControlPort {
  readiness(): TideReadiness;
  /** A tide is running (warning, show or murk). */
  active(): boolean;
  /** 唤潮: start the warning (false when not ready or already running). */
  call(o: TideStart): boolean;
  /** Per frame while active (idle frames are cheap). */
  step(i: TideInput): TideView;
  /** The generation summary of the last commit (null before). */
  summary(): GenerationSummary | null;
}
