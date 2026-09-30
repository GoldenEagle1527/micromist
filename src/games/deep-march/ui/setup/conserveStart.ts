/**
 * Setup screen, conserve mode: what the start button does for a given slot state
 * (pure, node-tested). A stored world is continued unless the player asked for a
 * new one; anything that would replace a stored save is labelled as such.
 */
import type { SlotView } from "../../modes/useConserveSlot";

export type StartLabel = "newWorld" | "continueWorld" | "overwrite";
export type ConserveStart = { canStart: boolean; intent: "new" | "continue"; label: StartLabel; showSeed: boolean; showNewWorldButton: boolean };

export function conserveStart(view: SlotView, newWorldRequested: boolean): ConserveStart {
  switch (view.state) {
    case "loading":
    case "failed":
      return { canStart: false, intent: "new", label: "newWorld", showSeed: false, showNewWorldButton: false };
    case "empty":
      return { canStart: true, intent: "new", label: "newWorld", showSeed: true, showNewWorldButton: false };
    case "ended":
    case "unreadable":
      return { canStart: true, intent: "new", label: "overwrite", showSeed: true, showNewWorldButton: false };
    case "ready":
      return newWorldRequested
        ? { canStart: true, intent: "new", label: "overwrite", showSeed: true, showNewWorldButton: false }
        : { canStart: true, intent: "continue", label: "continueWorld", showSeed: false, showNewWorldButton: true };
  }
}
