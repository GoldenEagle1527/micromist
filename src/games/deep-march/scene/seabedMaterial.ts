/**
 * Seabed terrain material: MeshStandardMaterial extended via onBeforeCompile.
 *
 * - Multi-material (materialShader.ts, materialCatalog.ts): 22 CC0 PBR sets in two
 *   texture arrays (materialLibrary.ts, all loaded before the dive), world-space triplanar with
 *   whiteout normal blend; each region has a main + alt palette of floor / wall /
 *   ceiling layers, blended by per-vertex region weights baked at generation time
 *   (terrain/regionWeights.ts) with noisy interfingering at the borders.
 * - Per-vertex AO attribute (from the mesher), animated caustics from above.
 * - SONAR mode (sonar.ts): expanding pulses light the terrain as cyan contour /
 *   scan lines (uSonar cross-fades it in; turbidity doesn't apply).
 * - Turbidity (fog.ts): lit surfaces fade into a dark blue-green murk within tens
 *   of metres, with lamp backscatter in the cone.
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
import { BEAM_DECLS, type BeamUniforms } from "./highBeam";
import { PL_DECLS, type ParticleLightUniforms } from "./particleLight";
import { FOG_GLSL, type FogUniforms } from "./fog";
import { SONAR_DECLS, type SonarUniforms } from "./sonar";
import { MAT_VERT_DECLS, MAT_VERT_MAIN } from "./materialShader";
import type { MaterialUniforms } from "./materialLibrary";
import { DETAIL_GLSL } from "./detailNormal";
import { BL_DECLS } from "./base/baseLightShader";
import type { BaseLightUniforms } from "./base/baseLight";
import { DECLS, EMISSIVE_FRAGMENT, LIGHTS_END_FRAGMENT, MAP_FRAGMENT, OPAQUE_FRAGMENT, WATER_GLSL } from "./seabedShader";
import { TIDE_FRONT_DECLS, TIDE_FRONT_EMISSIVE, TIDE_FRONT_FRAGMENT } from "./tide/tideFrontShader";

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
  lowSpec: boolean;
  /** Shared water uniforms (createWaterUniforms). */
  water: WaterUniforms;
  /** World scale (terrain shapes are this much larger than the base design). */
  worldScale: number;
  /** Material texture arrays + per-layer / palette uniforms (MaterialLibrary.uniforms). */
  materials: MaterialUniforms;
  /** Turbidity + lamp backscatter uniforms (fog.ts), shared with the background dome. */
  fog: FogUniforms;
  /** SONAR render-mode uniforms (sonar.ts). */
  sonar: SonarUniforms;
  /** High-beam (fog-light) uniforms, see highBeam.ts. */
  beam: BeamUniforms;
  /** Fluorescent-plankton point lights, see particleLight.ts. */
  particleLights: ParticleLightUniforms;
  /** Lighthouse light (conserve base, base/baseLight.ts); uBLCount 0 skips it. */
  baseLight: BaseLightUniforms;
  /** Shader detail normal (detailNormal.ts); false = ?detail=0. Default true. */
  detail?: boolean;
};

export type LodFadeMaterial = { material: THREE.Material; fade: THREE.Vector2 };

/** The tide's dissolve-front variant (tide/tideFrontShader.ts): front = (x, z, radius, band), glow colour. */
export type TideFrontMaterial = { material: THREE.Material; front: THREE.Vector4; glow: THREE.Color };

export type SeabedMaterial = {
  material: THREE.MeshStandardMaterial;
  /** Live per-unit absorption (scaled by the lamp rig). */
  absorb: THREE.Vector3;
  /** Scales surface-borne light that isn't from a light object (caustics); 0 = total darkness. */
  envLight: { value: number };
  /**
   * A new LOD-crossfade variant of the material (same look and program family,
   * screen-door on 2x2 pixel quads by its own `fade`: x = progress 0..1, y = +1 fading in /
   * −1 fading out). See chunks.ts.
   */
  fadeMaterial: () => LodFadeMaterial;
  /** The tide's front variant (conserve mode only; built on first use, one program). */
  tideMaterial: () => TideFrontMaterial;
  update: (time: number) => void;
  dispose: () => void;
};

