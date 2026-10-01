/**
 * Site table (+ ring wall) → the terrain's explicit site layout (terrain/siteLayout.ts):
 * plain typed arrays the density field, the mesher workers and the region map read.
 * The wall state becomes the layout's wall spec (thickness and the open cracks,
 * metres, with their through flag and arc extent).
 * The world is centred on the origin: cells −⌊nx/2⌋ … nx − 1 − ⌊nx/2⌋ (base-unit
 * site grid). Type-only import: no terrain code enters the conserve chunk.
 */
import type { SiteLayout } from "../../terrain/siteLayout";
import type { WallState } from "../chaos/wallModel";
import type { SiteTable } from "../world/siteTable";

export function terrainLayoutOf(table: SiteTable, wall: WallState | null = null): SiteLayout {
  const n = table.sites.length;
  const layout: SiteLayout = {
    cx0: -Math.floor(table.sitesX / 2),
    cz0: -Math.floor(table.sitesZ / 2),
    nx: table.sitesX,
    nz: table.sitesZ,
    jx: new Float64Array(n),
    jz: new Float64Array(n),
    region: new Int8Array(n),
    hash: new Float64Array(n),
    bias: new Float64Array(n),
    wall: wall ? { thickness: wall.thickness, cracks: wall.cracks.map((c) => ({ ...c, extent: [c.extent[0], c.extent[1]] as const })), anomaly: wall.anomaly ?? 0 } : null,
  };
  for (const s of table.sites) {
    layout.jx[s.i] = s.jx;
    layout.jz[s.i] = s.jz;
    layout.region[s.i] = s.region;
    layout.hash[s.i] = s.hash;
    layout.bias[s.i] = s.delta;
  }
  return layout;
}
