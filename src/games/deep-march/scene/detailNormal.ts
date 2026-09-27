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
 * `detailNormalJS` mirrors the GLSL for the unit test (scripts/deep-march-detail-test.ts).
 * ?detail=0 turns the whole block off (the DM_DETAIL define).
 */

/** [frequency (1/u), crease depth (u)] per scale: coarse, fine. */
export const DETAIL_SCALES: readonly [number, number][] = [
  [0.8, 0.03],
  [2.1, 0.01],
];
/** Largest tangential tilt of the detail normal (≈ radians). */
export const DETAIL_MAX_TILT = 0.26;
/** Scale fade by pixel footprint × frequency (crease cells per pixel). */
export const DETAIL_FADE: readonly [number, number] = [0.05, 0.16];
/** Facet (face-normal) blend: max weight, agreement gate, distance fade (u). */
export const FACET_W = 0.2;
export const FACET_AGREE: readonly [number, number] = [0.9, 0.98];
export const FACET_DIST: readonly [number, number] = [15, 45];

/** Column-major 3×3 rotations (GLSL mat3 order) and offsets per scale. */
const ROT: readonly number[][] = [
  [0.36, -0.8, 0.48, 0.48, 0.6, 0.64, -0.8, 0.0, 0.6],
  [0.6, 0.64, 0.48, 0.0, 0.6, -0.8, -0.8, 0.48, 0.36],
];
const OFF: readonly number[][] = [
  [17.3, 5.1, 41.7],
  [3.7, 29.9, 11.3],
];

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
// gradient of the crease height h = -w^3 (w = 1 - smoothabs(2n - 1)) at p·freq
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
    float dAmp = wRock + wMoss * 0.7 + wGravel * 0.45 + wSand * 0.2;
    dmWorldNormal = dmDetailNormal(dmWorldNormal, wp, dmFw, dAmp);
    float fW = dmFacetW(nAgree, length(cameraPosition - wp), wallW + ceilW);
    dmWorldNormal = normalize(dmWorldNormal + fW * (geoN - wn));
  }
#endif
`;

// ---- JS mirror (tests) ---------------------------------------------------------
const fract = (x: number) => x - Math.floor(x);
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function noiseDJS(x: number, y: number, z: number): [number, number, number, number] {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const dx = 6 * fx * (1 - fx), dy = 6 * fy * (1 - fy), dz = 6 * fz * (1 - fz);
  const ax = fract(ix * 0.3183099 + 0.1) * 17, ay = fract(iy * 0.3183099 + 0.2) * 17, az = fract(iz * 0.3183099 + 0.3) * 17;
  const bx = fract((ix + 1) * 0.3183099 + 0.1) * 17, by = fract((iy + 1) * 0.3183099 + 0.2) * 17, bz = fract((iz + 1) * 0.3183099 + 0.3) * 17;
  const h = (px: number, py: number, pz: number) => fract(px * py * pz * (px + py + pz));
  const k0 = h(ax, ay, az), k1 = h(bx, ay, az), k2 = h(ax, by, az), k3 = h(bx, by, az);
  const k4 = h(ax, ay, bz), k5 = h(bx, ay, bz), k6 = h(ax, by, bz), k7 = h(bx, by, bz);
  const ka = k1 - k0, kb = k2 - k0, kc = k4 - k0;
  const kd = k0 - k1 - k2 + k3, ke = k0 - k2 - k4 + k6, kf = k0 - k1 - k4 + k5;
  const kg = -k0 + k1 + k2 - k3 + k4 - k5 - k6 + k7;
  const n = k0 + ka * ux + kb * uy + kc * uz + kd * ux * uy + ke * uy * uz + kf * uz * ux + kg * ux * uy * uz;
  return [
    n,
    dx * (ka + kd * uy + kf * uz + kg * uy * uz),
    dy * (kb + kd * ux + ke * uz + kg * uz * ux),
    dz * (kc + ke * uy + kf * ux + kg * ux * uy),
  ];
}

/** Crease height h = −w³ at world p for scale s (test helper). */
export function creaseHeightJS(p: readonly number[], s: number): number {
  const q = rot(s, p);
  const fq = DETAIL_SCALES[s][0];
  const n = noiseDJS(q[0] * fq, q[1] * fq, q[2] * fq)[0];
  const u = 2 * n - 1;
  const w = Math.max(1 - Math.sqrt(u * u + 0.0064), 0);
  return -DETAIL_SCALES[s][1] * w * w * w;
}

function rot(s: number, p: readonly number[]): number[] {
  const m = ROT[s], o = OFF[s];
  // column-major M · p
  return [m[0] * p[0] + m[3] * p[1] + m[6] * p[2] + o[0], m[1] * p[0] + m[4] * p[1] + m[7] * p[2] + o[1], m[2] * p[0] + m[5] * p[1] + m[8] * p[2] + o[2]];
}

function creaseGradJS(q: number[], freq: number): number[] {
  const nd = noiseDJS(q[0] * freq, q[1] * freq, q[2] * freq);
  const u = 2 * nd[0] - 1;
  const v = Math.sqrt(u * u + 0.0064);
  const w = Math.max(1 - v, 0);
  const k = 3 * w * w * (u / v) * 2 * freq;
  return [k * nd[1], k * nd[2], k * nd[3]];
}

/** JS mirror of dmDetailNormal (lowSpec = coarse scale only). */
export function detailNormalJS(n: readonly number[], p: readonly number[], fw: number, amp: number, lowSpec = false): number[] {
  const g = [0, 0, 0];
  for (let s = 0; s < (lowSpec ? 1 : 2); s++) {
    const [freq, depth] = DETAIL_SCALES[s];
    const fade = 1 - smoothstep(DETAIL_FADE[0], DETAIL_FADE[1], fw * freq);
    if (fade <= 0) continue;
    const gq = creaseGradJS(rot(s, p), freq);
    const m = ROT[s];
    // gq · M (row vector) = Mᵀ gq
    const gx = gq[0] * m[0] + gq[1] * m[1] + gq[2] * m[2];
    const gy = gq[0] * m[3] + gq[1] * m[4] + gq[2] * m[5];
    const gz = gq[0] * m[6] + gq[1] * m[7] + gq[2] * m[8];
    g[0] += depth * fade * gx;
    g[1] += depth * fade * gy;
    g[2] += depth * fade * gz;
  }
  for (let a = 0; a < 3; a++) g[a] *= amp;
  const d = g[0] * n[0] + g[1] * n[1] + g[2] * n[2];
  const t = [g[0] - n[0] * d, g[1] - n[1] * d, g[2] - n[2] * d];
  const tl = Math.hypot(t[0], t[1], t[2]);
  const k = Math.min(1, DETAIL_MAX_TILT / Math.max(tl, 1e-5));
  const r = [n[0] - t[0] * k, n[1] - t[1] * k, n[2] - t[2] * k];
  const l = Math.hypot(r[0], r[1], r[2]);
  return [r[0] / l, r[1] / l, r[2] / l];
}

export function facetWJS(agree: number, camDist: number, rockW: number): number {
  return FACET_W * smoothstep(FACET_AGREE[0], FACET_AGREE[1], agree) * (1 - smoothstep(FACET_DIST[0], FACET_DIST[1], camDist)) * rockW;
}
