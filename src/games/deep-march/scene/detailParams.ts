/** Tuning of the seabed detail normal (detailNormal.ts), shared by the GLSL and its JS mirror. */

/** [frequency (1/u), crease depth (u)] per scale: coarse, fine. */
export const DETAIL_SCALES: readonly [number, number][] = [
  [0.8, 0.03],
  [2.1, 0.01],
];
/** Largest tangential tilt of the detail normal (≈ radians). */
export const DETAIL_MAX_TILT = 0.26;
/** Scale fade by pixel footprint × frequency (crease cells per pixel). */
export const DETAIL_FADE: readonly [number, number] = [0.05, 0.16];
/** Facet (face-normal) blend: max weight, agreement gate, distance fade (u). */
export const FACET_W = 0.2;
export const FACET_AGREE: readonly [number, number] = [0.9, 0.98];
export const FACET_DIST: readonly [number, number] = [15, 45];

/** Column-major 3×3 rotations (GLSL mat3 order) and offsets per scale. */
export const ROT: readonly number[][] = [
  [0.36, -0.8, 0.48, 0.48, 0.6, 0.64, -0.8, 0.0, 0.6],
  [0.6, 0.64, 0.48, 0.0, 0.6, -0.8, -0.8, 0.48, 0.36],
];
export const OFF: readonly number[][] = [
  [17.3, 5.1, 41.7],
  [3.7, 29.9, 11.3],
];
