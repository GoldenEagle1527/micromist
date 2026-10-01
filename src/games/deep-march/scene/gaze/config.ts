/**
 * 直视 (stage 5) presentation tuning (design doc §4.6, §7.3, §9.1): the eye in
 * the main breach, the anchors, the berserk swarm on the sonar, the current,
 * the sound floor and the endings. Megalophobia only — everything here is slow,
 * huge and announced; nothing appears in an instant. Data only.
 */
export const GAZE_LOOK = {
  eye: {
    /** The curtain the eye is traced on: beyond the breach's outer mouth (m), half angle (rad), segments, band (m). */
    curtain: { radius: 70, halfAngle: 1.45, segments: 24, yBot: -40, yTop: 70 },
    /** The eye itself, a sphere traced in the shader: centre this far beyond the mouth (m), radius (m), height. */
    distance: 2400,
    size: 1500,
    centreY: 10,
    /** Iris angular radius (rad), the slit's height (iris share), half widths: thin line … open. */
    iris: 0.55,
    slitH: 0.9,
    slit: [0.03, 0.22] as const,
    /** At first it looks past the world (rad off the base), then turns to it over `turnS` of the gaze. */
    turnFrom: 1.0,
    turnS: 90,
    /** A preview turns after this many seconds of the dive. */
    previewDelay: 20,
    /** The pupil follows the diver's lamp (s): lit = a thin line, dark = wider. */
    pupilS: 3,
    colors: { iris: [0.95, 0.46, 0.12], inner: [1.0, 0.8, 0.35], rim: [0.2, 0.05, 0.22], sclera: [0.03, 0.016, 0.04] },
    gain: 1.15,
    /** Turbidity pierce (extinction ×, of the distance to the curtain) and the draw distance from the breach (m). */
    pierce: 0.12,
    near: 760,
    /** Fade at the breach's sides / the void's floor and roof (m). */
    edge: 10,
    /** The void beyond the wall is open between these heights (terrain/wallConfig.ts voidLo / voidHi). */
    voidLo: -20,
    voidHi: 44,
    /** The 封界潮: the pupil closes and the eye dims over this long (s). */
    closeS: 20,
  },
  anchors: { size: 2.4, spin: 0.35, unlit: [0.1, 0.14, 0.2] as const, lit: [0.5, 0.95, 1.0] as const, gain: 2.4, near: 760 },
  swarm: {
    /** Silhouettes on the long sonar (one instanced draw). */
    count: 10,
    /** Their ring around the base per phase (m): ① from → ② to → ③ close → ④ crowd. */
    radius: [900, 560, 220, 150, 110] as const,
    height: [10, 30] as const,
    /** One lap around the base takes this long (s). */
    lapS: 300,
    /** ③ on: the echo giant circling over the dome (scale, height above the core, radius). */
    giant: { scale: 2.8, above: 70, radius: 60, lapS: 120 },
  },
  /** The plankton's current toward the base per phase (m/s). */
  flow: [0.25, 0.4, 0.55, 0.75] as const,
  /**
   * Sound floors per phase (0 … 1): the growl (the hostile drone loop, lower and muffled:
   * scene/audioLoops.ts) from ① on, the synthesized sub rumble under it; a squeeze's groan (rumble bed).
   * creak: the heavy metal creak, slowed and muffled, as a building starts to buckle (crush)
   * and, deeper and slower still, as it gives way (collapse) — its 0.8 s swell stretched, never a hit.
   */
  audio: {
    growl: [0.2, 0.28, 0.36, 0.46] as const,
    rumble: [0.06, 0.1, 0.16, 0.3] as const,
    squeeze: 0.7,
    creak: { crush: { gain: 0.36, rate: 0.68, lowpass: 900 }, collapse: { gain: 0.42, rate: 0.52, lowpass: 650 } },
  },
  /** ② on: the lighthouse light's reach × this (the swarm clouds it). */
  lighthouse: 0.5,
  /** 湮灭: the veil closes over this long (s), how dark, the visibility left (m). */
  ending: { veilS: 10, veilDark: 0.97, vis: 6 },
} as const;
