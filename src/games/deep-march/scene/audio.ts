/**
 * Dive audio (Web Audio). Clips are cut from the asset library (Universal Sound FX):
 *   ambience — AMBIENCE_Under_Water_Deep_Dark_loop (loop)
 *   swim     — SWIM_Water_01_loop (loop, gain follows speed)
 *   sonar    — SUBMARINE_Sonar_Ping_05_Pop_Short
 *   switch   — BUTTON_Plastic_Light_Switch_On
 *   mode     — UI_SCI-FI_Tone_Bright_Dry_08
 *   bump     — IMPACT_Concrete_Slab_on_Concrete_Slab_Deep (low-passed)
 *   warn     — NOTIFICATION_Digital_05
 *
 * The clips are a purchased, licensed pack and are NOT in the open-source repo
 * (public/deep-march/sfx/ is generated and git-ignored by scripts/sfx-sync.mjs; see
 * assets/CREDITS.md). They ship as Opus in WebM with an AAC (.m4a) fallback, listed
 * in sfx/manifest.json (audioManifest.ts). Loading is part of the pre-dive pipeline
 * (status() → loading screen step "audio") but never blocks the dive: every clip is
 * optional — a missing manifest or file, a non-audio response (SPA fallback), a
 * decode failure or a timeout only silences that sound, and the world's gate stops
 * waiting a few seconds after everything else is in (world.ts, AUDIO_GRACE_MS) while
 * slow clips keep loading in the background.
 *
 * Pass the shared AudioContext acquired inside the dive-start click
 * (audioContext.ts) so playback is allowed; AudioLifecycle (audioLifecycle.ts)
 * keeps it running across gestures, background / iOS interruptions and GPU loss.
 * ?audio=0 skips the mixer entirely.
 */
import { AudioLifecycle, type HoldReason, type LifecycleEnv } from "./audioLifecycle";
import { CLIP_IDS, formatOrder, loopPoints, parseManifest, type ClipId, type SfxClip, type SfxFile, type SfxFormat, type SfxManifest } from "./audioManifest";

export type LoopId = "ambience" | "swim";
export type ShotId = "sonar" | "switch" | "mode" | "bump" | "warn";

export type ShotOpts = { gain?: number; rate?: number; lowpass?: number };

export type AudioStatus = {
  /** off: no mixer (?audio=0 / no Web Audio) · loading · ready: all clips · partial · silent: none */
  state: "off" | "loading" | "ready" | "partial" | "silent";
  /** Every clip resolved (loaded or given up), or the world stopped waiting (late). */
  settled: boolean;
  /** The world's gate stopped waiting while clips still load in the background (world.ts). */
  late: boolean;
  done: number;
  failed: number;
  total: number;
  bytes: number;
  totalBytes: number;
  /** Format of the loaded clips (the first one that decoded). */
  format: SfxFormat | null;
  missing: ClipId[];
};

export type DiveAudio = {
  /** Keep audio stopped for `reason` (tab hidden is tracked automatically). */
  hold: (reason: HoldReason, on: boolean) => void;
  setLoop: (id: LoopId, gain: number) => void;
  /** Ease loop gains toward the targets set this frame. */
  tick: (dt: number) => void;
  play: (id: ShotId, opts?: ShotOpts) => void;
  status: () => AudioStatus;
  dispose: () => void;
};

export type DiveAudioOptions = {
  /** Gesture / visibility sources (null: no lifecycle, node tests). */
  env?: LifecycleEnv | null;
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
  canPlayType?: ((mime: string) => string) | null;
  /** Per file attempt (fetch + body). */
  clipTimeoutMs?: number;
  base?: string;
};

export const CLIP_TIMEOUT_MS = 10_000;
const MASTER_GAIN = 0.85;

const OFF: AudioStatus = { state: "off", settled: true, late: false, done: 0, failed: 0, total: 0, bytes: 0, totalBytes: 0, format: null, missing: [] };

const noop: DiveAudio = {
  hold: () => {},
  setLoop: () => {},
  tick: () => {},
  play: () => {},
  status: () => OFF,
  dispose: () => {},
};

function browserEnv(): LifecycleEnv | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  return { win: window, doc: document, isHidden: () => document.hidden };
}

