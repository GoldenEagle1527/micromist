/**
 * GLSL of the multi-material seabed (materialCatalog.ts / materialLibrary.ts):
 * texture arrays of 22 sets, per-vertex macro-region weights (terrain/regionWeights.ts)
 * → region palettes (main + alt sub-patches) → the 5 surface slots of the current
 * surface weights (floor A/B, wall A/B, ceiling). One shader for every device.
 *
 *  - region choice: the 6 baked region weights + the ring wall's (「界壁」, slot 6,
 *    bounded world only; 0 elsewhere) reduced to the top two; their mix is
 *    sharpened by world noise into meandering interfingering (no hard seam, both
 *    regions fetched only in thin ribbons). Each region blends its main / alt
 *    palette by a world patch noise (narrow soft band);
 *  - fixed top-2 selections in registers (materialSelect.ts: the third weight is
 *    subtracted, so an item enters / leaves at weight 0): where 3-4 palettes overlap,
 *    the two heaviest palettes; then per surface group (floor; wall + ceiling) the
 *    two heaviest layers of those palettes, duplicates merged. One palette at full
 *    weight (most pixels) takes a short path with the identical result;
 *  - triplanar with explicit gradients (derivatives taken in uniform control flow),
 *    floors on the top projection only, walls / ceiling on all three;
 *  - rotated second scale (anti-tiling) on the "desktop" and "always" sets;
 *  - mobile-driver safety: no local arrays or array constructors, explicit precision
 *    (DM_P) on every array uniform — Mali behind ANGLE rejects arrays the default
 *    precision doesn't reach ("S0032: no default precision defined for variable
 *    'float[5]'") — and no dynamic indexing of vector components; test:shaders lints
 *    this;
 *  - mobile cost (test:shaders malioc budget): weights, colours and normal sums are
 *    DM_M (mediump unless three itself chose lowp; desktop GPUs run it as fp32),
 *    world position, UVs and derivatives stay at the default (highp) precision;
 *  - all layers are on the GPU before the dive (materialLibrary.ts).
 * Needs DECLS (dmNoise / dmFbm / dmRot / dmUnpack, DM_P / DM_M) first, and wp, wn,
 * bw, axisSign, dpx / dpy from MAP_FRAGMENT. MAT_FRAGMENT defines floorW, ceilW,
 * wallW, nA, slotW0..4, albedo, dmNrm (whiteout triplanar normal, unnormalised) and
 * dmRough for the rest of MAP_FRAGMENT.
 */
import { LAYER_COUNT, PALETTE_COUNT, WALL_MATERIAL, WALL_TINT, paletteOf } from "./materialCatalog";
import { TOP3_GLSL, topTwoDecl, topTwoGlsl, topTwoJS, type LayerCandidate } from "./materialSelect";

/** Vertex side: region weight attributes (terrain/regionWeights.ts) → varyings. */
export const MAT_VERT_DECLS = /* glsl */ `
attribute vec4 aRegA;
attribute vec3 aRegB;
varying vec4 vRegA;
varying vec3 vRegB;
`;
export const MAT_VERT_MAIN = /* glsl */ `
  vRegA = aRegA;
  vRegB = aRegB;
`;

