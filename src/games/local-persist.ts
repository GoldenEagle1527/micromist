/**
 * Shared local progress persist for micromist solo games.
 *
 * All solo games must use this layer (or `gameStore*` directly). Storage is
 * IndexedDB via `src/lib/game-store.ts`. Online / multiplayer play is excluded —
 * never write progress while opponent === "online".
 *
 * TODO(mist-catch): mid-run Phaser resume skipped; best-score uses game-store
 * key `best` on slug mist-catch.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ensureLocalDbReady,
  gameStoreDelete,
  gameStoreGet,
  gameStoreSet,
} from "../lib/game-store";

export type LocalProgressEnvelope<T> = {
  v: number;
  savedAt: number;
  data: T;
};

const DEFAULT_VERSION = 1;
const PROGRESS_KEY = "progress";

/** @deprecated key was localStorage-only; kept for docs / grepping. */
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
    gameStoreSet(slug, PROGRESS_KEY, envelope);
    return true;
  } catch {
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
    const parsed = gameStoreGet<Partial<LocalProgressEnvelope<unknown>>>(
      slug,
      PROGRESS_KEY,
    );
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
  gameStoreDelete(slug, PROGRESS_KEY);
}

export type UseLocalGamePersistOptions<T> = {
  enabled?: boolean;
  version?: number;
  shouldSave?: (state: T) => boolean;
  onHydrate?: (data: T) => void;
  migrate?: (data: unknown, fromVersion: number) => T;
};

/**
 * Wait for IDB cache, load once, autosave on `state` changes.
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
    let cancelled = false;
    void ensureLocalDbReady().then(() => {
      if (cancelled) return;
      const data = loadLocalProgress<T>(slug, {
        version,
        migrate: migrateRef.current,
      });
      if (data != null) onHydrateRef.current?.(data);
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
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
