/**
 * Throttled save writes (design doc §10.2): changes mark the save dirty; it is
 * written at most once per `intervalMs`, and at once on flush (leaving the dive,
 * page hidden). Time and timers are injected, so the policy is unit-tested.
 */
export type WriterClock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type SaveWriter = {
  markDirty(): void;
  /** Write now if anything changed since the last write. */
  flush(): void;
  /** Stop the pending timer (does not write). */
  dispose(): void;
  readonly dirty: boolean;
};

export const systemClock: WriterClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createSaveWriter(write: () => void, intervalMs: number, clock: WriterClock = systemClock): SaveWriter {
  let dirty = false;
  // opening a slot (read or first write) counts as a write: the first change waits a full interval
  let lastWrite = clock.now();
  let timer: unknown = null;

  const cancelTimer = () => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  };
  const writeNow = () => {
    cancelTimer();
    if (!dirty) return;
    dirty = false;
    lastWrite = clock.now();
    write();
  };

  return {
    markDirty() {
      dirty = true;
      if (timer !== null) return;
      const wait = Math.max(0, lastWrite + intervalMs - clock.now());
      timer = clock.setTimeout(writeNow, wait);
    },
    flush: writeNow,
    dispose: cancelTimer,
    get dirty() {
      return dirty;
    },
  };
}