export const MAT_DECLS = /* glsl */ `
#define DM_LAYERS ${LAYER_COUNT}
#define DM_PALETTES ${PALETTE_COUNT}
varying vec4 vRegA;               // region weights: sand, reef, canyon, cave
varying vec3 vRegB;               //                 terrace, trench, ring wall
uniform DM_M sampler2DArray tMatA;   // 8-bit data: mediump results
uniform DM_M sampler2DArray tMatN;
uniform DM_P vec4 uLayer[DM_LAYERS];   // x = 1 / repeat, y = gain, z = rot (1 desktop, 2 always)
uniform DM_P vec4 uPal[DM_PALETTES];   // floorA, floorB, wallA, wallB layers
uniform DM_P vec4 uPalC[DM_PALETTES];  // x = ceiling layer, y = alt-patch threshold

void dmSampleLayer(int L, vec2 uv, vec2 dx, vec2 dy, DM_M float rMix, out DM_M vec3 a, out DM_M vec4 n) {
  vec4 P = uLayer[L];
  float s = P.x;
  float fl = float(L);
  DM_M float m = P.z > 0.5 ? rMix : 0.0;
  a = vec3(0.0);
  n = vec4(0.0);
  if (m < 1.0) {
    a = textureGrad(tMatA, vec3(uv * s, fl), dx * s, dy * s).rgb;
    n = textureGrad(tMatN, vec3(uv * s, fl), dx * s, dy * s);
  }
  if (m > 0.0) {
    // rotated second scale; its tangent xy rotated back into the base UV frame
    float sr = s * 0.43;
    vec3 ru = vec3(dmRot(uv) * sr + 0.37, fl);
    vec2 rdx = dmRot(dx) * sr, rdy = dmRot(dy) * sr;
    DM_M vec3 a2 = textureGrad(tMatA, ru, rdx, rdy).rgb;
    DM_M vec4 n2 = textureGrad(tMatN, ru, rdx, rdy);
    n2.xy = (transpose(mat2(0.8, -0.6, 0.6, 0.8)) * (n2.xy * 2.0 - 1.0)) * 0.5 + 0.5;
    a = mix(a, a2, m);
    n = mix(n, n2, m);
  }
  a *= P.y;
}

// Layer index stored as a float in a palette uniform.
int dmLayer(float f) { return int(f + 0.5); }

// Alt-palette share of region r at this point (world patch noise, narrow soft band).
DM_M float dmAltV(int r, DM_M float nP1, DM_M float nP2) {
  float th = uPalC[2 * r].y;
  return smoothstep(th - 0.05, th + 0.05, mix(nP1, nP2, float(r) * 0.2));
}

// Accumulate layer L with weight w (skipped at w <= 0).
void dmAcc(int L, DM_M float w, vec2 uv, vec2 dx, vec2 dy, DM_M float rMix, inout DM_M vec3 a, inout DM_M vec4 n, inout DM_M float s) {
  if (w <= 0.0) return;
  DM_M vec3 ta;
  DM_M vec4 tn;
  dmSampleLayer(L, uv, dx, dy, rMix, ta, tn);
  a += ta * w;
  n += tn * w;
  s += w;
}

// One triplanar projection: the kept floor pair (weights x fs) and wall / ceiling
// pair, normalised to their total.
void dmProject(vec2 uv, vec2 dx, vec2 dy, DM_M float fs, int fLa, DM_M float fWa, int fLb, DM_M float fWb,
               int kLa, DM_M float kWa, int kLb, DM_M float kWb, DM_M float rMix, out DM_M vec3 a, out DM_M vec4 n) {
  DM_M float s = 0.0;
  a = vec3(0.0);
  n = vec4(0.0);
  dmAcc(fLa, fWa * fs, uv, dx, dy, rMix, a, n, s);
  dmAcc(fLb, fWb * fs, uv, dx, dy, rMix, a, n, s);
  dmAcc(kLa, kWa, uv, dx, dy, rMix, a, n, s);
  dmAcc(kLb, kWb, uv, dx, dy, rMix, a, n, s);
  a /= max(s, 1e-4);
  n /= max(s, 1e-4);
}

// Running top-2 of the region weights (called with literal ids).
void dmTop2(DM_M float w, int r, inout int ia, inout DM_M float wa, inout int ib, inout DM_M float wb) {
  if (w > wa) { ib = ia; wb = wa; ia = r; wa = w; }
  else if (w > wb) { ib = r; wb = w; }
}
${TOP3_GLSL}`;

