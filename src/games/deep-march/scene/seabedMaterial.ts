/**
 * Seabed terrain material: MeshStandardMaterial extended via onBeforeCompile.
 *
 * - World-space triplanar mapping (blend = |n|^4) for four CC0 PBR sets
 *   (see ../assets/CREDITS.md): rippled sand, gravel, rock, mossy rock.
 * - Triplanar normal mapping with whiteout blend; roughness from the packed
 *   normal texture's blue channel.
 * - Material weights from slope (up-facing → sand/gravel, steep → rock/moss,
 *   overhangs → dark cave rock), height and world-space noise; macro colour
 *   variation + a second, rotated sampling scale on rock to hide tiling.
 * - Per-vertex AO attribute (from the mesher), animated caustics from above.
 * - Water for a vast scale (replaces three's fog): blue-green absorption over the
 *   first tens of units, then in-scattering haze toward a *darker* version of the
 *   water colour behind the surface (WATER_GLSL: bright above, black below), so
 *   distant masses read as dark silhouettes that resolve as the diver approaches;
 *   in the last stretch before the view distance everything fades into the open
 *   water colour itself (no popping at the LOD edge). The background dome
 *   (world.ts) draws the same water colour.
 */
import * as THREE from "three";

import sandAlb1024 from "../assets/sand_albedo_1024.webp?url";
import sandNrm1024 from "../assets/sand_nrm_1024.webp?url";
import gravelAlb1024 from "../assets/gravel_albedo_1024.webp?url";
import gravelNrm1024 from "../assets/gravel_nrm_1024.webp?url";
import rockAlb1024 from "../assets/rock_albedo_1024.webp?url";
import rockNrm1024 from "../assets/rock_nrm_1024.webp?url";
import mossAlb1024 from "../assets/moss_albedo_1024.webp?url";
import mossNrm1024 from "../assets/moss_nrm_1024.webp?url";
import sandAlb512 from "../assets/sand_albedo_512.webp?url";
import sandNrm512 from "../assets/sand_nrm_512.webp?url";
import gravelAlb512 from "../assets/gravel_albedo_512.webp?url";
import gravelNrm512 from "../assets/gravel_nrm_512.webp?url";
import rockAlb512 from "../assets/rock_albedo_512.webp?url";
import rockNrm512 from "../assets/rock_nrm_512.webp?url";
import mossAlb512 from "../assets/moss_albedo_512.webp?url";
import mossNrm512 from "../assets/moss_nrm_512.webp?url";

const URLS = {
  1024: {
    sand: [sandAlb1024, sandNrm1024],
    gravel: [gravelAlb1024, gravelNrm1024],
    rock: [rockAlb1024, rockNrm1024],
    moss: [mossAlb1024, mossNrm1024],
  },
  512: {
    sand: [sandAlb512, sandNrm512],
    gravel: [gravelAlb512, gravelNrm512],
    rock: [rockAlb512, rockNrm512],
    moss: [mossAlb512, mossNrm512],
  },
} as const;

/** Shared water / haze uniforms (terrain material + background dome). Colours are linear. */
export type WaterUniforms = {
  uWaterTop: { value: THREE.Color };
  uWaterHorizon: { value: THREE.Color };
  uWaterBottom: { value: THREE.Color };
  /** In-scattering density per unit (haze = 1 − exp(−d·uHaze)). */
  uHaze: { value: number };
  /** Silhouette brightness relative to the open water behind (≤ 1). */
  uSil: { value: number };
  /** View distance: fade into the open water over the last 28 %. */
  uFar: { value: number };
};

/** Open-water colour seen along a view direction (bright toward the surface, black below). */
export const WATER_GLSL = /* glsl */ `
uniform vec3 uWaterTop; uniform vec3 uWaterHorizon; uniform vec3 uWaterBottom;
uniform float uHaze; uniform float uSil; uniform float uFar;
vec3 dmWater(vec3 dir) {
  float y = dir.y;
  return y >= 0.0 ? mix(uWaterHorizon, uWaterTop, pow(y, 0.8)) : mix(uWaterHorizon, uWaterBottom, pow(-y, 0.55));
}
`;

export function createWaterUniforms(horizon: THREE.Color, far: number): WaterUniforms {
  return {
    uWaterTop: { value: horizon.clone().multiplyScalar(2.1) },
    uWaterHorizon: { value: horizon.clone() },
    uWaterBottom: { value: horizon.clone().multiplyScalar(0.06) },
    uHaze: { value: 0.012 },
    uSil: { value: 0.38 },
    uFar: { value: far },
  };
}

