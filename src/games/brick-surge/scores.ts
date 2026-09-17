/** Best score for Brick Surge (IndexedDB via game-store). */

import { gameStoreGet, gameStoreSet } from "../../lib/game-store";

export const BRICK_SURGE_GAME = "brick-surge";
export const BRICK_SURGE_BEST_KEY = "best";

export function readBestScore(): number {
  try {
    const raw = gameStoreGet<unknown>(BRICK_SURGE_GAME, BRICK_SURGE_BEST_KEY);
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      return Math.floor(raw);
    }
    if (typeof raw === "string") {
      const value = Number.parseInt(raw, 10);
      return Number.isFinite(value) && value >= 0 ? value : 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

export function writeBestScore(score: number): number {
  const next = Math.max(Math.floor(score), readBestScore());
  try {
    gameStoreSet(BRICK_SURGE_GAME, BRICK_SURGE_BEST_KEY, next);
  } catch {
    /* ignore */
  }
  return next;
}
