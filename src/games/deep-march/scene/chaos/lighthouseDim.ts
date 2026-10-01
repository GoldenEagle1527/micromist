/**
 * 基地灯塔偶尔变暗 (design doc §4.2 侵蚀), pure and telegraphed — never a flicker:
 * near a lit lighthouse (stage 4+; any stage in a debug preview), every 120 …
 * 240 s a low groan (heavy metal straining: `creak` marks its start) rises for
 * 2.5 s, then the lighthouse light eases down to 20 % over 2.5 s, stays dim
 * 4 … 7 s and recovers over 3.5 s (all eases ≥ 2 s: far below the 3 Hz
 * photosensitivity limit). 「减弱灯光起伏」: only down to 60 %, 1.6× slower.
 * Nothing starts during the tide; a running one finishes.
 */
import { CHAOS_LOOK } from "./config";
import { chaosRng } from "./rng";

/** gain: the lighthouse light's factor; rumble: the groan's level; creak: an event starts this frame (play its creak once). */
export type DimFrame = { gain: number; rumble: number; creak: boolean };

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export class LighthouseDim {
  private readonly on: boolean;
  private readonly calm: boolean;
  private readonly rand: () => number;
  private at: number;
  private hold = 0;
  /** The current event has begun (its creak played). */
  private begun = false;
  private readonly out: DimFrame = { gain: 1, rumble: 0, creak: false };

  constructor(on: boolean, calm: boolean, seed: number, start: number, firstS?: number) {
    this.on = on;
    this.calm = calm;
    this.rand = chaosRng(seed ^ 0xd1a7);
    this.at = start + (firstS ?? CHAOS_LOOK.late.dim.firstS);
    this.hold = this.between(CHAOS_LOOK.late.dim.holdS);
  }

  private between([a, b]: readonly [number, number]): number {
    return a + (b - a) * this.rand();
  }

  /** The phases (s) of the current event: lead, down, hold, up. */
  private phases(): [number, number, number, number] {
    const D = CHAOS_LOOK.late.dim, k = this.calm ? D.calm.slow : 1;
    return [D.leadS, D.downS * k, this.hold, D.upS * k];
  }

  /** Per frame: dive clock (s); near: a lit lighthouse lights the view; blocked: tide / loading. */
  update(time: number, near: boolean, blocked: boolean): DimFrame {
    const o = this.out;
    o.gain = 1;
    o.rumble = 0;
    o.creak = false;
    if (!this.on) return o;
    const D = CHAOS_LOOK.late.dim;
    const [lead, down, hold, up] = this.phases();
    const t = time - this.at, len = lead + down + hold + up;
    if (t > len) {
      this.at = time + this.between(D.every);
      this.hold = this.between(D.holdS);
      this.begun = false;
      return o;
    }
    if (t < 0) return o;
    // due but nobody near (or the tide): wait, and try again a little later
    if (t < 0.1 && (!near || blocked)) {
      this.at = time + 5;
      return o;
    }
    if (!this.begun) o.creak = this.begun = true;
    const floor = this.calm ? D.calm.floor : D.floor;
    const dimmed = ease((t - lead) / down) * (1 - ease((t - lead - down - hold) / up));
    o.gain = 1 - (1 - floor) * dimmed;
    o.rumble = D.rumble * ease(t / 0.8) * (1 - ease((t - lead - 0.5 * down) / down));
    return o;
  }
}
