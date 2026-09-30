/**
 * Node / cache material: MeshPhongMaterial (the terrain's lights: head lamp,
 * sun, ambient; Blinn-Phong glints on the facets and no BRDF lookup texture,
 * unlike MeshStandardMaterial) patched with nodeShader.ts, sharing the terrain's water, fog,
 * sonar and high-beam uniforms so nodes sit in the same murk and light up in
 * the same pulses. No textures. One program (customProgramCacheKey).
 */
import * as THREE from "three";
import { BEAM_DECLS, BEAM_LIGHT, type BeamUniforms } from "../highBeam";
import { FOG_GLSL, type FogUniforms } from "../fog";
import { WATER_GLSL, type WaterUniforms } from "../seabedMaterial";
import { SONAR_DECLS, type SonarUniforms } from "../sonar";
import { BEACON, NODE_VIEW } from "./config";
import { NODE_EMISSIVE, NODE_FRAG_DECLS, NODE_NORMAL, NODE_OPAQUE, NODE_VERT_BEGIN, NODE_VERT_DECLS, NODE_VERT_MAIN } from "./nodeShader";

export type NodeMaterialOptions = {
  water: WaterUniforms;
  fog: FogUniforms;
  sonar: SonarUniforms;
  beam: BeamUniforms;
  /** The terrain's live per-unit absorption (seabed.absorb). */
  absorb: THREE.Vector3;
};

export type NodeMaterial = { material: THREE.MeshPhongMaterial; time: { value: number }; dispose: () => void };

export function createNodeMaterial(opts: NodeMaterialOptions): NodeMaterial {
  const time = { value: 0 };
  const uniforms = {
    ...opts.water,
    ...opts.fog,
    ...opts.sonar,
    ...opts.beam,
    uAbsorb: { value: opts.absorb },
    uTime: time,
    uNodeFade: { value: new THREE.Vector2(NODE_VIEW.radius, NODE_VIEW.fadeBand) },
    uGrowIn: { value: NODE_VIEW.growIn },
    uBeaconPeriod: { value: BEACON.period },
    uNodeEcho: { value: NODE_VIEW.sonarEcho },
  };
  const material = new THREE.MeshPhongMaterial({ color: NODE_VIEW.body, specular: NODE_VIEW.specular, shininess: NODE_VIEW.shininess });
  material.fog = false;
  material.defines = { DM_SONAR_N: String(opts.sonar.uSonarPulse.value.length) };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${NODE_VERT_DECLS}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${NODE_VERT_BEGIN}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${NODE_VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${NODE_FRAG_DECLS}${WATER_GLSL}${FOG_GLSL}${SONAR_DECLS}${BEAM_DECLS}`)
      .replace("#include <normal_fragment_maps>", NODE_NORMAL)
      .replace("#include <emissivemap_fragment>", NODE_EMISSIVE)
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${BEAM_LIGHT}`)
      .replace("#include <opaque_fragment>", NODE_OPAQUE);
  };
  material.customProgramCacheKey = () => "deep-march-node";
  return { material, time, dispose: () => material.dispose() };
}
