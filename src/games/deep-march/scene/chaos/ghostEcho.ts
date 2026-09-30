/**
 * Sonar ghost echoes (MVP plan M8, design doc §4.2 stage 1 回响, §4.5): now and
 * then a ping is answered by a second, delayed wavefront that starts from the
 * wall's direction — as if the wall itself pinged back. Pure scheduling:
 *  - each real ping gets a ghost with the stage's chance (seeded stream), after
 *    0.3 … 1.2 s;
 *  - it starts toward the nearest wall point (an open crack's, when one is
 *    nearer), at most `reach` m from the diver, at the diver's height;
 *  - stage 0 (chance 0) never schedules one.
 * The scene feeds the due ones into the ordinary pulse slots (sonar.ts echo()).
 */
import type { ChaosView } from "../../conserve";
import { CHAOS_LOOK } from "./config";
import { chaosRng } from "./rng";

export type GhostPulse = { at: number; x: number; y: number; z: number };

/** Where the wall is from (x, z): a world point, or null (no wall). */
export type WallToward = (x: number, z: number) => { x: number; z: number } | null;

export class GhostEchoes {
  private readonly chance: number;
  private readonly rand: () => number;
  private readonly queue: GhostPulse[] = [];

  constructor(chance: number, seed: number) {
    this.chance = chance;
    this.rand = chaosRng(seed);
  }

  get pending(): number {
    return this.queue.length;
  }

  /** A real ping at time t (s) from (x, y, z). */
  ping(t: number, x: number, y: number, z: number, toward: WallToward): void {
    if (this.chance <= 0) return;
    const roll = this.rand();
    const delay = this.rand();
    if (roll >= this.chance) return;
    const p = toward(x, z);
    if (!p) return;
    const G = CHAOS_LOOK.ghost;
    const dx = p.x - x, dz = p.z - z;
    const d = Math.hypot(dx, dz);
    const k = d > 1e-6 ? Math.min(d, G.reach) / d : 0;
    this.queue.push({ at: t + G.delay[0] + (G.delay[1] - G.delay[0]) * delay, x: x + dx * k, y, z: z + dz * k });
    this.queue.sort((a, b) => a.at - b.at);
  }

  /** The ghosts due by time t (removed from the queue), oldest first. */
  due(t: number): GhostPulse[] {
    const out: GhostPulse[] = [];
    while (this.queue.length && this.queue[0].at <= t) out.push(this.queue.shift()!);
    return out;
  }

  clear(): void {
    this.queue.length = 0;
  }
}

/**
 * The nearest wall point from (x, z): the nearest side of the outline's box (the
 * rounded corners do not matter — only the direction, clamped to `reach`), or an
 * open crack when it is nearer.
 */
export function wallToward(view: ChaosView): WallToward {
  const { cx, cz, hx, hz } = view.bounds;
  return (x, z) => {
    const ex = hx - Math.abs(x - cx), ez = hz - Math.abs(z - cz);
    let p = ex <= ez ? { x: cx + Math.sign(x - cx || 1) * hx, z } : { x, z: cz + Math.sign(z - cz || 1) * hz };
    let best = Math.hypot(p.x - x, p.z - z);
    for (const c of view.cracks) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < best) [p, best] = [{ x: c.x, z: c.z }, d];
    }
    return p;
  };
}
