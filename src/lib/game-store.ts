/**
 * Sync façade over IndexedDB for game-scoped local data.
 *
 * Call `ensureLocalDbReady()` once at shell boot (awaits legacy migration +
 * cache warm). After that, get/set/delete are synchronous for gameplay code;
 * writes flush to IndexedDB in the background.
 *
 * Games must not invent their own storage — use this or `local-persist`
 * (progress helper on top of this).
 */

import {
  PLATFORM_GAME,
  clearAllLegacyMicromistLocalStorage,
  clearLegacyLocalStorageForGame,
  listLegacyLocalStorageKeys,
  localDbClearAll,
  localDbClearGame,
  localDbDelete,
  localDbList,
  localDbSet,
  type LocalDbRecord,
} from "./local-db";

const cache = new Map<string, unknown>();
let bootPromise: Promise<void> | null = null;
let ready = false;

function idOf(game: string, key: string): string {
  return `${game}/${key}`;
}

function parseLegacyProgressEnvelope(raw: string): unknown | null {
  try {
    const parsed = JSON.parse(raw) as { data?: unknown; v?: number; savedAt?: number };
    if (parsed == null || typeof parsed !== "object" || !("data" in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** One-shot: copy known micromist.* game keys from localStorage into IDB, then drop them. */
async function migrateLegacyLocalStorage(): Promise<void> {
  const keys = listLegacyLocalStorageKeys();
  for (const item of keys) {
    if (item.game === PLATFORM_GAME) continue; // theme / locale / misc stay on LS for now
    let raw = "";
    try {
      raw = localStorage.getItem(item.key) ?? "";
    } catch {
      continue;
    }
    if (!raw) continue;

    try {
      if (/^micromist\.local\.[^.]+\.progress$/.test(item.key)) {
        const envelope = parseLegacyProgressEnvelope(raw);
        if (envelope != null) await localDbSet(item.game, "progress", envelope);
      } else if (item.key === "micromist.local.chroma-slide.scores") {
        await localDbSet("chroma-slide", "scores", JSON.parse(raw));
      } else if (item.key === "micromist.explosive-chess.settings") {
        await localDbSet("explosive-chess", "settings", JSON.parse(raw));
      } else if (item.key === "micromist.mist-catch.best") {
        const n = Number.parseInt(raw, 10);
        if (Number.isFinite(n)) await localDbSet("mist-catch", "best", n);
      } else if (item.key === "micromist.explosive-chess.playerId") {
        await localDbSet("explosive-chess", "playerId", raw);
      } else if (item.game !== "unknown") {
        // Generic fallback: store raw string under legacy/<fullKey>
        await localDbSet(item.game, `legacy:${item.key}`, raw);
      } else {
        continue;
      }
      try {
        localStorage.removeItem(item.key);
      } catch {
        /* ignore */
      }
    } catch {
      /* skip bad rows */
    }
  }
}

async function warmCache(): Promise<void> {
  const rows = await localDbList();
  cache.clear();
  for (const row of rows) cache.set(row.id, row.value);
}

async function boot(): Promise<void> {
  await migrateLegacyLocalStorage();
  await warmCache();
  ready = true;
}

/** Resolve when migration + cache are ready. Safe to call repeatedly. */
export function ensureLocalDbReady(): Promise<void> {
  if (!bootPromise) bootPromise = boot();
  return bootPromise;
}

export function isLocalDbReady(): boolean {
  return ready;
}

export function gameStoreGet<T>(game: string, key: string): T | undefined {
  return cache.get(idOf(game, key)) as T | undefined;
}

export function gameStoreSet(game: string, key: string, value: unknown): void {
  const id = idOf(game, key);
  cache.set(id, value);
  void localDbSet(game, key, value).catch(() => {
    /* quota / private — cache still holds for the session */
  });
}

export function gameStoreDelete(game: string, key: string): void {
  cache.delete(idOf(game, key));
  void localDbDelete(game, key).catch(() => {
    /* ignore */
  });
}

export async function gameStoreClearGame(game: string): Promise<void> {
  await localDbClearGame(game);
  clearLegacyLocalStorageForGame(game);
  for (const id of [...cache.keys()]) {
    if (id.startsWith(`${game}/`)) cache.delete(id);
  }
}

export async function gameStoreClearAllGames(): Promise<void> {
  await localDbClearAll();
  // Drop game LS leftovers; keep platform theme/locale keys.
  for (const item of listLegacyLocalStorageKeys()) {
    if (item.game === PLATFORM_GAME) continue;
    try {
      localStorage.removeItem(item.key);
    } catch {
      /* ignore */
    }
  }
  cache.clear();
  // Re-warm empty
  ready = true;
}

export async function gameStoreReload(): Promise<void> {
  await warmCache();
}

export function gameStoreListCached(): LocalDbRecord[] {
  const out: LocalDbRecord[] = [];
  for (const [id, value] of cache) {
    const slash = id.indexOf("/");
    if (slash <= 0) continue;
    out.push({
      id,
      game: id.slice(0, slash),
      key: id.slice(slash + 1),
      value,
      updatedAt: Date.now(),
    });
  }
  return out;
}

/** @deprecated platform clear-all including theme — prefer gameStoreClearAllGames */
export async function gameStoreNukeEverythingIncludingPlatformLs(): Promise<void> {
  await localDbClearAll();
  clearAllLegacyMicromistLocalStorage();
  cache.clear();
}
