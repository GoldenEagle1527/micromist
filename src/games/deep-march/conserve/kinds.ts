/**
 * The particle-kind registry (design doc §3.3, §3.4): every per-kind rule of the
 * conserved world in one row, so activating a kind is a one-row change.
 *
 *   genesis  N_k of a new world (0 = the kind is not in this build's worlds);
 *   split    in-site split of a site's allocation: terrain body / nodes / creatures;
 *   surface  where its resource nodes grow (the scene turns it into a surface search).
 *
 * Storage order is particles/particleTypes.ts (PARTICLE_TYPES — append only, never
 * reorder: node ids, saves and the scene's per-kind tables are indexed by it). The
 * biome tables (AFFINITY, BIOME_SIGNATURE) stay in config.ts: they are biome × kind.
 *
 * Activating a kind (giving it a genesis total here) reaches existing saves through
 * save/activateKinds.ts: a save version bump whose migration is `activateKinds`
 * adds the new kind's genesis total to the world pool and the generation's R.
 *
 * Wall semantics (§4.1, D11): every kind counts the same in m = Σ R / Σ N — what
 * is locked in the base (storage, building costs) or carried thins the next wall;
 * fuel burnt from base storage goes to the suspended pool, which the tide returns,
 * so burning never thins it.
 */
import type { ParticleType } from "./particles/particleTypes";
import type { ParticleCounts } from "./particles/particleVector";

/** In-site split shares (terrain / nodes / creatures). */
export type SiteShares = { readonly terrain: number; readonly nodes: number; readonly creatures: number };

/** Where a kind's nodes grow (§3.4 table). */
export type NodeSurface = "floor" | "ledge" | "wall" | "sheltered" | "rock";

export type KindDef = {
  readonly genesis: number;
  readonly split: SiteShares;
  readonly surface: NodeSurface;
};

/** Most kinds: 90 % in nodes, 10 % in creatures (§3.3 「其余」). */
const NODE_RICH: SiteShares = { terrain: 0, nodes: 0.9, creatures: 0.1 };

/**
 * MVP totals: rock as in the full game (the frozen area locks the same ~6 %),
 * lumen and ferro carry the share of the kinds still missing (§12). Voltite
 * (伏晶, decision 1A: the reactor's fuel) at its design total, on terrace ledges.
 */
export const KINDS: Readonly<Record<ParticleType, KindDef>> = {
  lithic: { genesis: 66_000, split: { terrain: 0.85, nodes: 0.15, creatures: 0 }, surface: "rock" },
  silica: { genesis: 0, split: NODE_RICH, surface: "floor" },
  lumen: { genesis: 17_000, split: { terrain: 0, nodes: 0.55, creatures: 0.45 }, surface: "ledge" },
  ferro: { genesis: 17_000, split: NODE_RICH, surface: "wall" },
  voltite: { genesis: 4_500, split: NODE_RICH, surface: "ledge" },
  resonite: { genesis: 0, split: NODE_RICH, surface: "sheltered" },
  abyssal: { genesis: 0, split: NODE_RICH, surface: "sheltered" },
};

/** One field of every kind, keyed by kind (the per-kind tables config.ts exposes). */
export function kindTable<T>(pick: (def: KindDef) => T): Readonly<Record<ParticleType, T>> {
  return Object.fromEntries(Object.entries(KINDS).map(([k, d]) => [k, pick(d)])) as Record<ParticleType, T>;
}

/** Genesis totals of the active kinds (genesis > 0), sparse. */
export function genesisCounts(): ParticleCounts {
  return Object.fromEntries(Object.entries(KINDS).filter(([, d]) => d.genesis > 0).map(([k, d]) => [k, d.genesis])) as ParticleCounts;
}
