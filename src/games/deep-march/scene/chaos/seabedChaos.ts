/**
 * The chaos seabed program (MVP plan M8, design doc §4.4 / §4.5): GLSL blocks the
 * seabed material patches in under DM_CHAOS, and their uniforms. Only a
 * generation that shows chaos (stage ≥ 1, or a scar) draws its terrain with this
 * program (seabedMaterial.ts variant); stage 0 keeps the M7 programs exactly, and
 * every block below sits behind a uniform branch (uChaos) as well.
 *  - scars (healed cracks): a darker, tinted streak down the wall, computed per
 *    vertex from the scar list (no bake);
 *  - veins (stage 1+): glowing hairlines on the wall — the iso-line n = 0.5 of a
 *    2-octave solid value noise (no projection, so no seams), its width from the
 *    pixel footprint (≥ minPx, energy-conserving: thinner than a pixel = dimmer,
 *    never wider), faded out before a noise cell gets small on screen: soft,
 *    anti-aliased, no shimmer; only in patches (a smooth per-vertex mask);
 *  - crack light (stage 2+): the notch's baked glow weight (aChaos, regionWeights
 *    byte 7) lights its deep "membrane", and the water in front of each open crack
 *    glows (closest approach of the view ray to its centre line); both pierce the
 *    turbidity (pale light, the eye's, D7 / D12).
 * Kept free of three imports except the uniform types (node tests compile it).
 */
import * as THREE from "three";
import { CHAOS_LOOK } from "./config";

/** Open cracks drawn at once (the nearest), scars at once. */
export const CHAOS_CRACK_N = 3;
export const CHAOS_SCAR_N = 4;

export const CHAOS_VERT_DECLS = /* glsl */ `
#ifdef DM_CHAOS
attribute float aChaos;
uniform highp vec4 uScar[${CHAOS_SCAR_N}];
uniform highp vec4 uScarT[${CHAOS_SCAR_N}];
uniform float uScarReach;
uniform vec4 uVeinP;
varying vec3 vChaos;
#endif
`;

/** After vWPos: x = crack glow weight, y = scar weight (along the tangent, with the notch's jag). */
export const CHAOS_VERT_MAIN = /* glsl */ `
#ifdef DM_CHAOS
  {
    float scar = 0.0;
    for (int i = 0; i < ${CHAOS_SCAR_N}; i++) {
      vec4 s = uScar[i];
      vec4 t = uScarT[i];
      vec2 d = vWPos.xz - s.xy;
      float u = vWPos.y / t.w + t.z;
      float tri = 2.0 * abs(2.0 * (u - floor(u + 0.5))) - 1.0;
      float p = clamp(1.0 - abs(dot(d, t.xy) + s.w * tri) / s.z, 0.0, 1.0);
      float across = abs(d.x * t.y - d.y * t.x);
      scar = max(scar, p * p * (3.0 - 2.0 * p) * (1.0 - smoothstep(0.6 * uScarReach, uScarReach, across)));
    }
    // vein patches: a smooth low-frequency mask (tens of metres), per vertex
    vec3 q = vWPos * uVeinP.x;
    float m = sin(q.x * 1.7 + 2.3 * sin(q.z * 1.3 + q.y * 0.7)) * sin(q.z * 1.9 + 1.9 * sin(q.x * 1.1 - q.y * 0.9));
    vChaos = vec3(aChaos, scar, smoothstep(uVeinP.y, uVeinP.z, 0.5 + 0.5 * m));
  }
#endif
`;

export const CHAOS_DECLS = /* glsl */ `
#ifdef DM_CHAOS
uniform vec4 uChaos;
uniform vec4 uVein;
uniform vec3 uVeinColor;
uniform vec3 uCrackColor;
uniform DM_P vec4 uCrack[${CHAOS_CRACK_N}];
uniform vec4 uCrackGlow;
uniform vec4 uScarLook;
varying vec3 vChaos;
float dmVeins(vec3 p, float px) {
  vec3 q = p / uVein.x;
  float n = 0.62 * dmNoise(q) + 0.38 * dmNoise(mat3(0.8, 0.36, -0.48, -0.6, 0.48, -0.64, 0.0, 0.8, 0.6) * q * 2.63 + 17.1);
  float d = abs(n - 0.5) * uVein.x * 0.9;
  float w = max(uVein.y, uVein.z * px);
  float core = 1.0 - smoothstep(w - px, w + px, d);
  float halo = exp(-d / (5.0 * w + px));
  return (core + 0.3 * halo) * (uVein.y / w) * (1.0 - smoothstep(0.5, 1.0, px * uVein.w / uVein.x));
}
#endif
`;

