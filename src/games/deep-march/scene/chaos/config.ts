/**
 * Every strength of the chaos presentation (MVP plan M8, design doc §4.2 / §4.5 /
 * §7.3) in one table, so tuning after the visual check changes numbers only.
 * Stage 0 is all zeros (nothing is built or run). Stages 3–5 add the deep effects
 * (deepChaos.ts): global fog shift, plankton tint and distorted swarms, the global
 * audio wobble, the surge, the eye's blink and the shell beyond through cracks;
 * `late` the stage 3–4 omens (lateChaos.ts): false sonar readings, the lighthouse
 * dimming, the base's ghost echo (the anomalous terrain is baked: terrain/anomaly.ts).
 * Colours are linear RGB.
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
  /** Stage 3+: fog colour shift everywhere (share), on top of the local one. */
  fogGlobal: number;
  /** Stage 3+: plankton tint toward the stage's colour (deep.plankton), share. */
  plankton: number;
  /** Stage 3+: share of the plankton that swims distorted (jerky, against the drift). */
  warp: number;
  /** Stage 4+: audio wobble everywhere (wetness floor). */
  audioGlobal: number;
  /** Stage 4+: the surge and the eye's blink / pupil run. */
  events: boolean;
  /** Stage 3+: chance that a ping near a crack returns phantom contacts (声呐假读数). */
  phantom: number;
  /** Stage 3+: depth / heading readouts jump now and then near cracks. */
  glitch: boolean;
  /** Stage 4+: the base's lighthouses dim now and then (基地灯塔偶尔变暗). */
  dim: boolean;
  /** Stage 4+: chance that a ping away from the base is answered by the base's ghost echo from elsewhere. */
  homeGhost: number;
};

const LATE_OFF = { phantom: 0, glitch: false, dim: false, homeGhost: 0 };
const DEEP_OFF = { fogGlobal: 0, plankton: 0, warp: 0, audioGlobal: 0, events: false, ...LATE_OFF };
const CALM: ChaosStageLook = { veins: 0, glow: 0, fog: 0, flicker: 0, detune: 0, ghost: 0, omen: false, ...DEEP_OFF };
const ECHOES: ChaosStageLook = { veins: 0.55, glow: 0, fog: 0, flicker: 0, detune: 0, ghost: 0.25, omen: false, ...DEEP_OFF };
const FIRST_CRACKS: ChaosStageLook = { veins: 0.8, glow: 1, fog: 0.6, flicker: 0.32, detune: 1, ghost: 0.35, omen: true, ...DEEP_OFF };
const SEEPING: ChaosStageLook = { veins: 0.9, glow: 1.15, fog: 0.7, flicker: 0.34, detune: 1, ghost: 0.45, omen: true, fogGlobal: 0.1, plankton: 0.4, warp: 0.25, audioGlobal: 0, events: false, phantom: 0.4, glitch: true, dim: false, homeGhost: 0 };
const EROSION: ChaosStageLook = { veins: 1, glow: 1.3, fog: 0.8, flicker: 0.36, detune: 1, ghost: 0.55, omen: true, fogGlobal: 0.16, plankton: 0.7, warp: 0.5, audioGlobal: 0.3, events: true, phantom: 0.5, glitch: true, dim: true, homeGhost: 0.3 };
const GAZE: ChaosStageLook = { ...EROSION, glow: 1.45, fogGlobal: 0.22, plankton: 0.85, warp: 0.65, audioGlobal: 0.4 };

