/**
 * Step evaluation → model, and the dive gate (pure, node-tested).
 *
 * Normal start: every step settled (done / warn) and the world reports `loaded`.
 * "Dive anyway" (after a shader failure): allowed once every step is settled except
 * bypassable ones in error, and the world could actually start (programs checked,
 * no lost GPU context, terrain and textures in); the world's own gate
 * (world.ts: terrain, textures, shaders compiled) is unchanged.
 */
import type { LoadingSnapshot } from "../../scene/world";
import { settled, type LoadingModel } from "./loadingModel";
import type { LoadingStepDef, StepEval } from "./steps/types";

export function applyStep(model: LoadingModel, id: string, ev: StepEval): void {
  switch (ev.state) {
    case "pending":
      return;
    case "done":
      model.complete(id);
      return;
    case "warn":
      model.warn(id);
      return;
    case "active":
    case "error":
      if (ev.total !== undefined) model.report(id, ev.done ?? 0, ev.total);
      else model.start(id);
      if (ev.state === "error") model.fail(id);
      else model.recover(id);
  }
}

/** The world could start the simulation even though a bypassable step failed. */
export function forceAllowed(snap: LoadingSnapshot): boolean {
  const s = snap.system;
  return s.shaders && !s.gpuLost && snap.terrain.ready && snap.materials.ready;
}

export function canBeginDive(model: LoadingModel, steps: readonly LoadingStepDef[], snap: LoadingSnapshot, forceRequested: boolean): boolean {
  if (model.allDone() && snap.loaded) return true;
  if (!forceRequested || !forceAllowed(snap)) return false;
  return steps.every((d) => settled(model.status[d.id]) || (d.bypassable === true && model.status[d.id] === "error"));
}
