import type { Terrain } from "./types";
import { rngInt, type RngState } from "./rng";

/**
 * Frontline Tide tuning.
 * Flow code reads these fields on each action. Change numbers here;
 * day_match → day_build → night → front_shift → day_match stays put.
 *
 * Merge rule (frozen for this slice): three orthogonally connected defenses
 * of the same tier collapse into one defense of the next tier, on the cell
 * just placed. T3 does not promote.
 */
export const frontlineTideConfig = {
  boardSize: 8,
  colors: 3,
  dailySwaps: 5,
  hearts: 5,
  /** Build points to place one T1 groyne. T2 and T3 only come from merges. */
  t1Cost: 3,
  nightEnemiesDay1: 3,
  /** +1 biter every two days, then stop growing so nights stay inside a minute. */
  nightEnemiesPerTwoDays: 1,
  nightEnemyCap: 7,
  enemyHp: 5,
  /** +1 hp every this many days, then stop. Later pressure is rules, not infinite HP. */
  enemyHpEveryDays: 4,
  enemyHpCap: 12,
  enemyDamage: 1,
  /** Day 10 bite 2, day 25 bite 3, then flat. */
  enemyDamageDay10: 2,
  enemyDamageDay25: 3,
  enemyHeartDamage: 1,
  /** Index by tier. 0 is unused. */
  defenseHp: [0, 5, 8, 14] as const,
  defenseDamage: [0, 1, 2, 3] as const,
  maxTier: 3 as const,
  /** Row the single tide road uses. */
  pathRow: 3,
  /** Column where biters appear on day 1 (0 is the shore). */
  frontStart: 7,
  frontMin: 4,
  frontMax: 7,
  /**
   * -1 pushes the board toward the shore (column 0 washes off, a new band enters from the sea).
   * +1 pushes back out to sea. The direction flips after every night, including past day 50.
   */
  frontDirStart: -1 as const,
  /** Gems cleared on a rip column pay this many build points (shoal and reef pay matchPointsPerGem). */
  ripYield: 2,
  /** Days 1–9 use dailySwaps. Day 10 drops one. Day 25 drops another. Never below 3. */
  swapFloor: 3,
  /**
   * Night pacing. With enemyMoveEvery 3 and spawnGapTicks 5, an unblocked
   * day-1 wave of 3 lasts a little over 20s. Later nights run longer while
   * biters chew through groynes; 560ms keeps a hard day-5 fight under ~40s.
   */
  nightTickMs: 560,
  /** Ticks a biter waits between steps. Movement itself spends the tick it fires. */
  enemyMoveEvery: 3,
  /** Ticks between spawns (the spawn tick counts as one). */
  spawnGapTicks: 5,
  matchPointsPerGem: 1,
  /** Added once per cascade step after the first, so chains read as more than the gem count. */
  chainFlatBonus: 1,
  mergeRule: "adjacent-3-same-tier" as const,
  frontShiftMs: 900,
};

export type FrontlineTideConfig = typeof frontlineTideConfig;

export const FRONTLINETIDE_SLUG = "frontline-tide";

/** Swap budget for a day. Shrinks at day 10 and day 25, then holds. */
export function swapsForDay(day: number): number {
  const base = frontlineTideConfig.dailySwaps;
  const drop = day >= 25 ? 2 : day >= 10 ? 1 : 0;
  return Math.max(frontlineTideConfig.swapFloor, base - drop);
}

/** How the next column is dealt. Reef and rip take over as the days run on. */
export function terrainWeights(day: number): Record<Terrain, number> {
  if (day >= 50) return { shoal: 1, reef: 3, rip: 4 };
  if (day >= 25) return { shoal: 2, reef: 3, rip: 3 };
  if (day >= 10) return { shoal: 3, reef: 4, rip: 2 };
  return { shoal: 6, reef: 2, rip: 1 };
}

export function rollTerrain(rng: RngState, day: number): { terrain: Terrain; rng: RngState } {
  const weights = terrainWeights(day);
  const order: Terrain[] = ["shoal", "reef", "rip"];
  const total = order.reduce((sum, terrain) => sum + weights[terrain], 0);
  const rolled = rngInt(rng, total);
  let cursor = rolled.value;
  for (const terrain of order) {
    cursor -= weights[terrain];
    if (cursor < 0) return { terrain, rng: rolled.rng };
  }
  return { terrain: "shoal", rng: rolled.rng };
}

/** Day 1 always shows all three bands so the legend is something you can try. */
export function openingBands(size: number): Terrain[] {
  const bands: Terrain[] = Array.from({ length: size }, () => "shoal" as Terrain);
  if (size > 2) bands[2] = "reef";
  if (size > 5) bands[5] = "rip";
  return bands;
}
