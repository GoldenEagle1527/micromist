/**
 * 直视 ③ 侵袭 (design doc §7.3, §9.1): tentacles take the base apart one
 * building at a time, farthest from the core first, never the core (it falls at
 * the end). Each squeeze is telegraphed (tentacles wrap it, heard and on the
 * sonar), then crushes it at −8 durability per second, then it crumbles and its
 * particles scatter (the session moves its cost B → S). Pure: runtime state only,
 * not saved — a squeeze cut short by leaving starts over next time.
 */
import { STRUCTURES, type StructureKind } from "../config";
import { GAZE } from "./config";

export type SqueezeStage = "telegraph" | "crush" | "collapse";
export type Squeeze = { id: number; stage: SqueezeStage; t: number; length: number };
export type AssaultTarget = { id: number; kind: StructureKind; pos: readonly [number, number, number] };

/** Seconds of crushing a building of this kind takes. */
export function crushSeconds(kind: StructureKind): number {
  return STRUCTURES[kind].durability / GAZE.assault.hpPerSec;
}

export class Assault {
  private cur: Squeeze | null = null;
  private wait: number = GAZE.assault.firstDelay;

  get squeeze(): Readonly<Squeeze> | null {
    return this.cur;
  }

  /** Advance; returns the id of a building that just gave way (to ruin), else null. */
  step(dt: number, targets: readonly AssaultTarget[], center: readonly [number, number, number] | null): number | null {
    const s = this.cur && targets.some((b) => b.id === this.cur!.id) ? this.cur : null;
    this.cur = s;
    if (!s) {
      this.pick(dt, targets, center);
      return null;
    }
    s.t += dt;
    if (s.t < s.length) return null;
    if (s.stage === "collapse") {
      this.cur = null;
      this.wait = GAZE.assault.pause;
      return s.id;
    }
    if (s.stage === "telegraph") this.next(s, "crush", crushSeconds(targets.find((b) => b.id === s.id)!.kind));
    else this.next(s, "collapse", GAZE.assault.collapse);
    return null;
  }

  /** How crushed building `id` is (0 … 1): bending to `bend` while squeezed, then gone. */
  damage(id: number): number {
    const s = this.cur;
    if (!s || s.id !== id || s.stage === "telegraph") return 0;
    const u = Math.min(1, s.t / s.length), bend = GAZE.assault.bend;
    return s.stage === "crush" ? bend * u : bend + (1 - bend) * u;
  }

  private next(s: Squeeze, stage: SqueezeStage, length: number): void {
    s.stage = stage;
    s.t = 0;
    s.length = length;
  }

  private pick(dt: number, targets: readonly AssaultTarget[], center: readonly [number, number, number] | null): void {
    this.wait -= dt;
    if (this.wait > 0 || !center) return;
    const far = (b: AssaultTarget) => Math.hypot(b.pos[0] - center[0], b.pos[2] - center[2]);
    const pick = targets.filter((b) => b.kind !== "core").sort((a, b) => far(b) - far(a))[0];
    if (pick) this.cur = { id: pick.id, stage: "telegraph", t: 0, length: GAZE.assault.telegraph };
  }
}
