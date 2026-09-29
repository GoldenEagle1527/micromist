/**
 * 06 Audio systems: the sound clips (scene/audio.ts). Optional: a silent dive is
 * fine, so failures settle as "warn" and the gate stops waiting after the audio
 * deadline (slow clips finish in the background).
 */
import type { LoadingStepDef } from "./types";

const FORMAT_NAME = { webm: "Opus (WebM)", m4a: "AAC (M4A)", wav: "PCM (WAV)" } as const;

export const audioStep: LoadingStepDef = {
  id: "audio",
  weight: 3,
  required: false,
  evaluate(snap, { L }) {
    const a = snap?.audio;
    if (!a) return { state: "pending", lines: [] };
    if (a.state === "off") return { state: "done", lines: [L.audioOff] };
    const kb = (n: number) => (n / 1024).toFixed(0);
    const count = L.audioCount(a.done, a.total, kb(a.bytes), kb(a.totalBytes));
    const diag = [];
    if (a.format) diag.push({ label: L.diag.audioFormat, value: FORMAT_NAME[a.format] });
    if (a.missing.length) diag.push({ label: L.diag.audioMissing, value: a.missing.join(", ") });
    if (a.state === "ready") return { state: "done", lines: [count], diag };
    if (a.state === "silent") return { state: "warn", lines: [L.audioSilent], diag };
    if (a.state === "partial") return { state: "warn", lines: [count, L.audioPartial(a.missing.join(", "))], diag };
    // loading
    if (a.late) return { state: "warn", lines: [count, L.audioLate], diag };
    if (a.totalBytes === 0) return { state: "active", lines: [L.audioConnecting], diag };
    return { state: "active", done: a.bytes, total: a.totalBytes, lines: [count], diag };
  },
};