export type SeabedOptions = {
  lowSpec: boolean;
  /** Shared water uniforms (createWaterUniforms). */
  water: WaterUniforms;
  /** World scale (terrain shapes are this much larger than the base design). */
  worldScale: number;
  anisotropy: number;
  /** Called when all textures finished loading (or failed). */
  onReady?: () => void;
};

export type SeabedMaterial = {
  material: THREE.MeshStandardMaterial;
  update: (time: number) => void;
  dispose: () => void;
};

const DECLS = /* glsl */ `
uniform float uWS;
uniform sampler2D tSandA; uniform sampler2D tSandN;
uniform sampler2D tGravelA; uniform sampler2D tGravelN;
uniform sampler2D tRockA; uniform sampler2D tRockN;
uniform sampler2D tMossA; uniform sampler2D tMossN;
uniform float uTime;
uniform vec3 uAbsorb;
uniform vec3 uCausticColor;
uniform vec3 uCeilingTint;
varying vec3 vWPos;
varying vec3 vWNrm;
varying float vAO;

float dmHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float dmNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dmHash(i + vec3(0, 0, 0)), dmHash(i + vec3(1, 0, 0)), f.x),
                 mix(dmHash(i + vec3(0, 1, 0)), dmHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(dmHash(i + vec3(0, 0, 1)), dmHash(i + vec3(1, 0, 1)), f.x),
                 mix(dmHash(i + vec3(0, 1, 1)), dmHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
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
`;

