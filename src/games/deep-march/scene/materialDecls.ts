/**
 * GLSL declarations of the multi-material seabed (materialShader.ts): the region
 * weight attributes / varyings, the texture-array and palette uniforms, and the
 * layer sampling / accumulation / projection helpers MAT_FRAGMENT calls.
 * Needs DECLS (dmRot, DM_P / DM_M) first.
 */
import { LAYER_COUNT, PALETTE_COUNT } from "./materialCatalog";
import { TOP3_GLSL } from "./materialSelect";

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
