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
 * - Detail normal (detailNormal.ts): world-space ridged creases at 2 scales stand in
 *   for sub-metre relief, plus a little facet normal on rock (?detail=0 = off).
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

import { loadSeabedTextures } from "./seabedTextures";
import { DETAIL_GLSL } from "./detailNormal";
import { DECLS, MAP_FRAGMENT, WATER_GLSL } from "./seabedShader";

export { WATER_GLSL };

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
  /** For KTX2 transcoder format detection. */
  renderer: THREE.WebGLRenderer;
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
  /** Shader detail normal (detailNormal.ts); false = ?detail=0. Default true. */
  detail?: boolean;
  /** Called when all textures finished loading (or failed). */
  onReady?: () => void;
};

export type LodFadeMaterial = { material: THREE.Material; fade: THREE.Vector2 };

export type SeabedMaterial = {
  material: THREE.MeshStandardMaterial;
  /** Live per-unit absorption (scaled by night vision). */
  absorb: THREE.Vector3;
  /** Scales surface-borne light that isn't from a light object (caustics); 0 = total darkness. */
  envLight: { value: number };
  /**
   * A new LOD-crossfade variant of the material (same look and program family,
   * screen-door dither by its own `fade`: x = progress 0..1, y = +1 fading in /
   * −1 fading out). See chunks.ts.
   */
  fadeMaterial: () => LodFadeMaterial;
  update: (time: number) => void;
  dispose: () => void;
};

export function createSeabedMaterial(opts: SeabedOptions): SeabedMaterial {
  const tex = loadSeabedTextures(opts.renderer, opts.lowSpec ? 512 : 1024, opts.anisotropy, () => opts.onReady?.());

  const uniforms = {
    ...tex.uniforms,
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

  const patch = (shader: THREE.WebGLProgramParametersWithUniforms, extra: Record<string, THREE.IUniform>) => {
    Object.assign(shader.uniforms, uniforms, extra);
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
      .replace("#include <common>", "#include <common>\n" + DECLS + DETAIL_GLSL + WATER_GLSL + BEAM_DECLS + PL_DECLS)
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
    // (skipped entirely where it can't show: beyond 30 m, deep water, down-facing, lights off)
    float camDist = length(vWPos - cameraPosition);
    float facing = pow(clamp(dmWorldNormal.y, 0.0, 1.0), 1.5);
    float fade = (1.0 - smoothstep(10.0, 30.0, camDist)) * smoothstep(-10.0 * uWS, 4.0 * uWS, vWPos.y);
    float k = facing * fade * uEnvLight;
    if (k > 0.0) {
      float c = dmCaustics(vWPos.xz * 0.42, uTime * 0.9);
      totalEmissiveRadiance += diffuseColor.rgb * uCausticColor * c * k * mix(0.4, 1.0, vAO);
    }
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
      )
      .replace(
        "#include <dithering_fragment>",
        /* glsl */ `#include <dithering_fragment>
#ifdef DM_LOD_FADE
  {
    // LOD crossfade (screen-door): the incoming column keeps the pixels whose
    // threshold is below the progress, the outgoing one exactly the others, so
    // every pixel shows one of the two. Decided after shading, so the screen-space
    // derivatives above stay defined for every pixel of the quad.
    float d = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (uLodFade.y > 0.0 ? d >= uLodFade.x : d < uLodFade.x) discard;
  }
#endif`,
      );
    if (extra.uLodFade) shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec2 uLodFade;");
  };
  const detail = opts.detail !== false;
  const make = (fade: { value: THREE.Vector2 } | null) => {
    const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    m.fog = false; // own water model (see header)
    m.defines = { ...(opts.lowSpec ? { DM_LOW_SPEC: "" } : {}), ...(detail ? { DM_DETAIL: "" } : {}), ...(fade ? { DM_LOD_FADE: "" } : {}) };
    m.onBeforeCompile = (shader) => patch(shader, fade ? { uLodFade: fade } : {});
    // Fade variants share one program (their own uLodFade is uploaded when the
    // renderer switches material); the base material has no discard at all, so
    // the resting terrain keeps early depth testing.
    const key = `deep-march-seabed-${opts.lowSpec ? "lo" : "hi"}${detail ? "-d" : ""}${fade ? "-fade" : ""}`;
    m.customProgramCacheKey = () => key;
    return m;
  };
  const material = make(null);
  const fades: THREE.MeshStandardMaterial[] = [];

  return {
    material,
    absorb: uniforms.uAbsorb.value,
    envLight: uniforms.uEnvLight,
    fadeMaterial: () => {
      const fade = { value: new THREE.Vector2(0, 1) };
      const m = make(fade);
      fades.push(m);
      return { material: m, fade: fade.value };
    },
    update: (time) => {
      uniforms.uTime.value = time;
    },
    dispose: () => {
      tex.dispose();
      material.dispose();
      fades.forEach((m) => m.dispose());
    },
  };
}
