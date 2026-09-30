/** Compact summary of a site table for the loading step and diagnostics. */
import { BIOMES, type Biome } from "../config";
import type { SiteTable } from "./siteTable";

export type SiteSummary = {
  sitesX: number;
  sitesZ: number;
  /** Sites per biome. */
  byBiome: Record<Biome, number>;
  /** Range of the terrain bias δ over the sites. */
  deltaMin: number;
  deltaMax: number;
};

export function summarizeSites(table: SiteTable): SiteSummary {
  const byBiome = Object.fromEntries(BIOMES.map((b) => [b, 0])) as Record<Biome, number>;
  let deltaMin = Infinity, deltaMax = -Infinity;
  for (const s of table.sites) {
    byBiome[s.biome]++;
    deltaMin = Math.min(deltaMin, s.delta);
    deltaMax = Math.max(deltaMax, s.delta);
  }
  if (table.sites.length === 0) deltaMin = deltaMax = 0;
  return { sitesX: table.sitesX, sitesZ: table.sitesZ, byBiome, deltaMin, deltaMax };
}
