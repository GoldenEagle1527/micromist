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
  /** Mean linear albedo of the set (flat-colour fallback shader, no textures). */
  tone: readonly [number, number, number];
};

export const LAYERS: readonly LayerDef[] = [
  { key: "sand", source: "ambientCG Ground061", repeat: 3.2, gain: 0.7, rot: "none" , tone: [0.260, 0.241, 0.190] },
  { key: "gravel", source: "ambientCG Gravel036S", repeat: 2.2, gain: 1.0, rot: "none" , tone: [0.166, 0.153, 0.121] },
  { key: "rock", source: "Poly Haven rock_face_03", repeat: 5.5, gain: 1.0, rot: "desktop" , tone: [0.173, 0.126, 0.088] },
  { key: "moss", source: "Poly Haven mossy_rock", repeat: 4.0, gain: 1.0, rot: "none" , tone: [0.136, 0.131, 0.086] },
  { key: "basalt", source: "ambientCG Rock035", repeat: 5.0, gain: 0.85, rot: "always" , tone: [0.034, 0.083, 0.105] },
  { key: "darkrock", source: "Poly Haven dark_rock", repeat: 5.0, gain: 0.85, rot: "none" , tone: [0.081, 0.059, 0.041] },
  { key: "strata", source: "Poly Haven dark_rock_02", repeat: 6.0, gain: 1.0, rot: "none" , tone: [0.099, 0.078, 0.056] },
  { key: "seaside", source: "Poly Haven seaside_rock", repeat: 4.5, gain: 1.0, rot: "none" , tone: [0.103, 0.088, 0.064] },
  { key: "eroded", source: "ambientCG Rock062", repeat: 5.0, gain: 1.0, rot: "none" , tone: [0.111, 0.104, 0.077] },
  { key: "porous", source: "Poly Haven rock_05", repeat: 3.5, gain: 0.95, rot: "none" , tone: [0.162, 0.120, 0.086] },
  { key: "coralcrust", source: "Poly Haven coral_ground_02", repeat: 4.0, gain: 0.95, rot: "always" , tone: [0.162, 0.116, 0.075] },
  { key: "coralrubble", source: "Poly Haven coral_gravel", repeat: 2.6, gain: 0.95, rot: "none" , tone: [0.150, 0.102, 0.071] },
  { key: "coralmud", source: "Poly Haven coral_mud_01", repeat: 3.0, gain: 0.85, rot: "none" , tone: [0.210, 0.167, 0.121] },
  { key: "shellsand", source: "ambientCG Ground060", repeat: 2.4, gain: 0.75, rot: "none" , tone: [0.219, 0.203, 0.152] },
  { key: "ripplesand", source: "Poly Haven damp_beach_sand_02", repeat: 3.4, gain: 0.95, rot: "none" , tone: [0.128, 0.109, 0.070] },
  { key: "coarsesand", source: "Poly Haven damp_beach_sand", repeat: 2.6, gain: 0.9, rot: "none" , tone: [0.144, 0.117, 0.078] },
  { key: "ooze", source: "Poly Haven moon_01", repeat: 4.0, gain: 0.8, rot: "none" , tone: [0.157, 0.140, 0.115] },
  { key: "mud", source: "ambientCG Ground095B", repeat: 3.2, gain: 0.8, rot: "none" , tone: [0.176, 0.133, 0.100] },
  { key: "nodules", source: "ambientCG Gravel024", repeat: 2.2, gain: 0.85, rot: "none" , tone: [0.097, 0.094, 0.085] },
  { key: "scree", source: "Poly Haven low_tide_rocks", repeat: 2.8, gain: 0.95, rot: "none" , tone: [0.140, 0.110, 0.073] },
  { key: "algae", source: "ambientCG Rock015", repeat: 4.5, gain: 1.0, rot: "none" , tone: [0.087, 0.114, 0.099] },
  { key: "lichen", source: "Poly Haven lichen_rock", repeat: 4.5, gain: 1.0, rot: "always" , tone: [0.120, 0.085, 0.056] },
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

/** Palette index in the shader: 2·region (+1 for alt). */
export const PALETTE_COUNT = REGION_PALETTES.length * 2;

export function paletteOf(p: number): Palette {
  const r = REGION_PALETTES[p >> 1];
  return p & 1 ? r.alt : r.main;
}

/** Layers a region can show (both palettes). */
export function layersOfRegion(region: number): number[] {
  const r = REGION_PALETTES[region];
  return [...new Set([...r.main, ...r.alt])];
}

/** Regions whose palettes use layer i. */
export function regionsOfLayer(i: number): number[] {
  return REGION_PALETTES.flatMap((_, r) => (layersOfRegion(r).includes(i) ? [r] : []));
}

export const ROT_CODE: Record<RotMode, number> = { none: 0, desktop: 1, always: 2 };
