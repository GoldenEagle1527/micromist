/**
 * Dive audio tests (node, fakes only — no real audio, no browser):
 * - loading: manifest + per-clip files, format order (Opus WebM → AAC → WAV),
 *   decode fallback, streamed byte progress, timeouts, missing / partial / broken
 *   files → quiet silence (the sfx pack is licensed and never in the repo);
 * - gapless loop points from the source frame count and codec priming / padding;
 * - volume / mute (settings validation, master gain, mute suspends the context);
 * - AudioLifecycle (gestures, visibility, iOS interruption, GPU hold) and the shared
 *   AudioContext (never throws, webkit fallback, no duplicates);
 * - the chaos insert (M8): identity bypass, wet path and rumble on demand.
 * Run: npm run test:audio
 */
import { createDiveAudio, fetchBytes, type AudioStatus } from "../src/games/deep-march/scene/audio";
import { CLIP_IDS, FORMAT_MIME, formatOrder, loopPoints, parseManifest, type SfxManifest } from "../src/games/deep-march/scene/audioManifest";
import { acquireAudioContext, audioContextCtor, closeAudioContext, releaseAudioContext, sharedAudioContext } from "../src/games/deep-march/scene/audioContext";
import { AudioLifecycle, UNLOCK_EVENTS, type LifecycleEnv } from "../src/games/deep-march/scene/audioLifecycle";
import { BUMP_TUNING, BumpCue, CUE_INTERVAL, CueLimiter } from "../src/games/deep-march/scene/audioCues";
import { DEFAULT_SOUND, parseSound } from "../src/games/deep-march/settings";
import { FakeAudioContext, flush } from "./lib/fakeAudio";
import { chaosAudioChecks } from "./lib/chaosAudioChecks";
import { DEFAULT_DIVE_PARAMS } from "../src/games/deep-march/scene/dive/params";

