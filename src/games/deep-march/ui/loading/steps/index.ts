/**
 * Loading step registry, in display order. A new loading step is one module in this
 * folder (LoadingStepDef) plus a line here and its name in ../i18n.ts; weights are
 * relative (normalized by LoadingModel).
 */
import { audioStep } from "./audio";
import { coordsStep } from "./coords";
import { materialsStep } from "./materials";
import { regionsStep } from "./regions";
import { systemStep } from "./system";
import { terrainStep } from "./terrain";
import type { LoadingStepDef } from "./types";

export const LOADING_STEPS: readonly LoadingStepDef[] = [coordsStep, regionsStep, materialsStep, terrainStep, systemStep, audioStep];

export type { DiagEntry, LoadingLabels, LoadingStepDef, StepAction, StepContext, StepEval } from "./types";
