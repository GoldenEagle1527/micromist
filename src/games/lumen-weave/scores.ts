/** Best score for Lumen Weave (IndexedDB via game-store). */

import { gameStoreGet, gameStoreSet } from "../../lib/game-store";

export const LUMEN_GAME = "lumen-weave";
export const LUMEN_BEST_KEY = "best";

export function readBestScore(): number {
  try {
    const raw = gameStoreGet<unknown>(LUMEN_GAME, LUMEN_BEST_KEY);
    if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
    if (typeof raw === "string") {
      const value = Number.parseInt(raw, 10);
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

/** Persist if `score` beats current best; returns the best after write. */
export function writeBestScore(score: number): number {
  const next = Math.max(Math.floor(score), readBestScore());
  try {
    gameStoreSet(LUMEN_GAME, LUMEN_BEST_KEY, next);
  } catch {
    /* ignore */
  }
  return next;
}
