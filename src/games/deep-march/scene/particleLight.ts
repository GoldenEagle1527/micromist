/**
 * Fluorescent plankton as tiny point lights: each frame the CPU picks the N glowing
 * specks nearest the diver (in front, within PARTICLE_LIGHT.maxDist) and the seabed
 * shader adds a dim blue-cyan glow on rock within ~1.5 m of each (soft falloff to
 * zero at the radius). Additive and independent of ambient, so it is the only light
 * left when the lamps are off. Injected by seabedMaterial.ts; filled from particles.ts.
 */
import * as THREE from "three";

export const PARTICLE_LIGHT = {
  /** Lights uploaded per frame (shader loop length). */
  count: 40,
  /** Glow radius on surfaces (m); falls to zero here. */
  radius: 1.6,
  /** Peak radiance multiplier on albedo at the particle. */
  intensity: 1.4,
  /** Only specks this close to the camera are candidates. */
  maxDist: 20,
  /** Fragments farther than this from the camera skip the loop. */
  shadeDist: 28,
  tint: new THREE.Color(0.12, 0.5, 1.0),
};

export type ParticleLightUniforms = {
  /** xyz = world position, w = intensity (pulse × size), flat vec4 array. */
  uPL: { value: Float32Array };
  uPLCount: { value: number };
  uPLRadius: { value: number };
  uPLGain: { value: number };
  uPLTint: { value: THREE.Color };
  uPLShadeDist: { value: number };
};

export function createParticleLightUniforms(): ParticleLightUniforms {
  return {
    uPL: { value: new Float32Array(PARTICLE_LIGHT.count * 4) },
    uPLCount: { value: 0 },
    uPLRadius: { value: PARTICLE_LIGHT.radius },
    uPLGain: { value: PARTICLE_LIGHT.intensity },
    uPLTint: { value: PARTICLE_LIGHT.tint.clone() },
    uPLShadeDist: { value: PARTICLE_LIGHT.shadeDist },
  };
}

export const PL_DECLS = /* glsl */ `
#define DM_PL_N ${PARTICLE_LIGHT.count}
uniform vec4 uPL[DM_PL_N]; uniform int uPLCount; uniform float uPLRadius; uniform float uPLGain;
uniform vec3 uPLTint; uniform float uPLShadeDist;
`;

/** After lights_fragment_end: needs vWPos, dmWorldNormal, diffuseColor, vAO. */
export const PL_LIGHT = /* glsl */ `
  if (uPLCount > 0 && length(vWPos - cameraPosition) < uPLShadeDist) {
    float plAcc = 0.0;
    float invR2 = 1.0 / (uPLRadius * uPLRadius);
    for (int i = 0; i < DM_PL_N; i++) {
      if (i >= uPLCount) break;
      vec3 d = uPL[i].xyz - vWPos;
      float q = dot(d, d) * invR2;
      if (q >= 1.0) continue;
      float f = (1.0 - q) * (1.0 - q);           // smooth, zero at the radius
      vec3 L = d * inversesqrt(max(dot(d, d), 1e-4));
      float ndl = clamp((dot(dmWorldNormal, L) + 0.35) / 1.35, 0.0, 1.0);
      plAcc += f * ndl * uPL[i].w;
    }
    reflectedLight.directDiffuse += diffuseColor.rgb * uPLTint * (uPLGain * plAcc * mix(0.6, 1.0, clamp(vAO, 0.0, 1.0)));
  }
`;
