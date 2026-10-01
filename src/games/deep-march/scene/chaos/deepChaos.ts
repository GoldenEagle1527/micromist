/**
 * The deep stages' presentation (design doc §4.2 渗入 / 侵蚀, §4.4 壁外混沌, §4.5,
 * §4.6; backlog "阶段 3–5 表现"), owned by the ChaosDirector, numbers in
 * CHAOS_LOOK (stage rows + `deep`, `shell`):
 *  - stage 3+: the fog's colour shift everywhere (fogGlobal), the plankton tinted
 *    toward the stage's colour and a share of it swimming distorted (jerky, its
 *    jitter growing near cracks) — uniforms only (particles.ts);
 *  - stage 4+: the audio wobble everywhere (audioGlobal), and the timed events
 *    (chaosEvents.ts): the surge (30 s swell of fog / audio / plankton, the dread
 *    loop, a ghost pulse storm), the eye's blink (all crack light eases out for
 *    1.5 s after a 2 s low rumble) and the pupil sweeping the shell;
 *  - a through crack nearby: the chaos shell beyond it (chaosShell.ts).
 * During the tide (suppressed) every one returns to normal.
 */
import type * as THREE from "three";
import type { ChaosCrackView, ChaosView } from "../../conserve";
import type { DiveAudio } from "../audio";
import type { ChaosStageLook } from "./config";
import { CHAOS_LOOK } from "./config";
import { ChaosEvents } from "./chaosEvents";
import { ChaosShell } from "./chaosShell";
import type { FogUniforms } from "../fog";

/** The plankton's chaos uniforms (particles.ts MarineSnow). */
export type PlanktonChaos = { setChaos: (r: number, g: number, b: number, tint: number, warpAmp: number, warpShare: number) => void };

export type DeepChaosDeps = { scene: THREE.Scene; fog: FogUniforms; audio: DiveAudio; snow: PlanktonChaos | null; seed: number };

export type DeepFrameInput = { dt: number; time: number; camera: THREE.Vector3; chiL: number; suppressed: boolean; watch: (c: ChaosCrackView) => number };

export type DeepFrame = {
  /** Global fog shift share and audio wetness floor (0 = none). */
  fog: number;
  audio: number;
  /** Crack light factor (the blink: 1 = open). */
  glow: number;
  /** Low warning rumble before a blink. */
  rumble: number;
  /** A surge ghost pulse is due now. */
  ghost: boolean;
};

const CALM_FRAME: DeepFrame = { fog: 0, audio: 0, glow: 1, rumble: 0, ghost: false };

export class DeepChaos {
  private readonly d: DeepChaosDeps;
  private readonly view: ChaosView | null;
  private readonly levels: ChaosStageLook;
  private readonly events: ChaosEvents;
  private readonly through: ChaosCrackView[];
  private shell: ChaosShell | null = null;
  private readonly out: DeepFrame = { ...CALM_FRAME };

  constructor(d: DeepChaosDeps, view: ChaosView | null, levels: ChaosStageLook, clock: number) {
    this.d = d;
    this.view = view;
    this.levels = levels;
    this.events = new ChaosEvents(levels.events, d.seed, clock);
    this.through = view?.cracks.filter((c) => c.through) ?? [];
    if (this.through.length) {
      this.shell = new ChaosShell(d.fog);
      d.scene.add(this.shell.mesh);
    }
    d.snow?.setChaos(0, 0, 0, 0, 0, 0);
  }

  /** Whether this generation has anything for the deep layer to do. */
  get active(): boolean {
    const L = this.levels;
    return L.plankton > 0 || L.warp > 0 || L.fogGlobal > 0 || L.audioGlobal > 0 || L.events || this.through.length > 0;
  }

  frame(i: DeepFrameInput): DeepFrame {
    const o = this.out;
    if (!this.active) return CALM_FRAME;
    const L = this.levels, D = CHAOS_LOOK.deep, S = D.surge;
    const ev = this.events.update(i.time, i.dt, i.suppressed);
    const on = i.suppressed ? 0 : 1;
    const s = ev.surge * on;
    const stage = this.view?.stage ?? 0;
    const col = D.plankton[Math.min(D.plankton.length - 1, Math.max(0, stage - 3))];
    const amp = D.warpAmp[0] + (D.warpAmp[1] - D.warpAmp[0]) * i.chiL;
    this.d.snow?.setChaos(col[0], col[1], col[2], on * Math.min(1, L.plankton + S.plankton * s), amp, on * Math.min(1, L.warp + S.warp * s));
    this.d.audio.setLoop("dread", S.dread * s);
    o.fog = on * Math.min(1, L.fogGlobal + S.fog * s);
    o.audio = on * Math.min(1, L.audioGlobal + S.audio * s);
    o.glow = i.suppressed ? 1 : ev.glow;
    o.rumble = on * ev.rumble;
    o.ghost = ev.ghost && !i.suppressed;
    if (this.shell) {
      const crack = this.nearestThrough(i.camera.x, i.camera.z);
      const light = crack ? on * L.glow * i.watch(crack) * o.glow : 0;
      this.shell.update({ time: i.time, camera: i.camera, crack, thickness: this.view!.wallThickness, light, pupil: ev.pupil, pupilK: L.events ? ev.pupilK : 0, stage });
    }
    return o;
  }

  private nearestThrough(x: number, z: number): ChaosCrackView | null {
    let best: ChaosCrackView | null = null, bd = Infinity;
    for (const c of this.through) {
      const d = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d < bd) (bd = d), (best = c);
    }
    return best;
  }

  dispose(): void {
    this.d.audio.setLoop("dread", 0);
    this.d.snow?.setChaos(0, 0, 0, 0, 0, 0);
    this.shell?.dispose();
    this.shell = null;
  }
}
