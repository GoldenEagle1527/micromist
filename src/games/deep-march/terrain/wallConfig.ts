/**
 * Ring-wall shape tunables (design doc §4.4; geometry in wallGeometry.ts, density
 * term in density.ts). Lengths in metres at the design scale (TERRAIN.worldScale),
 * densities in world density units. The thickness itself is not here: it comes
 * from the wall model with the world (SiteLayout.wall, conserve/chaos/wallModel.ts).
 */
export const WALL_SHAPE = {
  /** Corner radius of the inner outline (the world rectangle with rounded corners). */
  cornerRadius: 400,
  /** Facet lattice (staggered rows → planar triangles): spacing along the ring and between rows. */
  facetAlong: 96,
  facetRow: 40,
  /** Lattice rows span yMin … yMax (the face is constant beyond). */
  yMin: -120,
  yMax: 80,
  /** The inner face stands inset … inset + relief + swell inside the outline. */
  inset: 4,
  /** Facet relief, quantised to `levels` offsets (few facet orientations: cleaved rock). */
  relief: 30,
  levels: 4,
  /** Low-frequency octave along the ring (periodic): amplitude and wavelength. */
  swell: 8,
  swellWave: 700,
  /** Density gradient across the face (≈ the terrain's, so normals / AO / collision match). */
  gradient: 1,
  /** `reach` m in front of the face the field steepens `falloff`× (the term then ends exactly). */
  reach: 24,
  falloff: 4,
  /** Rounded fillet where the wall meets the seabed (smooth-max width, density units). */
  fillet: 6,
  /** Chaos void beyond the outer face: open water between these heights, rock above / below. */
  voidLo: -20,
  voidHi: 44,
  voidGradient: 4,
  /** Cracks (M6): jag amplitude (× width) and period of the zigzag down the face. */
  crackJag: 0.3,
  crackJagPeriod: 28,
  /** Wall material weight: fades out over this distance in front of the face. */
  materialBand: 18,
} as const;

export type WallShapeTuning = { readonly [K in keyof typeof WALL_SHAPE]: number };
