/**
 * GLSL of the seabed terrain material (seabedMaterial.ts), kept free of asset /
 * three imports so node tests can compile it (scripts/deep-march-detail-test.ts).
 */
import { DETAIL_APPLY } from "./detailNormal";
import { BEAM_LIGHT, BEAM_OPAQUE } from "./highBeam";
import { PL_LIGHT } from "./particleLight";
import { FOG_OPAQUE } from "./fog";
import { SONAR_OPAQUE } from "./sonar";
import { MAT_DECLS, MAT_FRAGMENT } from "./materialShader";

/** Open-water colour seen along a view direction (bright toward the surface, black below). */
export const WATER_GLSL = /* glsl */ `
uniform vec3 uWaterTop; uniform vec3 uWaterHorizon; uniform vec3 uWaterBottom;
uniform float uHaze; uniform float uSil; uniform float uFar;
vec3 dmWater(vec3 dir) {
  float y = dir.y;
  return y >= 0.0 ? mix(uWaterHorizon, uWaterTop, pow(y, 0.8)) : mix(uWaterHorizon, uWaterBottom, pow(-y, 0.55));
}
`;

export const DECLS = /* glsl */ `
uniform float uWS;
uniform float uTime;
uniform vec3 uAbsorb;
uniform vec3 uCausticColor;
uniform vec3 uCeilingTint;
uniform float uEnvLight;
varying vec3 vWPos;
varying vec3 vWNrm;
varying float vAO;

float dmHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
// Value noise on dmHash lattice values. dmHash's first steps (fract(p / pi + c) * 17)
// act per axis, so the 8 corners share only two values per axis (i, i + 1): computed
// once here with the same arithmetic, the result is identical to hashing each corner.
float dmNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  vec3 a = fract(i * 0.3183099 + vec3(0.1, 0.2, 0.3)) * 17.0;
  vec3 b = fract((i + 1.0) * 0.3183099 + vec3(0.1, 0.2, 0.3)) * 17.0;
  // dmHash = fract(x*y*z*(x + y + z)), same operation order
  float p00 = a.x * a.y, p10 = b.x * a.y, p01 = a.x * b.y, p11 = b.x * b.y;
  float s00 = a.x + a.y, s10 = b.x + a.y, s01 = a.x + b.y, s11 = b.x + b.y;
  return mix(mix(mix(fract(p00 * a.z * (s00 + a.z)), fract(p10 * a.z * (s10 + a.z)), f.x),
                 mix(fract(p01 * a.z * (s01 + a.z)), fract(p11 * a.z * (s11 + a.z)), f.x), f.y),
             mix(mix(fract(p00 * b.z * (s00 + b.z)), fract(p10 * b.z * (s10 + b.z)), f.x),
                 mix(fract(p01 * b.z * (s01 + b.z)), fract(p11 * b.z * (s11 + b.z)), f.x), f.y), f.z);
}
float dmFbm(vec3 p) {
  return 0.55 * dmNoise(p) + 0.3 * dmNoise(p * 2.03 + 11.7) + 0.15 * dmNoise(p * 4.1 + 3.1);
}
vec3 dmUnpack(vec4 t) {
  vec2 xy = t.xy * 2.0 - 1.0;
  return vec3(xy, sqrt(clamp(1.0 - dot(xy, xy), 0.0, 1.0)));
}
vec2 dmRot(vec2 uv) { return mat2(0.8, -0.6, 0.6, 0.8) * uv; }
vec2 dmHash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
// Animated Worley-edge caustic layer: bright where two cells meet.
float dmCausticLayer(vec2 p, float t) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = dmHash2(i + g);
      o = 0.5 + 0.42 * sin(t + 6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  float e = sqrt(f2) - sqrt(f1);
  return 1.0 - smoothstep(0.0, 0.18, e);
}
float dmCaustics(vec2 p, float t) {
  vec2 warp = vec2(dmNoise(vec3(p * 0.35, t * 0.2)), dmNoise(vec3(p * 0.35 + 7.3, t * 0.2))) - 0.5;
  float a = dmCausticLayer(p * 0.9 + warp * 1.2, t * 0.9);
#ifdef DM_LOW_SPEC
  return a * a;
#else
  float b = dmCausticLayer(dmRot(p) * 1.3 - warp, -t * 0.7 + 2.0);
  return a * a * 0.7 + a * b * 0.8;
#endif
}
${MAT_DECLS}`;

