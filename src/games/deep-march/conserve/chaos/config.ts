/**
 * Chaos tunables (design doc v0.5 §4.2–4.3, MVP plan M6): stage thresholds of
 * the post-tide external share m, the global intensity χ_g, the cracks (opening
 * thresholds, size, placement score and rules, healing hysteresis) and the main
 * breach; plus the ring outline in metres (test:chaos checks it against the
 * terrain's wall geometry). The wall thickness curve itself is WALL (../config.ts).
 */

export const CHAOS = {
  /** Lower m bound of stages 0 … 4 (m ≥ stages[i] → stage ≤ i); below the last: stage 4, or 5 with the gaze condition. */
  stages: [0.92, 0.9, 0.87, 0.84, 0.8],
  /** Stage 5 (直视) also needs this many abyssal particles locked in the base. */
  gazeAbyssal: 200,
  /** χ_g = clamp((chiStart − m) / chiSpan, 0, 1): 0 at stage 0, 1 at m_break. */
  chiStart: 0.92,
  chiSpan: 0.14,
  /** 异常地形 strength near open cracks per stage 0 … 5 (terrain/anomaly.ts; baked at the tide). */
  anomaly: [0, 0, 0, 0.7, 1, 1],
} as const;

export const CRACKS = {
  /** Crack j opens at a tide with m < mOpen[j]. */
  mOpen: [0.9, 0.875, 0.855, 0.838, 0.825, 0.81],
  /** Heals at a tide with m ≥ mOpen + heal (hysteresis), leaving a scar; reopens at the same spot. */
  heal: 0.01,
  /** Width = widthBase + widthPerStep · 100 · (mOpen − m), in [widthBase, widthMax] (m). */
  widthBase: 4,
  widthPerStep: 4,
  widthMax: 60,
  /** Depth = thickness · (depthBase + depthPerStep · 100 · (mOpen − m)), fraction in [depthBase, 1]. */
  depthBase: 0.4,
  depthPerStep: 0.1,
  /** Through (passable) once the depth reaches the whole thickness and the width this (m). */
  throughWidth: 30,
  /** A through crack's notch runs this far past the thickness (≥ the inner face's deepest inset, 42 m). */
  throughMargin: 60,
  /** Candidate spots every `step` m of the ring. */
  step: 32,
  /** Placement rules: from the base core, and from every other crack or scar (m, straight line). */
  minBaseDistance: 600,
  minSpacing: 500,
  /** Score weights: wall thinness noise, harvested share of the wall site, toward the base, hash. */
  weights: { thin: 0.35, harvest: 0.35, base: 0.15, hash: 0.15 },
  /** Wavelength of the thinness noise along the ring (m). */
  thinWave: 480,
} as const;

/** The main breach (stage 5): opens below mOpen with the gaze condition; always through. */
export const BREACH = { j: 6, mOpen: 0.8, width: 120, widthMax: 200 } as const;

/** The ring outline, metres: site cell size (terrain MACRO.cell × worldScale) and corner radius (WALL_SHAPE.cornerRadius). */
export const RING = { siteMetres: 416, cornerRadius: 400 } as const;
