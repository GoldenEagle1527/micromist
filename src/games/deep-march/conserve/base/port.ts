/**
 * What the shared scene and UI see of the base (plan M5): the buildings and
 * their rules, storage and energy, and the actions. Type-only for the scene
 * (erased); the object comes from the conserve chunk (base.ts), so the free
 * dive never loads it. Particle kinds are storage indices (0 lithic, 2 lumen,
 * 3 ferro, …); positions are world metres.
 */
import type { StructureKind } from "../config";
import type { PlacementReason, WorldRect } from "./placementRules";

export type { StructureKind, PlacementReason, WorldRect };

export type StructureInfo = {
  kind: StructureKind;
  /** Per kind index. */
  cost: readonly number[];
  radius: number;
  height: number;
  energy: number;
  storage: number;
  energyCap: number;
  /** The player can switch it on / off (consumers and fuelled buildings). */
  switchable: boolean;
  /** Burns one particle of `kind` (storage index) every `every` s of work (lighthouse, reactor). */
  fuel: { kind: number; every: number } | null;
};

export type BaseBuilding = {
  id: number;
  kind: StructureKind;
  pos: readonly [number, number, number];
  yaw: number;
  /** Producing / consuming now (a lighthouse: lit). */
  working: boolean;
  /** The player's switch (only consumers and fuelled buildings can be switched off: `switchable`, M9). */
  on: boolean;
  /** A fuelled producer (reactor) waiting while the energy is full. */
  standby: boolean;
};

export type BaseView = {
  founded: boolean;
  center: readonly [number, number, number] | null;
  radius: number;
  buildings: readonly BaseBuilding[];
  /** Per kind index. Before the founding: the lander cargo. */
  storage: readonly number[];
  stored: number;
  /** The diver's tank (P), per kind index. */
  tank: readonly number[];
  capacity: number;
  energy: number;
  energyCap: number;
  /** Net energy per second (0 while full and not falling). */
  energyRate: number;
  brownout: boolean;
  /** Departures from the base this generation (the tide needs ≥ 1). */
  dives: number;
};

export type TideReadiness = { energy: number; energyNeeded: number; dives: number; divesNeeded: number; ready: boolean };

/**
 * The chaos the next tide would bring if it came now (m = Σ R' / Σ N, R' = N − P − B):
 * m, stage (0 静海 … 5 直视) and wall thickness (m) next to this generation's, and the cracks.
 */
export type TideForecast = {
  m: number;
  stage: number;
  thickness: number;
  now: { m: number; stage: number; thickness: number };
  /** Would open (new or a scar reopening) / heal; open and through (passable) after the tide. */
  cracks: { opening: number; healing: number; open: number; through: number };
};

export type BaseAction = { ok: true; id?: number } | { ok: false; reason: PlacementReason | "unknown" };

export interface BasePort {
  readonly kinds: readonly StructureKind[];
  info(kind: StructureKind): StructureInfo;
  /** Particle kinds of this world (totals > 0), in storage order. */
  readonly activeKinds: readonly number[];
  view(): BaseView;
  /** The 2D rules at (x, z) (the terrain checks are the scene's). */
  check(kind: StructureKind, x: number, z: number, rect: WorldRect): PlacementReason;
  /** Missing particles for `kind` (storage + tank), per kind index. */
  shortfall(kind: StructureKind): readonly number[];
  /** Build the core at `pos` (its site, row-major, is the centre of the frozen 3 × 3). */
  found(pos: readonly [number, number, number], yaw: number, site: number, rect: WorldRect): BaseAction;
  build(kind: StructureKind, pos: readonly [number, number, number], yaw: number, rect: WorldRect): BaseAction;
  /** Take a building down; its cost goes back into storage in full (may exceed the capacity). */
  demolish(id: number): BaseAction;
  /** Switch a consumer (lighthouse) or a fuelled producer (reactor) on / off (M9); refused for the others and unknown ids. */
  setOn(id: number, on: boolean): BaseAction;
  /** Tank → storage (P → B), up to the free capacity; `kind` null = everything. Returns particles moved. */
  deposit(kind: number | null): number;
  /** Storage → tank (B → P), up to the tank's room. */
  withdraw(kind: number, count: number): number;
  /** 放流: storage → suspended (B → S), any amount, no cooldown (D16). */
  release(kind: number, count: number): number;
  /** Death inside the base: the whole tank into storage, capacity ignored (§7.4). */
  depositOnDeath(): number;
  /** Is (x, z) inside the protection radius? */
  inside(x: number, z: number): boolean;
  /** The diver left the protection radius: one dive of this generation. */
  recordDeparture(): void;
  /** Energy, fuel; call every frame. */
  tick(dt: number): void;
  tide(): TideReadiness;
  forecast(): TideForecast;
  /** Changes on every building / storage change (not on energy ticks). */
  revision(): number;
}
