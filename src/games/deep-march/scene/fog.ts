/**
 * Turbidity: real underwater visibility is tens of metres, not hundreds.
 *
 * All light reaching the eye from a surface (lamp, ambient, plankton glow) is
 * attenuated by T = exp(−k·d), k = FOG_EXTINCTION / visibility (5 % left at the
 * visibility distance), and replaced by the murk: a dark blue-green in-scattered
 * tone (lamp light scattered back by suspended particles, so it scales with the
 * lamps and is black with the lights off) plus a little of the open-water
 * gradient. The background dome draws the fully fogged colour, so terrain beyond
 * the visibility merges into it. Inside the lamp cone the water itself glows
 * (backscatter): with the source at the eye the cone factor is constant along a
 * view ray, so the in-scatter integral is analytic — (1 − exp(−2kd)) — one exp per
 * pixel. Terrain generation distance is unchanged (sonar needs the far terrain);
 * sonar output ignores the fog (sonar.ts). The debug panel's 浑浊度 overrides it (parseFogParam).
 */
import * as THREE from "three";

/** −ln(0.05): transmittance 5 % at the visibility distance. */
export const FOG_EXTINCTION = 3.0;

export type FogVisibility = { beam: number; high: number; off: number };

export const FOG_TUNING = {
  /** Visibility (m) per light mode; `off` covers lights off / sonar (the plankton sprites). */
  visibility: { beam: 50, high: 72, off: 50 } as FogVisibility,
  /** Murk colour (linear) at full lamp light: dark, slightly blue-green. */
  murk: new THREE.Color(0.012, 0.034, 0.038),
  /** Share of the open-water gradient (daylight from above) left in the murk. */
  waterMix: 0.3,
  /** Backscatter glow inside the lamp cone (radiance at infinite depth of water). */
  glow: { beam: 0.05, high: 0.16 },
  glowColor: new THREE.Color(0.55, 0.78, 0.8),
  /** High beam without fog would reach 280 m; with fog it is cut to this range. */
  highRange: 110,
  /** High-beam gain (brighter than the beam, still fog-limited). */
  highGain: 1.5,
};

/** Extinction coefficient for a visibility (m); 0 visibility = fog off. */
export function fogK(visibility: number): number {
  return visibility > 0 ? FOG_EXTINCTION / visibility : 0;
}

/** Fraction of light left after d metres. */
export function fogTransmittance(k: number, d: number): number {
  return Math.exp(-k * d);
}

/** Backscatter in-scatter factor along a ray of length d (0…1; 1 at infinite depth, 0 without fog). */
export function glowIntegral(k: number, d: number): number {
  return 1 - Math.exp(-2 * k * d);
}

/**
 * Override (dive/params.ts fog): "0" / "off" → no fog; "60" → beam 60 m (high ×1.44, off = beam);
 * "50,80" → beam 50, high 80. Anything else → the defaults.
 */
export function parseFogParam(v: string | null, base: FogVisibility = FOG_TUNING.visibility): FogVisibility | null {
  if (v === null || v === "") return { ...base };
  if (v === "0" || v === "off") return null;
  const parts = v.split(",").map(Number);
  if (!parts.every((x) => Number.isFinite(x) && x > 0)) return { ...base };
  const beam = parts[0];
  const high = parts[1] ?? beam * (base.high / base.beam);
  return { beam, high, off: beam };
}

export type FogUniforms = {
  /** Extinction per metre (0 = off). */
  uFogK: { value: number };
  /** Murk colour, already scaled by the lamp level. */
  uFogColor: { value: THREE.Color };
  uFogWater: { value: number };
  uGlowGain: { value: number };
  uGlowColor: { value: THREE.Color };
  /** World-space lamp direction. */
  uGlowDir: { value: THREE.Vector3 };
  /** cos(outer), cos(inner) half-angles of the glowing cone. */
  uGlowCone: { value: THREE.Vector2 };
};

export function createFogUniforms(): FogUniforms {
  return {
    uFogK: { value: fogK(FOG_TUNING.visibility.beam) },
    uFogColor: { value: FOG_TUNING.murk.clone() },
    uFogWater: { value: FOG_TUNING.waterMix },
    uGlowGain: { value: 0 },
    uGlowColor: { value: FOG_TUNING.glowColor.clone() },
    uGlowDir: { value: new THREE.Vector3(0, 0, -1) },
    uGlowCone: { value: new THREE.Vector2(0.85, 0.95) },
  };
}

/** Needs WATER_GLSL (dmWater) before it. */
export const FOG_GLSL = /* glsl */ `
uniform float uFogK; uniform vec3 uFogColor; uniform float uFogWater;
uniform float uGlowGain; uniform vec3 uGlowColor; uniform vec3 uGlowDir; uniform vec2 uGlowCone;
// fully fogged colour along a view direction
vec3 dmMurk(vec3 dir) { return dmWater(dir) * uFogWater + uFogColor; }
// lamp backscatter along a view ray of length d (source at the eye)
vec3 dmGlow(vec3 dir, float d) {
  if (uGlowGain <= 0.0) return vec3(0.0);
  float c = smoothstep(uGlowCone.x, uGlowCone.y, dot(dir, uGlowDir));
  return uGlowColor * (uGlowGain * c * c * (1.0 - exp(-2.0 * uFogK * d)));
}
// what lies beyond everything (background dome, far terrain fade)
vec3 dmBackground(vec3 dir) { return uFogK > 0.0 ? dmMurk(dir) + dmGlow(dir, 1e5) : dmWater(dir); }
`;

/** Seabed opaque block, after the water haze and the high beam (needs dir, dist, outgoingLight). */
export const FOG_OPAQUE = /* glsl */ `
    if (uFogK > 0.0) {
      outgoingLight = mix(dmMurk(dir), outgoingLight, exp(-uFogK * dist)) + dmGlow(dir, dist);
    }
`;
