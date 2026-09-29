/**
 * Dive audio must stay optional: the sfx pack is licensed and not in the repo,
 * so every missing / wrong / broken clip has to resolve quietly to "no sound".
 */
import { createDiveAudio, loadClip } from "../src/games/deep-march/scene/audio";

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
  const node = () => ({ connect() {}, disconnect() {}, gain: { value: 0 } });
  const fakeCtx = {
    state: "running",
    destination: {},
    createGain: node,
    suspend: async () => {},
    resume: async () => {},
    decodeAudioData: ctx.decodeAudioData,
  } as unknown as AudioContext;
  let threw = false;
  try {
    const a = createDiveAudio(fakeCtx);
    await new Promise((r) => setTimeout(r, 20));
    a.unlock();
    a.setLoop("ambience", 0.4);
    a.tick(0.016);
    a.play("sonar");
    a.play("bump", { lowpass: 480 });
    a.suspend();
    a.resume();
    a.dispose();
  } catch (e) {
    threw = true;
    console.log(e);
  }
  console.info = origInfo;
  check("all clips missing: mixer never throws", !threw);
  check("all clips missing: no unhandled rejection", rejections.length === 0, `${rejections.length}`);
  check("all clips missing: one quiet info line", infos.length === 1, `${infos.length}`);

  if (failed) {
    console.log(`${failed} audio check(s) failed`);
    process.exit(1);
  }
  console.log("all audio checks passed");
}
void main();
