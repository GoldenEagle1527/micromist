/**
 * High beam ("fog light") as a seabed-shader term instead of a three.js light:
 * a wide, soft cone with NO distance falloff up to a far range, so near rock is
 * lit exactly as brightly as rock 200 m out (no blow-out up close), and the term
 * is added after the water haze with most of the haze cut, so it visibly reaches
 * deep into the murk. Injected by seabedMaterial.ts; driven by lampRig.ts.
 */
import * as THREE from "three";

export type BeamUniforms = {
  /** 0 = off. Radiance multiplier on albedo. */
  uBeamGain: { value: number };
  uBeamColor: { value: THREE.Color };
  /** World-space source + unit direction. */
  uBeamPos: { value: THREE.Vector3 };
  uBeamDir: { value: THREE.Vector3 };
  /** cos(outer half-angle), cos(inner half-angle). */
  uBeamCone: { value: THREE.Vector2 };
  /** Full-strength reach; fades out over the last 30 %. */
  uBeamRange: { value: number };
  /** Fraction of the water haze removed inside the beam (0…1). */
  uBeamHazeCut: { value: number };
};

export function createBeamUniforms(): BeamUniforms {
  return {
    uBeamGain: { value: 0 },
    uBeamColor: { value: new THREE.Color(1, 0.96, 0.88) },
    uBeamPos: { value: new THREE.Vector3() },
    uBeamDir: { value: new THREE.Vector3(0, 0, -1) },
    uBeamCone: { value: new THREE.Vector2(Math.cos(THREE.MathUtils.degToRad(48)), Math.cos(THREE.MathUtils.degToRad(18))) },
    uBeamRange: { value: 280 },
    uBeamHazeCut: { value: 0.75 },
  };
}

export const BEAM_DECLS = /* glsl */ `
uniform float uBeamGain; uniform vec3 uBeamColor; uniform vec3 uBeamPos; uniform vec3 uBeamDir;
uniform vec2 uBeamCone; uniform float uBeamRange; uniform float uBeamHazeCut;
`;

/** After lights_fragment_end: needs vWPos, dmWorldNormal, diffuseColor, vAO. Declares dmBeam. */
export const BEAM_LIGHT = /* glsl */ `
  vec3 dmBeam = vec3(0.0);
  if (uBeamGain > 0.0) {
    vec3 toP = vWPos - uBeamPos;
    float bd = length(toP);
    vec3 L = toP / max(bd, 1e-4);
    float cone = smoothstep(uBeamCone.x, uBeamCone.y, dot(L, uBeamDir));
    cone *= cone; // softer, fog-lamp-like edge
    // slight wrap so rounded rock doesn't terminate hard
    float ndl = clamp((dot(dmWorldNormal, -L) + 0.12) / 1.12, 0.0, 1.0);
    float reach = 1.0 - smoothstep(uBeamRange * 0.7, uBeamRange, bd);
    float occ = clamp(vAO, 0.0, 1.0);
    dmBeam = diffuseColor.rgb * uBeamColor * (uBeamGain * ndl * cone * reach * mix(0.5, 1.0, occ));
  }
`;

/** Inside the water block after haze (needs dist, haze, uAbsorb): distance-independent tint. */
export const BEAM_OPAQUE = /* glsl */ `
    outgoingLight += dmBeam * exp(-uAbsorb * 10.0) * (1.0 - haze * (1.0 - uBeamHazeCut));
`;