// Candidates per surface group: palettes x the group's slots (uPal xyzw = floor A,
// floor B, wall A, wall B; uPalC.x = ceiling).
const FLOOR_SLOTS: readonly [string, string][] = [[".x", "slotW0"], [".y", "slotW1"]];
const WALL_SLOTS: readonly [string, string][] = [[".z", "slotW2"], [".w", "slotW3"], ["C.x", "slotW4"]];
const cands = (pals: readonly (readonly [string, string])[], slots: readonly [string, string][]): LayerCandidate[] =>
  pals.flatMap(([P, pw]) => slots.map(([comp, sw]) => ({ layer: `dmLayer(${P}${comp})`, weight: pw ? `${pw} * ${sw}` : sw })));
// floor A != floor B within a palette (materialCatalog, test:materials)
const floorDistinct = (pals: number): [number, number][] => Array.from({ length: pals }, (_, i) => [2 * i, 2 * i + 1]);
// one palette at full weight (most pixels): 3 wall candidates
const ONE = [["P1", ""]] as const;
// otherwise the two heaviest palettes (materialSelect.ts on the 4 palette weights)
const TWO = [["P1", "u1"], ["P2", "u2"]] as const;
const SELECT = /* glsl */ `${topTwoDecl("dmF")}${topTwoDecl("dmK")}
  bool oneA = palMix <= 0.0 && (vA <= 0.0 || vA >= 1.0);
  bool oneB = palMix >= 1.0 && (vB <= 0.0 || vB >= 1.0);
  if (oneA || oneB) {
    int p1 = oneA ? 2 * regA + (vA > 0.5 ? 1 : 0) : 2 * regB + (vB > 0.5 ? 1 : 0);
    vec4 P1 = uPal[p1], P1C = uPalC[p1];
    dmFLa = dmLayer(P1.x); dmFWa = slotW0; dmFLb = dmLayer(P1.y); dmFWb = slotW1;
${topTwoGlsl("dmK", cands(ONE, WALL_SLOTS))}  } else {
    // palettes: region A main / alt, region B main / alt
    int p1 = 0, p2 = 0;
    DM_M float u1 = 0.0, u2 = 0.0;
${topTwoGlsl("dmP", [
  { layer: "2 * regA", weight: "(1.0 - palMix) * (1.0 - vA)" },
  { layer: "2 * regA + 1", weight: "(1.0 - palMix) * vA" },
  { layer: "2 * regB", weight: "palMix * (1.0 - vB)" },
  { layer: "2 * regB + 1", weight: "palMix * vB" },
], [[0, 1], [2, 3]], { La: "p1", Wa: "u1", Lb: "p2", Wb: "u2" })}    vec4 P1 = uPal[p1], P1C = uPalC[p1], P2 = uPal[p2], P2C = uPalC[p2];
${topTwoGlsl("dmF", cands(TWO, FLOOR_SLOTS), floorDistinct(2))}${topTwoGlsl("dmK", cands(TWO, WALL_SLOTS))}  }
`;

/** Wall albedo tint (MAP_FRAGMENT, by the wall weight vRegB.z). */
export const WALL_TINT_GLSL = `vec3(${WALL_TINT.map((v) => v.toFixed(3)).join(", ")})`;

