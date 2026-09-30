/**
 * The frozen area (§5.3, D15): the (2r + 1)² sites around the core's site keep
 * their layout (jitter, biome, variation, δ) across tides, and their terrain rock
 * leaves the external variable: world → base, locked with the base (§3.3). With a
 * 10 × 10 world the 3 × 3 is ~6 % of the rock (test:frozen).
 *
 * Whether the terrain inside the protection radius really stays put is the
 * terrain's check (terrain/frozenZone.ts, run before the core is placed). The
 * frozen sites enter the site table from the generation after the founding
 * (session/conserveSession.ts): the current one keeps its table (D2).
 */
import { BASE } from "../config";
import { addInto, zeroVector, type ParticleVector } from "../particles/particleVector";
import type { FrozenSite, SiteTable } from "../world/siteTable";

export type FrozenArea = { sites: FrozenSite[]; locked: ParticleVector };

/** Site indices of the square around `center` (row-major), clipped to the world. */
export function frozenIndices(center: number, sitesX: number, sitesZ: number, reach: number = BASE.frozenReach): number[] {
  const ix = center % sitesX, iz = Math.floor(center / sitesX);
  const out: number[] = [];
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const x = ix + dx, z = iz + dz;
      if (x >= 0 && z >= 0 && x < sitesX && z < sitesZ) out.push(z * sitesX + x);
    }
  }
  return out;
}

/** Freeze the sites around `center` as they are in `table`; locked = their terrain rock. */
export function freezeArea(table: SiteTable, center: number, reach: number = BASE.frozenReach): FrozenArea {
  const locked = zeroVector();
  const sites = frozenIndices(center, table.sitesX, table.sitesZ, reach).map((i): FrozenSite => {
    const s = table.sites[i];
    addInto(locked, s.split.terrain);
    return { i, jx: s.jx, jz: s.jz, region: s.region, hash: s.hash, delta: s.delta };
  });
  return { sites, locked };
}
