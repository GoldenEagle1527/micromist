/**
 * GLSL of the multi-material seabed (materialCatalog.ts / materialLibrary.ts):
 * texture arrays of 22 sets, per-vertex macro-region weights (terrain/regionWeights.ts)
 * → region palettes (main + alt sub-patches) → the 5 surface slots of the current
 * surface weights (floor A/B, wall A/B, ceiling).
 *
 *  - region choice: the 6 baked region weights reduced to the top two; their mix is
 *    sharpened by world noise into meandering interfingering (no hard seam, both
 *    regions fetched only in thin ribbons). DM_LOW_SPEC: single region per pixel,
 *    dithered inside the ribbon. Each region blends its main / alt palette by a
 *    world patch noise (narrow soft band);
 *  - slot entries of both palettes are merged by layer (shared layers fetched once);
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
#ifdef DM_LOW_SPEC
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

  // ---- regions → the two strongest regions (each: main / alt palette mix) --
  float regW[6] = float[6](vRegA.x, vRegA.y, vRegA.z, vRegA.w, vRegB.x, vRegB.y);
  int regA = 0, regB = 0;
  float wA = 0.0, wB = 0.0;
  for (int r = 0; r < 6; r++) {
    float w = regW[r];
    if (w > wA) { regB = regA; wB = wA; regA = r; wA = w; }
    else if (w > wB) { regB = r; wB = w; }
  }
  if (wA < 1e-3) { regA = 0; wA = 1.0; }
  // order the pair by region index, not by weight: the blend below is then the
  // same function on both sides of a rank swap (no seam where wA = wB)
  if (wB > 0.0 && regB < regA) {
    int tr = regA; regA = regB; regB = tr;
    float tw = wA; wA = wB; wB = tw;
  }
  // sub-region alt patches (~100 u), decorrelated per region by mixing two noises
  float nP1 = dmFbm(wp * 0.011 + 17.0), nP2 = dmFbm(wp * 0.0085 + 53.0);
  float thA = uPalC[2 * regA].y, thB = uPalC[2 * regB].y;
  float vA = smoothstep(thA - 0.05, thA + 0.05, mix(nP1, nP2, float(regA) * 0.2));
  float vB = smoothstep(thB - 0.05, thB + 0.05, mix(nP1, nP2, float(regB) * 0.2));
  // interfingering: the linear blend becomes a noisy, meandering front
  float nI = dmFbm(wp * 0.045 + 7.0) * 0.6 + dmFbm(wp * 0.19 + 3.0) * 0.4;
  float palMix = 0.0;
  if (wB > 0.0) {
    float t = wB / (wA + wB) + (nI - 0.5) * 1.5;
#ifdef DM_LOW_SPEC
    // single region per pixel, dithered only inside the ribbon (fog hides the grain)
    float dth = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    palMix = step(dth, smoothstep(0.44, 0.56, t));
#else
    palMix = smoothstep(0.44, 0.56, t);
#endif
  }
  // palette weights: region A main / alt, region B main / alt
  float palW[4] = float[4]((1.0 - palMix) * (1.0 - vA), (1.0 - palMix) * vA, palMix * (1.0 - vB), palMix * vB);
  int palI[4] = int[4](2 * regA, 2 * regA + 1, 2 * regB, 2 * regB + 1);

  // ---- slot entries of the palettes, merged by layer -----------------------
  int eL[DM_ENTRIES];
  float eW[DM_ENTRIES];
  bool eFloor[DM_ENTRIES];
  int ne = 0;
  float sideSum = 0.0;
  for (int k = 0; k < 20; k++) {
    int slot = k - 5 * (k / 5);
    float w = palW[k / 5] * slotW[slot];
    if (w <= 0.0) continue;
    int pi = palI[k / 5];
    int L = int((slot < 4 ? uPal[pi][slot] : uPalC[pi].x) + 0.5);
    bool isFloor = slot < 2;
    if (!isFloor) sideSum += w;
    bool merged = false;
    for (int i = 0; i < DM_ENTRIES; i++) {
      if (i >= ne) break;
      if (eL[i] == L && eFloor[i] == isFloor) { eW[i] += w; merged = true; break; }
    }
    if (!merged && ne < DM_ENTRIES) { eL[ne] = L; eW[ne] = w; eFloor[ne] = isFloor; ne++; }
  }
  // side projections show walls / ceiling; where those fade out (gentle floor
  // slopes) the floor layers fade in there instead (continuous: no seam line)
  float floorSide = 1.0 - smoothstep(0.0, 0.08, sideSum);

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

  // ---- albedo + packed normals, only for entries / axes that contribute ---
  vec3 aX = vec3(0.0), aY = vec3(0.0), aZ = vec3(0.0);
  vec4 nX4 = vec4(0.0), nY4 = vec4(0.0), nZ4 = vec4(0.0);
  float sY = 0.0, sX = 0.0, sZ = 0.0;
  for (int i = 0; i < DM_ENTRIES; i++) {
    if (i >= ne) break;
    float w = eW[i];
    vec3 a;
    vec4 n;
    if (bw.y > 0.0) {
      dmSampleLayer(eL[i], uvY, gYx, gYy, rMix, a, n);
      aY += a * w; nY4 += n * w; sY += w;
    }
    float ws = eFloor[i] ? w * floorSide : w;
    if (ws <= 0.0) continue;
    if (bw.x > 0.0) {
      dmSampleLayer(eL[i], uvX, gXx, gXy, rMix, a, n);
      aX += a * ws; nX4 += n * ws; sX += ws;
    }
    if (bw.z > 0.0) {
      dmSampleLayer(eL[i], uvZ, gZx, gZy, rMix, a, n);
      aZ += a * ws; nZ4 += n * ws; sZ += ws;
    }
  }
  aY /= max(sY, 1e-4); nY4 /= max(sY, 1e-4);
  aX /= max(sX, 1e-4); nX4 /= max(sX, 1e-4);
  aZ /= max(sZ, 1e-4); nZ4 /= max(sZ, 1e-4);
  vec3 albedo = aX * bw.x + aY * bw.y + aZ * bw.z;
`;
