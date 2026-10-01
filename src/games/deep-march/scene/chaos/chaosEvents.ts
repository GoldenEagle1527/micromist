/**
 * The stage-4+ timed events (design doc §4.2 侵蚀, §4.6), pure and telegraphed —
 * slow swells, never a jump:
 *  - surge (混沌涌): every 180 … 300 s, 30 s: eases in over 5 s, holds 20 s, eases
 *    out over 5 s (level 0 … 1, the director adds fog / audio / plankton / dread);
 *    during the hold a ghost pulse is due every few seconds (the 幽灵脉冲风暴);
 *  - blink: every 150 … 300 s, a 2 s low rumble, then every crack light eases to 0
 *    for 1.5 s and back (glow factor 0 … 1; eases of 0.35 s: no strobe);
 *  - pupil: every 40 … 90 s a dark vertical bar sweeps across the shell (−1 … 1).
 * Nothing starts while blocked (the tide, loading); a running one finishes.
 */
import { CHAOS_LOOK } from "./config";
import { chaosRng } from "./rng";

export type ChaosEventFrame = {
  /** Surge level 0 … 1. */
  surge: number;
  /** A surge ghost pulse is due this frame. */
  ghost: boolean;
  /** Crack light factor (1 = normal, 0 = closed eye). */
  glow: number;
  /** Low warning rumble 0 … 1 before a blink. */
  rumble: number;
  /** Pupil position across the shell (−1 … 1) and strength (0 = none). */
  pupil: number;
  pupilK: number;
};

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export class ChaosEvents {
  private readonly on: boolean;
  private readonly rand: () => number;
  private surgeAt: number;
  private blinkAt: number;
  private pupilAt: number;
  private ghostClock = 0;
  readonly frame: ChaosEventFrame = { surge: 0, ghost: false, glow: 1, rumble: 0, pupil: 0, pupilK: 0 };

  /** on: the stage runs events; start: the dive clock now (s). */
  constructor(on: boolean, seed: number, start: number) {
    const D = CHAOS_LOOK.deep;
    this.on = on;
    this.rand = chaosRng(seed ^ 0x5ca1ab1e);
    this.surgeAt = start + D.surge.firstS;
    this.blinkAt = start + D.blink.firstS;
    this.pupilAt = start + this.between(D.pupil.every);
  }

  private between([a, b]: readonly [number, number]): number {
    return a + (b - a) * this.rand();
  }

  /** Per frame: dive clock (s), frame time (s), blocked (no new event starts). */
  update(time: number, dt: number, blocked: boolean): ChaosEventFrame {
    const f = this.frame;
    f.ghost = false;
    if (!this.on) return f;
    const D = CHAOS_LOOK.deep;
    // surge: [surgeAt, surgeAt + 2 ramp + hold]
    const S = D.surge, sLen = 2 * S.ramp + S.hold;
    if (time > this.surgeAt + sLen) this.surgeAt = blocked ? time + 10 : this.surgeAt + sLen + this.between(S.every);
    const st = time - this.surgeAt;
    f.surge = st < 0 ? 0 : Math.min(ease(st / S.ramp), ease((sLen - st) / S.ramp));
    if (f.surge >= 1 && (this.ghostClock += dt) >= S.ghostEveryS) {
      this.ghostClock = 0;
      f.ghost = true;
    }
    // blink: lead (rumble), ease out, off, ease in
    const B = D.blink, bLen = B.leadS + 2 * B.ease + B.offS;
    if (time > this.blinkAt + bLen) this.blinkAt = blocked ? time + 10 : this.blinkAt + bLen + this.between(B.every);
    const bt = time - this.blinkAt;
    f.rumble = bt < 0 || bt > bLen ? 0 : B.rumble * Math.min(ease(bt / 0.8), ease((bLen - bt) / 0.8));
    const closed = bt - B.leadS;
    f.glow = closed < 0 || bt > bLen ? 1 : 1 - Math.min(ease(closed / B.ease), ease((bLen - B.leadS - closed) / B.ease));
    // pupil sweep
    const P = D.pupil;
    if (time > this.pupilAt + P.sweepS) this.pupilAt = this.pupilAt + P.sweepS + this.between(P.every);
    const pt = (time - this.pupilAt) / P.sweepS;
    f.pupil = -1.2 + 2.4 * pt;
    f.pupilK = pt < 0 || pt > 1 ? 0 : Math.sin(Math.PI * pt);
    return f;
  }
}
