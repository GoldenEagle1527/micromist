/**
 * Dive audio (Web Audio). Clips are 22 kHz PCM in public/deep-march/sfx, cut from
 * the asset library (Universal Sound FX):
 *   ambience — AMBIENCE_Under_Water_Deep_Dark_loop (loop)
 *   swim     — SWIM_Water_01_loop (loop, gain follows speed)
 *   sonar    — SUBMARINE_Sonar_Ping_05_Pop_Short
 *   switch   — BUTTON_Plastic_Light_Switch_On
 *   mode     — UI_SCI-FI_Tone_Bright_Dry_08
 *   bump     — IMPACT_Concrete_Slab_on_Concrete_Slab_Deep (low-passed)
 *   warn     — NOTIFICATION_Digital_05
 *
 * Pass an AudioContext created inside the dive-start click so playback is
 * allowed. ?audio=0 skips the mixer entirely.
 */
const BASE = `${import.meta.env.BASE_URL}deep-march/sfx/`;

const CLIPS = {
  ambience: "ambience.wav",
  swim: "swim.wav",
  sonar: "sonar.wav",
  switch: "switch.wav",
  mode: "mode.wav",
  bump: "bump.wav",
  warn: "warn.wav",
} as const;

export type LoopId = "ambience" | "swim";
export type ShotId = "sonar" | "switch" | "mode" | "bump" | "warn";

export type ShotOpts = { gain?: number; rate?: number; lowpass?: number };

export type DiveAudio = {
  unlock: () => void;
  setLoop: (id: LoopId, gain: number) => void;
  /** Ease loop gains toward the targets set this frame. */
  tick: (dt: number) => void;
  play: (id: ShotId, opts?: ShotOpts) => void;
  suspend: () => void;
  resume: () => void;
  dispose: () => void;
};

const noop: DiveAudio = {
  unlock: () => {},
  setLoop: () => {},
  tick: () => {},
  play: () => {},
  suspend: () => {},
  resume: () => {},
  dispose: () => {},
};

export function createDiveAudio(ctx: AudioContext | null): DiveAudio {
  if (!ctx) return noop;

  const master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(ctx.destination);

  const buffers = new Map<string, AudioBuffer>();
  const targets: Record<LoopId, number> = { ambience: 0, swim: 0 };
  const loops = new Map<LoopId, GainNode>();
  const sources: AudioBufferSourceNode[] = [];
  let alive = true;
  let started = false;

  void (async () => {
    await Promise.all(
      (Object.keys(CLIPS) as (keyof typeof CLIPS)[]).map(async (id) => {
        const res = await fetch(BASE + CLIPS[id]);
        if (!res.ok) throw new Error(`${CLIPS[id]} ${res.status}`);
        if (!alive) return;
        buffers.set(id, await ctx.decodeAudioData(await res.arrayBuffer()));
      }),
    );
  })().catch((err) => {
    console.warn("deep-march audio:", err);
  });

  const startLoops = () => {
    if (started || !alive) return;
    const amb = buffers.get("ambience");
    const swim = buffers.get("swim");
    if (!amb || !swim) return;
    started = true;
    for (const [id, buf] of [["ambience", amb], ["swim", swim]] as const) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(master);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(gain);
      src.start();
      sources.push(src);
      loops.set(id, gain);
    }
  };

  return {
    unlock: () => {
      if (ctx.state === "suspended") void ctx.resume();
    },
    setLoop: (id, gain) => {
      targets[id] = gain;
    },
    tick: (dt) => {
      if (!started) {
        if (buffers.has("ambience")) startLoops();
        return;
      }
      const k = 1 - Math.exp(-dt * 4);
      for (const [id, node] of loops) {
        node.gain.value += (targets[id] - node.gain.value) * k;
      }
    },
    play: (id, opts) => {
      const buf = buffers.get(id);
      if (!buf || ctx.state !== "running") return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = opts?.rate ?? 1;
      let node: AudioNode = src;
      if (opts?.lowpass) {
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = opts.lowpass;
        src.connect(filter);
        node = filter;
      }
      const gain = ctx.createGain();
      gain.gain.value = opts?.gain ?? 1;
      node.connect(gain);
      gain.connect(master);
      src.start();
      src.onended = () => {
        const i = sources.indexOf(src);
        if (i >= 0) sources.splice(i, 1);
      };
      sources.push(src);
    },
    suspend: () => {
      if (ctx.state === "running") void ctx.suspend();
    },
    resume: () => {
      if (alive && ctx.state === "suspended") void ctx.resume();
    },
    dispose: () => {
      alive = false;
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
