/**
 * GLSL of the seabed terrain material (seabedMaterial.ts), kept free of asset /
 * three imports so node tests can compile it (scripts/deep-march-detail-test.ts).
 * DECLS (shared declarations / helpers): seabedDecls.ts.
 */
import { DETAIL_APPLY } from "./detailNormal";
import { BEAM_LIGHT, BEAM_OPAQUE } from "./highBeam";
import { PL_LIGHT } from "./particleLight";
import { FOG_OPAQUE } from "./fog";
import { SONAR_OPAQUE } from "./sonar";
import { MAT_FRAGMENT, WALL_TINT_GLSL } from "./materialShader";
import { BL_LIGHT } from "./base/baseLightShader";

export { DECLS } from "./seabedDecls";

/** Open-water colour seen along a view direction (bright toward the surface, black below). */
export const WATER_GLSL = /* glsl */ `
uniform vec3 uWaterTop; uniform vec3 uWaterHorizon; uniform vec3 uWaterBottom;
uniform float uHaze; uniform float uSil; uniform float uFar;
vec3 dmWater(vec3 dir) {
  float y = dir.y;
  return y >= 0.0 ? mix(uWaterHorizon, uWaterTop, pow(y, 0.8)) : mix(uWaterHorizon, uWaterBottom, pow(-y, 0.55));
}
`;

/**
 * Start of MAP_FRAGMENT: LOD crossfade screen-door (DM_LOD_FADE, fade program only).
 * The incoming column keeps the cells whose threshold is below the progress, the
 * outgoing one exactly the others, so every pixel shows one of the two and is shaded
 * once. Cells are the 2x2 pixel quads the GPU shades together (floor(gl_FragCoord / 2)
 * is constant within a quad): a quad is discarded or kept whole before any shading,
 * so the screen-space derivatives of every kept pixel stay defined.
 */
export const LOD_FADE_FRAGMENT = /* glsl */ `
#ifdef DM_LOD_FADE
  {
    vec2 dmCell = floor(gl_FragCoord.xy * 0.5);
    float d = fract(52.9829189 * fract(dot(dmCell, vec2(0.06711056, 0.00583715))));
    if (uLodFade.y > 0.0 ? d >= uLodFade.x : d < uLodFade.x) discard;
  }
#endif
`;

export const MAP_FRAGMENT = /* glsl */ `${LOD_FADE_FRAGMENT}
  vec3 wp = vWPos;
  // Smooth (field-gradient) normal drives projection and material choice so
  // rock reads rounded; the flat facet normal is only a fallback where the two
  // truly disagree (grazing / sub-voxel features), never a per-triangle switch.
  vec3 dpx = dFdx(wp), dpy = dFdy(wp);   // also the triplanar UV gradients (materialShader.ts)
  vec3 geoN = normalize(cross(dpx, dpy));
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
  albedo *= mix(vec3(1.0), ${WALL_TINT_GLSL}, vRegB.z);          // ring wall (0 off the wall)
  diffuseColor.rgb *= albedo;

  // ---- normal (whiteout triplanar, blended per axis in MAT_FRAGMENT) ------------
  vec3 dmWorldNormal = normalize(dmNrm);
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
${PL_LIGHT}
${BL_LIGHT}`;

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
