import { resolveSwap } from "./board";
import { placeDefense } from "./build";
import { completeFrontShift, enterBuild, enterNight } from "./engine";
import { nightGate, stepNight } from "./night";
import type { GameState, Phase, Terrain } from "./types";

export type TideAction =
  | { type: "swap"; row: number; col: number; row2: number; col2: number }
  | { type: "place"; row: number; col: number }
  | { type: "end_phase" };

export type TideEffect =
  | { type: "clear"; chain: number; points: number; cells: { row: number; col: number }[] }
  | { type: "merge"; row: number; col: number; tier: number }
  | {
      type: "night";
      day: number;
      hearts: number;
      leaked: number;
      direction: "shore" | "sea";
      entered: Terrain | null;
      phase: Phase;
    };

export type ActionResult =
  | { ok: true; state: GameState; effects: TideEffect[] }
  | { ok: false; reason: string };

function nightSummary(before: GameState, after: GameState, leaked: number): TideEffect {
  const direction = before.frontDir < 0 ? "shore" : "sea";
  const entered =
    after.phase === "gameover"
      ? null
      : before.frontDir < 0
        ? (after.bands[after.bands.length - 1] ?? null)
        : (after.bands[0] ?? null);
  return {
    type: "night",
    day: after.day,
    hearts: after.hearts,
    leaked,
    direction,
    entered,
    phase: after.phase,
  };
}

/** Run the whole night and the front shift. Hearts at 0 stop before the shift. */
export function resolveNight(state: GameState): { state: GameState; effects: TideEffect[] } {
  let current = state.phase === "day_build" ? enterNight(state) : state;
  if (current.phase !== "night") return { state: current, effects: [] };
  const before = current;
  let leaked = 0;
  for (let guard = 0; guard < 900 && current.phase === "night"; guard++) {
    const step = stepNight(current);
    current = step.state;
    leaked += step.events.filter((event) => event.type === "heart").length;
  }
  if (current.phase === "front_shift") current = completeFrontShift(current);
  return { state: current, effects: [nightSummary(before, current, leaked)] };
}

export function applyAction(state: GameState, action: TideAction): ActionResult {
  if (action.type === "swap") {
    const result = resolveSwap(state, { r: action.row, c: action.col }, { r: action.row2, c: action.col2 });
    if (!result.ok) return { ok: false, reason: result.reason };
    return {
      ok: true,
      state: result.state,
      effects: result.steps.map((step) => ({
        type: "clear" as const,
        chain: step.chain,
        points: step.points,
        cells: step.cleared.map((cell) => ({ row: cell.r, col: cell.c })),
      })),
    };
  }
  if (action.type === "place") {
    const result = placeDefense(state, action.row, action.col);
    if (!result.ok) return { ok: false, reason: result.reason };
    return {
      ok: true,
      state: result.state,
      effects: result.merges.map((merge) => ({
        type: "merge" as const,
        row: merge.at.r,
        col: merge.at.c,
        tier: merge.tier,
      })),
    };
  }
  if (state.phase === "day_match") {
    return { ok: true, state: enterBuild(state), effects: [] };
  }
  if (state.phase === "day_build") {
    if (nightGate(state) === "patch") return { ok: false, reason: "patch-road" };
    const night = resolveNight(state);
    return { ok: true, state: night.state, effects: night.effects };
  }
  return { ok: false, reason: "phase" };
}
