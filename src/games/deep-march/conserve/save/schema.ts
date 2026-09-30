/**
 * World save format (design doc §10.1), stored as one plain object per slot in the
 * platform game-store. Only what the current milestone uses is in it; later
 * milestones add fields through a version bump and a migration (migrate.ts).
 */
import type { PoolId } from "../ledger/pools";
import type { ParticleVector } from "../particles/particleVector";

export const SAVE_VERSION = 3;

/** Ending A outcome: sealed = survived the gaze; annihilated = the save is over for good (D14). */
export type EndingA = "sealed" | "annihilated";

export type WorldSaveV1 = {
  v: 1;
  /** Slot id. */
  id: string;
  createdAt: number;
  savedAt: number;
  /** Seed as the player typed it, and its hash (the terrain seed). */
  seedText: string;
  seed: number;
  size: { sitesX: number; sitesZ: number };
  /** Generation number (1 until the first tide). */
  gen: number;
  /** N_k, fixed at genesis. */
  totals: ParticleVector;
  /** Pool contents; Σ pools = totals for every kind. */
  ledger: Record<PoolId, ParticleVector>;
  stats: { divesStarted: number };
  flags: { endingA?: EndingA; endingB?: boolean };
};

/** The current generation's fixed inputs (v2). */
export type GenerationStateV2 = {
  /** R_k at the start of this generation: the site table is (seed, gen, R) → … (world/siteTable.ts). */
  allocInput: ParticleVector;
};

/** v2 (M2): + generation.allocInput, so the site table stays fixed until the next tide. */
export type WorldSaveV2 = Omit<WorldSaveV1, "v"> & { v: 2; generation: GenerationStateV2 };

/** v3 (M4): what is left of this generation's resource nodes (nodes/nodeState.ts). */
export type GenerationState = GenerationStateV2 & {
  /** Fully absorbed node ids: base64 bitset, id = site · 64 + ordinal (nodes/bitset.ts). */
  harvested: string;
  /** Partly absorbed nodes: [id, particles left], ascending ids. */
  partial: [number, number][];
};

/** A lost cache (§7.4): what one death left behind; Σ caches = the lost pool. */
export type SavedCache = {
  id: number;
  /** World position, metres. */
  pos: [number, number, number];
  gen: number;
  contents: ParticleVector;
};

/** v3 (M4): + generation.harvested / partial, + caches (≤ 5). */
export type WorldSaveV3 = Omit<WorldSaveV2, "v" | "generation"> & { v: 3; generation: GenerationState; caches: SavedCache[] };

export type WorldSave = WorldSaveV3;

/** An annihilated world can only be looked back on, never entered again (D14). */
export function isReadOnlySave(save: WorldSave): boolean {
  return save.flags.endingA === "annihilated";
}
