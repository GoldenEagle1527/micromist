/**
 * Active sonar (no rendering): the diver sends one ping per key press / tap.
 * A ping needs the sonar unit, costs battery (SURVIVAL_TUNING.sonar.pingCost, all
 * or nothing) and has a cooldown. Accepted pings queue up until the scene's frame
 * takes them (scene/dive/diveLoop.ts emits the pulse from the diver's position).
 */
import { SURVIVAL_TUNING } from "./config";
import type { Equipment } from "./items";
import type { ResourceSystem } from "./resources";

export type SonarRefusal = "gear" | "cooldown" | "battery";

export type SonarState = {
  /** The sonar unit is equipped. */
  available: boolean;
  /** A ping would go out now. */
  ready: boolean;
  /** Seconds until the next ping is allowed (0 = ready as far as the cooldown goes). */
  cooldown: number;
  /** Cooldown progress 0 … 1 (1 = recharged). */
  charge: number;
};

export class SonarPinger {
  private last = -Infinity;
  private queued = 0;
  private readonly resources: ResourceSystem;
  private readonly equipment: Equipment;
  private readonly battery: string;

  constructor(resources: ResourceSystem, equipment: Equipment, battery = "battery") {
    this.resources = resources;
    this.equipment = equipment;
    this.battery = battery;
  }

  /** Why a ping at `nowS` would be refused (null = it would go out). */
  refusal(nowS: number): SonarRefusal | null {
    const T = SURVIVAL_TUNING.sonar;
    if (!this.equipment.has("sonar")) return "gear";
    if (nowS - this.last < T.cooldown) return "cooldown";
    if (!this.resources.canAfford(this.battery, T.pingCost)) return "battery";
    return null;
  }

  /** Key 3 / ping button (`nowS`: seconds, the frame clock). Returns the refusal, or null when the ping went out. */
  ping(nowS: number): SonarRefusal | null {
    const r = this.refusal(nowS);
    if (r) return r;
    this.resources.consume(this.battery, SURVIVAL_TUNING.sonar.pingCost);
    this.last = nowS;
    this.queued++;
    return null;
  }

  /** A ping without cost or cooldown (the staging debug panel). */
  queue(): void {
    this.queued++;
  }

  /** Pings accepted since the last call (the frame emits them). */
  take(): number {
    const n = this.queued;
    this.queued = 0;
    return n;
  }

  state(nowS: number): SonarState {
    const T = SURVIVAL_TUNING.sonar;
    const left = Math.max(0, T.cooldown - (nowS - this.last));
    return { available: this.equipment.has("sonar"), ready: this.refusal(nowS) === null, cooldown: left, charge: 1 - left / T.cooldown };
  }

  /** Forget the cooldown and queued pings (a new dive). */
  reset(): void {
    this.last = -Infinity;
    this.queued = 0;
  }
}
