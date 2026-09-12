/**
 * Shared IndexedDB layer for micromist local data (desktop + mobile).
 *
 * Records are scoped by `game` (catalog slug, or PLATFORM_GAME for shell-level).
 * Values use the structured-clone algorithm (objects, arrays, Blob, …).
 *
 * All game data goes through game-store (this IDB + boot cache).
 * local-persist writes progress envelopes here under key `progress`.
 */

export const LOCAL_DB_NAME = "micromist";
export const LOCAL_DB_VERSION = 1;
export const LOCAL_DB_STORE = "entries";
/** Shell / cross-game keys (not a catalog slug). */
export const PLATFORM_GAME = "_platform";

export type LocalDbRecord = {
  /** `${game}/${key}` */
  id: string;
  game: string;
  key: string;
  value: unknown;
  updatedAt: number;
};

export type LocalDbGameSummary = {
  game: string;
  count: number;
  /** Rough UTF-16 / JSON size of stored values (bytes estimate). */
  approxBytes: number;
  updatedAt: number;
};

function recordId(game: string, key: string): string {
  return `${game}/${key}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOCAL_DB_STORE)) {
        const store = db.createObjectStore(LOCAL_DB_STORE, { keyPath: "id" });
        store.createIndex("game", "game", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB tx failed"));
    tx.onabort = () => reject(tx.error ?? new Error("indexedDB tx aborted"));
  });
}

function approxSizeOf(value: unknown): number {
  try {
    if (typeof value === "string") return value.length * 2;
    if (value instanceof Blob) return value.size;
    if (value instanceof ArrayBuffer) return value.byteLength;
    return JSON.stringify(value)?.length * 2 || 0;
  } catch {
    return 0;
  }
}

export async function localDbSet(
  game: string,
  key: string,
  value: unknown,
): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(LOCAL_DB_STORE, "readwrite");
    const store = tx.objectStore(LOCAL_DB_STORE);
    const record: LocalDbRecord = {
      id: recordId(game, key),
      game,
      key,
      value,
      updatedAt: Date.now(),
    };
    store.put(record);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function localDbGet<T = unknown>(
  game: string,
  key: string,
): Promise<T | undefined> {
  const db = await openDb();
  try {
    const tx = db.transaction(LOCAL_DB_STORE, "readonly");
    const store = tx.objectStore(LOCAL_DB_STORE);
    const req = store.get(recordId(game, key));
    const row = await new Promise<LocalDbRecord | undefined>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as LocalDbRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    await txDone(tx);
    return row?.value as T | undefined;
  } finally {
    db.close();
  }
}

export async function localDbDelete(game: string, key: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(LOCAL_DB_STORE, "readwrite");
    tx.objectStore(LOCAL_DB_STORE).delete(recordId(game, key));
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function localDbList(
  game?: string,
): Promise<LocalDbRecord[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(LOCAL_DB_STORE, "readonly");
    const store = tx.objectStore(LOCAL_DB_STORE);
    const req =
      game == null
        ? store.getAll()
        : store.index("game").getAll(IDBKeyRange.only(game));
    const rows = await new Promise<LocalDbRecord[]>((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as LocalDbRecord[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    await txDone(tx);
    return rows;
  } finally {
    db.close();
  }
}

export async function localDbClearGame(game: string): Promise<void> {
  const rows = await localDbList(game);
  if (rows.length === 0) return;
  const db = await openDb();
  try {
    const tx = db.transaction(LOCAL_DB_STORE, "readwrite");
    const store = tx.objectStore(LOCAL_DB_STORE);
    for (const row of rows) store.delete(row.id);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function localDbClearAll(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(LOCAL_DB_STORE, "readwrite");
    tx.objectStore(LOCAL_DB_STORE).clear();
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function localDbSummarizeByGame(): Promise<LocalDbGameSummary[]> {
  const rows = await localDbList();
  const map = new Map<string, LocalDbGameSummary>();
  for (const row of rows) {
    const cur = map.get(row.game) ?? {
      game: row.game,
      count: 0,
      approxBytes: 0,
      updatedAt: 0,
    };
    cur.count += 1;
    cur.approxBytes += approxSizeOf(row.value);
    cur.updatedAt = Math.max(cur.updatedAt, row.updatedAt);
    map.set(row.game, cur);
  }
  return [...map.values()].sort((a, b) => a.game.localeCompare(b.game));
}

export type StorageQuotaInfo = {
  usage: number | null;
  quota: number | null;
};

export async function estimateOriginStorage(): Promise<StorageQuotaInfo> {
  try {
    if (!navigator.storage?.estimate) return { usage: null, quota: null };
    const est = await navigator.storage.estimate();
    return {
      usage: typeof est.usage === "number" ? est.usage : null,
      quota: typeof est.quota === "number" ? est.quota : null,
    };
  } catch {
    return { usage: null, quota: null };
  }
}

/** Legacy localStorage keys used by micromist (for the manager UI). */
export type LegacyLocalKey = {
  key: string;
  /** Best-effort game slug, or PLATFORM_GAME / "unknown". */
  game: string;
  approxBytes: number;
};

export function listLegacyLocalStorageKeys(): LegacyLocalKey[] {
  const out: LegacyLocalKey[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("micromist.")) continue;
      let raw = "";
      try {
        raw = localStorage.getItem(key) ?? "";
      } catch {
        raw = "";
      }
      let game = "unknown";
      // micromist.local.<slug>.progress | micromist.local.<slug>.scores
      const localMatch = /^micromist\.local\.([^.]+)\./.exec(key);
      if (localMatch) game = localMatch[1]!;
      else if (key.startsWith("micromist.mist-catch.")) game = "mist-catch";
      else if (key.startsWith("micromist.theme") || key.startsWith("micromist.locale"))
        game = PLATFORM_GAME;
      else if (key.includes("playerId") || key.includes("room")) game = PLATFORM_GAME;
      out.push({ key, game, approxBytes: raw.length * 2 });
    }
  } catch {
    /* private mode */
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export function clearLegacyLocalStorageForGame(game: string): number {
  const keys = listLegacyLocalStorageKeys()
    .filter((k) => k.game === game)
    .map((k) => k.key);
  let n = 0;
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
      n += 1;
    } catch {
      /* ignore */
    }
  }
  return n;
}

export function clearAllLegacyMicromistLocalStorage(): number {
  const keys = listLegacyLocalStorageKeys().map((k) => k.key);
  let n = 0;
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
      n += 1;
    } catch {
      /* ignore */
    }
  }
  return n;
}

export function formatBytes(n: number | null | undefined, locale: string): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = Math.max(0, n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = i === 0 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toLocaleString(locale, { maximumFractionDigits: digits })} ${units[i]}`;
}
