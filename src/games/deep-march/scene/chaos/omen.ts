/**
 * The megafauna omen (MVP plan M8, design doc §7.2–7.3, D8): at stage 2 a giant
 * squid is first HEARD, then SEEN in the sonar far away — never met. Pure state
 * machine, telegraphed and without a jump scare:
 *   wait  → near an open crack (≤ 900 m), after `firstS` into the dive, then every
 *           240 … 420 s, at most 3 per generation, never during the tide;
 *   lead  → a low rumble swells for 6 s; nothing to see yet;
 *   show  → a silhouette 230 … 280 m off (toward the crack ± 35°, 18 … 40 m below),
 *           drifting sideways at 4 m/s; its presence fades in over 3 s (and only
 *           the sonar draws it); it keeps ≥ 180 m from the diver, backing off;
 *   leave → it withdraws outward and down, presence and rumble fade out.
 */
import { CHAOS_LOOK } from "./config";
import { chaosRng } from "./rng";

export type OmenPhase = "wait" | "lead" | "show" | "leave";

export type OmenFrame = {
  phase: OmenPhase;
  /** Rumble level 0 … 1 (audio). */
  rumble: number;
  /** Silhouette presence 0 … 1 (sonar only). */
  presence: number;
  x: number;
  y: number;
  z: number;
  /** Heading (rad, around +y; 0 = toward −z) of its drift. */
  yaw: number;
};

export type OmenInput = {
  dt: number;
  /** Dive clock (s). */
  time: number;
  diver: { x: number; y: number; z: number };
  /** Nearest open crack (world x / z), null when none. */
  crack: { x: number; z: number } | null;
  /** The tide runs (or the dive is not ready): no new omen, a running one withdraws. */
  blocked: boolean;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class OmenChain {
  private readonly enabled: boolean;
  private readonly rand: () => number;
  private readonly f: OmenFrame = { phase: "wait", rumble: 0, presence: 0, x: 0, y: 0, z: 0, yaw: 0 };
  private t = 0;
  private nextAt: number;
  private count = 0;
  private vx = 0;
  private vz = 0;

  /** firstAt: dive time (s) the first omen may start. */
  constructor(enabled: boolean, seed: number, firstAt: number = CHAOS_LOOK.omen.firstS) {
    this.enabled = enabled;
    this.nextAt = firstAt;
    this.rand = chaosRng(seed * 31 + 7);
  }

  /** Omens run so far this generation. */
  get runs(): number {
    return this.count;
  }

  update(i: OmenInput): Readonly<OmenFrame> {
    const O = CHAOS_LOOK.omen, f = this.f;
    this.t += i.dt;
    if (f.phase === "wait") {
      const near = i.crack && Math.hypot(i.crack.x - i.diver.x, i.crack.z - i.diver.z) <= O.range;
      if (this.enabled && !i.blocked && near && i.time >= this.nextAt && this.count < O.perGeneration) [f.phase, this.t] = ["lead", 0];
    } else if (f.phase === "lead") {
      f.rumble = Math.min(1, this.t / O.leadS);
      if (i.blocked) this.leave();
      else if (this.t >= O.leadS) this.appear(i);
    } else if (f.phase === "show") {
      f.presence = Math.min(1, f.presence + i.dt / O.fadeS);
      this.drift(i, this.vx, 0, this.vz);
      if (i.blocked || this.t >= O.showS) this.leave();
    } else {
      const k = Math.min(1, this.t / O.leaveS);
      f.presence = Math.max(0, f.presence - i.dt / (O.leaveS * 0.6));
      f.rumble = Math.min(f.rumble, 1 - k);
      const dx = f.x - i.diver.x, dz = f.z - i.diver.z, d = Math.hypot(dx, dz) || 1;
      this.drift(i, (dx / d) * 6, -1.5, (dz / d) * 6);
      if (k >= 1) this.rest(i.time);
    }
    return f;
  }

  private appear(i: OmenInput): void {
    const O = CHAOS_LOOK.omen, f = this.f;
    const c = i.crack ?? { x: i.diver.x + 1, z: i.diver.z };
    const bearing = Math.atan2(c.x - i.diver.x, -(c.z - i.diver.z)) + (this.rand() - 0.5) * 2 * (35 * Math.PI) / 180;
    const d = lerp(O.distance[0], O.distance[1], this.rand());
    f.x = i.diver.x + Math.sin(bearing) * d;
    f.z = i.diver.z - Math.cos(bearing) * d;
    f.y = i.diver.y - lerp(O.below[0], O.below[1], this.rand());
    const side = this.rand() < 0.5 ? 1 : -1;
    this.vx = Math.cos(bearing) * O.speed * side;
    this.vz = Math.sin(bearing) * O.speed * side;
    [f.phase, this.t, f.rumble] = ["show", 0, 1];
  }

  /** Move, facing the motion, and back off to the minimum distance. */
  private drift(i: OmenInput, vx: number, vy: number, vz: number): void {
    const f = this.f, min = CHAOS_LOOK.omen.minDistance;
    f.x += vx * i.dt;
    f.y += vy * i.dt;
    f.z += vz * i.dt;
    f.yaw = Math.atan2(vx, -vz);
    const dx = f.x - i.diver.x, dz = f.z - i.diver.z, d = Math.hypot(dx, dz);
    if (d < min) {
      const k = d > 1e-6 ? min / d : 1;
      f.x = i.diver.x + (d > 1e-6 ? dx : min) * k;
      f.z = i.diver.z + dz * k;
    }
  }

  private leave(): void {
    [this.f.phase, this.t] = ["leave", 0];
  }

  private rest(time: number): void {
    const O = CHAOS_LOOK.omen;
    Object.assign(this.f, { phase: "wait", rumble: 0, presence: 0 });
    this.count++;
    this.nextAt = time + lerp(O.every[0], O.every[1], this.rand());
  }
}
