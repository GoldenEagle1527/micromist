/**
 * The dive's game clock for the HUD (scene/gameClock.ts): ControlPanel provides
 * the running dive's clock, so teaching notes and hint cards (useOnce) freeze
 * with the game while the ≡ menu is open. Outside a dive: wall time, never paused.
 */
import { createContext, useContext, useEffect, useState } from "react";
import type { ClockView } from "../scene/gameClock";

export const WALL_CLOCK: ClockView = { now: () => performance.now(), paused: false, subscribe: () => () => {} };

export const PauseClockContext = createContext<ClockView>(WALL_CLOCK);

/** The clock of the dive this HUD belongs to. */
export function usePauseClock(): ClockView {
  return useContext(PauseClockContext);
}

/** Whether that clock is paused right now (re-renders on every pause / resume). */
export function usePaused(clock: ClockView | null): boolean {
  const [paused, setPaused] = useState(clock?.paused ?? false);
  useEffect(() => {
    if (!clock) return;
    setPaused(clock.paused);
    return clock.subscribe(setPaused);
  }, [clock]);
  return paused;
}
