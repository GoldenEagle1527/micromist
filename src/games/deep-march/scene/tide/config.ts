/**
 * Tunables of the tide's show in the dive (scene/tide/): the dissolve front,
 * the dome, the particle currents, the veil (P1 clear water, the murk's
 * darkness). The timeline itself is conserve/tide/config.ts (TIDE).
 */
export const TIDE_VIEW = {
  front: {
    /** Dither band of the dissolve front (m): the terrain thins out across it. */
    width: 16,
    /** Glow at the front edge (linear RGB) and its gain. */
    glow: [0.22, 0.75, 1.0] as const,
    glowGain: 1.8,
  },
  dome: {
    /** Cap resolution (segments around × rings): 24 × 12 = 576 triangles. */
    segments: 24,
    rings: 12,
    /** How far the cap reaches below the equator (0.5 = hemisphere). */
    thetaFraction: 0.58,
    color: [0.3, 0.8, 1.0] as const,
    /** Glow while the warning runs, during the show, and the edge warning's highlight. */
    warnGlow: 0.35,
    showGlow: 0.8,
    edgeGlow: 1.2,
  },
  particles: {
    /** Current particles (one THREE.Points draw), plus the diver's particle-ization burst. */
    phone: 3000,
    desktop: 12000,
    burst: 500,
    /** Point size (m) and its pixel clamp. */
    size: 0.35,
    maxPx: 22,
    /** Height span of the currents around the dome's ground (m). */
    height: 70,
    color: [0.35, 0.85, 1.0] as const,
    /** Fade with distance (1 / m) so far particles merge into the water. */
    fade: 1 / 140,
  },
  veil: {
    /** P1 吸气: the visibility briefly opens to this (m). */
    inhaleVisibility: 90,
    /** The murk at full darkness: everything beyond this is black (m). */
    darkVisibility: 5,
  },
  /** The generation summary stays on screen this long after the tide (s). */
  summaryS: 12,
} as const;