const MAP_FRAGMENT = /* glsl */ `
  vec3 wp = vWPos;
  // Smooth (field-gradient) normal drives projection and material choice so
  // rock reads rounded; the flat facet normal is only a fallback where the two
  // truly disagree (grazing / sub-voxel features), never a per-triangle switch.
  vec3 geoN = normalize(cross(dFdx(wp), dFdy(wp)));
  if (dot(geoN, cameraPosition - wp) < 0.0) geoN = -geoN;
  vec3 wn = normalize(vWNrm);
  float nAgree = dot(wn, geoN);
  wn = normalize(mix(geoN, wn, smoothstep(-0.15, 0.25, nAgree)));
  vec3 bn = wn;
  vec3 bw = pow(abs(bn), vec3(4.0));
  bw /= (bw.x + bw.y + bw.z);
  vec3 axisSign = vec3(bn.x < 0.0 ? -1.0 : 1.0, bn.y < 0.0 ? -1.0 : 1.0, bn.z < 0.0 ? -1.0 : 1.0);

  // ---- material weights -------------------------------------------------
  float up = wn.y;
  float nA = dmFbm(wp * 0.07);          // large patches
  float nB = dmFbm(wp * 0.23 + 31.0);   // medium breakup
  float floorW = smoothstep(0.45, 0.8, up + (nB - 0.5) * 0.25);
  float ceilW = smoothstep(-0.25, -0.65, up);
  float wallW = max(0.0, 1.0 - floorW - ceilW);
  // gravel collects in low spots and near walls, sand on open flats
  float gravelMask = smoothstep(0.42, 0.62, nA + (1.0 - floorW) * 0.15 - (wp.y / uWS - 2.0) * 0.015);
  // moss / algae on gently sloped, lit rock and ledges, patchy
  float mossMask = smoothstep(0.45, 0.7, nB * 0.7 + nA * 0.3 + up * 0.35) * (1.0 - ceilW);
  float wSand = floorW * (1.0 - gravelMask);
  float wGravel = floorW * gravelMask;
  float wMoss = wallW * mossMask;
  float wRock = wallW * (1.0 - mossMask) + ceilW;

  // ---- UVs (units → texture repeats) ------------------------------------
  vec2 uvX = vec2(wp.z * axisSign.x, wp.y);
  vec2 uvY = vec2(wp.x * axisSign.y, wp.z);
  vec2 uvZ = vec2(-wp.x * axisSign.z, wp.y);
  const float SAND_S = 1.0 / 3.2;
  const float GRAVEL_S = 1.0 / 2.2;
  const float ROCK_S = 1.0 / 5.5;
  const float MOSS_S = 1.0 / 4.0;

  // sand + gravel: floors only → top projection
  vec4 sA = texture2D(tSandA, uvY * SAND_S);
  vec4 sN = texture2D(tSandN, uvY * SAND_S);
  vec4 gA = texture2D(tGravelA, uvY * GRAVEL_S);
  vec4 gN = texture2D(tGravelN, uvY * GRAVEL_S);
  // rock + moss: full triplanar
  vec4 rAx = texture2D(tRockA, uvX * ROCK_S), rAy = texture2D(tRockA, uvY * ROCK_S), rAz = texture2D(tRockA, uvZ * ROCK_S);
  vec4 rNx = texture2D(tRockN, uvX * ROCK_S), rNy = texture2D(tRockN, uvY * ROCK_S), rNz = texture2D(tRockN, uvZ * ROCK_S);
  vec4 mAx = texture2D(tMossA, uvX * MOSS_S), mAy = texture2D(tMossA, uvY * MOSS_S), mAz = texture2D(tMossA, uvZ * MOSS_S);
  vec4 mNx = texture2D(tMossN, uvX * MOSS_S), mNy = texture2D(tMossN, uvY * MOSS_S), mNz = texture2D(tMossN, uvZ * MOSS_S);
#ifndef DM_LOW_SPEC
  // second, rotated scale on rock albedo, blended by noise, to break repetition
  float rMix = smoothstep(0.35, 0.65, dmNoise(wp * 0.11 + 5.0));
  rAx = mix(rAx, texture2D(tRockA, dmRot(uvX) * ROCK_S * 0.43 + 0.37), rMix);
  rAy = mix(rAy, texture2D(tRockA, dmRot(uvY) * ROCK_S * 0.43 + 0.37), rMix);
  rAz = mix(rAz, texture2D(tRockA, dmRot(uvZ) * ROCK_S * 0.43 + 0.37), rMix);
#endif

  // ---- albedo -------------------------------------------------------------
  float sideRM = wRock + wMoss + 1e-4;
  // sand/gravel exist only on the Y projection; their share of X/Z goes to rock/moss
  vec3 aY = sA.rgb * vec3(0.5, 0.49, 0.44) * wSand + gA.rgb * wGravel + rAy.rgb * wRock + mAy.rgb * wMoss;
  vec3 aX = (rAx.rgb * wRock + mAx.rgb * wMoss) / sideRM;
  vec3 aZ = (rAz.rgb * wRock + mAz.rgb * wMoss) / sideRM;
  float wSum = wSand + wGravel + wRock + wMoss;
  aY /= wSum;
  vec3 albedo = aX * bw.x + aY * bw.y + aZ * bw.z;

  // tone the photo sets toward a cohesive underwater palette
  float luma = dot(albedo, vec3(0.299, 0.587, 0.114));
  albedo = mix(vec3(luma), albedo, 0.72);                       // desaturate a bit
  albedo *= mix(vec3(1.0), uCeilingTint, ceilW);                 // dark cave ceiling
  albedo *= mix(0.72, 1.12, dmFbm(wp * (0.035 / uWS) + 71.0));   // macro variation (scales with the world)
  albedo *= mix(0.85, 1.08, dmFbm(wp * 0.05 + 13.0));            // and at the diver's scale
  albedo *= mix(vec3(1.0), vec3(0.86, 0.95, 0.9), smoothstep(0.4, 0.8, nA) * floorW); // silt tint
  albedo *= mix(0.62, 1.0, smoothstep(-24.0 * uWS, 6.0 * uWS, wp.y)); // deeper = darker sediment
  diffuseColor.rgb *= albedo;

  // ---- normals (whiteout triplanar) + roughness --------------------------
  vec4 nY4 = (sN * wSand + gN * wGravel + rNy * wRock + mNy * wMoss) / wSum;
  vec4 nX4 = (rNx * wRock + mNx * wMoss) / sideRM;
  vec4 nZ4 = (rNz * wRock + mNz * wMoss) / sideRM;
  vec3 tnX = dmUnpack(nX4);
  vec3 tnY = dmUnpack(nY4);
  vec3 tnZ = dmUnpack(nZ4);
  tnX.x *= axisSign.x;
  tnY.x *= axisSign.y;
  tnZ.x *= -axisSign.z;
  tnX = vec3(tnX.xy + wn.zy, abs(tnX.z) * wn.x);
  tnY = vec3(tnY.xy + wn.xz, abs(tnY.z) * wn.y);
  tnZ = vec3(tnZ.xy + wn.xy, abs(tnZ.z) * wn.z);
  vec3 dmWorldNormal = normalize(tnX.zyx * bw.x + tnY.xzy * bw.y + tnZ.xyz * bw.z);
  float dmRough = nX4.b * bw.x + nY4.b * bw.y + nZ4.b * bw.z;
`;

