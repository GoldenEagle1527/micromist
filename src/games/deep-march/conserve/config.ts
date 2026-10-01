/**
 * Conserve-mode tunables, in one place (design doc v0.5, MVP plan M1–M3). Modules
 * import these; none hard-codes a number a designer might want to change.
 */
import { genesisCounts, kindTable, type NodeSurface, type SiteShares } from "./kinds";
import type { PoolId } from "./ledger/pools";
import type { ParticleType } from "./particles/particleTypes";
import type { ParticleCounts } from "./particles/particleVector";

export type { NodeSurface, SiteShares };

export const GENESIS = {
  /** Particle totals N_k fixed at world creation: the kind registry's (kinds.ts). */
  totals: genesisCounts(),
  /** Lander cargo, moved world → base at genesis: exactly enough for the base core (§8.1). */
  landerCargo: { lithic: 600, ferro: 80 } satisfies ParticleCounts,
} as const;

/** Site grid of the bounded world (D17: 10 × 10, MVP included), centred on the origin. */
export const WORLD_SIZE = { sitesX: 10, sitesZ: 10 } as const;

/**
 * Biomes, in the terrain's region order (terrain/regions.ts REGION_KEYS — test:world
 * checks the two agree): relative frequency (REGION_WEIGHTS) and signature particle,
 * the kind whose remaining share scales the biome's draw probability (§5.2).
 */
export const BIOMES = ["sand", "reef", "canyon", "cave", "terrace", "trench"] as const;
export type Biome = (typeof BIOMES)[number];
export const BIOME_WEIGHTS: Readonly<Record<Biome, number>> = { sand: 0.25, reef: 0.27, canyon: 0.15, cave: 0.09, terrace: 0.16, trench: 0.08 };
export const BIOME_SIGNATURE: Readonly<Record<Biome, ParticleType>> = {
  sand: "silica",
  reef: "lumen",
  canyon: "ferro",
  cave: "resonite",
  terrace: "voltite",
  trench: "abyssal",
};

/** Biome × particle affinity A (§3.4): primary 1.0, secondary 0.2–0.35, else 0.05; rock 1.0 everywhere. */
export const AFFINITY: Readonly<Record<Biome, Readonly<Record<ParticleType, number>>>> = {
  sand: { lithic: 1, silica: 1, lumen: 0.2, ferro: 0.05, voltite: 0.05, resonite: 0.05, abyssal: 0 },
  reef: { lithic: 1, silica: 0.2, lumen: 1, ferro: 0.05, voltite: 0.05, resonite: 0.05, abyssal: 0 },
  canyon: { lithic: 1, silica: 0.05, lumen: 0.05, ferro: 1, voltite: 0.3, resonite: 0.05, abyssal: 0 },
  cave: { lithic: 1, silica: 0.05, lumen: 0.2, ferro: 0.05, voltite: 0.05, resonite: 1, abyssal: 0.05 },
  terrace: { lithic: 1, silica: 0.05, lumen: 0.05, ferro: 0.35, voltite: 1, resonite: 0.05, abyssal: 0 },
  trench: { lithic: 1, silica: 0, lumen: 0.05, ferro: 0.05, voltite: 0.05, resonite: 0.2, abyssal: 1 },
};

/** Site table (§3.2, §3.3, §5.2): allocation, draw and rock → terrain bias. */
export const SITE_TABLE = {
  /** Region draw: P(r) ∝ weight · (R_sig / N_sig)^gamma (kinds with N_sig = 0 leave the factor at 1). */
  gamma: 1,
  /** Per-site, per-kind allocation jitter: base + span · hash. */
  jitterBase: 0.75,
  jitterSpan: 0.5,
  /** Allocation factor e_i of sites touching the world edge. */
  edgeFactor: 0.6,
  /** δ_i = clamp(beta · ln(a_rock / ā_rock), ±maxBias), ā_rock = the genesis mean per site. */
  beta: 1.6,
  maxBias: 3,
} as const;

/** In-site split of each kind's allocation (§3.3 table; kinds.ts): shares of terrain / nodes / creatures. */
export const SITE_SPLIT: Readonly<Record<ParticleType, SiteShares>> = kindTable((d) => d.split);

/**
 * The ring wall (§4.1): external variable share m = Σ R / Σ N at the tide,
 * stability σ = clamp((m − mBreak) / (mFull − mBreak), 0, 1), thickness
 * T = minThickness + (fullThickness − minThickness) · smoothstep(σ), metres.
 */
export const WALL = {
  fullThickness: 160,
  minThickness: 24,
  mFull: 0.95,
  mBreak: 0.78,
} as const;

/**
 * Resource nodes (§3.3, §7.1; M4): each kind's node share of a site is cut into
 * nodes of minSize … maxSize particles (about meanSize each, sizes jittered by
 * weight base + span · hash, summing exactly to the share). A share smaller than
 * minSize makes no node: it stays in the site's terrain body (still in W).
 * Node id = site · perSite + ordinal (the save's harvested bitset, §10.1).
 */
