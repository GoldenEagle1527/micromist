/**
 * Base energy (§6.3) — one tick, pure. Producers (the core) always work; a
 * consumer (lighthouse) works while it is switched on, the base is not browned
 * out, and it has fuel: every `fuel.every` s of work burns one particle of
 * `fuel.type` from base storage (→ suspended, by the caller).
 *
 * The player's switch (`on`, M9): a switchable consumer that is off neither
 * consumes nor burns fuel — with only the core producing (+0.25 / s), one lit
 * lighthouse (−0.3 / s) would keep the energy from ever reaching the tide's 150.
 *
 * Fuelled producers (the volt reactor, decision 1A): work while switched on and
 * fuelled, but stand by while the energy is within BASE.standbyBand of the
 * capacity — fuel is only burnt for energy the base can store. With a fuelled
 * reactor (+1.2 / s) a lit lighthouse no longer keeps the tide out of reach.
 *
 * Brown-out: energy runs dry while the net rate is negative → the consumer
 * kinds of BASE.shutdownOrder switch off (MVP: lighthouses only; sonar and
 * harvesters join the list ahead of them later); they come back when the
 * energy is above BASE.restartEnergy again (hysteresis, no flicker).
 */
import { BASE, STRUCTURES } from "../config";
import { particleIndex } from "../particles/particleTypes";
import type { ReadonlyParticleVector } from "../particles/particleVector";
import { energyCapacity, type BaseStructure } from "./baseState";

export type EnergyState = { energy: number; brownout: boolean; structures: readonly BaseStructure[] };

export type EnergyTick = {
  energy: number;
  brownout: boolean;
  /** Per structure id: seconds of work towards the next fuel particle. */
  fuel: Map<number, number>;
  /** Fuel particles burnt this tick, per kind index. */
  burnt: Map<number, number>;
};

/** The player may switch it off: a consumer (lighthouse — saves energy) or anything fuelled (reactor — saves voltite). */
export function switchable(kind: BaseStructure["kind"]): boolean {
  const def = STRUCTURES[kind];
  return def.energy < 0 || !!def.fuel;
}

/** Energy close enough to the capacity that a fuelled producer waits. */
export function isFull(energy: number, cap: number): boolean {
  return cap > 0 && energy >= cap - BASE.standbyBand;
}

/** A fuelled producer waiting for the energy to drop (switched on, fuel or not). */
export function onStandby(s: BaseStructure, full: boolean): boolean {
  const def = STRUCTURES[s.kind];
  return full && s.on && def.energy > 0 && !!def.fuel;
}

/** Set a switchable structure's `on` in place; false if `id` is unknown or not switchable. */
export function switchStructure(structures: readonly BaseStructure[], id: number, on: boolean): boolean {
  const s = structures.find((x) => x.id === id);
  if (!s || !switchable(s.kind)) return false;
  s.on = on;
  return true;
}

/** Is `s` working (producing / consuming) with this storage? `full`: the energy is at the capacity (isFull). */
export function isWorking(s: BaseStructure, brownout: boolean, storage: ReadonlyParticleVector, full = false): boolean {
  const def = STRUCTURES[s.kind];
  if (!s.on || onStandby(s, full)) return false;
  if (def.energy < 0 && brownout && BASE.shutdownOrder.includes(s.kind)) return false;
  return !def.fuel || storage[particleIndex(def.fuel.type)] > 0 || s.fuel < def.fuel.every;
}

/** Net energy per second of the working structures. */
export function netRate(structures: readonly BaseStructure[], brownout: boolean, storage: ReadonlyParticleVector, full = false): number {
  return structures.reduce((sum, s) => sum + (isWorking(s, brownout, storage, full) ? STRUCTURES[s.kind].energy : 0), 0);
}

export function tickEnergy(state: EnergyState, storage: ReadonlyParticleVector, dt: number): EnergyTick {
  const cap = energyCapacity(state.structures);
  const full = isFull(state.energy, cap);
  let brownout = state.brownout;
  if (brownout && state.energy > BASE.restartEnergy) brownout = false;
  const left = storage.slice();
  const fuel = new Map<number, number>();
  const burnt = new Map<number, number>();
  let rate = 0;
  for (const s of state.structures) {
    const def = STRUCTURES[s.kind];
    if (!isWorking(s, brownout, left, full)) continue;
    rate += def.energy;
    if (!def.fuel) continue;
    let t = s.fuel + dt;
    const k = particleIndex(def.fuel.type);
    while (t >= def.fuel.every && left[k] > 0) {
      t -= def.fuel.every;
      left[k] -= 1;
      burnt.set(k, (burnt.get(k) ?? 0) + 1);
    }
    fuel.set(s.id, Math.min(t, def.fuel.every));
  }
  let energy = Math.min(cap, Math.max(0, state.energy + rate * dt));
  if (energy <= 0 && rate < 0) {
    brownout = true;
    energy = 0;
  }
  return { energy, brownout, fuel, burnt };
}
