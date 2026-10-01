/**
 * Base scene tunables (plan M5): placement feedback, the buildings' look, the
 * lighthouse light and beam, docking. Rules and costs are the conserve side's
 * (conserve/config.ts STRUCTURES / BASE); ground scans are terrain/anchorConfig.ts GROUND.
 */
export const PLACEMENT = {
  /** Steepest ground: the core (§6.1: < 22°), the others (tilt ≤ 15°, skirt fitted). */
  slopeMaxCore: 22,
  slopeMaxOther: 15,
  /** Re-run the ground checks at most this often, or when the aim moved this far. */
  intervalMs: 120,
  moveEps: 0.6,
  /** Frozen-zone check radius: the largest protection radius the base can reach. */
  frozenRadius: 120,
  /** Buildings face the diver: yaw snaps to this step (rad). */
  yawStep: Math.PI / 8,
} as const;

export const STRUCTURE_LOOK = {
  /** Hull: dark basalt-blue, specular sheen (Phong), panel seams (normal-map look). */
  hull: [0.16, 0.2, 0.25] as const,
  shininess: 34,
  specular: 0.22,
  /** Seam spacing (m) and depth of the procedural panel normals. */
  seam: 3.2,
  seamDepth: 0.55,
  /** Emissive strips: deep cyan-blue; unpowered strips keep this fraction. */
  glow: [0.25, 0.75, 1.0] as const,
  /** The reactor's volt crystal (glow weight 3): amber, as the voltite nodes. */
  volt: [1.0, 0.62, 0.2] as const,
  glowGain: 1.6,
  glowIdle: 0.12,
  /** Slow breathing of the glow, Hz. */
  pulseHz: 0.18,
} as const;

/** Lighthouse light on the terrain and buildings, and its visible column (§6.2: 80 m, 400 m through fog). */
export const BASE_LIGHT = {
  radius: 80,
  /** Lights the renderer shades at once (nearest lit lighthouses to the camera). */
  max: 2,
  color: [0.62, 0.86, 1.0] as const,
  /** Diffuse strength at the lantern; falls off as (1 − d/r)². */
  gain: 2.4,
  /** Sweeping beam: turns per second, cone half-width (cos), extra gain inside it. */
  sweepHz: 0.07,
  sweepCos: 0.93,
  sweepGain: 2.2,
  /** Lantern height above the lighthouse's ground point. */
  lanternY: 41,
  /** Column: height above the lantern, radius, fog visibility (m, e-fold). */
  columnHeight: 340,
  columnRadius: 3.2,
  columnFog: 260,
  columnAlpha: 0.55,
} as const;

/** Docking at the base: within `range` m of an energy tower (while the base has energy) the battery charges `charge` % / s. */
export const DOCK = { range: 18, charge: 5 } as const;

/** Buildings drawn per kind (conserve BASE.maxStructures is 40 in all). */
export const MAX_PER_KIND = 40;

/**
 * The volt reactor's hum (reactorHum.ts): full `gain` within `near` m of a working
 * reactor's crystal (`crystalY` above its ground point), fading to silence at `far` m;
 * it swells / dies over `easeS` when the reactor starts or goes to 待机 / 停机.
 */
export const REACTOR_HUM = { gain: 0.16, near: 10, far: 85, crystalY: 9, easeS: 1.2 } as const;