export function createSeabedMaterial(opts: SeabedOptions): SeabedMaterial {
  const uniforms = {
    ...opts.materials,
    uTime: { value: 0 },
    // per-unit absorption (red goes first) — close surfaces keep true colour
    uAbsorb: { value: new THREE.Vector3(0.06, 0.024, 0.014) },
    uCausticColor: { value: new THREE.Color(0.55, 0.85, 0.95).multiplyScalar(0.55) },
    uCeilingTint: { value: new THREE.Color(0.55, 0.58, 0.64) },
    uWS: { value: opts.worldScale },
    ...opts.water,
    ...opts.fog,
    ...opts.sonar,
    ...opts.beam,
    ...opts.particleLights,
    ...opts.baseLight,
    uEnvLight: { value: 1 },
  };

  const patch = (shader: THREE.WebGLProgramParametersWithUniforms, extra: Record<string, THREE.IUniform>) => {
    Object.assign(shader.uniforms, uniforms, extra);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float ao;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\nvarying float vAO;" + MAT_VERT_DECLS,
      )
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vWNrm = normalize(mat3(modelMatrix) * objectNormal);\n  vAO = ao;" + MAT_VERT_MAIN,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + DECLS + DETAIL_GLSL + WATER_GLSL + FOG_GLSL + SONAR_DECLS + BEAM_DECLS + PL_DECLS + BL_DECLS)
      .replace("#include <map_fragment>", (extra.uTideFront ? TIDE_FRONT_FRAGMENT : "") + MAP_FRAGMENT)
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = clamp(mix(0.55, 1.0, dmRough), 0.3, 1.0);")
      .replace(
        "#include <normal_fragment_maps>",
        "normal = normalize((viewMatrix * vec4(dmWorldNormal, 0.0)).xyz);",
      )
      .replace(
        "#include <emissivemap_fragment>",
        EMISSIVE_FRAGMENT + (extra.uTideFront ? TIDE_FRONT_EMISSIVE : ""),
      )
      .replace(
        "#include <lights_fragment_end>",
        LIGHTS_END_FRAGMENT,
      )
      .replace(
        "#include <opaque_fragment>",
        OPAQUE_FRAGMENT,
      );
    if (extra.uTideFront) shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>" + TIDE_FRONT_DECLS);
    if (extra.uLodFade) shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec2 uLodFade;");
  };
  const detail = opts.detail !== false;
  const make = (fade: { value: THREE.Vector2 } | null, tide: Record<string, THREE.IUniform> | null = null) => {
    const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    m.fog = false; // own water model (see header)
    m.defines = { ...(opts.lowSpec ? { DM_LOW_SPEC: "" } : {}), ...(detail ? { DM_DETAIL: "" } : {}), ...(fade ? { DM_LOD_FADE: "" } : {}), ...(tide ? { DM_TIDE_FRONT: "" } : {}), DM_SONAR_N: String(opts.sonar.uSonarPulse.value.length) };
    m.onBeforeCompile = (shader) => patch(shader, fade ? { uLodFade: fade } : tide ?? {});
    // Fade variants share one program (their own uLodFade is uploaded when the
    // renderer switches material); the base material has no discard at all, so
    // the resting terrain keeps early depth testing.
    const key = `deep-march-seabed-${opts.lowSpec ? "lo" : "hi"}${detail ? "-d" : ""}${fade ? "-fade" : ""}${tide ? "-tide" : ""}`;
    m.customProgramCacheKey = () => key;
    return m;
  };
  const material = make(null);
  const fades: THREE.MeshStandardMaterial[] = [];
  let tide: TideFrontMaterial | null = null;

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
    tideMaterial: () => {
      if (tide) return tide;
      const u = { uTideFront: { value: new THREE.Vector4(0, 0, 1e6, 1) }, uTideGlow: { value: new THREE.Color(0, 0, 0) } };
      const m = make(null, u);
      fades.push(m);
      return (tide = { material: m, front: u.uTideFront.value, glow: u.uTideGlow.value });
    },
    update: (time) => {
      uniforms.uTime.value = time;
    },
    dispose: () => {
      material.dispose();
      fades.forEach((m) => m.dispose());
    },
  };
}
