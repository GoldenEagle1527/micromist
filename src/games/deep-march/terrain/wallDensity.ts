/**
 * The ring wall's density term (design doc §4.4), applied by density.ts on top of
 * the terrain's raw value t (base units, like evalRaw):
 *
 *   u     = sd + face(s, y)                          (> 0 behind the inner face)
 *   inner = iso + g·u            (u ≥ −reach)        the wall's solid, gradient g
 *         = iso − g·reach + g₂·(u + reach)  (below)  steeper in front, so it ends exactly
 *   outer = max(iso + g·(T − sd),                    the outer face (thickness T) …
 *               iso + g_v·(voidLo − y), iso + g_v·(y − voidHi))   … and the void's floor / roof
 *   raw   = min(cap, min(smax_k(t, inner), outer))
 *
 * smax_k is the polynomial smooth max (C1 fillet where the wall meets the seabed,
 * monotone in t, = t exactly once inner ≤ t − k). Beyond the outer face everything is
 * the chaos void (open between voidLo and voidHi, sealed above and below), so no
 * terrain survives past the wall. Every constant is in raw units at the design scale
 * (WALL_UNIT), so the world field and the base-scale classification field share it.
 *
 * Exactness / cost: with tMin a lower bound of t everywhere, the term is an exact
 * identity at every point with sd ≤ skipSd (inner ≤ tMin − k and outer ≥ cap), so the
 * density evaluates it only in columns reaching past skipSd (per-(x, z) test); nearer,
 * identityFrom(sd) gives the terrain value above which it is still an exact identity
 * at that (x, z) (a compare per sample), and bounds() tells when the wall alone fixes
 * the value (no terrain noise needed: the solid behind the face, the void beyond).
 */
import { WALL_SHAPE, type WallShapeTuning } from "./wallConfig";
import { WALL_UNIT, type WallShape } from "./wallGeometry";

export type WallTerm = {
  shape: WallShape;
  /** The term is an exact identity wherever sd ≤ skipSd. */
  skipSd: number;
  /** Wall-combined raw value (t = the terrain's raw value at the point). */
  apply: (t: number, sd: number, s: number, y: number) => number;
  /** At signed distance sd: apply(t, sd, ·, ·) = t exactly for every t ≥ this (+∞: nowhere; −∞ for sd ≤ skipSd). */
  identityFrom: (sd: number) => number;
  /**
   * Terrain bounds [lo, hi] (lo ≤ cap) mapped through the term at one point: out = [lo', hi'].
   * Returns true if the combined value is the same for every t in [lo, hi] (then
   * out[0] = out[1] = exactly apply's result).
   */
  bounds: (lo: number, hi: number, sd: number, s: number, y: number, out: Float64Array) => boolean;
  /** Lower bound of the combined raw at height y, given a lower bound lo of t (upper bound: the cap). */
  lowerAt: (y: number, lo: number) => number;
  /** Wall material weight at a point (1 on and behind the face, 0 beyond materialBand in front). */
  weight: (sd: number, s: number, y: number) => number;
};

const smooth01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function createWallTerm(shape: WallShape, iso: number, capHi: number, tMin: number, t: WallShapeTuning = WALL_SHAPE): WallTerm {
  const U = WALL_UNIT;
  const g = t.gradient, g2 = t.falloff * t.gradient, r1 = t.reach / U;
  const k = t.fillet / U;
  const gV = t.voidGradient, vLo = t.voidLo / U, vHi = t.voidHi / U;
  const T = shape.thickness;
  const band = t.materialBand / U;
  const face = shape.face;
  const voidBound = (y: number) => iso + gV * Math.max(vLo - y, y - vHi);

  const innerOf = (u: number) => (u >= -r1 ? iso + g * u : iso - g * r1 + g2 * (u + r1));
  const outerOf = (sd: number, y: number) => {
    const o = iso + g * (T - sd), vb = voidBound(y);
    return vb > o ? vb : o;
  };
  /** min(cap, min(smax_k(t, inner), outer)); smax ≥ max(t, inner) holds in floating point too. */
  const combine = (tv: number, inner: number, outer: number): number => {
    let v = tv;
    const dd = inner - tv;
    if (dd >= k) v = inner;
    else if (dd > -k) {
      const hh = (k - Math.abs(dd)) / k;
      v = (dd > 0 ? inner : tv) + hh * hh * k * 0.25;
    }
    if (outer < v) v = outer;
    return v < capHi ? v : capHi;
  };
  const apply = (tv: number, sd: number, s: number, y: number): number => combine(tv, innerOf(sd + face(s, y)), outerOf(sd, y));

  const bounds = (lo: number, hi: number, sd: number, s: number, y: number, out: Float64Array): boolean => {
    const inner = innerOf(sd + face(s, y)), outer = outerOf(sd, y);
    const c = outer < capHi ? outer : capHi;
    // v ≥ max(t, inner) ≥ max(lo, inner) ≥ min(outer, cap): clipped to exactly c
    if ((lo > inner ? lo : inner) >= c) {
      out[0] = out[1] = c;
      return true;
    }
    // inner − t ≥ inner − hi ≥ k for every t ≤ hi: v = inner, then the same clips
    if (inner - hi >= k) {
      out[0] = out[1] = inner < c ? inner : c;
      return true;
    }
    out[0] = combine(lo, inner, outer);
    out[1] = combine(hi, inner, outer);
    return false;
  };

  // identity for t with inner − t ≤ −k everywhere at this sd (inner ≤ its value at
  // faceMax) wherever the outer face stays above the cap (the margin covers rounding)
  const innerMax = (sd: number) => innerOf(sd + shape.faceMax);
  const identityFrom = (sd: number) => (sd <= skipSd ? -Infinity : iso + g * (T - sd) >= capHi ? innerMax(sd) + k + 1e-9 : Infinity);

  // largest u with inner(u) ≤ tMin − k, then the outer face ≥ cap
  const L = tMin - k;
  const uLim = L >= iso - g * r1 ? (L - iso) / g : -r1 + (L - (iso - g * r1)) / g2;
  const skipSd: number = Math.min(uLim - shape.faceMax, T - (capHi - iso) / g) - 1e-9;

  return {
    shape,
    skipSd,
    apply,
    identityFrom,
    bounds,
    lowerAt: (y, lo) => Math.min(lo, voidBound(y)),
    weight: (sd, s, y) => 1 - smooth01(-(sd + face(s, y)) / band),
  };
}