function browserCanPlay(): ((mime: string) => string) | null {
  if (typeof document === "undefined") return null;
  try {
    const el = document.createElement("audio");
    return typeof el.canPlayType === "function" ? (m) => el.canPlayType(m) : null;
  } catch {
    return null;
  }
}

type Loaded = { buf: AudioBuffer; start: number; end: number };

export function createDiveAudio(ctx: AudioContext | null, opts: DiveAudioOptions = {}): DiveAudio {
  if (!ctx) return noop;
  const env = opts.env === undefined ? browserEnv() : opts.env;
  const lifecycle = env ? new AudioLifecycle(ctx, env) : null;
  const fetcher = opts.fetcher ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const base = opts.base ?? `${import.meta.env.BASE_URL}deep-march/sfx/`;
  const clipTimeout = opts.clipTimeoutMs ?? CLIP_TIMEOUT_MS;

  const master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(ctx.destination);

  const buffers = new Map<ClipId, Loaded>();
  const targets: Record<LoopId, number> = { ambience: 0, swim: 0 };
  const loops = new Map<LoopId, GainNode>();
  const sources: AudioBufferSourceNode[] = [];
  let alive = true;

  // ---- loading (status() feeds the loading screen) ----
  const st = { state: "loading" as AudioStatus["state"], done: 0, failed: 0, format: null as SfxFormat | null, missing: [] as ClipId[] };
  const expected = new Map<ClipId, number>();
  const received = new Map<ClipId, number>();
  const settle = () => {
    if (st.done + st.failed < CLIP_IDS.length) return;
    st.state = st.failed === 0 ? "ready" : st.done > 0 ? "partial" : "silent";
    if (st.done === 0) console.info("deep-march audio: sound files not found, playing silent");
  };
  const fail = (id: ClipId) => {
    st.failed++;
    st.missing.push(id);
    received.set(id, expected.get(id) ?? 0);
    settle();
  };
  const loadOne = async (id: ClipId, clip: SfxClip, files: [SfxFormat, SfxFile][]) => {
    for (const [fmt, file] of files) {
      const data = await fetchBytes(fetcher, base + file.file, clipTimeout, (n) => {
        if (alive) received.set(id, Math.max(received.get(id) ?? 0, Math.min(n, expected.get(id) ?? n)));
      });
      if (!alive) return;
      if (!data) continue;
      const buf = await decode(ctx, data);
      if (!alive) return;
      if (!buf) continue;
      const lp = loopPoints(buf.duration, clip, file);
      buffers.set(id, { buf, start: lp.start, end: lp.end });
      received.set(id, expected.get(id) ?? file.bytes);
      st.format ??= fmt;
      st.done++;
      settle();
      return;
    }
    fail(id);
  };
  void (async () => {
    const manifest = await fetchManifest(fetcher, base + "manifest.json", clipTimeout);
    if (!alive) return;
    const order = formatOrder(opts.canPlayType === undefined ? browserCanPlay() : opts.canPlayType);
    const jobs: Promise<void>[] = [];
    for (const id of CLIP_IDS) {
      const clip = manifest?.clips[id];
      const files = clip ? order.flatMap((f): [SfxFormat, SfxFile][] => (clip.files[f] ? [[f, clip.files[f]!]] : [])) : [];
      if (!clip || !files.length) {
        fail(id);
        continue;
      }
      expected.set(id, files[0][1].bytes);
      jobs.push(loadOne(id, clip, files));
    }
    await Promise.all(jobs);
  })().catch(() => {
    /* every path above resolves; belt and braces */
  });

  const status = (): AudioStatus => {
    const total = CLIP_IDS.length;
    const resolved = st.done + st.failed >= total;
    let bytes = 0;
    let totalBytes = 0;
    for (const v of expected.values()) totalBytes += v;
    for (const v of received.values()) bytes += v;
    return { state: st.state, settled: resolved, late: false, done: st.done, failed: st.failed, total, bytes: Math.min(bytes, totalBytes), totalBytes, format: st.format, missing: [...st.missing] };
  };

  // ---- mixer ----
  const startLoop = (id: LoopId) => {
    const clip = buffers.get(id);
    if (!clip || loops.has(id) || !alive) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);
    const src = ctx.createBufferSource();
    src.buffer = clip.buf;
    src.loop = true;
    // gapless: exactly the source length, after any codec priming the decoder kept
    src.loopStart = clip.start;
    src.loopEnd = clip.end;
    src.connect(gain);
    src.start(0, clip.start);
    sources.push(src);
    loops.set(id, gain);
  };

  return {
    hold: (reason, on) => lifecycle?.hold(reason, on),
    setLoop: (id, gain) => {
      targets[id] = gain;
    },
    tick: (dt) => {
      if (loops.size < 2) {
        startLoop("ambience");
        startLoop("swim");
      }
      const k = 1 - Math.exp(-dt * 4);
      for (const [id, node] of loops) {
        node.gain.value += (targets[id] - node.gain.value) * k;
      }
    },
    play: (id, o) => {
      const clip = buffers.get(id);
      if (!clip || ctx.state !== "running") return;
      const src = ctx.createBufferSource();
      src.buffer = clip.buf;
      src.playbackRate.value = o?.rate ?? 1;
      let node: AudioNode = src;
      if (o?.lowpass) {
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = o.lowpass;
        src.connect(filter);
        node = filter;
      }
      const gain = ctx.createGain();
      gain.gain.value = o?.gain ?? 1;
      node.connect(gain);
      gain.connect(master);
      src.start(0, clip.start, clip.end - clip.start);
      src.onended = () => {
        const i = sources.indexOf(src);
        if (i >= 0) sources.splice(i, 1);
      };
      sources.push(src);
    },
    status,
    dispose: () => {
      alive = false;
      lifecycle?.dispose();
      if (ctx.state === "closed") return;
      for (const src of sources) {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
      }
      sources.length = 0;
      try {
        master.disconnect();
      } catch {
        /* context already closing */
      }
    },
  };
}

