/**
 * Building material: MeshPhongMaterial patched with structureShader.ts, sharing
 * the terrain's water, fog, sonar, high-beam and lighthouse-light uniforms, so
 * the buildings stand in the same murk and light. No textures, one program
 * for all four kinds (customProgramCacheKey).
 */
import * as THREE from "three";
import { BEAM_DECLS, BEAM_LIGHT, type BeamUniforms } from "../highBeam";
import { FOG_GLSL, type FogUniforms } from "../fog";
import { WATER_GLSL, type WaterUniforms } from "../seabedMaterial";
import { SONAR_DECLS, type SonarUniforms } from "../sonar";
import type { BaseLightUniforms } from "./baseLight";
import { BL_DECLS, BL_LIGHT } from "./baseLightShader";
import { STRUCTURE_LOOK } from "./config";
import { STRUCT_EMISSIVE, STRUCT_FRAG_DECLS, STRUCT_NORMAL, STRUCT_OPAQUE, STRUCT_VERT_BEGIN, STRUCT_VERT_DECLS, STRUCT_VERT_MAIN } from "./structureShader";

export type StructureMaterialOptions = {
  water: WaterUniforms;
  fog: FogUniforms;
  sonar: SonarUniforms;
  beam: BeamUniforms;
  baseLight: BaseLightUniforms;
  /** The terrain's live per-unit absorption (seabed.absorb). */
  absorb: THREE.Vector3;
};

export type StructureMaterial = { material: THREE.MeshPhongMaterial; time: { value: number }; dispose: () => void };

/** Seconds a new building takes to rise. */
export const GROW_IN = 2.4;

export function createStructureMaterial(opts: StructureMaterialOptions): StructureMaterial {
  const L = STRUCTURE_LOOK;
  const time = { value: 0 };
  const uniforms = {
    ...opts.water,
    ...opts.fog,
    ...opts.sonar,
    ...opts.beam,
    ...opts.baseLight,
    uAbsorb: { value: opts.absorb },
    uTime: time,
    uGrowIn: { value: GROW_IN },
    uSeam: { value: new THREE.Vector2(L.seam, L.seamDepth) },
    uGlowTint: { value: new THREE.Color(...L.glow) },
    uGlowParams: { value: new THREE.Vector3(L.glowGain, L.glowIdle, L.pulseHz * Math.PI * 2) },
  };
  const material = new THREE.MeshPhongMaterial({ color: new THREE.Color(...L.hull), specular: new THREE.Color().setScalar(L.specular), shininess: L.shininess });
  material.fog = false;
  material.defines = { DM_SONAR_N: String(opts.sonar.uSonarPulse.value.length), DM_STRUCT: "1" };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${STRUCT_VERT_DECLS}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${STRUCT_VERT_BEGIN}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${STRUCT_VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${STRUCT_FRAG_DECLS}${WATER_GLSL}${FOG_GLSL}${SONAR_DECLS}${BEAM_DECLS}${BL_DECLS}`)
      .replace("#include <normal_fragment_maps>", STRUCT_NORMAL)
      .replace("#include <emissivemap_fragment>", STRUCT_EMISSIVE)
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${BEAM_LIGHT}${BL_LIGHT}`)
      .replace("#include <opaque_fragment>", STRUCT_OPAQUE);
  };
  material.customProgramCacheKey = () => "deep-march-structure";
  return { material, time, dispose: () => material.dispose() };
}
