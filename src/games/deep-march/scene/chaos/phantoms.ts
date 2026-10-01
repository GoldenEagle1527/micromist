/**
 * 声呐假读数 (design doc §4.2 渗入, §4.5), pure scheduling: within `reach` of an
 * open crack (stage 3+; anywhere in a debug preview) a ping is now and then
 * answered by a phantom contact — a node-like cluster or one large body — 70 …
 * 190 m out, leaning toward the crack. The next ping decides afresh (the old
 * one fades: re-pinging shows nothing there); coming close dissolves it.
 */
import type { ChaosCrackView } from "../../conserve";
import { CHAOS_LOOK } from "./config";
import { ContactSet, massShape, nodeShape } from "./phantomContacts";
import { chaosRng } from "./rng";

type Point = { x: number; y: number; z: number };

export class Phantoms {
  private readonly chance: number;
  private readonly forced: boolean;
  private readonly rand: () => number;

  /** chance per qualifying ping; forced: the debug preview (every other ping, anywhere). */
  constructor(chance: number, forced: boolean, seed: number) {
    this.chance = forced ? Math.max(chance, 0.5) : chance;
    this.forced = forced;
    this.rand = chaosRng(seed ^ 0x7a17);
  }

  get on(): boolean {
    return this.chance > 0;
  }

  /** A ping at `time` from `diver`; `crack`: the nearest open crack (or null). */
  ping(time: number, diver: Point, crack: ChaosCrackView | null, set: ContactSet): void {
    if (!this.on) return;
    const P = CHAOS_LOOK.late.phantom;
    const near = crack !== null && Math.hypot(crack.x - diver.x, crack.z - diver.z) < P.reach;
    if (!near && !this.forced) return;
    set.leaveAll();
    const roll = this.rand();
    if (roll >= this.chance || set.list.length >= P.max) return;
    const r = this.rand;
    const toward = near && crack ? Math.atan2(crack.z - diver.z, crack.x - diver.x) : r() * Math.PI * 2;
    const a = toward + (r() * 2 - 1) * (near ? 1.05 : Math.PI);
    const d = P.distance[0] + (P.distance[1] - P.distance[0]) * r();
    const c = { x: diver.x + Math.cos(a) * d, y: diver.y + (r() * 2 - 1) * P.height, z: diver.z + Math.sin(a) * d };
    set.add(r() < P.mass.chance ? massShape(c, r) : nodeShape(c, r), time, P.lifeS);
  }
}
