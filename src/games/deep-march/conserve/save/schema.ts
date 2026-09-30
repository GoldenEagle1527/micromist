/**
 * World save format (design doc §10.1), stored as one plain object per slot in the
 * platform game-store. Only what the current milestone uses is in it; later
 * milestones add fields through a version bump and a migration (migrate.ts).
 */
import type { PoolId } from "../ledger/pools";
import type { ParticleVector } from "../particles/particleVector";

export const SAVE_VERSION = 1;

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

export type WorldSave = WorldSaveV1;

/** An annihilated world can only be looked back on, never entered again (D14). */
export function isReadOnlySave(save: WorldSave): boolean {
  return save.flags.endingA === "annihilated";
}
