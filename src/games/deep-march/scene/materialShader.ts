/**
 * GLSL of the multi-material seabed (materialCatalog.ts / materialLibrary.ts):
 * texture arrays of 22 sets, per-vertex macro-region weights (terrain/regionWeights.ts)
 * → region palettes (main + alt sub-patches) → the 5 surface slots of the current
 * surface weights (floor A/B, wall A/B, ceiling).
 *
 *  - region choice: the 6 baked region weights reduced to the top two; their mix is
 *    sharpened by world noise into meandering interfingering (no hard seam, both
 *    regions fetched only in thin ribbons). Each region blends its main / alt
 *    palette by a world patch noise (narrow soft band);
 *  - full path (desktop): slot entries of up to 4 palettes merged by layer (shared
 *    layers fetched once);
 *  - DM_SIMPLE_MAT (phones, and the automatic fallback when the full program fails
 *    to build): ONE palette per pixel — region and main / alt picked by an
 *    interleaved-gradient dither inside the border ribbon / alt band — and its 5
 *    slots fetched directly: no local arrays, no dynamic vector indexing, few
 *    loops (mobile GLSL compilers choke on the full path, see test:shaders);
 *  - no dynamic indexing of vector components anywhere (dmLayerOf);
 *  - triplanar with explicit gradients (derivatives taken in uniform control flow in
 *    MAP_FRAGMENT), floors on the top projection only, walls / ceiling on all three;
 *  - rotated second scale (anti-tiling) per layer: "desktop" sets on desktop,
 *    "always" sets (large unique features, B slots only) everywhere;
 *  - all layers are on the GPU before the dive (materialLibrary.ts): no stand-ins.
 * Needs DECLS (dmNoise / dmFbm / dmRot) first. MAT_FRAGMENT defines floorW, ceilW,
 * nA, albedo, nX4 / nY4 / nZ4 for the rest of MAP_FRAGMENT.
 */
import { LAYER_COUNT, PALETTE_COUNT } from "./materialCatalog";

/** Vertex side: region weight attributes (terrain/regionWeights.ts) → varyings. */
export const MAT_VERT_DECLS = /* glsl */ `
attribute vec4 aRegA;
attribute vec2 aRegB;
varying vec4 vRegA;
varying vec2 vRegB;
`;
export const MAT_VERT_MAIN = /* glsl */ `
  vRegA = aRegA;
  vRegB = aRegB;
`;

export const MAT_DECLS = /* glsl */ `
#define DM_LAYERS ${LAYER_COUNT}
#define DM_PALETTES ${PALETTE_COUNT}
#define DM_ENTRIES 14
uniform sampler2DArray tMatA;
uniform sampler2DArray tMatN;
uniform vec4 uLayer[DM_LAYERS];   // x = 1 / repeat, y = gain, z = rot (1 desktop, 2 always)
uniform vec4 uPal[DM_PALETTES];   // floorA, floorB, wallA, wallB layers
uniform vec4 uPalC[DM_PALETTES];  // x = ceiling layer, y = alt-patch threshold
varying vec4 vRegA;               // region weights: sand, reef, canyon, cave
varying vec2 vRegB;               //                 terrace, trench

void dmSampleLayer(int L, vec2 uv, vec2 dx, vec2 dy, float rMix, out vec3 a, out vec4 n) {
  vec4 P = uLayer[L];
  float s = P.x;
  float fl = float(L);
#ifdef DM_SIMPLE_MAT
  float m = P.z > 1.5 ? rMix : 0.0;
#else
  float m = P.z > 0.5 ? rMix : 0.0;
#endif
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
    vec3 a2 = textureGrad(tMatA, ru, rdx, rdy).rgb;
    vec4 n2 = textureGrad(tMatN, ru, rdx, rdy);
    n2.xy = (transpose(mat2(0.8, -0.6, 0.6, 0.8)) * (n2.xy * 2.0 - 1.0)) * 0.5 + 0.5;
    a = mix(a, a2, m);
    n = mix(n, n2, m);
  }
  a *= P.y;
}

// Layer of palette p in slot 0..4 (floorA, floorB, wallA, wallB, ceiling), without
// dynamic vector-component indexing.
int dmLayerOf(int p, int slot) {
  vec4 v = uPal[p];
  float f = slot == 0 ? v.x : slot == 1 ? v.y : slot == 2 ? v.z : slot == 3 ? v.w : uPalC[p].x;
  return int(f + 0.5);
}

// Running top-2 of the region weights (called once per region with a literal id).
void dmTop2(float w, int r, inout int ia, inout float wa, inout int ib, inout float wb) {
  if (w > wa) { ib = ia; wb = wa; ia = r; wa = w; }
  else if (w > wb) { ib = r; wb = w; }
}

// Alt-palette share of region r at this point (world patch noise, narrow soft band).
float dmAltV(int r, float nP1, float nP2) {
  float th = uPalC[2 * r].y;
  return smoothstep(th - 0.05, th + 0.05, mix(nP1, nP2, float(r) * 0.2));
}

// Accumulate layer L with weight w (skipped at w <= 0).
void dmAcc(int L, float w, vec2 uv, vec2 dx, vec2 dy, float rMix, inout vec3 a, inout vec4 n, inout float s) {
  if (w <= 0.0) return;
  vec3 ta;
  vec4 tn;
  dmSampleLayer(L, uv, dx, dy, rMix, ta, tn);
  a += ta * w;
  n += tn * w;
  s += w;
}
`;

