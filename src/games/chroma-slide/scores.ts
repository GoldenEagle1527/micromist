/** Persisted best + recent run history for Chroma Slide (separate from mid-run progress). */

import { normalizePresetId, type PresetId } from "./engine";

export type ChromaRunRecord = {
  steps: number;
  preset: PresetId;
  at: number;
  durationMs?: number;
};

export type ChromaScores = {
  best: ChromaRunRecord | null;
  /** Newest first; capped at MAX_RECENT. */
  recent: ChromaRunRecord[];
};

export const CHROMA_SCORES_KEY = "micromist.local.chroma-slide.scores";
export const MAX_RECENT = 10;

function emptyScores(): ChromaScores {
  return { best: null, recent: [] };
}

function parseRun(raw: unknown): ChromaRunRecord | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.steps !== "number" || !Number.isFinite(o.steps) || o.steps < 0) {
    return null;
  }
  const preset = normalizePresetId(o.preset);
  if (preset == null) return null;
  if (typeof o.at !== "number" || !Number.isFinite(o.at)) return null;
  const run: ChromaRunRecord = {
    steps: Math.floor(o.steps),
    preset,
    at: o.at,
  };
  if (
    typeof o.durationMs === "number" &&
    Number.isFinite(o.durationMs) &&
    o.durationMs >= 0
  ) {
    run.durationMs = o.durationMs;
  }
  return run;
}

export function loadScores(): ChromaScores {
  try {
    const raw = localStorage.getItem(CHROMA_SCORES_KEY);
    if (!raw) return emptyScores();
    const parsed = JSON.parse(raw) as Partial<ChromaScores>;
    const best = parsed.best != null ? parseRun(parsed.best) : null;
    const recent = Array.isArray(parsed.recent)
      ? parsed.recent
          .map(parseRun)
          .filter((r): r is ChromaRunRecord => r != null)
          .slice(0, MAX_RECENT)
      : [];
    return { best, recent };
  } catch {
    return emptyScores();
  }
}

export function saveScores(scores: ChromaScores): boolean {
  try {
    localStorage.setItem(
      CHROMA_SCORES_KEY,
      JSON.stringify({
        best: scores.best,
        recent: scores.recent.slice(0, MAX_RECENT),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Prefer fewer steps; on tie keep the newer run (`at`). */
export function isBetterRun(
  candidate: ChromaRunRecord,
  current: ChromaRunRecord | null,
): boolean {
  if (!current) return true;
  if (candidate.steps < current.steps) return true;
  if (candidate.steps > current.steps) return false;
  return candidate.at >= current.at;
}

/**
 * Append a completed run. Caps recent at 10 (newest first).
 * Best: fewer steps wins; equal steps → keep newer.
 */
export function recordWin(run: ChromaRunRecord): {
  scores: ChromaScores;
  isNewBest: boolean;
} {
  const prev = loadScores();
  const isNewBest = isBetterRun(run, prev.best);
  const scores: ChromaScores = {
    best: isNewBest ? run : prev.best,
    recent: [run, ...prev.recent].slice(0, MAX_RECENT),
  };
  saveScores(scores);
  return { scores, isNewBest };
}
