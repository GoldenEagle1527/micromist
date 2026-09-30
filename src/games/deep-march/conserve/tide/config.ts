/**
 * Tide tunables (design doc §5.5, §5.6; plan M7). Seconds and metres. The
 * cost to call it (base energy, departures) is BASE.tide in ../config.ts.
 */
export const TIDE_PHASES = ["inhale", "strip", "currents", "gather", "settle"] as const;
export type TidePhase = (typeof TIDE_PHASES)[number];

export const TIDE = {
  /** P0 warning (the player may still store and build); extended while gen + 1 is not precomputed. */
  warnS: 60,
  extendS: 30,
  /** The show, P1 … P5: 吸气 0–5 · 剥离 5–13 · 洋流 13–21 · 凝聚 21–30 · 平息 30–35. */
  phaseS: { inhale: 5, strip: 8, currents: 8, gather: 9, settle: 5 } satisfies Record<TidePhase, number>,
  /** Terrain and collision switch to the new generation at the start of this phase (P4). */
  swapPhase: "gather" as TidePhase,
  /** 浊潮 (murk): fog to black, a switch in the dark (held until the new terrain covers the view), clearing. ≈ 12 s. */
  murk: { darkS: 3, holdMinS: 3, holdMaxS: 20, clearS: 6 },
  /** The dome (§5.6): warning this close to its edge; dissolving outside takes this long. */
  dome: { warnM: 5, dissolveS: 2 },
  /**
   * Frame-time governor (phone performance): the show falls back to the murk when
   * the mean frame time over the last `warnWindowS` of the warning exceeds
   * `warnMaxMs` (< 25 fps with the next generation already streaming), or, before
   * the terrain switch, over `showWindowS` of the show exceeds `showMaxMs` (< 15 fps).
   */
  governor: { warnWindowS: 8, warnMaxMs: 40, showWindowS: 2, showMaxMs: 66 },
  /** navigator.deviceMemory at or below this (GB): the murk from the start. */
  lowMemoryGB: 2,
} as const;

/** Show start time (s) of each phase, and the total. */
export function phaseStarts(): { starts: Record<TidePhase, number>; total: number } {
  const starts = {} as Record<TidePhase, number>;
  let t = 0;
  for (const p of TIDE_PHASES) {
    starts[p] = t;
    t += TIDE.phaseS[p];
  }
  return { starts, total: t };
}
