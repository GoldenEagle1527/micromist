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
 * - Per-vertex AO attribute (from the mesher), animated caustics from above,
 *   blue-green absorption with distance before the regular fog.
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

export type SeabedOptions = {
  lowSpec: boolean;
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
  // geometric (flat) normal: terrace steps are real geometry, and the smooth
  // field normal can disagree there → use the facet for projection weights
  vec3 geoN = normalize(cross(dFdx(wp), dFdy(wp)));
  if (dot(geoN, cameraPosition - wp) < 0.0) geoN = -geoN;
  vec3 wn = normalize(vWNrm);
  float nAgree = dot(wn, geoN);
  wn = normalize(mix(geoN, wn, smoothstep(0.1, 0.5, nAgree)));
  vec3 bn = normalize(mix(geoN, wn, 0.4));
  vec3 bw = pow(abs(bn), vec3(4.0));
  bw /= (bw.x + bw.y + bw.z);
  vec3 axisSign = vec3(bn.x < 0.0 ? -1.0 : 1.0, bn.y < 0.0 ? -1.0 : 1.0, bn.z < 0.0 ? -1.0 : 1.0);

  // ---- material weights -------------------------------------------------
  float up = min(wn.y, bn.y + 0.15);
  float nA = dmFbm(wp * 0.07);          // large patches
  float nB = dmFbm(wp * 0.23 + 31.0);   // medium breakup
  float floorW = smoothstep(0.45, 0.8, up + (nB - 0.5) * 0.25);
  float ceilW = smoothstep(-0.25, -0.65, up);
  float wallW = max(0.0, 1.0 - floorW - ceilW);
  // gravel collects in low spots and near walls, sand on open flats
  float gravelMask = smoothstep(0.42, 0.62, nA + (1.0 - floorW) * 0.15 - (wp.y - 2.0) * 0.015);
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
  albedo *= mix(0.72, 1.12, dmFbm(wp * 0.035 + 71.0));           // macro variation
  albedo *= mix(vec3(1.0), vec3(0.86, 0.95, 0.9), smoothstep(0.4, 0.8, nA) * floorW); // silt tint
  albedo *= mix(0.8, 1.0, smoothstep(-8.0, 6.0, wp.y));          // deeper = darker sediment
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
    uAbsorb: { value: new THREE.Vector3(0.075, 0.03, 0.018) },
    uCausticColor: { value: new THREE.Color(0.55, 0.85, 0.95).multiplyScalar(0.55) },
    uCeilingTint: { value: new THREE.Color(0.55, 0.58, 0.64) },
  };

  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
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
      .replace("#include <common>", "#include <common>\n" + DECLS)
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
    float fade = (1.0 - smoothstep(10.0, 30.0, camDist)) * smoothstep(-10.0, 4.0, vWPos.y);
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
        "#include <fog_fragment>",
        /* glsl */ `{
    float dist = length(vWPos - cameraPosition);
    gl_FragColor.rgb *= exp(-uAbsorb * dist);
  }
  #include <fog_fragment>`,
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
