/**
 * The base as saved (design doc §6, §10.1) and what follows from it: protection
 * radius, storage / energy capacity, and the particles it locks in pool B.
 *
 *   B = storage + Σ building costs + frozen terrain rock      (after founding)
 *   B = the lander cargo                                       (before founding)
 *
 * Pure data and functions; base.ts owns the live state.
 */
import { BASE, STRUCTURES, STRUCTURE_KINDS, type StructureKind } from "../config";
import { addInto, vectorFromCounts, zeroVector, type ParticleVector } from "../particles/particleVector";
import type { FrozenSite } from "../world/siteTable";
import type { StructureInfo } from "./port";

export type Vec3 = [number, number, number];

export type BaseStructure = {
  id: number;
  kind: StructureKind;
  /** Ground point (world, m) and heading (rad). */
  pos: Vec3;
  yaw: number;
  /** The player's switch (consumers only, M9; a brown-out does not clear it). */
  on: boolean;
  /** Seconds of work since the last fuel particle (lighthouse). */
  fuel: number;
};

export type BaseSave = {
  /** The generation the core was built in; its frozen sites apply from the next one (§5.3). */
  foundedGen: number;
  /** The core's ground point. */
  center: Vec3;
  /** The 3 × 3 frozen sites (§5.3, D15) and the terrain rock they lock in B. */
  frozen: FrozenSite[];
  frozenLocked: ParticleVector;
  structures: BaseStructure[];
  storage: ParticleVector;
  energy: number;
  /** Consumers are off after running dry, until energy is back above BASE.restartEnergy. */
  brownout: boolean;
};

export const isStructureKind = (v: unknown): v is StructureKind => typeof v === "string" && (STRUCTURE_KINDS as readonly string[]).includes(v);

export function costOf(kind: StructureKind): ParticleVector {
  return vectorFromCounts(STRUCTURES[kind].cost);
}

/** A building's numbers as the scene / UI see them (port.ts). */
export function structureInfo(kind: StructureKind): StructureInfo {
  const d = STRUCTURES[kind];
  return { kind, cost: costOf(kind), radius: d.radius, height: d.height, energy: d.energy, storage: d.storage, energyCap: d.energyCap };
}

/** Σ building costs. */
export function builtCost(structures: readonly BaseStructure[]): ParticleVector {
  const out = zeroVector();
  for (const s of structures) addInto(out, costOf(s.kind));
  return out;
}

/** What the base locks in pool B (storage + buildings + frozen terrain). */
export function lockedOf(base: Pick<BaseSave, "storage" | "structures" | "frozenLocked">): ParticleVector {
  const out = builtCost(base.structures);
  addInto(out, base.storage);
  addInto(out, base.frozenLocked);
  return out;
}

const sumOf = (structures: readonly BaseStructure[], key: "storage" | "energyCap" | "radiusBonus") => structures.reduce((s, b) => s + STRUCTURES[b.kind][key], 0);

export function protectionRadius(structures: readonly BaseStructure[]): number {
  return Math.min(BASE.radiusMax, BASE.radius + sumOf(structures, "radiusBonus"));
}

export function storageCapacity(structures: readonly BaseStructure[]): number {
  return sumOf(structures, "storage");
}

export function energyCapacity(structures: readonly BaseStructure[]): number {
  return sumOf(structures, "energyCap");
}

export function coreOf(structures: readonly BaseStructure[]): BaseStructure | undefined {
  return structures.find((s) => s.kind === "core");
}

export function cloneBase(b: BaseSave): BaseSave {
  return {
    ...b,
    center: [...b.center] as Vec3,
    frozen: b.frozen.map((f) => ({ ...f })),
    frozenLocked: b.frozenLocked.slice(),
    structures: b.structures.map((s) => ({ ...s, pos: [...s.pos] as Vec3 })),
    storage: b.storage.slice(),
  };
}
