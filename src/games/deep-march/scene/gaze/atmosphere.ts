/**
 * The world's state of mind under the gaze, applied each frame (design doc
 * §7.3): the plankton's current toward the base, the lighthouse light clouded
 * from ② on, the sound floor (the growl loop over the sub rumble), the groan
 * of a squeeze starting and of a building giving way — and after 湮灭 the
 * veil closing over everything. Telegraphed and slow; no stingers.
 */
import type { GazeView } from "../../conserve";
import type { DiveAudio } from "../audio";
import type { BaseLightUniforms } from "../base/baseLight";
import type { ChaosDirector } from "../chaos/chaosDirector";
import type { MarineSnow } from "../particles";
import type { WaterLook } from "../dive/waterLook";
import { GAZE_LOOK } from "./config";

export type AtmosphereDeps = { audio: DiveAudio; baseLight: BaseLightUniforms; chaos: ChaosDirector; snow: MarineSnow; look: WaterLook };

export class GazeAtmosphere {
  private readonly d: AtmosphereDeps;
  private stage: string | null = null;
  private veiled = false;
  /** The growl was driven (so it is brought back to 0 once). */
  private growling = false;

  constructor(d: AtmosphereDeps) {
    this.d = d;
  }

  /** g: the gaze now (null / inactive: calm); center: where the swarm gathers; tide: a tide is running. */
  frame(g: GazeView | null, center: { x: number; z: number } | null, camera: { x: number; z: number }, tide: boolean): void {
    const { chaos, snow } = this.d, on = !!g?.active && !tide;
    if (!on || !g) {
      snow.setFlow(0, 0, 0);
      chaos.floor.rumble = 0;
      this.growl(0);
      this.stage = null;
      return;
    }
    const L = GAZE_LOOK, ph = g.phase;
    if (center) {
      const dx = center.x - camera.x, dz = center.z - camera.z, l = Math.hypot(dx, dz) || 1;
      snow.setFlow((dx / l) * L.flow[ph], 0, (dz / l) * L.flow[ph]);
    }
    if (ph >= 1) for (let i = 0; i < this.d.baseLight.uBLCount.value; i++) this.d.baseLight.uBL.value[i].w *= L.lighthouse;
    const sq = g.squeeze;
    chaos.floor.rumble = Math.max(L.audio.rumble[ph], sq && sq.stage !== "collapse" ? L.audio.squeeze * (sq.stage === "telegraph" ? sq.u : 1) : 0);
    this.growl(L.audio.growl[ph]);
    const key = sq ? `${sq.id}:${sq.stage}` : null;
    if (key !== this.stage && sq && sq.stage !== "telegraph") this.d.audio.play("bump", { gain: 0.6, rate: sq.stage === "crush" ? 0.32 : 0.25, lowpass: 420 });
    this.stage = key;
  }

  /** After 湮灭: the veil closes, the rumble swells and dies away (t: seconds since). */
  ending(t: number): void {
    const E = GAZE_LOOK.ending, { chaos } = this.d;
    this.veiled = true;
    this.d.look.setVeil({ dark: Math.min(1, t / E.veilS) * E.veilDark, clear: 0, darkVis: E.vis, clearVis: 0 });
    chaos.floor.rumble = t < 14 ? Math.min(1, t / 6) : Math.max(0, 1 - (t - 14) / 12);
    this.growl(t < 8 ? 0.46 + (0.6 - 0.46) * (t / 8) : Math.max(0, 0.6 * (1 - (t - 8) / 24)));
    this.d.snow.setFlow(0, 0, 0);
  }

  private growl(level: number): void {
    if (level <= 0 && !this.growling) return;
    this.d.audio.setLoop("growl", level);
    this.growling = level > 0;
  }

  dispose(): void {
    this.growl(0);
    if (this.veiled) this.d.look.setVeil(null);
    this.d.snow.setFlow(0, 0, 0);
  }
}
