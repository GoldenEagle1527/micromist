/**
 * Shared GLSL declarations of the seabed terrain material (seabedShader.ts):
 * precision macros (DM_P / DM_M), common uniforms / varyings, hash / value noise /
 * fbm, normal unpack, caustics, then the multi-material declarations (MAT_DECLS).
 */
import { MAT_DECLS } from "./materialShader";

export const DECLS = /* glsl */ `
// Explicit precision for every array type (DM_P = the renderer's float precision,
// three's HIGH_ / MEDIUM_PRECISION): Mali's native compiler (behind ANGLE) doesn't
// apply the default precision to some array types (S0032, see materialShader.ts).
#ifndef DM_P
#if defined(HIGH_PRECISION) || !defined(MEDIUM_PRECISION)
#define DM_P highp
#else
#define DM_P mediump
#endif
#endif
// Reduced precision for material weights, colours and normal sums (materialShader.ts):
// mediump unless three itself runs at lowp. World positions, UVs and derivatives keep
// the default precision. Desktop GPUs evaluate mediump as fp32 (no change there).
#ifndef DM_M
#ifdef LOW_PRECISION
#define DM_M lowp
#else
#define DM_M mediump
#endif
#endif
uniform float uWS;
uniform float uTime;
uniform vec3 uAbsorb;
uniform vec3 uCausticColor;
uniform vec3 uCeilingTint;
uniform float uEnvLight;
varying vec3 vWPos;
varying vec3 vWNrm;
varying float vAO;

float dmHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
// Value noise on dmHash lattice values. dmHash's first steps (fract(p / pi + c) * 17)
// act per axis, so the 8 corners share only two values per axis (i, i + 1): computed
// once here with the same arithmetic, the result is identical to hashing each corner.
float dmNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  vec3 a = fract(i * 0.3183099 + vec3(0.1, 0.2, 0.3)) * 17.0;
  vec3 b = fract((i + 1.0) * 0.3183099 + vec3(0.1, 0.2, 0.3)) * 17.0;
  // dmHash = fract(x*y*z*(x + y + z)), same operation order
  float p00 = a.x * a.y, p10 = b.x * a.y, p01 = a.x * b.y, p11 = b.x * b.y;
  float s00 = a.x + a.y, s10 = b.x + a.y, s01 = a.x + b.y, s11 = b.x + b.y;
  return mix(mix(mix(fract(p00 * a.z * (s00 + a.z)), fract(p10 * a.z * (s10 + a.z)), f.x),
                 mix(fract(p01 * a.z * (s01 + a.z)), fract(p11 * a.z * (s11 + a.z)), f.x), f.y),
             mix(mix(fract(p00 * b.z * (s00 + b.z)), fract(p10 * b.z * (s10 + b.z)), f.x),
                 mix(fract(p01 * b.z * (s01 + b.z)), fract(p11 * b.z * (s11 + b.z)), f.x), f.y), f.z);
}
float dmFbm(vec3 p) {
  return 0.55 * dmNoise(p) + 0.3 * dmNoise(p * 2.03 + 11.7) + 0.15 * dmNoise(p * 4.1 + 3.1);
}
vec3 dmUnpack(vec4 t) {
  vec2 xy = t.xy * 2.0 - 1.0;
  return vec3(xy, sqrt(clamp(1.0 - dot(xy, xy), 0.0, 1.0)));
}
vec2 dmRot(vec2 uv) { return mat2(0.8, -0.6, 0.6, 0.8) * uv; }
vec2 dmHash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
// Animated Worley-edge caustic layer: bright where two cells meet.
float dmCausticLayer(vec2 p, float t) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = dmHash2(i + g);
      o = 0.5 + 0.42 * sin(t + 6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  float e = sqrt(f2) - sqrt(f1);
  return 1.0 - smoothstep(0.0, 0.18, e);
}
float dmCaustics(vec2 p, float t) {
  vec2 warp = vec2(dmNoise(vec3(p * 0.35, t * 0.2)), dmNoise(vec3(p * 0.35 + 7.3, t * 0.2))) - 0.5;
  float a = dmCausticLayer(p * 0.9 + warp * 1.2, t * 0.9);
#ifdef DM_LOW_SPEC
  return a * a;
#else
  float b = dmCausticLayer(dmRot(p) * 1.3 - warp, -t * 0.7 + 2.0);
  return a * a * 0.7 + a * b * 0.8;
#endif
}
${MAT_DECLS}`;
