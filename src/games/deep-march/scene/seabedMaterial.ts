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
import { BEAM_DECLS, BEAM_LIGHT, BEAM_OPAQUE, type BeamUniforms } from "./highBeam";
import { PL_DECLS, PL_LIGHT, type ParticleLightUniforms } from "./particleLight";

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
  /** High-beam (fog-light) uniforms, see highBeam.ts. */
  beam: BeamUniforms;
  /** Fluorescent-plankton point lights, see particleLight.ts. */
  particleLights: ParticleLightUniforms;
  /** Called when all textures finished loading (or failed). */
  onReady?: () => void;
};

export type SeabedMaterial = {
  material: THREE.MeshStandardMaterial;
  /** Live per-unit absorption (scaled by night vision). */
  absorb: THREE.Vector3;
  /** Scales surface-borne light that isn't from a light object (caustics); 0 = total darkness. */
  envLight: { value: number };
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
uniform float uEnvLight;
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
// Explicit-gradient fetch (see MAP_FRAGMENT): uv·s with derivatives d·s.
#define DM_TG(t, uv, s, dx, dy) textureGrad(t, (uv) * (s), (dx) * (s), (dy) * (s))
// Rock albedo with the rotated second scale mixed in by m (fetches skipped at m = 0 / 1).
vec3 dmRockA(vec2 uv, vec2 dx, vec2 dy, float m) {
  const float S = 1.0 / 5.5;
  const float SR = S * 0.43;
  vec3 a = vec3(0.0), b = vec3(0.0);
  if (m < 1.0) a = textureGrad(tRockA, uv * S, dx * S, dy * S).rgb;
  if (m > 0.0) b = textureGrad(tRockA, dmRot(uv) * SR + 0.37, dmRot(dx) * SR, dmRot(dy) * SR).rgb;
  return mix(a, b, m);
}

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
  // Negligible projection axes drop to exactly 0 (continuous remap + renormalise)
  // so their texture fetches can be skipped below.
  bw = max(bw - 0.02, 0.0);
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
  // Screen-space UV derivatives taken here, in uniform control flow: the fetches
  // below sit in branches (skipped layers / axes), where implicit derivatives would
  // be undefined and pick wrong mips along branch borders (thin seams).
  vec2 gXx = dFdx(uvX), gXy = dFdy(uvX);
  vec2 gYx = dFdx(uvY), gYy = dFdy(uvY);
  vec2 gZx = dFdx(uvZ), gZy = dFdy(uvZ);
  const float SAND_S = 1.0 / 3.2;
  const float GRAVEL_S = 1.0 / 2.2;
  const float ROCK_S = 1.0 / 5.5;
  const float MOSS_S = 1.0 / 4.0;
  const float ROT_S = ROCK_S * 0.43;
#ifndef DM_LOW_SPEC
  // second, rotated scale on rock albedo, blended by noise, to break repetition
  float rMix = smoothstep(0.35, 0.65, dmNoise(wp * 0.11 + 5.0));
#else
  float rMix = 0.0;
#endif

  // ---- albedo + packed normals, only for layers / axes that contribute -----
  float sideRM = wRock + wMoss + 1e-4;
  float wSum = wSand + wGravel + wRock + wMoss;
  vec3 aX = vec3(0.0), aY = vec3(0.0), aZ = vec3(0.0);
  vec4 nX4 = vec4(0.0), nY4 = vec4(0.0), nZ4 = vec4(0.0);
  // sand + gravel: floors only → top projection; sand/gravel exist only on the Y
  // projection, their share of X/Z goes to rock/moss
  if (bw.y > 0.0) {
    if (wSand > 0.0) {
      aY += DM_TG(tSandA, uvY, SAND_S, gYx, gYy).rgb * vec3(0.5, 0.49, 0.44) * wSand;
      nY4 += DM_TG(tSandN, uvY, SAND_S, gYx, gYy) * wSand;
    }
    if (wGravel > 0.0) {
      aY += DM_TG(tGravelA, uvY, GRAVEL_S, gYx, gYy).rgb * wGravel;
      nY4 += DM_TG(tGravelN, uvY, GRAVEL_S, gYx, gYy) * wGravel;
    }
    if (wRock > 0.0) {
      aY += dmRockA(uvY, gYx, gYy, rMix) * wRock;
      nY4 += DM_TG(tRockN, uvY, ROCK_S, gYx, gYy) * wRock;
    }
    if (wMoss > 0.0) {
      aY += DM_TG(tMossA, uvY, MOSS_S, gYx, gYy).rgb * wMoss;
      nY4 += DM_TG(tMossN, uvY, MOSS_S, gYx, gYy) * wMoss;
    }
    aY /= wSum;
    nY4 /= wSum;
  }
  if (bw.x > 0.0) {
    if (wRock > 0.0) {
      aX += dmRockA(uvX, gXx, gXy, rMix) * wRock;
      nX4 += DM_TG(tRockN, uvX, ROCK_S, gXx, gXy) * wRock;
    }
    if (wMoss > 0.0) {
      aX += DM_TG(tMossA, uvX, MOSS_S, gXx, gXy).rgb * wMoss;
      nX4 += DM_TG(tMossN, uvX, MOSS_S, gXx, gXy) * wMoss;
    }
    aX /= sideRM;
    nX4 /= sideRM;
  }
  if (bw.z > 0.0) {
    if (wRock > 0.0) {
      aZ += dmRockA(uvZ, gZx, gZy, rMix) * wRock;
      nZ4 += DM_TG(tRockN, uvZ, ROCK_S, gZx, gZy) * wRock;
    }
    if (wMoss > 0.0) {
      aZ += DM_TG(tMossA, uvZ, MOSS_S, gZx, gZy).rgb * wMoss;
      nZ4 += DM_TG(tMossN, uvZ, MOSS_S, gZx, gZy) * wMoss;
    }
    aZ /= sideRM;
    nZ4 /= sideRM;
  }
  vec3 albedo = aX * bw.x + aY * bw.y + aZ * bw.z;

  // tone the photo sets toward a cohesive underwater palette
  float luma = dot(albedo, vec3(0.299, 0.587, 0.114));
  albedo = mix(vec3(luma), albedo, 0.72);                       // desaturate a bit
  albedo *= mix(vec3(1.0), uCeilingTint, ceilW);                 // dark cave ceiling
  albedo *= mix(0.72, 1.12, dmFbm(wp * (0.035 / uWS) + 71.0));  // macro variation (scales with the world)
  albedo *= mix(0.85, 1.08, dmFbm(wp * 0.05 + 13.0));           // and at the diver's scale
  albedo *= mix(vec3(1.0), vec3(0.86, 0.95, 0.9), smoothstep(0.4, 0.8, nA) * floorW); // silt tint
  albedo *= mix(0.62, 1.0, smoothstep(-24.0 * uWS, 6.0 * uWS, wp.y)); // deeper = darker sediment
  diffuseColor.rgb *= albedo;

  // ---- normals (whiteout triplanar) + roughness --------------------------
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
    ...opts.beam,
    ...opts.particleLights,
    uEnvLight: { value: 1 },
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
      .replace("#include <common>", "#include <common>\n" + DECLS + WATER_GLSL + BEAM_DECLS + PL_DECLS)
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
    totalEmissiveRadiance += diffuseColor.rgb * uCausticColor * c * facing * fade * mix(0.4, 1.0, vAO) * uEnvLight;
  }`,
      )
      .replace(
        "#include <lights_fragment_end>",
        /* glsl */ `#include <lights_fragment_end>
  {
    float occ = clamp(vAO, 0.0, 1.0);
    reflectedLight.indirectDiffuse *= occ * occ;
    reflectedLight.directDiffuse *= mix(0.55, 1.0, occ);
  }
${BEAM_LIGHT}
${PL_LIGHT}`,
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
${BEAM_OPAQUE}    outgoingLight = mix(outgoingLight, water, smoothstep(uFar * 0.8, uFar, dist));
  }
  #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `deep-march-seabed-${opts.lowSpec ? "lo" : "hi"}`;

  return {
    material,
    absorb: uniforms.uAbsorb.value,
    envLight: uniforms.uEnvLight,
    update: (time) => {
      uniforms.uTime.value = time;
    },
    dispose: () => {
      textures.forEach((t) => t.dispose());
      material.dispose();
    },
  };
}