/** The manifest, or null (absent, SPA fallback page, malformed, timeout). */
async function fetchManifest(fetcher: NonNullable<DiveAudioOptions["fetcher"]>, url: string, timeoutMs: number): Promise<SfxManifest | null> {
  const data = await fetchBytes(fetcher, url, timeoutMs, () => {}, { cache: "no-cache" }, true);
  if (!data) return null;
  try {
    return parseManifest(JSON.parse(new TextDecoder().decode(data)));
  } catch {
    return null;
  }
}

/**
 * Fetch a file with a timeout, reporting received bytes as the body streams in.
 * Resolves null (never rejects) on HTTP errors, a text response where audio was
 * expected (the SPA fallback serves index.html with 200), network errors or timeout.
 */
export async function fetchBytes(
  fetcher: NonNullable<DiveAudioOptions["fetcher"]>,
  url: string,
  timeoutMs: number,
  onBytes: (n: number) => void,
  init: RequestInit = {},
  textOk = false,
): Promise<ArrayBuffer | null> {
  const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timedOut = false;
  let expire: (v: null) => void = () => {};
  const deadline = new Promise<null>((r) => (expire = r));
  const timer = setTimeout(() => {
    timedOut = true;
    ac?.abort();
    expire(null);
  }, timeoutMs);
  try {
    const res = await Promise.race([fetcher(url, { ...init, signal: ac?.signal }), deadline]);
    if (!res || timedOut || !res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!textOk && type.startsWith("text/")) return null;
    if (textOk && type.startsWith("text/html")) return null;
    const reader = res.body?.getReader?.();
    if (!reader) {
      const buf = await Promise.race([res.arrayBuffer(), deadline]);
      if (!buf || timedOut) return null;
      onBytes(buf.byteLength);
      return buf;
    }
    const chunks: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const r = await Promise.race([reader.read(), deadline]);
      if (!r || timedOut) {
        reader.cancel().catch(() => {});
        return null;
      }
      const { done, value } = r;
      if (done) break;
      chunks.push(value);
      n += value.byteLength;
      onBytes(n);
    }
    const out = new Uint8Array(n);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.byteLength;
    }
    return out.buffer;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** decodeAudioData, promise or callback style (prefixed Safari), null on failure. */
function decode(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer | null> {
  return new Promise((resolve) => {
    try {
      const p = ctx.decodeAudioData(data, resolve, () => resolve(null)) as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === "function") p.then(resolve, () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}
