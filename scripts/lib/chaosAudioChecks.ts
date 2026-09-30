/**
 * The chaos audio insert (plan M8; scene/chaos/chaosAudio.ts via DiveAudio.chaos /
 * rumble): the identity builds nothing, the wet path connects on first use and
 * disconnects once silent, the rumble's oscillators start on demand and stop once
 * silent, and the parameters are the identity at wetness 0.
 */
import { createDiveAudio } from "../../src/games/deep-march/scene/audio";
import { CHAOS_LOOK } from "../../src/games/deep-march/scene/chaos/config";
import { chaosAudioParams } from "../../src/games/deep-march/scene/chaos/effects";
import { FakeAudioContext, flush } from "./fakeAudio";

type Check = (name: string, ok: boolean, info?: string) => void;

const quiet = async () => new Response("", { status: 404, headers: { "content-type": "text/plain" } });

export async function chaosAudioChecks(check: Check): Promise<void> {
  const id = chaosAudioParams(0, 12.3);
  check("chaos params at wetness 0: the identity (rate 1, wet 0, no feedback)", id.rate === 1 && id.wet === 0 && id.feedback === 0);
  const full = chaosAudioParams(1, 0), cents = (r: number) => 1200 * Math.log2(r);
  const A = CHAOS_LOOK.audio;
  let lo = Infinity, hi = -Infinity;
  for (let t = 0; t < 20; t += 0.05) {
    const c = cents(chaosAudioParams(1, t).rate);
    lo = Math.min(lo, c);
    hi = Math.max(hi, c);
  }
  check("full chaos: flat detune wavering within detune ± wobble cents", full.wet > 0 && lo >= A.detuneCents - A.wobbleCents - 1e-6 && hi <= A.detuneCents + A.wobbleCents + 1e-6, `${lo.toFixed(1)} … ${hi.toFixed(1)} cents`);

  const ctx = new FakeAudioContext();
  ctx.state = "running";
  const a = createDiveAudio(ctx as unknown as AudioContext, { env: null, fetcher: quiet, canPlayType: null, base: "/sfx/" });
  await flush();
  const master = ctx.gains[0];
  const before = ctx.created;
  for (let i = 0; i < 10; i++) {
    a.chaos(chaosAudioParams(0, i));
    a.rumble(0);
  }
  check("stage 0 / far from cracks: the insert builds nothing (identity bypass)", ctx.created === before && master.targets.length === 1, `${ctx.created - before} nodes`);
  a.chaos(chaosAudioParams(0.8, 1));
  const wetNodes = ctx.created - before;
  check("near a crack: the wet path is built and fed from the master", wetNodes === 4 && master.targets.length === 2, `${wetNodes} nodes, master → ${master.targets.length}`);
  for (let t = 0; t < 2.5; t += 0.1) {
    ctx.currentTime += 0.1;
    a.chaos(chaosAudioParams(0, t));
  }
  check("back to wetness 0: the wet path is disconnected after a moment", master.targets.length === 1);
  a.chaos(chaosAudioParams(0.5, 3));
  check("… and reconnected (not rebuilt) when needed again", master.targets.length === 2 && ctx.created - before === wetNodes);

  a.rumble(1);
  const oscs = ctx.oscillators.slice();
  check("omen rumble: low oscillators started on demand", oscs.length === CHAOS_LOOK.omen.rumble.hz.length && oscs.every((o) => o.started === 1) && oscs.every((o, i) => o.frequency.value === CHAOS_LOOK.omen.rumble.hz[i]));
  for (let t = 0; t < 2.5; t += 0.1) {
    ctx.currentTime += 0.1;
    a.rumble(0);
  }
  check("rumble silent for a while: its oscillators stopped", oscs.every((o) => o.stopped === 1));
  a.dispose();

  const off = createDiveAudio(null);
  let threw = false;
  try {
    off.chaos(chaosAudioParams(1, 0));
    off.rumble(1);
  } catch {
    threw = true;
  }
  check("?audio=0: chaos / rumble are harmless no-ops", !threw);
}
