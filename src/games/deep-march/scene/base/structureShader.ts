/**
 * GLSL of the building material (structureMaterial.ts), free of three imports
 * so test:shaders can compile it. Patches three's MeshPhongMaterial (the head
 * lamp, sun and ambient light it like the terrain):
 *   vertex: per instance aState (x working, y birth time, z 直视's crush): a new building rises
 *           out of the ground over uGrowIn s (no popping), a squeezed one sinks and splays; aGlow per vertex;
 *   normal: flat facets + horizontal panel seams every STRUCTURE_LOOK.seam m with bevelled
 *           edges and a fine grain (a normal-map look without a texture fetch),
 *           faded out with distance; grooves darken the albedo;
 *   emissive: deep-blue light strips (1) and lantern (2), breathing slowly,
 *           dimmed to the idle level while the building is not working; 3 = the
 *           reactor's volt crystal: lantern strength in amber (dmVoltTint);
 *   lights: the diver's high beam and the lighthouse light (baseLightShader.ts);
 *   opaque: the terrain's water chain and a sonar echo (glowing parts brighter).
 * The static look (STRUCTURE_LOOK: seams, glow tints, glow gain / idle / pulse) is
 * baked in as constants, not uniforms: with the shared water / fog / sonar / beam /
 * lighthouse uniforms the highp program fills Mali-G57's 128 fast uniform registers,
 * and every uniform past them is a load/store cycle on each fragment.
 */
import { BEAM_OPAQUE } from "../highBeam";
import { FOG_OPAQUE } from "../fog";
import { STRUCTURE_LOOK as L } from "./config";

/** A GLSL float literal of this number (shortest round-trip digits, always with a decimal point). */
const f = (n: number) => (/[.eE]/.test(String(n)) ? String(n) : `${n}.0`);
const v = (xs: readonly number[]) => `vec${xs.length}(${xs.map(f).join(", ")})`;

export const STRUCT_VERT_DECLS = /* glsl */ `
attribute float aGlow;
// x: working (0 / 1), y: birth time (s)
attribute vec4 aState;
uniform float uTime;
uniform float uGrowIn;
varying vec3 vWPos;
varying vec3 vWNrm;
varying vec3 vObj;
varying vec2 vGlow;
`;

/** After <begin_vertex>. */
export const STRUCT_VERT_BEGIN = /* glsl */ `
  transformed.y *= max(smoothstep(aState.y, aState.y + uGrowIn, uTime), 0.002) * (1.0 - 0.97 * aState.z);
  transformed.xz *= 1.0 + 0.35 * aState.z;`;

/** After <project_vertex>. */
export const STRUCT_VERT_MAIN = /* glsl */ `
  vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  vWNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
  vObj = position;
  vGlow = vec2(aGlow, aState.x);`;

export const STRUCT_FRAG_DECLS = /* glsl */ `
#ifndef DM_P
#if defined(HIGH_PRECISION) || !defined(MEDIUM_PRECISION)
#define DM_P highp
#else
#define DM_P mediump
#endif
#endif
uniform float uTime;
uniform vec3 uAbsorb;
// seam spacing (m), depth; strip and volt-crystal tints; glow gain, idle, pulse (rad/s)
const vec2 dmSeam = ${v([L.seam, L.seamDepth])};
const vec3 dmGlowTint = ${v(L.glow)};
const vec3 dmVoltTint = ${v(L.volt)};
const vec3 dmGlowParams = ${v([L.glowGain, L.glowIdle, L.pulseHz * Math.PI * 2])};
varying vec3 vWPos;
varying vec3 vWNrm;
varying vec3 vObj;
varying vec2 vGlow;
// the high-beam term reads an ambient-occlusion value: buildings stand free
const float vAO = 1.0;
`;

/** Replaces <normal_fragment_maps>: declares dmWorldNormal and dmSeamShade. */
export const STRUCT_NORMAL = /* glsl */ `
  vec3 dmWorldNormal = normalize(vWNrm);
  float dmSeamShade = 1.0;
  {
    float fade = 1.0 - smoothstep(24.0, 80.0, distance(vWPos, cameraPosition));
    float s = fract(vObj.y / dmSeam.x);
    float flat0 = smoothstep(0.0, 0.07, s) * smoothstep(0.0, 0.07, 1.0 - s);
    float bevel = (s < 0.5 ? -1.0 : 1.0) * (1.0 - flat0);
    vec3 t = vec3(0.0, 1.0, 0.0) - dmWorldNormal * dmWorldNormal.y;
    vec3 q = vWPos * 1.7;
    vec3 w = vec3(sin(q.y * 1.3 + q.x * 0.7), sin(q.z * 1.9 - q.y * 0.5), sin(q.x * 1.1 + q.z * 1.6));
    dmWorldNormal = normalize(dmWorldNormal + fade * (dmSeam.y * bevel * t + 0.07 * (w - dmWorldNormal * dot(w, dmWorldNormal))));
    dmSeamShade = mix(1.0, mix(0.5, 1.0, flat0), fade);
  }
  normal = normalize((viewMatrix * vec4(dmWorldNormal, 0.0)).xyz);`;

/** Replaces <emissivemap_fragment>: declares dmHullGlow (dmGlowParams: gain, idle, pulse rad/s). */
export const STRUCT_EMISSIVE = /* glsl */ `#include <emissivemap_fragment>
  diffuseColor.rgb *= dmSeamShade;
  float dmVolt = step(2.5, vGlow.x);
  float dmHullGlow = (vGlow.x - dmVolt) * mix(dmGlowParams.y, 1.0, vGlow.y) * (0.78 + 0.22 * sin(uTime * dmGlowParams.z + vWPos.y * 0.12));
  totalEmissiveRadiance += mix(dmGlowTint, dmVoltTint, dmVolt) * (dmHullGlow * dmGlowParams.x);`;

/** Replaces <opaque_fragment>. */
export const STRUCT_OPAQUE = /* glsl */ `{
    vec3 dv = vWPos - cameraPosition;
    float dist = length(dv);
    vec3 dir = dv / max(dist, 1e-4);
    outgoingLight *= exp(-uAbsorb * min(dist, 28.0));
    float haze = 1.0 - exp(-dist * uHaze);
    float sil = mix(uSil, 1.0, smoothstep(uFar * 0.22, uFar * 0.95, dist));
    outgoingLight = mix(outgoingLight, dmWater(dir) * sil, haze * (1.0 - 0.35 * min(dmHullGlow, 1.0)));
${BEAM_OPAQUE}${FOG_OPAQUE}    outgoingLight = mix(outgoingLight, dmBackground(dir), smoothstep(uFar * 0.8, uFar, dist));
    if (uSonar > 0.001) {
      float trail = 0.0, front = 0.0;
      for (int i = 0; i < DM_SONAR_N; i++) {
        vec4 p = uSonarPulse[i];
        float behind = p.w - distance(vWPos, p.xyz);
        float rf = uSonarAmp[i] * (1.0 - smoothstep(0.85 * uSonarWave.w, uSonarWave.w, dist));
        float x = behind / uSonarWave.z;
        front = max(front, exp(-x * x) * rf);
        trail = max(trail, behind >= 0.0 ? exp(-behind / (uSonarWave.x * uSonarWave.y)) * rf : 0.0);
      }
      vec3 echo = uSonarColor * (trail * (0.16 + 0.5 * dmHullGlow) + front * (0.5 + 0.5 * dmHullGlow));
      outgoingLight += echo * uSonar; // overlaid on the lamps' image
    }
  }
  #include <opaque_fragment>`;
