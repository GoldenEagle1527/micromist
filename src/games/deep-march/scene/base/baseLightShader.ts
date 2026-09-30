/**
 * GLSL of the lighthouse light (baseLight.ts), free of three imports so
 * test:shaders can compile it: up to DM_BL_N lanterns, each lighting the rock
 * and buildings within its radius with a smooth (1 − d²/r²)² falloff, plus a
 * sweeping double beam that turns around the lantern. uBLCount = 0 (the free
 * dive, no lighthouse lit) skips the whole block — a uniform branch.
 */
export const BL_N = 2;

export const BL_DECLS = /* glsl */ `
#define DM_BL_N ${BL_N}
uniform DM_P vec4 uBL[DM_BL_N];
uniform DM_P vec2 uBLDir[DM_BL_N];
uniform int uBLCount; uniform vec3 uBLColor; uniform float uBLGain; uniform vec2 uBLSweep;
`;

/** After lights_fragment_end: needs vWPos, dmWorldNormal, diffuseColor. */
export const BL_LIGHT = /* glsl */ `
  if (uBLCount > 0) {
    float blAcc = 0.0;
    for (int i = 0; i < DM_BL_N; i++) {
      if (i >= uBLCount) break;
      vec3 d = uBL[i].xyz - vWPos;
      float q = dot(d, d) / (uBL[i].w * uBL[i].w);
      if (q >= 1.0) continue;
      float f = (1.0 - q) * (1.0 - q);
      vec3 L = d * inversesqrt(max(dot(d, d), 1e-4));
      float ndl = clamp((dot(dmWorldNormal, L) + 0.2) / 1.2, 0.0, 1.0);
      vec2 h = -d.xz * inversesqrt(max(dot(d.xz, d.xz), 1e-4));
      float sweep = smoothstep(uBLSweep.x, 1.0, abs(dot(h, uBLDir[i])));
      blAcc += f * ndl * (1.0 + uBLSweep.y * sweep);
    }
    reflectedLight.directDiffuse += diffuseColor.rgb * uBLColor * (uBLGain * blAcc);
  }
`;
