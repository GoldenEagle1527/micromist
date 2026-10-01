/**
 * 读数跳变 (design doc §4.5 声呐假读数: depth / heading readings jump, pure UI):
 * near an open crack (stage 3+; anywhere in a debug preview), every 18 … 45 s the
 * depth and heading readouts show a wrong value for 0.7 … 1.6 s, then the true
 * one again. Never during the tide or loading. Pure, seeded.
 */
import { CHAOS_LOOK } from "./config";
import { chaosRng } from "./rng";

export type GlitchOffsets = { depth: number; heading: number };
export const NO_GLITCH: Readonly<GlitchOffsets> = Object.freeze({ depth: 0, heading: 0 });

export class ReadingGlitch {
  private readonly on: boolean;
  private readonly rand: () => number;
  private nextAt: number;
  private until = -Infinity;
  private readonly now: GlitchOffsets = { depth: 0, heading: 0 };

  constructor(on: boolean, seed: number, start: number, firstS?: number) {
    this.on = on;
    this.rand = chaosRng(seed ^ 0x611c);
    this.nextAt = start + (firstS ?? this.between(CHAOS_LOOK.late.glitch.every));
  }

  private between([a, b]: readonly [number, number]): number {
    return a + (b - a) * this.rand();
  }

  private sign(): number {
    return this.rand() < 0.5 ? -1 : 1;
  }

  /** Per frame: dive clock (s); near: within the omen's reach of a crack; blocked: tide / loading. */
  update(time: number, near: boolean, blocked: boolean): GlitchOffsets {
    if (!this.on) return NO_GLITCH;
    const G = CHAOS_LOOK.late.glitch;
    if (time < this.until && !blocked) return this.now;
    if (time >= this.nextAt) {
      if (near && !blocked) {
        this.until = time + this.between(G.hold);
        this.now.depth = this.sign() * this.between(G.depth);
        this.now.heading = this.sign() * this.between(G.heading);
        this.nextAt = this.until + this.between(G.every);
        return this.now;
      }
      this.nextAt = time + 5;
    }
    return NO_GLITCH;
  }
}
