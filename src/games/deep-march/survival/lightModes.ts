/**
 * Diver light state machine (no rendering): current mode, on/off, which modes the
 * equipped gear allows, and the battery drain each active mode registers.
 * The scene side (scene/lampRig.ts) only reads `state()`.
 */
import { SURVIVAL_TUNING } from "./config";
import type { Equipment, ItemTag } from "./items";
import type { ResourceSystem } from "./resources";

export type LightMode = "beam" | "high" | "night";
export const LIGHT_MODES: readonly LightMode[] = ["beam", "high", "night"];

/** Gear each mode needs. */
const REQUIRES: Record<LightMode, ItemTag> = { beam: "headLamp", high: "headLamp", night: "nightVision" };

export type LightState = {
  mode: LightMode;
  on: boolean;
  /** Battery is (or recently was) empty: lights can't be switched on. */
  locked: boolean;
  available: readonly LightMode[];
};

const SOURCE = "lights";

export class LightController {
  private mode: LightMode = "beam";
  private on = true;
  private locked = false;
  private readonly offs: (() => void)[] = [];
  private readonly resources: ResourceSystem;
  private readonly equipment: Equipment;
  private readonly battery: string;

  constructor(resources: ResourceSystem, equipment: Equipment, battery = "battery") {
    this.resources = resources;
    this.equipment = equipment;
    this.battery = battery;
    this.offs.push(
      resources.on("depleted", battery, () => {
        this.locked = true;
        this.setOn(false);
      }),
      resources.on("changed", battery, (e) => {
        if (this.locked && e.value >= SURVIVAL_TUNING.battery.minToEnable) this.locked = false;
      }),
      equipment.onChange(() => {
        if (!this.isAvailable(this.mode)) {
          const next = this.available()[0];
          if (next) this.mode = next;
          else this.on = false;
        }
        this.sync();
      }),
    );
    this.sync();
  }

  state(): LightState {
    return { mode: this.mode, on: this.on, locked: this.locked, available: this.available() };
  }

  available(): LightMode[] {
    return LIGHT_MODES.filter((m) => this.isAvailable(m));
  }

  isAvailable(m: LightMode): boolean {
    return this.equipment.has(REQUIRES[m]);
  }

  /** F / lamp button. Returns the new on-state (false if locked or no gear). */
  toggle(): boolean {
    return this.setOn(!this.on);
  }

  setOn(on: boolean): boolean {
    this.on = on && !this.locked && this.isAvailable(this.mode);
    this.sync();
    return this.on;
  }

  /** L / mode button: next available mode; switches the light on. */
  cycle(): LightMode {
    const list = this.available();
    if (list.length === 0) return this.mode;
    const i = list.indexOf(this.mode);
    return this.select(list[(i + 1) % list.length]);
  }

  /** 1 / 2 / 3: pick a mode directly (ignored if the gear is missing); switches the light on. */
  select(m: LightMode): LightMode {
    if (!this.isAvailable(m)) return this.mode;
    this.mode = m;
    this.setOn(true);
    return this.mode;
  }

  dispose(): void {
    this.offs.forEach((f) => f());
    this.resources.clearSource(SOURCE);
  }

  private sync(): void {
    this.resources.setDrain(this.battery, SOURCE, this.on ? SURVIVAL_TUNING.lights[this.mode] : 0);
  }
}