export const MAT_FRAGMENT = /* glsl */ `
  // ---- surface weights ---------------------------------------------------
  DM_M float up = wn.y;
  DM_M float nA = dmFbm(wp * 0.07);          // large patches
  DM_M float nB = dmFbm(wp * 0.23 + 31.0);   // medium breakup
  DM_M float floorW = smoothstep(0.45, 0.8, up + (nB - 0.5) * 0.25);
  DM_M float ceilW = smoothstep(-0.25, -0.65, up);
  DM_M float wallW = max(0.0, 1.0 - floorW - ceilW);
  // floor B collects in low spots and near walls, floor A on open flats
  DM_M float floorBMask = smoothstep(0.42, 0.62, nA + (1.0 - floorW) * 0.15 - (wp.y / uWS - 2.0) * 0.015);
  // wall B on gently sloped, lit rock and ledges, patchy
  DM_M float wallBMask = smoothstep(0.45, 0.7, nB * 0.7 + nA * 0.3 + up * 0.35) * (1.0 - ceilW);
  // five scalars, not an array constructor (Mali S0032, see the header)
  DM_M float slotW0 = floorW * (1.0 - floorBMask), slotW1 = floorW * floorBMask;
  DM_M float slotW2 = wallW * (1.0 - wallBMask), slotW3 = wallW * wallBMask, slotW4 = ceilW;

  // side projections show walls / ceiling; where those fade out (gentle floor
  // slopes) the floor layers fade in there instead (continuous: no seam line)
  DM_M float floorSide = 1.0 - smoothstep(0.0, 0.08, slotW2 + slotW3 + slotW4);

  // ---- regions -> the two strongest regions --------------------------------
  int regA = 0, regB = 0;
  DM_M float wA = 0.0, wB = 0.0;
  dmTop2(vRegA.x, 0, regA, wA, regB, wB);
  dmTop2(vRegA.y, 1, regA, wA, regB, wB);
  dmTop2(vRegA.z, 2, regA, wA, regB, wB);
  dmTop2(vRegA.w, 3, regA, wA, regB, wB);
  dmTop2(vRegB.x, 4, regA, wA, regB, wB);
  dmTop2(vRegB.y, 5, regA, wA, regB, wB);
  dmTop2(vRegB.z, ${WALL_MATERIAL}, regA, wA, regB, wB);
  if (wA < 1e-3) { regA = 0; wA = 1.0; }
  // order the pair by region index, not by weight: the blend below is then the
  // same function on both sides of a rank swap (no seam where wA = wB)
  if (wB > 0.0 && regB < regA) {
    int tr = regA; regA = regB; regB = tr;
    DM_M float tw = wA; wA = wB; wB = tw;
  }
  // sub-region alt patches (~100 u), decorrelated per region by mixing two noises
  DM_M float nP1 = dmFbm(wp * 0.011 + 17.0), nP2 = dmFbm(wp * 0.0085 + 53.0);
  DM_M float vA = dmAltV(regA, nP1, nP2);
  DM_M float vB = dmAltV(regB, nP1, nP2);
  // interfingering: the linear blend becomes a noisy, meandering front (its noise
  // only where a second region is present)
  DM_M float palMix = 0.0;
  if (wB > 0.0) {
    DM_M float nI = dmFbm(wp * 0.045 + 7.0) * 0.6 + dmFbm(wp * 0.19 + 3.0) * 0.4;
    palMix = smoothstep(0.44, 0.56, wB / (wA + wB) + (nI - 0.5) * 1.5);
  }
  // rotated second-scale blend (anti-tiling), plain math: safe to branch on
  DM_M float rMix = smoothstep(0.35, 0.65, dmNoise(wp * 0.11 + 5.0));

  // ---- palettes (region A main / alt, region B main / alt) -> fixed top-2 layers
  // per surface group (materialSelect.ts); region interiors take a short path with
  // the identical result
${SELECT}
  // ---- triplanar: per projection axis, finished right away (few live registers).
  // UVs and their screen-space gradients come from wp and dpx / dpy = dFdx / dFdy(wp)
  // (MAP_FRAGMENT, uniform control flow): the fetches sit in branches, where
  // implicit derivatives would be undefined (wrong mips, thin seams).
  // Floor layers: top projection, sides only via floorSide; wall / ceiling: all three.
  DM_M vec3 albedo = vec3(0.0);
  DM_M vec3 dmNrm = vec3(0.0);     // whiteout-blended world normal (unnormalised)
  DM_M float dmRough = 0.0;
  if (bw.y > 0.0) {
    DM_M vec3 a; DM_M vec4 n;
    dmProject(vec2(wp.x * axisSign.y, wp.z), vec2(dpx.x * axisSign.y, dpx.z), vec2(dpy.x * axisSign.y, dpy.z), 1.0,
              dmFLa, dmFWa, dmFLb, dmFWb, dmKLa, dmKWa, dmKLb, dmKWb, rMix, a, n);
    DM_M vec3 t = dmUnpack(n);
    t.x *= axisSign.y;
    t = vec3(t.xy + wn.xz, abs(t.z) * wn.y);
    albedo += a * bw.y; dmNrm += t.xzy * bw.y; dmRough += n.b * bw.y;
  }
  if (bw.x > 0.0) {
    DM_M vec3 a; DM_M vec4 n;
    dmProject(vec2(wp.z * axisSign.x, wp.y), vec2(dpx.z * axisSign.x, dpx.y), vec2(dpy.z * axisSign.x, dpy.y), floorSide,
              dmFLa, dmFWa, dmFLb, dmFWb, dmKLa, dmKWa, dmKLb, dmKWb, rMix, a, n);
    DM_M vec3 t = dmUnpack(n);
    t.x *= axisSign.x;
    t = vec3(t.xy + wn.zy, abs(t.z) * wn.x);
    albedo += a * bw.x; dmNrm += t.zyx * bw.x; dmRough += n.b * bw.x;
  }
  if (bw.z > 0.0) {
    DM_M vec3 a; DM_M vec4 n;
    dmProject(vec2(-wp.x * axisSign.z, wp.y), vec2(-dpx.x * axisSign.z, dpx.y), vec2(-dpy.x * axisSign.z, dpy.y), floorSide,
              dmFLa, dmFWa, dmFLb, dmFWb, dmKLa, dmKWa, dmKLb, dmKWb, rMix, a, n);
    DM_M vec3 t = dmUnpack(n);
    t.x *= -axisSign.z;
    t = vec3(t.xy + wn.xy, abs(t.z) * wn.z);
    albedo += a * bw.z; dmNrm += t * bw.z; dmRough += n.b * bw.z;
  }
`;

