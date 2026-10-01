/** JS mirror of the detail-normal GLSL (detailNormal.ts) for scripts/deep-march-detail-test.ts. */
import { DETAIL_FADE, DETAIL_MAX_TILT, DETAIL_SCALES, FACET_AGREE, FACET_DIST, FACET_W, OFF, ROT } from "./detailParams";

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
