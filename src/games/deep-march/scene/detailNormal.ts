/**
 * Shader detail normal for the seabed (seabedMaterial.ts): stands in for the
 * sub-metre relief the 1 u lattice no longer carries.
 *
 * - A crease height field h = −w³, w = 1 − |2n − 1| (smooth abs) of a small 3D
 *   value noise n (dmNoiseD: same lattice hash as dmNoise, analytic gradient)
 *   at 2 scales (DETAIL_SCALES), each in its own rotated, offset frame so neither
 *   aligns with the lattice axes or with the other scale. Its minima are the
 *   iso-lines n = ½: a network of thin creases (lines, not pits), flat between.
 * - World-space and non-periodic (irrational hash lattice): no tiling, identical
 *   on every LOD level (no popping).
 * - Low amplitude: the tangential tilt is capped at DETAIL_MAX_TILT; each scale
 *   fades out before its creases get thinner than ~3 px (no thin-line aliasing).
 * - DM_LOW_SPEC keeps only the coarse scale (1 noise evaluation per pixel).
 * - A little of the flat face normal (dFdx/dFdy facet) is blended into the final
 *   normal near the camera, gated by agreement with the smooth normal so thin
 *   sliver triangles never shade differently from their neighbours.
 *
 * `detailNormalJS` (detailNormalJS.ts) mirrors the GLSL for the unit test
 * (scripts/deep-march-detail-test.ts); the tuning lives in detailParams.ts.
 * The debug panel's 细节法线 off turns the whole block off (the DM_DETAIL define).
 */import { DETAIL_SCALES, FACET_AGREE, FACET_DIST, FACET_W, DETAIL_FADE, DETAIL_MAX_TILT, OFF, ROT } from "./detailParams";

export { DETAIL_FADE, DETAIL_MAX_TILT, DETAIL_SCALES, FACET_AGREE, FACET_DIST, FACET_W } from "./detailParams";
export { creaseHeightJS, detailNormalJS, facetWJS, noiseDJS } from "./detailNormalJS";

const f = (x: number) => x.toFixed(6);
const mat = (m: readonly number[]) => `mat3(${m.map(f).join(", ")})`;
const vec = (v: readonly number[]) => `vec3(${v.map(f).join(", ")})`;

