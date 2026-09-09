import { BEST_SCORE_KEY } from "../games/catalog";

export function readBestScore(): number {
  try {
    const raw = localStorage.getItem(BEST_SCORE_KEY);
    const value = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function writeBestScore(score: number): number {
  const next = Math.max(score, readBestScore());
  try {
    localStorage.setItem(BEST_SCORE_KEY, String(next));
  } catch {
    // Private mode or full quota — ignore; the run still plays.
  }
  return next;
}
