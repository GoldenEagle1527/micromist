/**
 * Bounded-world fixtures for the terrain tests: the genesis site table of a seed
 * as a terrain site layout, and a stress layout with the bias pinned at ±δmax
 * (checkerboard) for the conservative-bound checks.
 */
import { SITE_TABLE } from "../../src/games/deep-march/conserve/config";
import { terrainLayoutOf } from "../../src/games/deep-march/conserve/platform/terrainLayout";
import { createWorldSave } from "../../src/games/deep-march/conserve/save/createSave";
import { buildSiteTable, type SiteTable } from "../../src/games/deep-march/conserve/world/siteTable";
import type { SiteLayout } from "../../src/games/deep-march/terrain/siteLayout";

export function genesisTable(seed: number): SiteTable {
  const save = createWorldSave({ id: "main", seedText: String(seed), seed, now: 0 });
  return buildSiteTable({ seed, gen: 1, allocInput: save.generation.allocInput, totals: save.totals });
}

export function genesisLayout(seed: number): SiteLayout {
  return terrainLayoutOf(genesisTable(seed));
}

export function stressLayout(seed: number): SiteLayout {
  const l = genesisLayout(seed);
  for (let iz = 0; iz < l.nz; iz++) for (let ix = 0; ix < l.nx; ix++) l.bias[iz * l.nx + ix] = (ix + iz) % 2 ? SITE_TABLE.maxBias : -SITE_TABLE.maxBias;
  return l;
}

/** The same layout with every bias 0 (δ term off, sites unchanged). */
export function unbiased(l: SiteLayout): SiteLayout {
  return { ...l, bias: new Float64Array(l.bias.length) };
}