export const DETAIL_GLSL = /* glsl */ `
#ifdef DM_DETAIL
// value noise + analytic gradient, same lattice values as dmNoise
vec4 dmNoiseD(vec3 x) {
  vec3 i = floor(x);
  vec3 fr = fract(x);
  vec3 u = fr * fr * (3.0 - 2.0 * fr);
  vec3 du = 6.0 * fr * (1.0 - fr);
  vec3 a = fract(i * 0.3183099 + vec3(0.1, 0.2, 0.3)) * 17.0;
  vec3 b = fract((i + 1.0) * 0.3183099 + vec3(0.1, 0.2, 0.3)) * 17.0;
  float p00 = a.x * a.y, p10 = b.x * a.y, p01 = a.x * b.y, p11 = b.x * b.y;
  float s00 = a.x + a.y, s10 = b.x + a.y, s01 = a.x + b.y, s11 = b.x + b.y;
  float k0 = fract(p00 * a.z * (s00 + a.z)), k1 = fract(p10 * a.z * (s10 + a.z));
  float k2 = fract(p01 * a.z * (s01 + a.z)), k3 = fract(p11 * a.z * (s11 + a.z));
  float k4 = fract(p00 * b.z * (s00 + b.z)), k5 = fract(p10 * b.z * (s10 + b.z));
  float k6 = fract(p01 * b.z * (s01 + b.z)), k7 = fract(p11 * b.z * (s11 + b.z));
  float ka = k1 - k0, kb = k2 - k0, kc = k4 - k0;
  float kd = k0 - k1 - k2 + k3, ke = k0 - k2 - k4 + k6, kf = k0 - k1 - k4 + k5;
  float kg = -k0 + k1 + k2 - k3 + k4 - k5 - k6 + k7;
  float n = k0 + ka * u.x + kb * u.y + kc * u.z + kd * u.x * u.y + ke * u.y * u.z + kf * u.z * u.x + kg * u.x * u.y * u.z;
  vec3 g = du * vec3(ka + kd * u.y + kf * u.z + kg * u.y * u.z,
                     kb + kd * u.x + ke * u.z + kg * u.z * u.x,
                     kc + ke * u.y + kf * u.x + kg * u.x * u.y);
  return vec4(n, g);
}
// gradient of the crease height h = -w^3 (w = 1 - smoothabs(2n - 1)) at p*freq
vec3 dmCreaseGrad(vec3 q, float freq) {
  vec4 nd = dmNoiseD(q * freq);
  float u = 2.0 * nd.x - 1.0;
  float v = sqrt(u * u + 0.0064);
  float w = max(1.0 - v, 0.0);
  return (3.0 * w * w * (u / v) * 2.0 * freq) * nd.yzw;
}
// n: shading normal (world), p: world position, fw: pixel footprint (world units), amp: material weight
vec3 dmDetailNormal(vec3 n, vec3 p, float fw, float amp) {
  vec3 g = vec3(0.0);
  float f1 = 1.0 - smoothstep(${f(DETAIL_FADE[0])}, ${f(DETAIL_FADE[1])}, fw * ${f(DETAIL_SCALES[0][0])});
  if (f1 > 0.0) {
    mat3 R = ${mat(ROT[0])};
    g += (${f(DETAIL_SCALES[0][1])} * f1) * (dmCreaseGrad(R * p + ${vec(OFF[0])}, ${f(DETAIL_SCALES[0][0])}) * R);
  }
#ifndef DM_LOW_SPEC
  float f2 = 1.0 - smoothstep(${f(DETAIL_FADE[0])}, ${f(DETAIL_FADE[1])}, fw * ${f(DETAIL_SCALES[1][0])});
  if (f2 > 0.0) {
    mat3 R = ${mat(ROT[1])};
    g += (${f(DETAIL_SCALES[1][1])} * f2) * (dmCreaseGrad(R * p + ${vec(OFF[1])}, ${f(DETAIL_SCALES[1][0])}) * R);
  }
#endif
  g *= amp;
  vec3 t = g - n * dot(g, n);
  float tl = length(t);
  t *= min(1.0, ${f(DETAIL_MAX_TILT)} / max(tl, 1e-5));
  return normalize(n - t);
}
// weight of the flat face normal blended into the shading normal
float dmFacetW(float agree, float camDist, float rockW) {
  return ${f(FACET_W)} * smoothstep(${f(FACET_AGREE[0])}, ${f(FACET_AGREE[1])}, agree) * (1.0 - smoothstep(${f(FACET_DIST[0])}, ${f(FACET_DIST[1])}, camDist)) * rockW;
}
#endif
`;

/** Fragment block (MAP_FRAGMENT, after dmWorldNormal): detail creases + a little facet normal. */
export const DETAIL_APPLY = /* glsl */ `
#ifdef DM_DETAIL
  {
    // pixel footprint in world units (uniform control flow: derivatives defined)
    float dmFw = length(fwidth(wp));
    // slots (materialShader.ts): wall A + ceiling full, wall B 0.7, floor B 0.45, floor A 0.2
    float dAmp = slotW2 + slotW4 + slotW3 * 0.7 + slotW1 * 0.45 + slotW0 * 0.2;
    dmWorldNormal = dmDetailNormal(dmWorldNormal, wp, dmFw, dAmp);
    float fW = dmFacetW(nAgree, length(cameraPosition - wp), wallW + ceilW);
    dmWorldNormal = normalize(dmWorldNormal + fW * (geoN - wn));
  }
#endif
`;

