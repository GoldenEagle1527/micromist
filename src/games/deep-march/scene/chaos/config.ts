/**
 * Every strength of the chaos presentation (MVP plan M8, design doc §4.2 / §4.5 /
 * §7.3) in one table, so tuning after the visual check changes numbers only.
 * Stage 0 is all zeros (nothing is built or run). Stages 3–5 reuse stage 2's row
 * (their own effects are in the follow-up backlog). Colours are linear RGB.
 */
export type ChaosStageLook = {
  /** Glowing hairline veins on the wall (emissive gain). */
  veins: number;
  /** Pale light in the open cracks (surface + water haze gain). */
  glow: number;
  /** Near-crack fog colour shift (share of the chaos murk at χ_l = 1). */
  fog: number;
  /** Lamp dimming depth near cracks (share, ≤ 0.4: never on / off). */
  flicker: number;
  /** Audio detune / wobble wetness near cracks (at χ_l = 1). */
  detune: number;
  /** Chance that a sonar ping gets a ghost echo from the wall. */
  ghost: number;
  /** The distant megafauna omen may run. */
  omen: boolean;
};

const CALM: ChaosStageLook = { veins: 0, glow: 0, fog: 0, flicker: 0, detune: 0, ghost: 0, omen: false };
const ECHOES: ChaosStageLook = { veins: 0.55, glow: 0, fog: 0, flicker: 0, detune: 0, ghost: 0.25, omen: false };
const FIRST_CRACKS: ChaosStageLook = { veins: 0.8, glow: 1, fog: 0.6, flicker: 0.32, detune: 1, ghost: 0.35, omen: true };

export const CHAOS_LOOK = {
  stages: [CALM, ECHOES, FIRST_CRACKS, FIRST_CRACKS, FIRST_CRACKS, FIRST_CRACKS] as readonly ChaosStageLook[],
  /** Within a stage the strengths grow with χ_g from this share of the row to all of it. */
  withinStage: 0.75,
  /** Local intensity χ_l = max exp(−d² / r²): r from the crack width (4 … 60 m → 150 … 400 m). */
  local: { rMin: 150, rMax: 400, wMin: 4, wMax: 60 },
  veins: {
    color: [0.42, 0.72, 0.95] as const,
    /** Noise cell (m), hairline half-width (m), minimum half-width (px), fade once a cell is below this many px. */
    cell: 9,
    hair: 0.035,
    minPx: 0.75,
    fadeCellPx: 14,
    /** Patches (a smooth per-vertex mask, no noise fetch per pixel): scale (m) and the band that shows veins. */
    patch: 70,
    patchBand: [0.42, 0.72] as const,
    /** Slow breathing of the vein glow (Hz, share). */
    breathHz: 0.09,
    breath: 0.18,
  },
  glow: {
    color: [0.78, 0.86, 0.9] as const,
    /** Surface glow in the notch (at weight 1) and the water haze in front of it. */
    surface: 1.6,
    haze: 0.22,
    /** Haze radius around the crack's centre line (m) and how far it reaches out of the wall. */
    hazeRadius: 26,
    /** The light carries through the turbidity this much better than lit rock (extinction ×). */
    pierce: 0.35,
    /** Brighter when the diver stands in front of the crack, followed with a lag (s): "it watches". */
    follow: 0.4,
    followLagS: 3,
    breathHz: 0.13,
    breath: 0.15,
  },
  fog: { color: [0.02, 0.05, 0.036] as const },
  scar: { dark: 0.55, tint: [0.72, 0.7, 0.78] as const, reach: 120 },
  flicker: {
    /** Slow modulation components (Hz, weight): all ≤ maxHz (photosensitivity: no strobe). */
    parts: [[0.23, 0.5], [0.61, 0.32], [1.7, 0.18]] as const,
    maxHz: 3,
    /** 「减弱灯光起伏」: depth × this, and only the slowest component. */
    calm: 0.25,
  },
  audio: {
    /** Detune (cents) at wetness 1: a flat offset wavering at wobbleHz. */
    detuneCents: -38,
    wobbleCents: 16,
    wobbleHz: 0.13,
    /** Wet path: low-pass sweep (Hz), short feedback delay (s, share), wet gain. */
    cutoff: [700, 2400] as const,
    delayS: 0.085,
    feedback: 0.38,
    wetGain: 0.45,
  },
  ghost: {
    /** Delay after the real ping (s), how far toward the wall the phantom starts (m), its strength. */
    delay: [0.3, 1.2] as const,
    reach: 220,
    gain: 0.55,
    /** The phantom's ping: quieter, lower, muffled. */
    sound: { gain: 0.22, rate: 0.8, lowpass: 1600 },
  },
  omen: {
    /** Runs within this distance of an open crack (m), first after `firstS` in the dive, then every `every` s. */
    range: 900,
    firstS: 50,
    every: [240, 420] as const,
    perGeneration: 3,
    /** Rumble first (s), then the silhouette for `showS`, then it withdraws over `leaveS`. */
    leadS: 6,
    showS: 18,
    leaveS: 10,
    /** Where it passes: distance from the diver (m), below the diver (m), drift speed (m/s), never nearer than this. */
    distance: [230, 280] as const,
    below: [18, 40] as const,
    speed: 4,
    minDistance: 180,
    /** Presence fade-in (s): it resolves in the sonar, it never pops. */
    fadeS: 3,
    rumble: { gain: 0.5, hz: [41, 55, 110] as const, lowpass: 180 },
    /** Body (m): mantle length and radius, arm and tentacle lengths; limb sway (m, Hz). */
    body: { mantle: 18, radius: 3, arm: 14, tentacle: 30 },
    sway: { amp: 2.2, hz: 0.11 },
    /** Sonar look: trail / front gains, rim share. */
    look: { trail: 0.55, front: 0.9, rim: 0.6 },
  },
} as const;
