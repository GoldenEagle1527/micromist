/**
 * Seabed material library: the 22 CC0 PBR sets (texture-array layers, built by
 * scripts/deep-march-materials.py in this order) and the per-region palettes.
 *
 * Each macro region (terrain/regions.ts) has two palettes — `main` and `alt` — of
 * 5 slots matching the shader's surface weights: floorA (open floor), floorB
 * (low spots / near walls), wallA, wallB (patches on walls / ledges) and ceiling.
 * `alt` covers world-noise sub-patches of the region (share ≈ 1 − altAt).
 * Sets with large unique features (rot: "always") only appear in B slots and are
 * always sampled with the rotated second scale (materialShader.ts), so they don't
 * tile visibly.
 *
 * Pure data, no asset imports (node tests: scripts/deep-march-materials-test.ts).
 */
export type RotMode = "none" | "desktop" | "always";

export type LayerDef = {
  key: string;
  /** Source (CREDITS.md). */
  source: string;
  /** World units per texture repeat. */
  repeat: number;
  /** Fine brightness trim on top of the encode-time tone matching. */
  gain: number;
  /** Rotated second-scale anti-tiling blend. */
  rot: RotMode;
};

export const LAYERS: readonly LayerDef[] = [
  { key: "sand", source: "ambientCG Ground061", repeat: 3.2, gain: 0.7, rot: "none" },
  { key: "gravel", source: "ambientCG Gravel036S", repeat: 2.2, gain: 1.0, rot: "none" },
  { key: "rock", source: "Poly Haven rock_face_03", repeat: 5.5, gain: 1.0, rot: "desktop" },
  { key: "moss", source: "Poly Haven mossy_rock", repeat: 4.0, gain: 1.0, rot: "none" },
  { key: "basalt", source: "ambientCG Rock035", repeat: 5.0, gain: 0.85, rot: "always" },
  { key: "darkrock", source: "Poly Haven dark_rock", repeat: 5.0, gain: 0.85, rot: "none" },
  { key: "strata", source: "Poly Haven dark_rock_02", repeat: 6.0, gain: 1.0, rot: "none" },
  { key: "seaside", source: "Poly Haven seaside_rock", repeat: 4.5, gain: 1.0, rot: "none" },
  { key: "eroded", source: "ambientCG Rock062", repeat: 5.0, gain: 1.0, rot: "none" },
  { key: "porous", source: "Poly Haven rock_05", repeat: 3.5, gain: 0.95, rot: "none" },
  { key: "coralcrust", source: "Poly Haven coral_ground_02", repeat: 4.0, gain: 0.95, rot: "always" },
  { key: "coralrubble", source: "Poly Haven coral_gravel", repeat: 2.6, gain: 0.95, rot: "none" },
  { key: "coralmud", source: "Poly Haven coral_mud_01", repeat: 3.0, gain: 0.85, rot: "none" },
  { key: "shellsand", source: "ambientCG Ground060", repeat: 2.4, gain: 0.75, rot: "none" },
  { key: "ripplesand", source: "Poly Haven damp_beach_sand_02", repeat: 3.4, gain: 0.95, rot: "none" },
  { key: "coarsesand", source: "Poly Haven damp_beach_sand", repeat: 2.6, gain: 0.9, rot: "none" },
  { key: "ooze", source: "Poly Haven moon_01", repeat: 4.0, gain: 0.8, rot: "none" },
  { key: "mud", source: "ambientCG Ground095B", repeat: 3.2, gain: 0.8, rot: "none" },
  { key: "nodules", source: "ambientCG Gravel024", repeat: 2.2, gain: 0.85, rot: "none" },
  { key: "scree", source: "Poly Haven low_tide_rocks", repeat: 2.8, gain: 0.95, rot: "none" },
  { key: "algae", source: "ambientCG Rock015", repeat: 4.5, gain: 1.0, rot: "none" },
  { key: "lichen", source: "Poly Haven lichen_rock", repeat: 4.5, gain: 1.0, rot: "always" },
];

export const LAYER_COUNT = LAYERS.length;
const L = Object.fromEntries(LAYERS.map((l, i) => [l.key, i])) as Record<string, number>;

