/**
 * Where saves live: a synchronous key → value store. In the game this is the
 * platform game-store (platform/gameStoreBackend.ts); tests use the in-memory one.
 */
export type SaveBackend = {
  read(key: string): unknown;
  write(key: string, value: unknown): void;
};

export function createMemoryBackend(initial: Record<string, unknown> = {}): SaveBackend & { readonly entries: Map<string, unknown> } {
  const entries = new Map<string, unknown>(Object.entries(initial));
  return {
    entries,
    read: (key) => entries.get(key),
    write: (key, value) => {
      entries.set(key, structuredClone(value));
    },
  };
}
