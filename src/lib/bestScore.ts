import { gameStoreGet, gameStoreSet } from "./game-store";

const GAME = "mist-catch";
const KEY = "best";

export function readBestScore(): number {
  try {
    const raw = gameStoreGet<unknown>(GAME, KEY);
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string") {
      const value = Number.parseInt(raw, 10);
      return Number.isFinite(value) ? value : 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

export function writeBestScore(score: number): number {
  const next = Math.max(score, readBestScore());
  try {
    gameStoreSet(GAME, KEY, next);
  } catch {
    /* ignore */
  }
  return next;
}
