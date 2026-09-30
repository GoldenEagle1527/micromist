/**
 * GLSL of the node / cache material (nodeMaterial.ts), free of three imports so
 * test:shaders can compile it. Patches three's MeshPhongMaterial (lit by the
 * same head lamp, sun and ambient as the terrain):
 *   vertex: part select (crystal cluster / cache), distance shrink over the last
 *           band before the draw radius (no popping), grow-in after placement;
 *   normal: faceted flat normals + procedural growth ridges (a normal-map look
 *           without a texture fetch), faded out with distance;
 *   emissive: deep-blue inner glow brightening toward the tips, a rim, a slow
 *           pulse; caches flash on their beacon tick;
 *   opaque: the terrain's water chain (absorption, haze, high beam, turbidity,
 *           far fade) and a sonar echo — nodes glint as each pulse passes.
 */
import { BEAM_OPAQUE } from "../highBeam";
import { FOG_OPAQUE } from "../fog";

export const NODE_VERT_DECLS = /* glsl */ `
attribute float aTip;
attribute float aPart;
// rgb: emissive tint, w: part (0 crystal cluster, 1 cache)
attribute vec4 aTint;
// x: glow, y: pulse phase (s), z: unused, w: birth time (s)
attribute vec4 aGlow;
uniform vec2 uNodeFade;
uniform float uTime;
uniform float uGrowIn;
varying vec3 vWPos;
varying vec3 vWNrm;
varying vec3 vTint;
varying vec4 vNode;
`;

/** After <begin_vertex>. */
export const NODE_VERT_BEGIN = /* glsl */ `
  {
    vec3 dmOrigin = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
    float dmFade = 1.0 - smoothstep(uNodeFade.x - uNodeFade.y, uNodeFade.x, distance(cameraPosition, dmOrigin));
    float dmKeep = 1.0 - step(0.5, abs(aPart - aTint.w));
    float dmGrow = smoothstep(aGlow.w, aGlow.w + uGrowIn, uTime);
    transformed *= dmFade * dmKeep * dmGrow;
  }`;

/** After <project_vertex>. */
export const NODE_VERT_MAIN = /* glsl */ `
  vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  vWNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
  vTint = aTint.rgb;
  vNode = vec4(aGlow.x, aTip, aGlow.y, aTint.w);`;

export const NODE_FRAG_DECLS = /* glsl */ `
#ifndef DM_P
#if defined(HIGH_PRECISION) || !defined(MEDIUM_PRECISION)
#define DM_P highp
#else
#define DM_P mediump
#endif
#endif
uniform float uTime;
uniform vec3 uAbsorb;
uniform float uBeaconPeriod;
uniform float uNodeEcho;
varying vec3 vWPos;
varying vec3 vWNrm;
varying vec3 vTint;
varying vec4 vNode;
// the high-beam term reads an ambient-occlusion value: nodes stand free
const float vAO = 1.0;
`;

/** Replaces <normal_fragment_maps>: declares dmWorldNormal. */
export const NODE_NORMAL = /* glsl */ `
  vec3 dmWorldNormal = normalize(vWNrm);
  {
    // growth ridges across each facet: tangential wobble of the flat normal
    vec3 q = vWPos * 9.0;
    vec3 w = vec3(sin(q.y * 1.7 + q.x), sin(q.z * 2.3 - q.y * 0.7), sin(q.x * 1.3 + q.z * 1.9));
    float amp = 0.18 * (1.0 - smoothstep(8.0, 30.0, distance(vWPos, cameraPosition)));
    dmWorldNormal = normalize(dmWorldNormal + amp * (w - dmWorldNormal * dot(w, dmWorldNormal)));
  }
  normal = normalize((viewMatrix * vec4(dmWorldNormal, 0.0)).xyz);`;

/** Replaces <emissivemap_fragment>: declares dmNodeGlow. */
export const NODE_EMISSIVE = /* glsl */ `#include <emissivemap_fragment>
  float dmPulse = 0.5 + 0.5 * sin(uTime * (1.3 + 0.6 * vNode.w) + vNode.z * 6.2831853);
  float dmTick = vNode.w > 0.5 ? exp(-fract((uTime + vNode.z) / uBeaconPeriod) * uBeaconPeriod * 3.0) : 0.0;
  float dmRim = 1.0 - abs(dot(normalize(vWNrm), normalize(cameraPosition - vWPos)));
  float dmNodeGlow = vNode.x * (mix(0.25, 1.0, vNode.y * vNode.y) * (0.55 + 0.45 * dmPulse) + 0.6 * dmRim * dmRim + 2.5 * dmTick);
  totalEmissiveRadiance += vTint * dmNodeGlow;`;

/** Replaces <opaque_fragment>. */
export const NODE_OPAQUE = /* glsl */ `{
    vec3 dv = vWPos - cameraPosition;
    float dist = length(dv);
    vec3 dir = dv / max(dist, 1e-4);
    outgoingLight *= exp(-uAbsorb * min(dist, 28.0));
    float haze = 1.0 - exp(-dist * uHaze);
    float sil = mix(uSil, 1.0, smoothstep(uFar * 0.22, uFar * 0.95, dist));
    outgoingLight = mix(outgoingLight, dmWater(dir) * sil, haze);
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
      vec3 echo = uSonarColor * (trail * (0.12 + uNodeEcho * dmNodeGlow) + front * (0.4 + uNodeEcho * dmNodeGlow));
      outgoingLight = mix(outgoingLight, echo, uSonar);
    }
  }
  #include <opaque_fragment>`;
