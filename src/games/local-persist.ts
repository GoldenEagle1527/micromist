/**
 * Shared local progress persist for micromist solo games.
 *
 * All listed solo games (chroma-slide, blade-break, explosive-chess solo,
 * mist-catch) must use this layer. Online / multiplayer play is excluded —
 * never write micromist.local.* progress while opponent === "online".
 *
 * TODO(mist-catch): mid-run Phaser resume skipped; best-score stays via
 * src/lib/bestScore.ts (catalog BEST_SCORE_KEY). Wire runtime resume later
 * if Phaser scene snapshot is practical.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type LocalProgressEnvelope<T> = {
  v: number;
  savedAt: number;
  data: T;
};

const DEFAULT_VERSION = 1;

export function localProgressKey(slug: string): string {
  return `micromist.local.${slug}.progress`;
}

export function saveLocalProgress<T>(
  slug: string,
  data: T,
  opts?: { version?: number },
): boolean {
  try {
    const envelope: LocalProgressEnvelope<T> = {
      v: opts?.version ?? DEFAULT_VERSION,
      savedAt: Date.now(),
      data,
    };
    localStorage.setItem(localProgressKey(slug), JSON.stringify(envelope));
    return true;
  } catch {
    // Quota exceeded / private mode — ignore; gameplay continues.
    return false;
  }
}

export function loadLocalProgress<T>(
  slug: string,
  opts?: {
    version?: number;
    migrate?: (data: unknown, fromVersion: number) => T;
  },
): T | null {
  try {
    const raw = localStorage.getItem(localProgressKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalProgressEnvelope<unknown>>;
    if (parsed == null || typeof parsed !== "object" || !("data" in parsed)) {
      return null;
    }
    const fromVersion =
      typeof parsed.v === "number" ? parsed.v : DEFAULT_VERSION;
    const want = opts?.version ?? DEFAULT_VERSION;
    if (fromVersion !== want) {
      if (!opts?.migrate) return null;
      return opts.migrate(parsed.data, fromVersion);
    }
    return parsed.data as T;
  } catch {
    return null;
  }
}

export function clearLocalProgress(slug: string): void {
  try {
    localStorage.removeItem(localProgressKey(slug));
  } catch {
    /* ignore */
  }
}

export type UseLocalGamePersistOptions<T> = {
  /** When false, skip autosave (e.g. online mode). Default true. */
  enabled?: boolean;
  version?: number;
  /** Return false to clear instead of save. Default: always save when state is set. */
  shouldSave?: (state: T) => boolean;
  onHydrate?: (data: T) => void;
  migrate?: (data: unknown, fromVersion: number) => T;
};

/**
 * Load once on mount; autosave on `state` changes (0ms debounce via effect).
 * When enabled and state fails shouldSave (or is nullish), clears storage.
 */
export function useLocalGamePersist<T>(
  slug: string,
  state: T | null | undefined,
  options: UseLocalGamePersistOptions<T> = {},
): { clear: () => void; hydrated: boolean } {
  const enabled = options.enabled ?? true;
  const version = options.version ?? DEFAULT_VERSION;
  const shouldSaveRef = useRef(options.shouldSave ?? ((_: T) => true));
  shouldSaveRef.current = options.shouldSave ?? ((_: T) => true);
  const onHydrateRef = useRef(options.onHydrate);
  onHydrateRef.current = options.onHydrate;
  const migrateRef = useRef(options.migrate);
  migrateRef.current = options.migrate;

  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const data = loadLocalProgress<T>(slug, {
      version,
      migrate: migrateRef.current,
    });
    if (data != null) {
      onHydrateRef.current?.(data);
    }
    setHydrated(true);
  }, [slug, version]);

  useEffect(() => {
    if (!hydrated || !enabled) return;
    const id = window.setTimeout(() => {
      if (state != null && shouldSaveRef.current(state)) {
        saveLocalProgress(slug, state, { version });
      } else {
        clearLocalProgress(slug);
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [slug, state, enabled, hydrated, version]);

  const clear = useCallback(() => {
    clearLocalProgress(slug);
  }, [slug]);

  return { clear, hydrated };
}