export const MAP_FRAGMENT = /* glsl */ `
  vec3 wp = vWPos;
  // Smooth (field-gradient) normal drives projection and material choice so
  // rock reads rounded; the flat facet normal is only a fallback where the two
  // truly disagree (grazing / sub-voxel features), never a per-triangle switch.
  vec3 geoN = normalize(cross(dFdx(wp), dFdy(wp)));
  if (dot(geoN, cameraPosition - wp) < 0.0) geoN = -geoN;
  vec3 wn = normalize(vWNrm);
  float nAgree = dot(wn, geoN);
  wn = normalize(mix(geoN, wn, smoothstep(-0.15, 0.25, nAgree)));
  vec3 bn = wn;
  vec3 bw = pow(abs(bn), vec3(4.0));
  bw /= (bw.x + bw.y + bw.z);
  // Negligible projection axes drop to exactly 0 (continuous remap + renormalise)
  // so their texture fetches can be skipped below.
  bw = max(bw - 0.02, 0.0);
  bw /= (bw.x + bw.y + bw.z);
  vec3 axisSign = vec3(bn.x < 0.0 ? -1.0 : 1.0, bn.y < 0.0 ? -1.0 : 1.0, bn.z < 0.0 ? -1.0 : 1.0);

${MAT_FRAGMENT}
  // tone the photo sets toward a cohesive underwater palette
  float luma = dot(albedo, vec3(0.299, 0.587, 0.114));
  albedo = mix(vec3(luma), albedo, 0.72);                       // desaturate a bit
  albedo *= mix(vec3(1.0), uCeilingTint, ceilW);                 // dark cave ceiling
  albedo *= mix(0.72, 1.12, dmFbm(wp * (0.035 / uWS) + 71.0));  // macro variation (scales with the world)
  albedo *= mix(0.85, 1.08, dmFbm(wp * 0.05 + 13.0));           // and at the diver's scale
  albedo *= mix(vec3(1.0), vec3(0.86, 0.95, 0.9), smoothstep(0.4, 0.8, nA) * floorW); // silt tint
  albedo *= mix(0.62, 1.0, smoothstep(-24.0 * uWS, 6.0 * uWS, wp.y)); // deeper = darker sediment
  diffuseColor.rgb *= albedo;

  // ---- normals (whiteout triplanar) + roughness --------------------------
  vec3 tnX = dmUnpack(nX4);
  vec3 tnY = dmUnpack(nY4);
  vec3 tnZ = dmUnpack(nZ4);
  tnX.x *= axisSign.x;
  tnY.x *= axisSign.y;
  tnZ.x *= -axisSign.z;
  tnX = vec3(tnX.xy + wn.zy, abs(tnX.z) * wn.x);
  tnY = vec3(tnY.xy + wn.xz, abs(tnY.z) * wn.y);
  tnZ = vec3(tnZ.xy + wn.xy, abs(tnZ.z) * wn.z);
  vec3 dmWorldNormal = normalize(tnX.zyx * bw.x + tnY.xzy * bw.y + tnZ.xyz * bw.z);
  float dmRough = nX4.b * bw.x + nY4.b * bw.y + nZ4.b * bw.z;
${DETAIL_APPLY}`;

/** Replaces <emissivemap_fragment>: caustics. */
export const EMISSIVE_FRAGMENT = /* glsl */ `#include <emissivemap_fragment>
  {
    // caustics from the surface above: on up-facing surfaces, fading with distance
    // (skipped entirely where it can't show: beyond 30 m, deep water, down-facing, lights off)
    float camDist = length(vWPos - cameraPosition);
    float facing = pow(clamp(dmWorldNormal.y, 0.0, 1.0), 1.5);
    float fade = (1.0 - smoothstep(10.0, 30.0, camDist)) * smoothstep(-10.0 * uWS, 4.0 * uWS, vWPos.y);
    float k = facing * fade * uEnvLight;
    if (k > 0.0) {
      float c = dmCaustics(vWPos.xz * 0.42, uTime * 0.9);
      totalEmissiveRadiance += diffuseColor.rgb * uCausticColor * c * k * mix(0.4, 1.0, vAO);
    }
  }`;

/** Replaces <lights_fragment_end>: AO, high beam, plankton lights. */
export const LIGHTS_END_FRAGMENT = /* glsl */ `#include <lights_fragment_end>
  {
    float occ = clamp(vAO, 0.0, 1.0);
    reflectedLight.indirectDiffuse *= occ * occ;
    reflectedLight.directDiffuse *= mix(0.55, 1.0, occ);
  }
${BEAM_LIGHT}
${PL_LIGHT}`;

/** Replaces <opaque_fragment>: absorption, haze, high beam, turbidity (fog.ts), far fade. */
export const OPAQUE_FRAGMENT = /* glsl */ `{
    vec3 dv = vWPos - cameraPosition;
    float dist = length(dv);
    vec3 dir = dv / max(dist, 1e-4);
    vec3 water = dmWater(dir);
    // absorption (red first) over the near range, then haze toward the silhouette tone
    outgoingLight *= exp(-uAbsorb * min(dist, 28.0));
    float haze = 1.0 - exp(-dist * uHaze);
    // silhouette tone: darkest in the middle distance, lifting toward the open water far
    // away, so masses emerge as faint shadows, darken into silhouettes, then resolve
    float sil = mix(uSil, 1.0, smoothstep(uFar * 0.22, uFar * 0.95, dist));
    outgoingLight = mix(outgoingLight, water * sil, haze);
${BEAM_OPAQUE}${FOG_OPAQUE}    outgoingLight = mix(outgoingLight, dmBackground(dir), smoothstep(uFar * 0.8, uFar, dist));
${SONAR_OPAQUE}  }
  #include <opaque_fragment>`;

/** Replaces <dithering_fragment>: LOD crossfade screen-door (DM_LOD_FADE). */
export const DITHER_FRAGMENT = /* glsl */ `#include <dithering_fragment>
#ifdef DM_LOD_FADE
  {
    // LOD crossfade (screen-door): the incoming column keeps the pixels whose
    // threshold is below the progress, the outgoing one exactly the others, so
    // every pixel shows one of the two. Decided after shading, so the screen-space
    // derivatives above stay defined for every pixel of the quad.
    float d = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (uLodFade.y > 0.0 ? d >= uLodFade.x : d < uLodFade.x) discard;
  }
#endif`;