/** After MAP_FRAGMENT: scars darken the wall's albedo. */
export const CHAOS_MAP = /* glsl */ `
#ifdef DM_CHAOS
  if (uChaos.z > 0.0) diffuseColor.rgb *= mix(vec3(1.0), uScarLook.xyz * (1.0 - uScarLook.w), vChaos.y * vRegB.z * uChaos.z);
#endif
`;

/** After the caustics: the veins (wall pixels only; no derivatives inside the branch). */
export const CHAOS_EMISSIVE = /* glsl */ `
#ifdef DM_CHAOS
  if (uChaos.x > 0.0 && vRegB.z > 0.02) {
    float px = max(length(dpx), length(dpy));
    totalEmissiveRadiance += uVeinColor * (uChaos.x * vChaos.z * vRegB.z * dmVeins(vWPos, px));
  }
#endif
`;

/** After the turbidity, before the sonar: the pale crack light (lengths in 100 m, mediump-safe). */
export const CHAOS_OPAQUE = /* glsl */ `
#ifdef DM_CHAOS
    if (uChaos.y > 0.0) {
      vec2 o = cameraPosition.xz * 0.01, rd = dv.xz * 0.01;
      float len2 = max(dot(rd, rd), 1e-6);
      float haze = 0.0;
      for (int i = 0; i < ${CHAOS_CRACK_N}; i++) {
        vec4 c = uCrack[i];
        vec2 cp = c.xy * 0.01;
        float t = clamp(dot(cp - o, rd) / len2, 0.0, 1.0);
        vec2 q = o + rd * t - cp;
        float r = c.z * 0.01;
        haze += c.w * exp(-dot(q, q) / (r * r));
      }
      float lit = uCrackGlow.x * vChaos.x * vChaos.x * uChaos.y + uCrackGlow.y * haze;
      outgoingLight += uCrackColor * (lit * exp(-uFogK * dist * uCrackGlow.z));
    }
#endif
`;

export type ChaosUniforms = {
  /** x veins, y crack glow, z scars (0 = off: its block is skipped), w unused. */
  uChaos: { value: THREE.Vector4 };
  /** Veins: cell (m), hairline half-width (m), minimum half-width (px), fade cell (px). */
  uVein: { value: THREE.Vector4 };
  /** Vein patches: 1 / scale (1/m), band lo, hi. */
  uVeinP: { value: THREE.Vector4 };
  uVeinColor: { value: THREE.Color };
  uCrackColor: { value: THREE.Color };
  /** Open cracks: x, z (m), haze radius (m), intensity (0 = unused slot). */
  uCrack: { value: THREE.Vector4[] };
  /** Surface gain, haze gain, fog pierce. */
  uCrackGlow: { value: THREE.Vector4 };
  /** Scar tint (xyz) and darkness (w). */
  uScarLook: { value: THREE.Vector4 };
  /** Scars: x, z (m), half-width (m), jag (m); tangent x, z, jag phase, jag period (m). */
  uScar: { value: THREE.Vector4[] };
  uScarT: { value: THREE.Vector4[] };
  uScarReach: { value: number };
};

/** Far away, zero width: a slot that never matches. */
export function clearScarSlot(s: THREE.Vector4, t: THREE.Vector4): void {
  s.set(1e6, 1e6, 1, 0);
  t.set(1, 0, 0, 28);
}

export function createChaosUniforms(): ChaosUniforms {
  const L = CHAOS_LOOK;
  const scar = Array.from({ length: CHAOS_SCAR_N }, () => new THREE.Vector4());
  const scarT = Array.from({ length: CHAOS_SCAR_N }, () => new THREE.Vector4());
  scar.forEach((s, i) => clearScarSlot(s, scarT[i]));
  return {
    uChaos: { value: new THREE.Vector4(0, 0, 0, 0) },
    uVein: { value: new THREE.Vector4(L.veins.cell, L.veins.hair, L.veins.minPx, L.veins.fadeCellPx) },
    uVeinP: { value: new THREE.Vector4(1 / L.veins.patch, L.veins.patchBand[0], L.veins.patchBand[1], 0) },
    uVeinColor: { value: new THREE.Color(...L.veins.color) },
    uCrackColor: { value: new THREE.Color(...L.glow.color) },
    uCrack: { value: Array.from({ length: CHAOS_CRACK_N }, () => new THREE.Vector4(0, 0, 1, 0)) },
    uCrackGlow: { value: new THREE.Vector4(L.glow.surface, L.glow.haze, L.glow.pierce, 0) },
    uScarLook: { value: new THREE.Vector4(...L.scar.tint, L.scar.dark) },
    uScar: { value: scar },
    uScarT: { value: scarT },
    uScarReach: { value: L.scar.reach },
  };
}