export const NODES = {
  minSize: 20,
  meanSize: 50,
  maxSize: 80,
  perSite: 64,
  jitterBase: 0.7,
  jitterSpan: 0.6,
} as const;

/** Where a kind's nodes grow (§3.4 table; kinds.ts); the scene turns this into a surface search. */
export const NODE_SURFACE: Readonly<Record<ParticleType, NodeSurface>> = kindTable((d) => d.surface);

/**
 * The diver's particle tank (plan M4: 200 in the MVP) and the absorb rates: a
 * whole node drains in absorbSeconds of holding (a partial one sooner); a lost
 * cache empties at cacheRate particles / s. Both stop when the tank is full.
 */
export const TANK = { capacity: 200, absorbSeconds: 2, cacheRate: 100 } as const;

/** Lost caches (§7.4, G12): at most `max`; one more sends the oldest to the suspended pool. */
export const CACHES = { max: 5 } as const;

export const SAVE = {
  /** The single MVP save slot (G11: 1 slot until phase 4). */
  slotId: "main",
  /** Minimum time between two throttled save writes, ms (design doc §10.2). */
  throttleMs: 30_000,
} as const;

/**
 * Repairing a save that does not conserve: the totals win; a deficit is added to
 * the suspended pool, an excess is taken back from the pools in this order.
 */
export const REPAIR_TAKE_ORDER: readonly PoolId[] = ["suspended", "world", "lost", "player", "base"];

/** Base buildings (M5 plan table, §6.2; the volt reactor: decision 1A). Durability is reserved for later (nothing is damaged in the MVP). */
export const STRUCTURE_KINDS = ["core", "lighthouse", "energy", "storage", "reactor"] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];
export type StructureDef = {
  readonly cost: ParticleCounts;
  /** Footprint (bounding circle) radius and height above its ground point, metres. */
  readonly radius: number;
  readonly height: number;
  /** Energy per second while working (+ produces, − consumes). */
  readonly energy: number;
  /** Adds to the base's storage and energy capacity, and to its protection radius (m). */
  readonly storage: number;
  readonly energyCap: number;
  readonly radiusBonus: number;
  /**
   * Fuel: one particle of `type` every `every` s of working, base storage → suspended
   * (lighthouse: lumen; reactor: voltite). A fuelled producer stands by while the
   * base's energy is full (BASE.standbyBand): it never burns what can't be stored.
   */
  readonly fuel?: { readonly type: ParticleType; readonly every: number };
  readonly durability: number;
};
export const STRUCTURES: Readonly<Record<StructureKind, StructureDef>> = {
  core: { cost: { lithic: 400, ferro: 60 }, radius: 10, height: 28, energy: 0.25, storage: 500, energyCap: 100, radiusBonus: 0, durability: 1000 },
  lighthouse: { cost: { lithic: 300, lumen: 60, ferro: 40 }, radius: 5, height: 46, energy: -0.3, storage: 0, energyCap: 0, radiusBonus: 8, fuel: { type: "lumen", every: 60 }, durability: 400 },
  energy: { cost: { lithic: 150, ferro: 60, lumen: 20 }, radius: 5, height: 24, energy: 0, storage: 0, energyCap: 200, radiusBonus: 0, durability: 300 },
  storage: { cost: { lithic: 200, ferro: 40 }, radius: 8, height: 13, energy: 0, storage: 1000, energyCap: 0, radiusBonus: 8, durability: 500 },
  /** §6.2 伏晶反应堆: 1 voltite / 30 s → +1.2 / s (36 energy a crystal; the tide's 150 ≈ 4 crystals). */
  reactor: { cost: { ferro: 100, voltite: 30 }, radius: 6, height: 18, energy: 1.2, storage: 0, energyCap: 0, radiusBonus: 0, fuel: { type: "voltite", every: 30 }, durability: 400 },
};

/** The base (§6.1, §6.3, §8.1): placement rules, grid, energy, frozen area, the tide's requirements. */
export const BASE = {
  /** Protection radius: start, + each building's radiusBonus, capped (m). */
  radius: 48,
  radiusMax: 120,
  /** A building must be within this of the core or an energy tower (the power grid, m). */
  gridRange: 60,
  /** Gap kept between two buildings' footprints, m. */
  gap: 2,
  /** The core must be this far from the ring wall's inner face (room for cracks, §4.2), m. */
  wallClearance: 600,
  /** Dominant region weight at the core: not on a biome blend (§6.1). */
  regionMin: 0.6,
  maxStructures: 40,
  /** Frozen square around the core's site: (2 · frozenReach + 1)² sites (D15: 3 × 3). */
  frozenReach: 1,
  /** A brown-out switches consumers off in this order; they come back above restartEnergy. */
  shutdownOrder: ["lighthouse"] as readonly StructureKind[],
  restartEnergy: 10,
  /** A fuelled producer (reactor) stands by while energy ≥ capacity − standbyBand. */
  standbyBand: 1,
  /** The tide (G3, M7): base energy ≥ energy and ≥ dives departures this generation. */
  tide: { energy: 150, dives: 1 },
} as const;