export const CHAOS_LOOK = {
  stages: [CALM, ECHOES, FIRST_CRACKS, SEEPING, EROSION, GAZE] as readonly ChaosStageLook[],
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
  deep: {
    /** Plankton tint per stage from 3 (sickly green-white, then red-violet). */
    plankton: [[0.55, 0.95, 0.62], [0.95, 0.22, 0.62], [1, 0.16, 0.5]] as const,
    /** Distorted specks: jitter amplitude (m) away from / at a crack (χ_l = 1). */
    warpAmp: [0.25, 0.9] as const,
    /** 混沌涌: every 180 … 300 s (first after `firstS`), ramp in / hold / out (s), its added strengths. */
    surge: { firstS: 90, every: [180, 300] as const, ramp: 5, hold: 20, fog: 0.22, audio: 0.35, plankton: 0.25, warp: 0.25, dread: 0.55, ghostEveryS: 4 },
    /** The eye blinks: every 150 … 300 s, a 2 s low warning, then the crack light dims to 0 for 1.5 s (0.35 s eases). */
    blink: { firstS: 60, every: [150, 300] as const, leadS: 2, offS: 1.5, ease: 0.35, rumble: 0.35 },
    /** The pupil, a dark vertical bar sweeping across a through crack's shell: every 40 … 90 s, over 7 s. */
    pupil: { every: [40, 90] as const, sweepS: 7, width: 0.12, dark: 0.85 },
  },
  late: {
    /** 声呐假读数: within `reach` m of an open crack (anywhere when forced), ≤ `max` contacts at once. */
    phantom: {
      reach: 400,
      max: 3,
      /** Placed this far from the diver (m), up to this much above / below, leaning toward the crack. */
      distance: [70, 190] as const,
      height: 25,
      /** Kinds: a node-like cluster of 3 small returns, or one large body of 7 along a 26 … 48 m curve. */
      node: { blips: 3, spread: 4, size: 5 },
      mass: { chance: 0.35, blips: 7, length: [26, 48] as const, size: 11 },
      /** It fades out once the diver comes this close (m) over `fadeS`; gone at the next ping or after `lifeS`. */
      vanish: 55,
      fadeS: 1.6,
      lifeS: 30,
      /** Sonar look: front / trail gain of a return (the sonar colour), point size cap (px). */
      front: 1.1,
      trail: 0.7,
      maxPx: 160,
    },
    /** Readings jump (pure UI): every 18 … 45 s near a crack, for 0.7 … 1.6 s. */
    glitch: { every: [18, 45] as const, hold: [0.7, 1.6] as const, depth: [9, 38] as const, heading: [25, 110] as const },
    /**
     * 基地灯塔变暗: within `near` m of the base, every 120 … 240 s (first after `firstS`): a low groan (`leadS`: the heavy
     * metal creak, slowed and muffled, over a softer rumble), the light eases down, holds, recovers.
     */
    dim: { near: 420, firstS: 75, every: [120, 240] as const, leadS: 2.5, downS: 2.5, holdS: [4, 7] as const, upS: 3.5, floor: 0.2, rumble: 0.3, creak: { gain: 0.34, rate: 0.8, lowpass: 1300 }, calm: { floor: 0.6, slow: 1.6 } },
    /** 幽灵回波: ≥ `minHome` m from the base core; the phantom base 120 … 240 m away, turned 70 … 180° from the true bearing, 0.6 … 1.4 s after the ping (the deep far ping, a little low and muffled). */
    homeGhost: { minHome: 160, distance: [120, 240] as const, turn: [70, 180] as const, delay: [0.6, 1.4] as const, gain: 0.6, sound: { gain: 0.24, rate: 0.92, lowpass: 1300 } },
    /** A debug-panel preview runs its first event this soon (s). */
    previewS: 8,
  },
  shell: {
    /** Radius of the shell patch around a through crack's outer mouth (m), its half angle (rad), segments. */
    radius: 90,
    halfAngle: 1.3,
    segments: 24,
    /** Height band (m) and its soft edges. */
    yBot: -60,
    yTop: 110,
    edge: 30,
    /** Drawn while the camera is this close to the crack (m). */
    near: 520,
    /** Noise scale (m), drift (m/s), hue cycle (s), emissive gain, fog pierce (extinction ×). */
    cell: 26,
    drift: 2.5,
    hueS: 48,
    gain: 1.25,
    pierce: 0.3,
    colors: [[0.12, 0.75, 0.6], [0.55, 0.18, 0.85], [0.85, 0.2, 0.42]] as const,
  },
} as const;