/** Kept layers of one surface group: [layer, weight] x 2. */
export type LayerPair = [number, number][];

/**
 * JS mirror of SELECT (test:materials): the floor and wall / ceiling pairs for the
 * region pair (regA, regB), palette blend palMix, alt shares vA / vB and the slot
 * weights slotW0..4.
 */
export function selectLayersJS(
  regA: number,
  regB: number,
  palMix: number,
  vA: number,
  vB: number,
  slotW: readonly number[],
  stats?: { gain: number },
): { floor: LayerPair; wall: LayerPair } {
  const wallOf = (pals: [number, number][]) => topTwoJS(pals.flatMap(([p, u]) => paletteOf(p).slice(2).map((l, i): [number, number] => [l, u * slotW[2 + i]])), stats);
  const oneA = palMix <= 0 && (vA <= 0 || vA >= 1);
  const oneB = palMix >= 1 && (vB <= 0 || vB >= 1);
  if (oneA || oneB) {
    const p1 = oneA ? 2 * regA + (vA > 0.5 ? 1 : 0) : 2 * regB + (vB > 0.5 ? 1 : 0);
    const P = paletteOf(p1);
    return { floor: [[P[0], slotW[0]], [P[1], slotW[1]]], wall: wallOf([[p1, 1]]) };
  }
  const pals = topTwoJS([
    [2 * regA, (1 - palMix) * (1 - vA)],
    [2 * regA + 1, (1 - palMix) * vA],
    [2 * regB, palMix * (1 - vB)],
    [2 * regB + 1, palMix * vB],
  ], stats);
  const floor = topTwoJS(pals.flatMap(([p, u]) => paletteOf(p).slice(0, 2).map((l, i): [number, number] => [l, u * slotW[i]])), stats);
  return { floor, wall: wallOf(pals) };
}
