/**
 * Types of the seabed terrain material (seabedMaterial.ts): options, the program
 * variants it hands out, and the shared water / haze uniforms.
 */
import * as THREE from "three";
import type { BeamUniforms } from "./highBeam";
import type { ParticleLightUniforms } from "./particleLight";
import type { FogUniforms } from "./fog";
import type { SonarUniforms } from "./sonar";
import type { MaterialUniforms } from "./materialLibrary";
import type { BaseLightUniforms } from "./base/baseLight";
import type { ChaosUniforms } from "./chaos/seabedChaos";

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
  /** Shader detail normal (detailNormal.ts); false = the debug panel's 细节法线 off. Default true. */
  detail?: boolean;
  /** Conserve (M8): the chaos program's uniforms (chaos/seabedChaos.ts); null / omitted = no chaos variant. */
  chaos?: ChaosUniforms | null;
};

/** One program family for a generation's columns: resting material + its LOD-crossfade variants. */
export type SeabedVariant = { material: THREE.MeshStandardMaterial; fadeMaterial: () => LodFadeMaterial };

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
  /**
   * The tide's front variant (conserve mode only; built on first use, one program
   * each): chaos = for a generation drawn with DM_CHAOS (its veins and crack light
   * stay in the band). Both share one front / glow.
   */
  tideMaterial: (chaos?: boolean) => TideFrontMaterial;
  /**
   * The columns' programs for a generation: chaos = its terrain shows chaos (M8:
   * DM_CHAOS, built on first use); false (and without `opts.chaos`) = `material` /
   * `fadeMaterial` exactly.
   */
  variant: (chaos: boolean) => SeabedVariant;
  update: (time: number) => void;
  dispose: () => void;
};