/** floorA, floorB, wallA, wallB, ceiling (layer indices). */
export type Palette = readonly [number, number, number, number, number];
export type RegionPalettes = { main: Palette; alt: Palette; /** alt-patch threshold on the patch noise (higher = fewer alt patches). */ altAt: number };

export const SLOT_NAMES = ["floorA", "floorB", "wallA", "wallB", "ceiling"] as const;
/** Slots allowed to hold `rot: "always"` sets. */
export const B_SLOTS = [1, 3] as const;

/** Index = region id (REGION: sand, reef, canyon, cave, terrace, trench). */
export const REGION_PALETTES: readonly RegionPalettes[] = [
  // sand plains: dark rippled sand + shell hash; weathered low rock
  { main: [L.ripplesand, L.shellsand, L.seaside, L.eroded, L.seaside], alt: [L.sand, L.coarsesand, L.eroded, L.moss, L.seaside], altAt: 0.55 },
  // reef forest: coral sediment + rubble, porous limestone with coral crust / algae
  { main: [L.coralmud, L.coralrubble, L.porous, L.coralcrust, L.porous], alt: [L.shellsand, L.coralrubble, L.porous, L.algae, L.porous], altAt: 0.5 },
  // canyon: scree floors, stratified walls with encrusting growth
  { main: [L.gravel, L.scree, L.strata, L.lichen, L.darkrock], alt: [L.coarsesand, L.scree, L.strata, L.seaside, L.darkrock], altAt: 0.55 },
  // cave: mud and black pebbles, slimy rock
  { main: [L.mud, L.nodules, L.rock, L.algae, L.darkrock], alt: [L.ooze, L.nodules, L.eroded, L.algae, L.darkrock], altAt: 0.5 },
  // terrace: the original look, with rippled-sand / seaside-rock patches for variety
  { main: [L.sand, L.gravel, L.rock, L.moss, L.rock], alt: [L.ripplesand, L.gravel, L.seaside, L.moss, L.rock], altAt: 0.5 },
  // trench: grey ooze and nodule fields under black basalt
  { main: [L.ooze, L.nodules, L.darkrock, L.basalt, L.darkrock], alt: [L.mud, L.ooze, L.darkrock, L.basalt, L.darkrock], altAt: 0.6 },
];

/**
 * 「界壁」 — the ring wall's material (bounded world; material slot WALL_MATERIAL =
 * the wall weight of terrain/regionWeights.ts). Stratified dark rock on the big
 * facets (horizontal banding reads the scale), black basalt / lichen patches with the
 * rotated second scale (no visible tiling on flat faces), scree and nodules as the
 * talus at its foot. Albedo toned by WALL_TINT (materialShader.ts).
 */
export const WALL_PALETTES: RegionPalettes = {
  main: [L.scree, L.nodules, L.strata, L.basalt, L.darkrock],
  alt: [L.gravel, L.scree, L.darkrock, L.lichen, L.darkrock],
  altAt: 0.55,
};
/** Material slot of the wall (after the 6 regions). */
export const WALL_MATERIAL = REGION_PALETTES.length;
/** Albedo multiplier on the wall (linear): darker and a little colder than the seabed. */
export const WALL_TINT = [0.72, 0.8, 0.86] as const;
/** Material slots: the region palettes, then the wall's. */
export const MATERIAL_PALETTES: readonly RegionPalettes[] = [...REGION_PALETTES, WALL_PALETTES];

/** Palette index in the shader: 2·slot (+1 for alt); slot = region id, or WALL_MATERIAL. */
export const PALETTE_COUNT = MATERIAL_PALETTES.length * 2;

export function paletteOf(p: number): Palette {
  const r = MATERIAL_PALETTES[p >> 1];
  return p & 1 ? r.alt : r.main;
}

/** Layers a material slot (region, or the wall) can show (both palettes). */
export function layersOfRegion(region: number): number[] {
  const r = MATERIAL_PALETTES[region];
  return [...new Set([...r.main, ...r.alt])];
}

/** Regions whose palettes use layer i. */
export function regionsOfLayer(i: number): number[] {
  return REGION_PALETTES.flatMap((_, r) => (layersOfRegion(r).includes(i) ? [r] : []));
}

export const ROT_CODE: Record<RotMode, number> = { none: 0, desktop: 1, always: 2 };
