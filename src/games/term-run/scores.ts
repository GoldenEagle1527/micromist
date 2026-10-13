/** High score for term-run (IndexedDB via game-store). */

import { gameStoreGet, gameStoreSet } from "../../lib/game-store";

export const TERM_RUN_GAME = "term-run";
export const TERM_RUN_SCORES_KEY = "scores";

export type TermRunRecord = {
  score: number;
  lines: number;
  ok: number;
  distance: number;
  at: number;
};

export type TermRunScores = {
  best: TermRunRecord | null;
  recent: TermRunRecord[];
};

const MAX_RECENT = 10;

function empty(): TermRunScores {
  return { best: null, recent: [] };
}

function parseRun(raw: unknown): TermRunRecord | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.score !== "number" || !Number.isFinite(o.score)) return null;
  if (typeof o.at !== "number" || !Number.isFinite(o.at)) return null;
  return {
    score: Math.max(0, Math.floor(o.score)),
    lines: typeof o.lines === "number" ? Math.max(0, Math.floor(o.lines)) : 0,
    ok: typeof o.ok === "number" ? Math.max(0, Math.floor(o.ok)) : 0,
    distance:
      typeof o.distance === "number" ? Math.max(0, Math.floor(o.distance)) : 0,
    at: o.at,
  };
}

export function loadScores(): TermRunScores {
  try {
    const raw = gameStoreGet<Partial<TermRunScores>>(
      TERM_RUN_GAME,
      TERM_RUN_SCORES_KEY,
    );
    if (raw == null || typeof raw !== "object") return empty();
    const best = raw.best != null ? parseRun(raw.best) : null;
    const recent = Array.isArray(raw.recent)
      ? raw.recent
          .map(parseRun)
          .filter((r): r is TermRunRecord => r != null)
          .slice(0, MAX_RECENT)
      : [];
    return { best, recent };
  } catch {
    return empty();
  }
}

export function recordRun(run: TermRunRecord): {
  scores: TermRunScores;
  isNewBest: boolean;
} {
  const prev = loadScores();
  const isNewBest = !prev.best || run.score > prev.best.score;
  const scores: TermRunScores = {
    best: isNewBest ? run : prev.best,
    recent: [run, ...prev.recent].slice(0, MAX_RECENT),
  };
  try {
    gameStoreSet(TERM_RUN_GAME, TERM_RUN_SCORES_KEY, scores);
  } catch {
    /* ignore */
  }
  return { scores, isNewBest };
}
