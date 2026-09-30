/**
 * Bounded-world fixtures for the terrain tests: the genesis site table of a seed
 * as a terrain site layout (with its ring wall), a stress layout with the bias pinned at ±δmax
 * (checkerboard) for the conservative-bound checks, and a thin, cracked wall (M6 inputs).
 */
import { SITE_TABLE } from "../../src/games/deep-march/conserve/config";
import { terrainLayoutOf } from "../../src/games/deep-march/conserve/platform/terrainLayout";
import { createWorldSave } from "../../src/games/deep-march/conserve/save/createSave";
import { buildSiteTable, type SiteTable } from "../../src/games/deep-march/conserve/world/siteTable";
import { wallStateOf } from "../../src/games/deep-march/conserve/chaos/wallModel";
import type { SiteLayout } from "../../src/games/deep-march/terrain/siteLayout";

export function genesisTable(seed: number): SiteTable {
  const save = createWorldSave({ id: "main", seedText: String(seed), seed, now: 0 });
  return buildSiteTable({ seed, gen: 1, allocInput: save.generation.allocInput, totals: save.totals });
}

/** The genesis world as played: site layout + the genesis ring wall (wall = false: open edge, M2). */
export function genesisLayout(seed: number, wall = true): SiteLayout {
  const t = genesisTable(seed);
  return terrainLayoutOf(t, wall ? wallStateOf(t.allocInput, createWorldSave({ id: "main", seedText: String(seed), seed, now: 0 }).totals) : null);
}

/** The same layout with another wall (thickness m, cracks) or none. */
export function withWall(l: SiteLayout, wall: SiteLayout["wall"]): SiteLayout {
  return { ...l, wall };
}

/**
 * The genesis sites with an eroded wall as M6 will drive it: 40 m thick, three
 * cracks — one opening right through (depth > face + thickness), one straddling
 * s = 0 (the arc-length wrap), one on a rounded corner.
 */
export function crackedLayout(seed: number): SiteLayout {
  return withWall(genesisLayout(seed), {
    thickness: 40,
    cracks: [
      { s: 30, width: 50, depth: 120 },
      { s: 2080 + 314, width: 70, depth: 60 },
      { s: 7000, width: 30, depth: 25 },
    ],
  });
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
