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
 * Parts: declarations / helpers (materialDecls.ts), palette / layer selection
 * (materialSelectGlsl.ts).
 * Needs DECLS (dmNoise / dmFbm / dmRot / dmUnpack, DM_P / DM_M) first, and wp, wn,
 * bw, axisSign, dpx / dpy from MAP_FRAGMENT. MAT_FRAGMENT defines floorW, ceilW,
 * wallW, nA, slotW0..4, albedo, dmNrm (whiteout triplanar normal, unnormalised) and
 * dmRough for the rest of MAP_FRAGMENT.
 */
import { WALL_MATERIAL, WALL_TINT } from "./materialCatalog";
import { SELECT } from "./materialSelectGlsl";

export { MAT_DECLS, MAT_VERT_DECLS, MAT_VERT_MAIN } from "./materialDecls";
export { selectLayersJS, type LayerPair } from "./materialSelectGlsl";

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
