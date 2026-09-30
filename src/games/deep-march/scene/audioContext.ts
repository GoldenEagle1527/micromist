/**
 * One AudioContext per page session, shared by every dive.
 *
 * Browsers cap the number of live contexts (older Safari: ~4–6) and each one costs
 * a hardware stream, so the dive-start click acquires (or reuses) the shared context
 * and leaving a dive only suspends it; the game's unmount closes it.
 *
 * Never throws: no Web Audio (some in-app browsers), only the prefixed
 * `webkitAudioContext` (Safari < 14.1) or a constructor that fails (context limit,
 * blocked audio) all resolve to "no audio" and the dive starts silent.
 */
type AudioCtor = new () => AudioContext;

/** Where the constructors live (window in the browser; injectable for node tests). */
export type AudioHost = { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };

let shared: AudioContext | null = null;

export function audioContextCtor(host: AudioHost = globalThis as AudioHost): AudioCtor | null {
  return host.AudioContext ?? host.webkitAudioContext ?? null;
}

/**
 * The shared context, created on first use. Call inside a user gesture: the resume()
 * issued here is what unlocks playback on iOS / Chrome autoplay rules.
 */
export function acquireAudioContext(host?: AudioHost): AudioContext | null {
  if (!shared || shared.state === "closed") {
    shared = null;
    const Ctor = audioContextCtor(host);
    if (!Ctor) return null;
    try {
      shared = new Ctor();
    } catch (err) {
      console.info("deep-march audio: no AudioContext, playing silent", err);
      return null;
    }
  }
  try {
    void shared.resume().catch(() => {});
  } catch {
    /* resume unsupported in this state */
  }
  return shared;
}

/** Leaving a dive: keep the context for the next one, but stop the hardware stream. */
export function releaseAudioContext(): void {
  const ctx = shared;
  if (!ctx || ctx.state !== "running") return;
  try {
    void ctx.suspend().catch(() => {});
  } catch {
    /* already closing */
  }
}

/** The game unmounted: drop the context for good. */
export function closeAudioContext(): void {
  const ctx = shared;
  shared = null;
  if (!ctx || ctx.state === "closed") return;
  try {
    void ctx.close().catch(() => {});
  } catch {
    /* already closed */
  }
}

/** Test hook: the context currently shared (null when none). */
export function sharedAudioContext(): AudioContext | null {
  return shared;
}