let failed = 0;
const check = (name: string, ok: boolean, info = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${info ? `: ${info}` : ""}`);
  if (!ok) failed++;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const resp = (status: number, type: string, body: BodyInit | null) => new Response(body, { status, headers: { "content-type": type } });

type Served = { status?: number; type?: string; body?: Uint8Array | string; hang?: "fetch" | "body" };
function server(files: Record<string, Served>) {
  const hits: string[] = [];
  const fetcher = async (url: string) => {
    hits.push(url);
    const f = files[url.replace(/^.*\//, "")];
    if (!f) return resp(404, "text/plain", "not found");
    if (f.hang === "fetch") return new Promise<Response>(() => {});
    if (f.hang === "body") {
      const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(10)); } });
      return new Response(stream, { status: 200, headers: { "content-type": "audio/webm" } });
    }
    return resp(f.status ?? 200, f.type ?? "application/octet-stream", typeof f.body === "string" ? f.body : (f.body ?? new Uint8Array(0)));
  };
  return { fetcher, hits };
}

/** A manifest for every clip (or `only`), webm + m4a, AAC-like delays. */
function manifestFor(only: readonly string[] = CLIP_IDS, formats: readonly ("webm" | "m4a" | "wav")[] = ["webm", "m4a"]): SfxManifest {
  const clips: Record<string, unknown> = {};
  for (const id of only) {
    const files: Record<string, unknown> = {};
    for (const f of formats) files[f] = { file: `${id}.abc123.${f}`, bytes: 1000, priming: f === "m4a" ? 1024 / 44100 : 312 / 48000, padding: f === "m4a" ? 888 / 44100 : 648 / 48000 };
    clips[id] = { loop: ["ambience", "swim", "flow", "dread", "reactor"].includes(id), frames: 22050, sampleRate: 22050, channels: 1, files };
  }
  return { version: 1, clips } as SfxManifest;
}
/** Files for a manifest: first byte tags the format for the fake decoder. */
function filesFor(m: SfxManifest, extra: Record<string, Served> = {}): Record<string, Served> {
  const out: Record<string, Served> = { "manifest.json": { type: "application/json", body: JSON.stringify(m) } };
  for (const c of Object.values(m.clips)) for (const [fmt, f] of Object.entries(c!.files)) out[f!.file] = { type: fmt === "m4a" ? "audio/mp4" : "audio/webm", body: new Uint8Array(1000).fill(fmt.charCodeAt(0)) };
  return { ...out, ...extra };
}
function ctxDecoding(bad: string[] = []) {
  const ctx = new FakeAudioContext();
  ctx.state = "running";
  ctx.decode = async (data: ArrayBuffer) => {
    const tag = String.fromCharCode(new Uint8Array(data)[0] ?? 0);
    if (bad.includes(tag)) throw new Error("EncodingError");
    // untrimmed AAC-like buffer for m4a, exact length for webm
    return { duration: tag === "m" ? 1 + (1024 + 888) / 44100 : 1, length: 48000, sampleRate: 48000, numberOfChannels: 1, tag };
  };
  return ctx;
}
async function until(fn: () => boolean, ms = 2000) {
  const t = Date.now();
  while (!fn() && Date.now() - t < ms) await sleep(2);
  return fn();
}

async function main() {
  const rejections: unknown[] = [];
  process.on("unhandledRejection", (e) => rejections.push(e));
  const infos: unknown[] = [];
  const origInfo = console.info;
  console.info = (...a: unknown[]) => void infos.push(a);

  console.log("fetch");
  {
    const { fetcher } = server({ "a.webm": { type: "audio/webm", body: new Uint8Array(5000) }, "page": { type: "text/html", body: "<!doctype html>" }, "hang": { hang: "fetch" }, "stall": { hang: "body" } });
    const seen: number[] = [];
    const buf = await fetchBytes(fetcher, "/x/a.webm", 1000, (n) => seen.push(n));
    check("200 audio: bytes, streamed progress", buf?.byteLength === 5000 && seen.length >= 1 && seen[seen.length - 1] === 5000, `${seen.join(",")}`);
    check("404 → null", (await fetchBytes(fetcher, "/x/none.webm", 1000, () => {})) === null);
    check("SPA index.html fallback (200 text/html) → null", (await fetchBytes(fetcher, "/x/page", 1000, () => {})) === null);
    check("network error → null", (await fetchBytes(async () => { throw new TypeError("offline"); }, "/x", 1000, () => {})) === null);
    const t0 = Date.now();
    check("request that never answers → null after the timeout", (await fetchBytes(fetcher, "/x/hang", 40, () => {})) === null && Date.now() - t0 < 1000);
    check("body that stalls → null after the timeout", (await fetchBytes(fetcher, "/x/stall", 40, () => {})) === null);
  }

  console.log("formats + manifest + loop points");
  {
    const yes = (list: string[]) => (m: string) => (list.includes(m) ? "probably" : "");
    check("Opus WebM first when playable", formatOrder(yes([FORMAT_MIME.webm, FORMAT_MIME.m4a])).join() === "webm,m4a,wav");
    check("old Safari (AAC only): m4a first, WebM still tried after", formatOrder(yes([FORMAT_MIME.m4a])).join() === "m4a,webm,wav");
    check("no canPlayType: default order", formatOrder(null).join() === "webm,m4a,wav");
    check("canPlayType throwing: default order", formatOrder(() => { throw new Error("x"); }).join() === "webm,m4a,wav");
    check("manifest: wrong version / junk → null", parseManifest({ version: 2, clips: {} }) === null && parseManifest("x") === null && parseManifest(null) === null);
    const pm = parseManifest({ version: 1, clips: { bump: { frames: 10, sampleRate: 22050, files: { webm: { file: "../../etc/passwd", bytes: 1 }, m4a: { file: "bump.1.m4a", bytes: 2 } } }, nope: { frames: 1, sampleRate: 1, files: { webm: { file: "n.webm" } } } } });
    check("manifest: unsafe file names and unknown clips dropped", !!pm && Object.keys(pm.clips).join() === "bump" && !pm.clips.bump!.files.webm && pm.clips.bump!.files.m4a!.file === "bump.1.m4a");
    const clip = { frames: 229080, sampleRate: 22050 };
    const src = clip.frames / clip.sampleRate;
    const aac = { priming: 1024 / 44100, padding: 888 / 44100 };
    const opus = { priming: 312 / 48000, padding: 648 / 48000 };
    const eq = (a: number, b: number) => Math.abs(a - b) < 1e-6;
    const cases: [string, number, typeof aac, number][] = [
      ["exact buffer (decoder trimmed both ends)", src, aac, 0],
      ["AAC, edit list honoured (end padding left)", src + aac.padding, aac, 0],
      ["AAC, edit list ignored (priming + padding left)", src + aac.priming + aac.padding, aac, aac.priming],
      ["AAC, priming left, padding cut", src + aac.priming, aac, aac.priming],
      ["Opus, pre-skip not applied", src + opus.priming + opus.padding, opus, opus.priming],
      ["Opus, trimmed", src, opus, 0],
    ];
    for (const [name, dur, d, lead] of cases) {
      const lp = loopPoints(dur, clip, d);
      check(`loop points: ${name}`, eq(lp.start, lead) && eq(lp.end - lp.start, src), `start ${(lp.start * 1000).toFixed(2)} ms, length ${(lp.end - lp.start).toFixed(6)} s (source ${src.toFixed(6)})`);
    }
    const short = loopPoints(src - 0.01, clip, aac);
    check("loop points: shorter buffer clamps to it", short.start === 0 && eq(short.end, src - 0.01));
  }

  console.log("mixer loading");
  // everything present: Opus WebM chosen, progress to 100%, loops gapless
  {
    const m = manifestFor();
    const { fetcher, hits } = server(filesFor(m));
    const ctx = ctxDecoding();
    const a = createDiveAudio(ctx as unknown as AudioContext, { env: null, fetcher, canPlayType: (t) => (t === FORMAT_MIME.webm || t === FORMAT_MIME.m4a ? "maybe" : ""), base: "/sfx/" });
    const s0 = a.status();
    check("starts loading, not settled", s0.state === "loading" && !s0.settled && s0.total === CLIP_IDS.length);
    await until(() => a.status().settled);
    const s = a.status();
    check("all clips: ready, settled, webm", s.state === "ready" && s.settled && s.done === CLIP_IDS.length && s.failed === 0 && s.format === "webm", JSON.stringify({ state: s.state, done: s.done, format: s.format }));
    check("byte progress complete", s.totalBytes === 1000 * CLIP_IDS.length && s.bytes === 1000 * CLIP_IDS.length, `${s.bytes}/${s.totalBytes}`);
    check(`only manifest + ${CLIP_IDS.length} webm fetched`, hits.length === CLIP_IDS.length + 1 && hits.every((h) => h.startsWith("/sfx/")) && hits.filter((h) => h.endsWith(".webm")).length === CLIP_IDS.length);
    a.setLoop("ambience", 0.4);
    a.tick(0.016);
    const loops = ctx.sources.filter((x) => x.loop);
    check("both loops started with loop points (whole exact buffer)", loops.length === 2 && loops.every((x) => x.loopStart === 0 && x.loopEnd === 1 && x.startArgs[1] === 0));
    a.play("bump", { lowpass: 480 });
    const shot = ctx.sources[ctx.sources.length - 1];
    check("one-shot plays source length from its start", !shot.loop && shot.startArgs[1] === 0 && shot.startArgs[2] === 1);
    a.dispose();
  }
  // WebM decode fails (e.g. Lockdown mode): AAC fallback, loop skips the priming
  {
    const m = manifestFor();
    const { fetcher, hits } = server(filesFor(m));
    const ctx = ctxDecoding(["w"]);
    const a = createDiveAudio(ctx as unknown as AudioContext, { env: null, fetcher, canPlayType: () => "maybe", base: "/sfx/" });
    await until(() => a.status().settled);
    const s = a.status();
    check("WebM undecodable → AAC fallback for every clip", s.state === "ready" && s.format === "m4a" && hits.filter((h) => h.endsWith(".m4a")).length === CLIP_IDS.length, `${s.state} ${s.format}`);
    a.tick(0.016);
    const amb = ctx.sources.find((x) => x.loop)!;
    const src = 22050 / 22050;
    check("AAC loop starts after the priming, exact source length", Math.abs(amb.loopStart - 1024 / 44100) < 1e-6 && Math.abs(amb.loopEnd - amb.loopStart - src) < 1e-6 && Math.abs(amb.startArgs[1] - amb.loopStart) < 1e-9);
    check("progress still complete after fallback", s.bytes === s.totalBytes && s.totalBytes > 0);
    a.dispose();
  }
  // old Safari: m4a first by canPlayType
  {
    const m = manifestFor();
    const { fetcher, hits } = server(filesFor(m));
    const a = createDiveAudio(ctxDecoding() as unknown as AudioContext, { env: null, fetcher, canPlayType: (t) => (t === FORMAT_MIME.m4a ? "maybe" : ""), base: "/sfx/" });
    await until(() => a.status().settled);
    check("AAC-only browser fetches m4a, never webm", a.status().format === "m4a" && !hits.some((h) => h.endsWith(".webm")));
    a.dispose();
  }
  // no manifest (licensed files absent): silent, settled, quiet
  {
    const before = infos.length;
    const { fetcher } = server({});
    const a = createDiveAudio(ctxDecoding() as unknown as AudioContext, { env: null, fetcher, canPlayType: null, base: "/sfx/" });
    await until(() => a.status().settled);
    const s = a.status();
    check("no manifest → silent, settled, all missing", s.state === "silent" && s.settled && s.failed === CLIP_IDS.length && s.missing.length === CLIP_IDS.length);
    check("no manifest → one quiet info line", infos.length - before === 1, `${infos.length - before}`);
    let threw = false;
    try {
      a.setLoop("ambience", 0.4);
      a.tick(0.016);
      a.play("sonar");
      a.hold("gpu", true);
      a.hold("gpu", false);
      a.dispose();
    } catch {
      threw = true;
    }
    check("silent mixer: every call is a no-op", !threw);
  }
  // manifest is the SPA fallback page (200 text/html)
  {
    const { fetcher } = server({ "manifest.json": { type: "text/html", body: "<!doctype html>" } });
    const a = createDiveAudio(ctxDecoding() as unknown as AudioContext, { env: null, fetcher, canPlayType: null, base: "/sfx/" });
    await until(() => a.status().settled);
    check("manifest = SPA index.html → silent", a.status().state === "silent");
    a.dispose();
  }
  // partial: one clip absent from the manifest, one file 404, one hangs
  {
    const m = manifestFor(CLIP_IDS.filter((id) => id !== "bump"));
    const files = filesFor(m);
    delete files[m.clips.warn!.files.webm!.file];
    delete files[m.clips.warn!.files.m4a!.file];
    files[m.clips.mode!.files.webm!.file] = { hang: "fetch" };
    files[m.clips.mode!.files.m4a!.file] = { hang: "body" };
    const { fetcher } = server(files);
    const a = createDiveAudio(ctxDecoding() as unknown as AudioContext, { env: null, fetcher, canPlayType: null, clipTimeoutMs: 40, base: "/sfx/" });
    await until(() => a.status().settled);
    const s = a.status();
    check("partial: missing / 404 / timed-out clips given up, rest ready", s.state === "partial" && s.done === CLIP_IDS.length - 3 && s.failed === 3 && [...s.missing].sort().join() === "bump,mode,warn", `${s.state} ${s.done}/${s.failed} ${s.missing.join()}`);
    check("partial: progress reaches the total (given-up clips count as resolved)", s.bytes === s.totalBytes, `${s.bytes}/${s.totalBytes}`);
    let threw = false;
    try {
      a.play("bump");
      a.play("warn");
      a.play("sonar");
    } catch {
      threw = true;
    }
    check("partial: missing sounds are silent, others play", !threw);
    a.dispose();
  }
  // progress is monotonic while bytes stream
  {
    const m = manifestFor();
    const { fetcher } = server(filesFor(m));
    const a = createDiveAudio(ctxDecoding() as unknown as AudioContext, { env: null, fetcher, canPlayType: null, base: "/sfx/" });
    let prev = -1, mono = true;
    const statuses: AudioStatus[] = [];
    while (!a.status().settled) {
      const s = a.status();
      statuses.push(s);
      if (s.bytes < prev) mono = false;
      prev = s.bytes;
      await sleep(0);
    }
    check("byte progress monotonic", mono, `${statuses.length} samples`);
    a.dispose();
  }
  // null context (debug panel sound off / no Web Audio): off, settled
  {
    const a = createDiveAudio(null);
    check("no context → off, settled", a.status().state === "off" && a.status().settled);
  }
  // disposed while loading: nothing after
  {
    const m = manifestFor();
    const { fetcher } = server(filesFor(m));
    const ctx = ctxDecoding();
    const a = createDiveAudio(ctx as unknown as AudioContext, { env: null, fetcher, canPlayType: null, base: "/sfx/" });
    a.dispose();
    await sleep(20);
    a.tick(0.016);
    check("disposed while loading: no sources started", ctx.sources.length === 0);
  }
  console.info = origInfo;
  check("no unhandled rejections anywhere", rejections.length === 0, `${rejections.length}`);

  console.log("cues");
  cueChecks();

  console.log("volume / mute");
  await soundChecks();

  console.log("lifecycle + context");
  await lifecycleChecks();
  await contextChecks();

  console.log("chaos insert (M8)");
  await chaosAudioChecks(check);

  if (failed) {
    console.log(`${failed} audio check(s) failed`);
    process.exit(1);
  }
  console.log("all audio checks passed");
}

class FakeDoc extends EventTarget {
  hidden = false;
  set(hidden: boolean) {
    this.hidden = hidden;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

function lifecycleEnv() {
  const win = new EventTarget();
  const doc = new FakeDoc();
  const env: LifecycleEnv = { win, doc, isHidden: () => doc.hidden };
  return { win, doc, env };
}

async function lifecycleChecks() {
  // start inside the click: resumes right away
  {
    const ctx = new FakeAudioContext();
    const { env } = lifecycleEnv();
    const lc = new AudioLifecycle(ctx, env);
    await flush();
    check("lifecycle: resumes a suspended context on creation", ctx.state === "running", ctx.state);
    lc.dispose();
  }
  // gesture needed (iOS): resume refused until touchend / click / pointerup / keydown
  for (const ev of UNLOCK_EVENTS) {
    const ctx = new FakeAudioContext();
    ctx.resumeBlocked = true;
    const { win, env } = lifecycleEnv();
    const lc = new AudioLifecycle(ctx, env);
    await flush();
    const before = ctx.state;
    ctx.resumeBlocked = false;
    win.dispatchEvent(new Event(ev));
    await flush();
    check(`lifecycle: ${ev} unlocks a blocked context`, before === "suspended" && ctx.state === "running", `${before} → ${ctx.state}`);
    lc.dispose();
  }
  // pointerdown alone does not count as activation on iOS: not relied on
  check("lifecycle: unlock events are touchend/click/pointerup/keydown", UNLOCK_EVENTS.join() === "touchend,click,pointerup,keydown");
  // background → suspend; back → resume; iOS "interrupted" → retried on the next gesture
  {
    const ctx = new FakeAudioContext();
    const { win, doc, env } = lifecycleEnv();
    const lc = new AudioLifecycle(ctx, env);
    await flush();
    doc.set(true);
    await flush();
    const hiddenState = ctx.state;
    // a gesture while hidden must not resume
    win.dispatchEvent(new Event("click"));
    await flush();
    const stillHidden = ctx.state;
    doc.set(false);
    await flush();
    check("lifecycle: hidden tab suspends, visible resumes", hiddenState === "suspended" && stillHidden === "suspended" && ctx.state === "running", `${hiddenState}/${stillHidden}/${ctx.state}`);
    // interruption (phone call): state flips outside our control, resume refused at first
    ctx.resumeBlocked = true;
    ctx.setState("interrupted");
    await flush();
    const interrupted = ctx.state;
    ctx.resumeBlocked = false;
    win.dispatchEvent(new Event("touchend"));
    await flush();
    check("lifecycle: interrupted → resumed by the next gesture", interrupted === "interrupted" && ctx.state === "running", `${interrupted} → ${ctx.state}`);
    // statechange alone retries (interruption ended, resume allowed again)
    ctx.setState("suspended");
    await flush();
    check("lifecycle: statechange to suspended retries resume", ctx.state === "running", ctx.state);
    // back-forward cache: pageshow with the page visible resumes
    ctx.resumeBlocked = true;
    ctx.setState("suspended");
    await flush();
    ctx.resumeBlocked = false;
    win.dispatchEvent(new Event("pageshow"));
    await flush();
    check("lifecycle: pageshow resumes", ctx.state === "running", ctx.state);
    // GPU context lost: held until restored, gestures don't override the hold
    lc.hold("gpu", true);
    await flush();
    const lost = ctx.state;
    win.dispatchEvent(new Event("click"));
    await flush();
    const lostAfterClick = ctx.state;
    lc.hold("gpu", false);
    await flush();
    check("lifecycle: gpu hold suspends until released", lost === "suspended" && lostAfterClick === "suspended" && ctx.state === "running", `${lost}/${lostAfterClick}/${ctx.state}`);
    // two holds: released one by one
    lc.hold("gpu", true);
    doc.set(true);
    lc.hold("gpu", false);
    await flush();
    const oneLeft = ctx.state;
    doc.set(false);
    await flush();
    check("lifecycle: resumes only when every hold is released", oneLeft === "suspended" && ctx.state === "running", `${oneLeft}/${ctx.state}`);
    // dispose: listeners gone
    lc.dispose();
    ctx.setState("suspended");
    const n = ctx.resumes;
    win.dispatchEvent(new Event("click"));
    doc.set(true);
    doc.set(false);
    await flush();
    check("lifecycle: dispose removes every listener", ctx.resumes === n && ctx.state === "suspended", `${ctx.resumes - n} resumes`);
  }
  // hidden at creation (dive created while backgrounded) → not resumed until visible
  {
    const ctx = new FakeAudioContext();
    const { doc, env } = lifecycleEnv();
    doc.hidden = true;
    const lc = new AudioLifecycle(ctx, env);
    await flush();
    const s0 = ctx.state;
    doc.set(false);
    await flush();
    check("lifecycle: created hidden → waits for visible", s0 === "suspended" && ctx.state === "running", `${s0} → ${ctx.state}`);
    lc.dispose();
  }
  // closed context: never touched
  {
    const ctx = new FakeAudioContext();
    await ctx.close();
    const { win, env } = lifecycleEnv();
    const lc = new AudioLifecycle(ctx, env);
    win.dispatchEvent(new Event("click"));
    await flush();
    check("lifecycle: closed context left alone", ctx.resumes === 0 && ctx.suspends === 0);
    lc.dispose();
  }
}

async function contextChecks() {
  check("sound is on unless the staging debug panel turns it off", DEFAULT_DIVE_PARAMS.noAudio === false);
  // no Web Audio: null, no throw
  let threw = false;
  let none: AudioContext | null = null;
  try {
    none = acquireAudioContext({});
  } catch {
    threw = true;
  }
  check("context: no Web Audio → null, no throw", none === null && !threw);
  // constructor throws (context limit / blocked): null, no throw
  const infos: unknown[] = [];
  const origInfo = console.info;
  console.info = (...a: unknown[]) => void infos.push(a);
  threw = false;
  let broken: AudioContext | null = null;
  try {
    broken = acquireAudioContext({
      AudioContext: class {
        constructor() {
          throw new Error("NotSupportedError");
        }
      } as unknown as new () => AudioContext,
    });
  } catch {
    threw = true;
  }
  console.info = origInfo;
  check("context: throwing constructor → null (silent dive), no throw", broken === null && !threw && infos.length === 1);
  // prefixed webkitAudioContext (Safari < 14.1)
  let made = 0;
  class Ctx extends FakeAudioContext {
    constructor() {
      super();
      made++;
    }
  }
  const W = Ctx as unknown as new () => AudioContext;
  check("context: webkitAudioContext fallback", audioContextCtor({ webkitAudioContext: W }) === W && audioContextCtor({ AudioContext: W, webkitAudioContext: undefined }) === W);
  const a = acquireAudioContext({ webkitAudioContext: W });
  const b = acquireAudioContext({ webkitAudioContext: W });
  await flush();
  check("context: one shared context, reused (no duplicates on double start)", a !== null && a === b && made === 1 && sharedAudioContext() === a);
  check("context: acquire resumes inside the gesture", (a as unknown as FakeAudioContext).state === "running");
  releaseAudioContext();
  await flush();
  const c = acquireAudioContext({ webkitAudioContext: W });
  await flush();
  check("context: leaving a dive suspends, the next dive reuses it", c === a && made === 1 && (c as unknown as FakeAudioContext).state === "running");
  closeAudioContext();
  await flush();
  const closed = (a as unknown as FakeAudioContext).state;
  const d = acquireAudioContext({ webkitAudioContext: W });
  check("context: closed on unmount, a later start makes a fresh one", closed === "closed" && d !== a && made === 2 && sharedAudioContext() === d);
  closeAudioContext();
  check("context: close with none is a no-op", (() => {
    try {
      closeAudioContext();
      releaseAudioContext();
      return sharedAudioContext() === null;
    } catch {
      return false;
    }
  })());
}

/** Run a bump cue over frames: each frame [dt, impact, touching]. Returns the sounds with times. */
function bumps(frames: [number, number, boolean][], rng = () => 0.5) {
  const cue = new BumpCue(BUMP_TUNING, rng);
  const out: { t: number; gain: number; rate: number }[] = [];
  let t = 0;
  for (const [dt, impact, touching] of frames) {
    t += dt;
    const s = cue.update(dt, impact, touching);
    if (s) out.push({ t, ...s });
  }
  return out;
}
const hold = (seconds: number, impact: number, touching: boolean, dt = 1 / 30): [number, number, boolean][] => Array.from({ length: Math.round(seconds / dt) }, () => [dt, impact, touching]);

function cueChecks() {
  // head-on hit, then 3 s sliding along the wall (contact kept, tiny normal speeds)
  const slide = bumps([[1 / 30, 3, true], ...hold(3, 0.3, true)]);
  check("slide along a wall after a hit: one bump", slide.length === 1, `${slide.length}`);
  // grinding a bumpy wall: repeated moderate impacts while touching
  const grind: [number, number, boolean][] = [[1 / 30, 2, true]];
  // (2 → 2.5: not "clearly harder")
  for (let k = 0; k < 20; k++) grind.push(...hold(0.2, 0, true).slice(0, 5), [1 / 30, 2.5, true]);
  const g = bumps(grind);
  check("grinding along rough rock (contact kept): one bump", g.length === 1, `${g.length}`);
  // contact flicker (the old null → contact trigger): short gaps < rearm
  const flick: [number, number, boolean][] = [];
  for (let k = 0; k < 15; k++) flick.push([1 / 30, 2, true], ...hold(0.2, 0, false));
  const f = bumps(flick);
  check("contact flicker with short gaps: no bump spam", f.length === 1, `${f.length}`);
  // two separate head-on hits with open water between
  const two = bumps([[1 / 30, 4, true], ...hold(0.3, 0, true), ...hold(1, 0, false), [1 / 30, 4, true]]);
  check("two hits with open water between: two bumps", two.length === 2, `${two.length}`);
  // bounce back in quickly (within the cooldown)
  const quick = bumps([[1 / 30, 4, true], ...hold(0.45, 0, false), [1 / 30, 4, true]]);
  check("second hit inside the cooldown: silent", quick.length === 1, `${quick.length}`);
  // still touching but a clearly harder hit after the cooldown
  const harder = bumps([[1 / 30, 2, true], ...hold(0.8, 0.1, true), [1 / 30, 4, true]]);
  check("clearly harder hit while in contact: plays", harder.length === 2, `${harder.length}`);
  // full-speed glide parallel to the wall: no normal speed
  check("full-speed glide along a wall (no normal speed): silent", bumps([...hold(2, 0, true)]).length === 0);
  check("gentle touch below the threshold: silent", bumps([[1 / 30, BUMP_TUNING.minImpact * 0.9, true]]).length === 0);
  // pushing into rock from a standstill: one tick of hover thrust (0.02 blocks/tick) per tick
  const thrust = 0.02 * 1.25 * 2.25 * 20;
  check(`pushing into rock from rest (${thrust.toFixed(2)} u/s per tick): silent`, bumps([...hold(2, thrust, true)]).length === 0);
  // loudness follows the impact
  const gains = [1.6, 3, 5, 8, 12].map((v) => bumps([[1 / 30, v, true]])[0]?.gain ?? -1);
  check("gain grows with impact, within limits", gains.every((x, i) => i === 0 || x >= gains[i - 1]) && gains[0] >= BUMP_TUNING.minGain && gains[4] === BUMP_TUNING.maxGain, gains.map((x) => x.toFixed(2)).join(" "));
  const lo = bumps([[1 / 30, 3, true]], () => 0)[0].rate;
  const hi = bumps([[1 / 30, 3, true]], () => 0.999999)[0].rate;
  check("playback rate varies ±5 %", Math.abs(lo - BUMP_TUNING.rate * 0.95) < 1e-6 && Math.abs(hi - BUMP_TUNING.rate * 1.05) < 1e-5);
  // light switch mashing
  const lim = new CueLimiter();
  let plays = 0;
  for (let k = 0; k < 10; k++) if (lim.allow("switch", k * 0.05)) plays++;
  check(`switch mashed every 50 ms for 0.5 s: rate-limited (${plays} plays)`, plays === 4);
  const lim2 = new CueLimiter();
  let normal = 0;
  for (let k = 0; k < 5; k++) if (lim2.allow("switch", k * 0.3)) normal++;
  check("switch toggled at a normal pace: every press plays", normal === 5);
  const lim3 = new CueLimiter();
  check("cues are limited independently", lim3.allow("switch", 0) && lim3.allow("mode", 0) && !lim3.allow("switch", 0.01) && lim3.allow("warn", 0.01) && !lim3.allow("warn", CUE_INTERVAL.warn - 0.01));
}

void main();

async function soundChecks() {
  // settings validation
  check("sound defaults: on, 85 %", parseSound(undefined).muted === false && parseSound(undefined).volume === DEFAULT_SOUND.volume && DEFAULT_SOUND.volume === 0.85);
  check("stored sound kept", JSON.stringify(parseSound({ muted: true, volume: 0.4 })) === JSON.stringify({ muted: true, volume: 0.4 }));
  check(
    "odd stored sound → sane values",
    parseSound({ muted: "yes", volume: 7 }).muted === false &&
      parseSound({ volume: 7 }).volume === 1 &&
      parseSound({ volume: -1 }).volume === 0 &&
      parseSound({ volume: Number.NaN }).volume === DEFAULT_SOUND.volume &&
      parseSound({ volume: "0.5" }).volume === DEFAULT_SOUND.volume &&
      parseSound(null).volume === DEFAULT_SOUND.volume &&
      parseSound({ volume: 0.333333 }).volume === 0.33,
  );
  // mixer: master gain follows volume, mute = 0 gain + suspended context, unmute resumes
  {
    const ctx = new FakeAudioContext();
    const { env, doc } = lifecycleEnv();
    const a = createDiveAudio(ctx as unknown as AudioContext, { env, fetcher: async () => resp(404, "text/plain", ""), canPlayType: null, base: "/sfx/", sound: { muted: false, volume: 0.5 } });
    await flush();
    const master = ctx.gains[0];
    check("initial volume on the master gain", Math.abs(master.gain.value - 0.5) < 1e-9, `${master.gain.value}`);
    check("unmuted: context running", ctx.state === "running");
    a.setSound({ muted: false, volume: 0.2 });
    check("volume change reaches the master gain", Math.abs(master.gain.value - 0.2) < 1e-9);
    a.setSound({ muted: true, volume: 0.2 });
    await flush();
    check("mute: gain 0 and context suspended", master.gain.value === 0 && ctx.state === "suspended");
    const sus = ctx.suspends;
    a.setSound({ muted: true, volume: 0.6 });
    await flush();
    check("volume change while muted stays silent", master.gain.value === 0 && ctx.state === "suspended" && ctx.suspends === sus);
    a.setSound({ muted: false, volume: 0.6 });
    await flush();
    check("unmute (in the key / button gesture): resumed at the new volume", ctx.state === "running" && Math.abs(master.gain.value - 0.6) < 1e-9);
    a.setSound({ muted: false, volume: Number.NaN });
    check("bad volume ignored (clamped to the default)", Number.isFinite(master.gain.value));
    a.setSound({ muted: false, volume: 3 });
    check("volume clamped to 1", master.gain.value === 1);
    doc.set(true);
    await flush();
    a.setSound({ muted: true, volume: 1 });
    a.setSound({ muted: false, volume: 1 });
    await flush();
    check("unmute while the page is hidden: stays suspended", ctx.state === "suspended");
    doc.set(false);
    await flush();
    check("page back: running again", ctx.state === "running");
    a.dispose();
  }
  {
    const ctx = new FakeAudioContext();
    const { env } = lifecycleEnv();
    const a = createDiveAudio(ctx as unknown as AudioContext, { env, fetcher: async () => resp(404, "text/plain", ""), canPlayType: null, base: "/sfx/", sound: { muted: true, volume: 0.85 } });
    await flush();
    check("dive started muted: gain 0, context suspended", ctx.gains[0].gain.value === 0 && ctx.state === "suspended");
    a.dispose();
  }
  {
    const a = createDiveAudio(null);
    let threw = false;
    try {
      a.setSound({ muted: true, volume: 0.1 });
    } catch {
      threw = true;
    }
    check("sound off / no Web Audio: setSound is a harmless no-op", !threw && a.status().state === "off");
  }
}
