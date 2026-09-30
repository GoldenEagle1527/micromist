/**
 * Loading step registry contract. Each step is one module in this folder that
 * turns the world's LoadingSnapshot into a row (status + progress), the lines of the
 * focus card and entries for the diagnostics drawer. Register it in index.ts.
 */
import type { LoadingSnapshot } from "../../../scene/world";
import type { RegionKey } from "../../../terrain/regions";
import type { LightMode } from "../../../survival";
import type { LoadingDict, StepId } from "../i18n";
import type { StepSpec } from "../loadingModel";

export type LoadingLabels = LoadingDict & {
  regionNames: Record<RegionKey, string>;
  lightModes: Record<LightMode, string>;
  /** Map legend for lost caches (conserve; shown only when there are any). */
  mapCache?: string;
};

/** What a step sees besides the snapshot. */
export type StepContext = {
  L: LoadingLabels;
  seedText: string;
  seed: number;
  /** Region-map raster rows done / total (drawn by the screen in time slices). */
  mapRows: number;
  mapSize: number;
};

/** Buttons a step can offer (wired by the screen). */
export type StepAction = "retryMaterials" | "diveAnyway";

export type DiagEntry = { label: string; value: string };

export type StepEval = {
  /** pending: not started · active: working · done · warn: finished degraded · error: stuck */
  state: "pending" | "active" | "done" | "warn" | "error";
  /** Units of real work (progress = done / total, monotonic in the model). */
  done?: number;
  total?: number;
  /** Focus-card lines (only the focused step shows them). */
  lines: string[];
  /** Diagnostics drawer entries (GPU facts, full logs, file paths). */
  diag?: DiagEntry[];
  actions?: StepAction[];
};

export type LoadingStepDef = StepSpec & {
  /** Row name: L.steps[id] (add new ids to StepId and both dictionaries in ../i18n.ts). */
  readonly id: StepId;
  /**
   * Optional steps never hold the dive on failure: they settle as "warn". Required
   * steps must reach "done" (or, when `bypassable`, the player may dive anyway).
   */
  readonly required: boolean;
  /** An error here can be overridden by "Dive anyway" (shader failures). */
  readonly bypassable?: boolean;
  evaluate(snap: LoadingSnapshot | null, ctx: StepContext): StepEval;
};
