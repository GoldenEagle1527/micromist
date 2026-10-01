/**
 * The chaos insert on the dive's mixer (MVP plan M8, design doc §4.5 声音畸变),
 * made of existing clips and plain Web Audio nodes — no new sound files:
 *  - detune: the loops' and one-shots' playback rate (DiveAudio applies `rate`);
 *  - wet path: master → low-pass sweep → short feedback delay → wet gain → out,
 *    built on first use and disconnected again 1.5 s after the wetness drops to 0
 *    (an identity bypass: stage 0 and the free dive never build it);
 *  - rumble (the omen): three low oscillators through a low-pass into the master
 *    (so volume and mute apply), started on demand, stopped 1.5 s after silence.
 * The teardown runs on a timer, so it also happens when the caller stops calling
 * (the stage dropped at the tide, a preview turned off).
 */
import { CHAOS_LOOK } from "./config";

export type ChaosAudioParams = { rate: number; wet: number; cutoff: number; delay: number; feedback: number };

export type ChaosAudio = {
  /** Current detune as a playback-rate factor (1 = none). */
  readonly rate: number;
  /** Nodes built so far (0 until the first wet or rumble use). */
  readonly nodes: number;
  /** Whether the wet path is connected. */
  readonly wetOn: boolean;
  apply: (p: ChaosAudioParams) => void;
  rumble: (level: number) => void;
  dispose: () => void;
};

/** Time constant of every parameter change (s): no clicks. */
const TC = 0.12;
/** A silent wet path / rumble is torn down after this long (s). */
const IDLE_S = 1.5;

type Wet = { filter: BiquadFilterNode; delay: DelayNode; feedback: GainNode; gain: GainNode };
type Rumble = { oscs: OscillatorNode[]; filter: BiquadFilterNode; gain: GainNode };

export function createChaosAudio(ctx: AudioContext, master: GainNode, out: AudioNode): ChaosAudio {
  let rate = 1, nodes = 0;
  let wet: Wet | null = null, wetOn = false, wetLevel = 0;
  let rum: Rumble | null = null, rumLevel = 0;
  const timers: { wet: ReturnType<typeof setTimeout> | null; rumble: ReturnType<typeof setTimeout> | null } = { wet: null, rumble: null };
  /** Level > 0 cancels a pending teardown; level 0 schedules one (once). */
  const idle = (k: keyof typeof timers, level: number, down: () => void) => {
    if (level > 0) {
      if (timers[k]) clearTimeout(timers[k]!);
      timers[k] = null;
    } else if (!timers[k]) timers[k] = setTimeout(() => ((timers[k] = null), down()), IDLE_S * 1000);
  };
  const dropWet = () => {
    if (wet && wetOn && wetLevel <= 0) {
      master.disconnect(wet.filter);
      wetOn = false;
    }
  };
  const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, ctx.currentTime, TC);

  const buildWet = (): Wet => {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    const delay = ctx.createDelay(0.5);
    const feedback = ctx.createGain();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    filter.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(gain);
    gain.connect(out);
    nodes += 4;
    return { filter, delay, feedback, gain };
  };
  const buildRumble = (): Rumble => {
    const R = CHAOS_LOOK.omen.rumble;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = R.lowpass;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    filter.connect(gain);
    gain.connect(master);
    const oscs = R.hz.map((hz, i) => {
      const o = ctx.createOscillator();
      o.type = i === 1 ? "triangle" : "sine";
      o.frequency.value = hz;
      o.connect(filter);
      o.start();
      return o;
    });
    nodes += 2 + oscs.length;
    return { oscs, filter, gain };
  };
  const stopRumble = () => {
    if (!rum) return;
    for (const o of rum!.oscs) {
      o.stop();
      o.disconnect();
    }
    rum!.gain.disconnect();
    rum = null;
  };

  return {
    get rate() {
      return rate;
    },
    get nodes() {
      return nodes;
    },
    get wetOn() {
      return wetOn;
    },
    apply: (p) => {
      rate = p.rate;
      wetLevel = p.wet;
      if (p.wet > 0 && !wetOn) {
        wet ??= buildWet();
        master.connect(wet.filter);
        wetOn = true;
      }
      if (!wet || !wetOn) return;
      set(wet.gain.gain, p.wet);
      set(wet.filter.frequency, p.cutoff);
      set(wet.feedback.gain, p.feedback);
      wet.delay.delayTime.value = p.delay;
      idle("wet", p.wet, dropWet);
    },
    rumble: (level) => {
      if (level > 0 && !rum) rum = buildRumble();
      if (!rum) return;
      rumLevel = level;
      set(rum.gain.gain, level * CHAOS_LOOK.omen.rumble.gain);
      idle("rumble", level, () => rumLevel <= 0 && stopRumble());
    },
    dispose: () => {
      for (const t of Object.values(timers)) if (t) clearTimeout(t);
      stopRumble();
      if (wet && wetOn) master.disconnect(wet.filter);
      wet?.gain.disconnect();
      wetOn = false;
    },
  };
}
