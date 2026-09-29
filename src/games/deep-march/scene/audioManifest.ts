/**
 * Sound manifest (written by scripts/sfx-sync.mjs next to the clips, never in git)
 * and the pure helpers around it: format choice and gapless loop points.
 */
import clipList from "./sfxClips.json";

export type ClipId = keyof typeof clipList.clips;
export const CLIP_IDS = Object.keys(clipList.clips) as ClipId[];

export type SfxFormat = "webm" | "m4a" | "wav";
export type SfxFile = { file: string; bytes: number; priming: number; padding: number };
export type SfxClip = { loop: boolean; frames: number; sampleRate: number; channels: number; files: Partial<Record<SfxFormat, SfxFile>> };
export type SfxManifest = { version: 1; clips: Partial<Record<ClipId, SfxClip>> };

/** MIME types for canPlayType (Web Audio has no codec query of its own). */
export const FORMAT_MIME: Readonly<Record<SfxFormat, string>> = {
  webm: 'audio/webm; codecs="opus"',
  m4a: 'audio/mp4; codecs="mp4a.40.2"',
  wav: "audio/wav",
};
const PREFERENCE: readonly SfxFormat[] = ["webm", "m4a", "wav"];

/**
 * Formats to try, best first: the ones the browser says it plays (Opus in WebM:
 * Chrome / Firefox / Android / Safari ≥ 17.4; AAC: every Safari, also with Lockdown
 * mode), then the rest (iOS once decoded WebM Opus while denying it in canPlayType),
 * so a decode failure can still fall back.
 */
export function formatOrder(canPlayType: ((mime: string) => string) | null): SfxFormat[] {
  if (!canPlayType) return [...PREFERENCE];
  const yes = PREFERENCE.filter((f) => {
    try {
      return canPlayType(FORMAT_MIME[f]) !== "";
    } catch {
      return false;
    }
  });
  return [...yes, ...PREFERENCE.filter((f) => !yes.includes(f))];
}

/** Validate a fetched manifest (anything odd → null = silent). */
export function parseManifest(raw: unknown): SfxManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as { version?: unknown; clips?: unknown };
  if (m.version !== 1 || !m.clips || typeof m.clips !== "object") return null;
  const clips: SfxManifest["clips"] = {};
  for (const id of CLIP_IDS) {
    const c = (m.clips as Record<string, unknown>)[id] as Partial<SfxClip> | undefined;
    if (!c || typeof c !== "object" || !(Number(c.frames) > 0) || !(Number(c.sampleRate) > 0) || !c.files) continue;
    const files: SfxClip["files"] = {};
    for (const f of PREFERENCE) {
      const e = (c.files as Record<string, Partial<SfxFile>>)[f];
      if (e && typeof e.file === "string" && /^[\w.-]+$/.test(e.file)) files[f] = { file: e.file, bytes: Math.max(0, Number(e.bytes) || 0), priming: Math.max(0, Number(e.priming) || 0), padding: Math.max(0, Number(e.padding) || 0) };
    }
    if (Object.keys(files).length) clips[id] = { loop: !!c.loop, frames: Number(c.frames), sampleRate: Number(c.sampleRate), channels: Number(c.channels) || 1, files };
  }
  return { version: 1, clips };
}

/**
 * Loop points (seconds) in a decoded buffer. Decoders differ in how much codec
 * delay they strip (AAC priming via the MP4 edit list, Opus pre-skip, end padding),
 * so the buffer can be the exact source length or longer by priming and/or padding.
 * The extra length tells which: the loop starts after any priming left in and is
 * exactly the source duration long, so no silence or click lands on the seam.
 */
export function loopPoints(bufferDuration: number, clip: Pick<SfxClip, "frames" | "sampleRate">, file: Pick<SfxFile, "priming" | "padding">): { start: number; end: number } {
  const src = clip.frames / clip.sampleRate;
  const extra = bufferDuration - src;
  const cases = [
    { lead: 0, extra: 0 },
    { lead: 0, extra: file.padding },
    { lead: file.priming, extra: file.priming },
    { lead: file.priming, extra: file.priming + file.padding },
  ];
  let best = cases[0];
  for (const c of cases) if (Math.abs(c.extra - extra) < Math.abs(best.extra - extra)) best = c;
  const start = Math.max(0, Math.min(best.lead, bufferDuration));
  return { start, end: Math.min(bufferDuration, start + src) };
}
