/**
 * Dive audio must stay optional: the sfx pack is licensed and not in the repo,
 * so every missing / wrong / broken clip has to resolve quietly to "no sound".
 */
import { createDiveAudio, loadClip } from "../src/games/deep-march/scene/audio";
import { acquireAudioContext, audioContextCtor, audioDisabledByUrl, closeAudioContext, releaseAudioContext, sharedAudioContext } from "../src/games/deep-march/scene/audioContext";
import { AudioLifecycle, UNLOCK_EVENTS, type LifecycleEnv } from "../src/games/deep-march/scene/audioLifecycle";
import { FakeAudioContext, flush } from "./lib/fakeAudio";

let failed = 0;
const check = (name: string, ok: boolean, info = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${info ? `: ${info}` : ""}`);
  if (!ok) failed++;
};

const fakeBuf = { duration: 1 } as unknown as AudioBuffer;
const ctx = {
  decodeAudioData: async (data: ArrayBuffer) => {
    if (new Uint8Array(data)[0] !== 0x52) throw new Error("EncodingError"); // "RIFF"
    return fakeBuf;
  },
};
const resp = (status: number, type: string, body: string) =>
  new Response(body, { status, headers: { "content-type": type } });

async function main() {
  check("200 audio/wav decodes", (await loadClip(ctx, "a", async () => resp(200, "audio/wav", "RIFF...."))) === fakeBuf);
  check("404 → null", (await loadClip(ctx, "a", async () => resp(404, "text/plain", "nope"))) === null);
  check("SPA index.html fallback (200 text/html) → null",
    (await loadClip(ctx, "a", async () => resp(200, "text/html", "<!doctype html>"))) === null);
  check("undecodable body → null", (await loadClip(ctx, "a", async () => resp(200, "audio/wav", "garbage"))) === null);
  check("network error → null", (await loadClip(ctx, "a", async () => { throw new TypeError("offline"); })) === null);

  // Whole mixer with every clip missing: no throw, no unhandled rejection, calls are no-ops.
  const rejections: unknown[] = [];
  process.on("unhandledRejection", (e) => rejections.push(e));
  const infos: unknown[] = [];
  const origInfo = console.info;
  console.info = (...a: unknown[]) => void infos.push(a);
  (globalThis as { fetch: typeof fetch }).fetch = async () => resp(404, "text/plain", "");
  const fakeCtx = new FakeAudioContext() as unknown as AudioContext;
  let threw = false;
  try {
    const a = createDiveAudio(fakeCtx, null);
    await new Promise((r) => setTimeout(r, 20));
    a.hold("gpu", true);
    a.setLoop("ambience", 0.4);
    a.tick(0.016);
    a.play("sonar");
    a.play("bump", { lowpass: 480 });
    a.hold("gpu", false);
    a.dispose();
  } catch (e) {
    threw = true;
    console.log(e);
  }
  console.info = origInfo;
  check("all clips missing: mixer never throws", !threw);
  check("all clips missing: no unhandled rejection", rejections.length === 0, `${rejections.length}`);
  check("all clips missing: one quiet info line", infos.length === 1, `${infos.length}`);

  await lifecycleChecks();
  await contextChecks();

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
  check("?audio=0 is hard off", audioDisabledByUrl("?audio=0") && !audioDisabledByUrl("?audio=1") && !audioDisabledByUrl(""));
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

void main();
