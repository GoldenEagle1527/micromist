/**
 * 基地的幽灵回波 (design doc §4.2 侵蚀), pure scheduling: away from the base
 * (stage 4+; any stage in a debug preview) a ping is now and then answered,
 * 0.6 … 1.4 s later, by a wavefront from a phantom base 120 … 240 m off, turned
 * 70 … 180° from where the base really is — with the base's silhouette in the
 * returns and a lower, muffled ping. Home answers from the wrong side.
 */
import { CHAOS_LOOK } from "./config";
import { chaosRng } from "./rng";

type Point = { x: number; y: number; z: number };
export type HomeEcho = Point & { at: number };

export class HomeGhosts {
  private readonly chance: number;
  private readonly rand: () => number;
  private readonly queue: HomeEcho[] = [];

  constructor(chance: number, forced: boolean, seed: number) {
    this.chance = forced ? Math.max(chance, 0.6) : chance;
    this.rand = chaosRng(seed ^ 0x40e5);
  }

  get on(): boolean {
    return this.chance > 0;
  }

  /** A ping at `time` from `diver`; `home`: the base core (null: none yet). */
  ping(time: number, diver: Point, home: Point | null): void {
    if (!this.on || !home || this.queue.length) return;
    const H = CHAOS_LOOK.late.homeGhost, r = this.rand;
    const roll = r();
    const far = Math.hypot(home.x - diver.x, home.z - diver.z);
    if (roll >= this.chance || far < H.minHome) return;
    const turn = ((H.turn[0] + (H.turn[1] - H.turn[0]) * r()) * Math.PI) / 180;
    const a = Math.atan2(home.z - diver.z, home.x - diver.x) + (r() < 0.5 ? -turn : turn);
    const d = H.distance[0] + (H.distance[1] - H.distance[0]) * r();
    const delay = H.delay[0] + (H.delay[1] - H.delay[0]) * r();
    this.queue.push({ at: time + delay, x: diver.x + Math.cos(a) * d, y: home.y, z: diver.z + Math.sin(a) * d });
  }

  /** The echoes due by `time` (removed). */
  due(time: number): HomeEcho[] {
    const out: HomeEcho[] = [];
    while (this.queue.length && this.queue[0].at <= time) out.push(this.queue.shift()!);
    return out;
  }

  clear(): void {
    this.queue.length = 0;
  }
}
