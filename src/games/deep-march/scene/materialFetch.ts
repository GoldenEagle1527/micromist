/**
 * Material file downloads (materialLibrary.ts): the bundled asset URLs, the load
 * tuning and one file fetch with byte progress, retried with a short back-off.
 */
import type { MaterialDownload } from "./materialDownload";

const FILES = import.meta.glob("../assets/materials/*", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const fileUrl = (name: string): string => {
  const u = FILES[`../assets/materials/${name}`];
  if (!u) throw new Error(`missing material file ${name}`);
  return u;
};

export const MATERIAL_LOAD = {
  /** Layers fetched concurrently. */
  inFlight: 4,
  /** One fetch attempt is abandoned after this long (then retried). */
  attemptTimeoutMs: 30000,
  /** Back-off before retry n (× n). */
  retryDelayMs: 700,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch one file with byte progress, retrying failed attempts. `superseded()`:
 * the job was dropped (fallback path switch or dispose) — stop without retrying.
 */
export async function fetchMaterialFile(download: MaterialDownload, file: string, superseded: () => boolean): Promise<ArrayBuffer> {
  for (;;) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), MATERIAL_LOAD.attemptTimeoutMs);
    try {
      const res = await fetch(fileUrl(file), { signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${file}`);
      const reader = res.body?.getReader();
      if (!reader) {
        const buf = await res.arrayBuffer();
        download.progress(file, buf.byteLength);
        return buf;
      }
      const parts: Uint8Array[] = [];
      let n = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (superseded()) throw new Error("superseded");
        parts.push(value);
        n += value.byteLength;
        download.progress(file, n);
      }
      const out = new Uint8Array(n);
      let o = 0;
      for (const p of parts) {
        out.set(p, o);
        o += p.byteLength;
      }
      return out.buffer;
    } catch (e) {
      if (superseded()) throw e;
      if (!download.attemptFailed(file)) throw e;
      await sleep(MATERIAL_LOAD.retryDelayMs * download.attemptsOf(file));
    } finally {
      clearTimeout(timer);
    }
  }
}