export const MAT_FRAGMENT = /* glsl */ `
  // ---- surface weights ---------------------------------------------------
  float up = wn.y;
  float nA = dmFbm(wp * 0.07);          // large patches
  float nB = dmFbm(wp * 0.23 + 31.0);   // medium breakup
  float floorW = smoothstep(0.45, 0.8, up + (nB - 0.5) * 0.25);
  float ceilW = smoothstep(-0.25, -0.65, up);
  float wallW = max(0.0, 1.0 - floorW - ceilW);
  // floor B collects in low spots and near walls, floor A on open flats
  float floorBMask = smoothstep(0.42, 0.62, nA + (1.0 - floorW) * 0.15 - (wp.y / uWS - 2.0) * 0.015);
  // wall B on gently sloped, lit rock and ledges, patchy
  float wallBMask = smoothstep(0.45, 0.7, nB * 0.7 + nA * 0.3 + up * 0.35) * (1.0 - ceilW);
  float slotW[5] = float[5](floorW * (1.0 - floorBMask), floorW * floorBMask, wallW * (1.0 - wallBMask), wallW * wallBMask, ceilW);
  // side projections show walls / ceiling; where those fade out (gentle floor
  // slopes) the floor layers fade in there instead (continuous: no seam line)
  float sideSum = slotW[2] + slotW[3] + slotW[4];
  float floorSide = 1.0 - smoothstep(0.0, 0.08, sideSum);

  // ---- regions → the two strongest regions ---------------------------------
  int regA = 0, regB = 0;
  float wA = 0.0, wB = 0.0;
  dmTop2(vRegA.x, 0, regA, wA, regB, wB);
  dmTop2(vRegA.y, 1, regA, wA, regB, wB);
  dmTop2(vRegA.z, 2, regA, wA, regB, wB);
  dmTop2(vRegA.w, 3, regA, wA, regB, wB);
  dmTop2(vRegB.x, 4, regA, wA, regB, wB);
  dmTop2(vRegB.y, 5, regA, wA, regB, wB);
  if (wA < 1e-3) { regA = 0; wA = 1.0; }
  // order the pair by region index, not by weight: the blend below is then the
  // same function on both sides of a rank swap (no seam where wA = wB)
  if (wB > 0.0 && regB < regA) {
    int tr = regA; regA = regB; regB = tr;
    float tw = wA; wA = wB; wB = tw;
  }
  // sub-region alt patches (~100 u), decorrelated per region by mixing two noises
  float nP1 = dmFbm(wp * 0.011 + 17.0), nP2 = dmFbm(wp * 0.0085 + 53.0);
  float vA = dmAltV(regA, nP1, nP2);
  float vB = dmAltV(regB, nP1, nP2);
  // interfingering: the linear blend becomes a noisy, meandering front
  float nI = dmFbm(wp * 0.045 + 7.0) * 0.6 + dmFbm(wp * 0.19 + 3.0) * 0.4;
  float palMix = wB > 0.0 ? smoothstep(0.44, 0.56, wB / (wA + wB) + (nI - 0.5) * 1.5) : 0.0;

  // ---- UVs (units → texture repeats) ------------------------------------
  vec2 uvX = vec2(wp.z * axisSign.x, wp.y);
  vec2 uvY = vec2(wp.x * axisSign.y, wp.z);
  vec2 uvZ = vec2(-wp.x * axisSign.z, wp.y);
  // Screen-space UV derivatives taken here, in uniform control flow: the fetches
  // below sit in branches (skipped layers / axes), where implicit derivatives would
  // be undefined and pick wrong mips along branch borders (thin seams).
  vec2 gXx = dFdx(uvX), gXy = dFdy(uvX);
  vec2 gYx = dFdx(uvY), gYy = dFdy(uvY);
  vec2 gZx = dFdx(uvZ), gZy = dFdy(uvZ);
  // rotated second-scale blend (anti-tiling), plain math: safe to branch on
  float rMix = smoothstep(0.35, 0.65, dmNoise(wp * 0.11 + 5.0));

  vec3 aX = vec3(0.0), aY = vec3(0.0), aZ = vec3(0.0);
  vec4 nX4 = vec4(0.0), nY4 = vec4(0.0), nZ4 = vec4(0.0);
  float sY = 0.0, sX = 0.0, sZ = 0.0;
#ifdef DM_SIMPLE_MAT
  // ---- one palette per pixel: region, then main / alt, by dither ----------
  float dth = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float dth2 = fract(dth + 0.61803399);
  bool useB = palMix > dth;
  int reg = useB ? regB : regA;
  int pal = 2 * reg + ((useB ? vB : vA) > dth2 ? 1 : 0);
  vec4 PL4 = uPal[pal];
  int l0 = int(PL4.x + 0.5), l1 = int(PL4.y + 0.5), l2 = int(PL4.z + 0.5), l3 = int(PL4.w + 0.5);
  int l4 = int(uPalC[pal].x + 0.5);
  if (bw.y > 0.0) {
    dmAcc(l0, slotW[0], uvY, gYx, gYy, rMix, aY, nY4, sY);
    dmAcc(l1, slotW[1], uvY, gYx, gYy, rMix, aY, nY4, sY);
    dmAcc(l2, slotW[2], uvY, gYx, gYy, rMix, aY, nY4, sY);
    dmAcc(l3, slotW[3], uvY, gYx, gYy, rMix, aY, nY4, sY);
    dmAcc(l4, slotW[4], uvY, gYx, gYy, rMix, aY, nY4, sY);
  }
  if (bw.x > 0.0) {
    dmAcc(l0, slotW[0] * floorSide, uvX, gXx, gXy, rMix, aX, nX4, sX);
    dmAcc(l1, slotW[1] * floorSide, uvX, gXx, gXy, rMix, aX, nX4, sX);
    dmAcc(l2, slotW[2], uvX, gXx, gXy, rMix, aX, nX4, sX);
    dmAcc(l3, slotW[3], uvX, gXx, gXy, rMix, aX, nX4, sX);
    dmAcc(l4, slotW[4], uvX, gXx, gXy, rMix, aX, nX4, sX);
  }
  if (bw.z > 0.0) {
    dmAcc(l0, slotW[0] * floorSide, uvZ, gZx, gZy, rMix, aZ, nZ4, sZ);
    dmAcc(l1, slotW[1] * floorSide, uvZ, gZx, gZy, rMix, aZ, nZ4, sZ);
    dmAcc(l2, slotW[2], uvZ, gZx, gZy, rMix, aZ, nZ4, sZ);
    dmAcc(l3, slotW[3], uvZ, gZx, gZy, rMix, aZ, nZ4, sZ);
    dmAcc(l4, slotW[4], uvZ, gZx, gZy, rMix, aZ, nZ4, sZ);
  }
#else
  // ---- slot entries of up to 4 palettes (A main / alt, B main / alt), merged by layer
  float pw0 = (1.0 - palMix) * (1.0 - vA), pw1 = (1.0 - palMix) * vA;
  float pw2 = palMix * (1.0 - vB), pw3 = palMix * vB;
  int eL[DM_ENTRIES];
  float eW[DM_ENTRIES];
  float eF[DM_ENTRIES]; // 1 = floor entry (top projection; sides only via floorSide)
  int ne = 0;
  for (int q = 0; q < 4; q++) {
    float pw = q == 0 ? pw0 : q == 1 ? pw1 : q == 2 ? pw2 : pw3;
    if (pw <= 0.0) continue;
    int pi = 2 * (q < 2 ? regA : regB) + (q == 1 || q == 3 ? 1 : 0);
    for (int slot = 0; slot < 5; slot++) {
      float sw = slot == 0 ? slotW[0] : slot == 1 ? slotW[1] : slot == 2 ? slotW[2] : slot == 3 ? slotW[3] : slotW[4];
      float w = pw * sw;
      if (w <= 0.0) continue;
      int L = dmLayerOf(pi, slot);
      float fl = slot < 2 ? 1.0 : 0.0;
      bool merged = false;
      for (int i = 0; i < DM_ENTRIES; i++) {
        if (i >= ne) break;
        if (eL[i] == L && eF[i] == fl) { eW[i] += w; merged = true; break; }
      }
      if (!merged && ne < DM_ENTRIES) { eL[ne] = L; eW[ne] = w; eF[ne] = fl; ne++; }
    }
  }
  for (int i = 0; i < DM_ENTRIES; i++) {
    if (i >= ne) break;
    float w = eW[i];
    if (bw.y > 0.0) dmAcc(eL[i], w, uvY, gYx, gYy, rMix, aY, nY4, sY);
    float ws = eF[i] > 0.5 ? w * floorSide : w;
    if (bw.x > 0.0) dmAcc(eL[i], ws, uvX, gXx, gXy, rMix, aX, nX4, sX);
    if (bw.z > 0.0) dmAcc(eL[i], ws, uvZ, gZx, gZy, rMix, aZ, nZ4, sZ);
  }
#endif
  aY /= max(sY, 1e-4); nY4 /= max(sY, 1e-4);
  aX /= max(sX, 1e-4); nX4 /= max(sX, 1e-4);
  aZ /= max(sZ, 1e-4); nZ4 /= max(sZ, 1e-4);
  vec3 albedo = aX * bw.x + aY * bw.y + aZ * bw.z;
`;