export function createSeabedMaterial(opts: SeabedOptions): SeabedMaterial {
  const size = opts.lowSpec ? 512 : 1024;
  const urls = URLS[size];
  const loader = new THREE.TextureLoader();
  const textures: THREE.Texture[] = [];
  let pending = 8;
  const done = () => {
    pending--;
    if (pending === 0) opts.onReady?.();
  };
  const load = (url: string, srgb: boolean) => {
    const t = loader.load(url, done, undefined, done);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = opts.anisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    textures.push(t);
    return t;
  };

  const uniforms = {
    tSandA: { value: load(urls.sand[0], true) },
    tSandN: { value: load(urls.sand[1], false) },
    tGravelA: { value: load(urls.gravel[0], true) },
    tGravelN: { value: load(urls.gravel[1], false) },
    tRockA: { value: load(urls.rock[0], true) },
    tRockN: { value: load(urls.rock[1], false) },
    tMossA: { value: load(urls.moss[0], true) },
    tMossN: { value: load(urls.moss[1], false) },
    uTime: { value: 0 },
    // per-unit absorption (red goes first) — close surfaces keep true colour
    uAbsorb: { value: new THREE.Vector3(0.06, 0.024, 0.014) },
    uCausticColor: { value: new THREE.Color(0.55, 0.85, 0.95).multiplyScalar(0.55) },
    uCeilingTint: { value: new THREE.Color(0.55, 0.58, 0.64) },
    uWS: { value: opts.worldScale },
    ...opts.water,
  };

  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  material.fog = false; // own water model (see header)
  material.defines = opts.lowSpec ? { DM_LOW_SPEC: "" } : {};
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float ao;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\nvarying float vAO;",
      )
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vWNrm = normalize(mat3(modelMatrix) * objectNormal);\n  vAO = ao;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + DECLS + WATER_GLSL)
      .replace("#include <map_fragment>", MAP_FRAGMENT)
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = clamp(mix(0.55, 1.0, dmRough), 0.3, 1.0);")
      .replace(
        "#include <normal_fragment_maps>",
        "normal = normalize((viewMatrix * vec4(dmWorldNormal, 0.0)).xyz);",
      )
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `#include <emissivemap_fragment>
  {
    // caustics from the surface above: on up-facing surfaces, fading with distance
    float camDist = length(vWPos - cameraPosition);
    float facing = pow(clamp(dmWorldNormal.y, 0.0, 1.0), 1.5);
    float c = dmCaustics(vWPos.xz * 0.42, uTime * 0.9);
    float fade = (1.0 - smoothstep(10.0, 30.0, camDist)) * smoothstep(-10.0 * uWS, 4.0 * uWS, vWPos.y);
    totalEmissiveRadiance += diffuseColor.rgb * uCausticColor * c * facing * fade * mix(0.4, 1.0, vAO);
  }`,
      )
      .replace(
        "#include <lights_fragment_end>",
        /* glsl */ `#include <lights_fragment_end>
  {
    float occ = clamp(vAO, 0.0, 1.0);
    reflectedLight.indirectDiffuse *= occ * occ;
    reflectedLight.directDiffuse *= mix(0.55, 1.0, occ);
  }`,
      )
      .replace(
        "#include <opaque_fragment>",
        /* glsl */ `{
    vec3 dv = vWPos - cameraPosition;
    float dist = length(dv);
    vec3 dir = dv / max(dist, 1e-4);
    vec3 water = dmWater(dir);
    // absorption (red first) over the near range, then haze toward the silhouette tone
    outgoingLight *= exp(-uAbsorb * min(dist, 28.0));
    float haze = 1.0 - exp(-dist * uHaze);
    // silhouette tone: darkest in the middle distance, lifting toward the open water far
    // away, so masses emerge as faint shadows, darken into silhouettes, then resolve
    float sil = mix(uSil, 1.0, smoothstep(uFar * 0.22, uFar * 0.95, dist));
    outgoingLight = mix(outgoingLight, water * sil, haze);
    outgoingLight = mix(outgoingLight, water, smoothstep(uFar * 0.8, uFar, dist));
  }
  #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `deep-march-seabed-${opts.lowSpec ? "lo" : "hi"}`;

  return {
    material,
    update: (time) => {
      uniforms.uTime.value = time;
    },
    dispose: () => {
      textures.forEach((t) => t.dispose());
      material.dispose();
    },
  };
}
