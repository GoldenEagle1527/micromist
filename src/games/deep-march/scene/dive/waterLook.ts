/**
 * The underwater look for a vast world: the reference water colour (0, .168,
 * .453) is the horizon of an open-water gradient (brighter toward the surface,
 * black below) drawn by a background dome; the terrain hazes toward a darker
 * tone of the same colour, so far masses loom as silhouettes and resolve as the
 * diver closes in (seabedMaterial.ts). Plus the down-welling lights, and the
 * per-frame lighting: depth-driven base (deeper = darker) × light mode (lights
 * off = black water and no ambient; sonar draws on a dark background).
 */
import * as THREE from "three";
import { SEA_COLORS } from "../../terrain/config";
import { FOG_GLSL, FOG_TUNING, createFogUniforms, type FogUniforms } from "../fog";
import type { LampRig } from "../lampRig";
import type { MarineSnow } from "../particles";
import { WATER_GLSL, createWaterUniforms, type WaterUniforms } from "../seabedMaterial";

const DOME_VERT = /* glsl */ `varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
}`;

const DOME_FRAG = /* glsl */ `${WATER_GLSL}${FOG_GLSL}
varying vec3 vDir;
void main() {
  gl_FragColor = vec4(dmBackground(normalize(vDir)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** What the lighting drives on the terrain material (seabedMaterial.ts). */
export type SeabedLightTargets = { envLight: { value: number }; absorb: THREE.Vector3 };

export class WaterLook {
  readonly water: WaterUniforms;
  readonly fog: FogUniforms;
  private readonly scene: THREE.Scene;
  private readonly fogColor: THREE.Color;
  private readonly baseFog: THREE.Color;
  private readonly baseWater: { top: THREE.Color; horizon: THREE.Color; bottom: THREE.Color };
  private readonly dome: THREE.Mesh;
  private ambient: THREE.HemisphereLight | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private lastDeep = -1;
  private lastWater = -1;
  private baseAbsorb = new THREE.Vector3();
  private baseHaze = 0;

  /** Sets the scene's fog (it only tints the marine snow near the camera) and adds the dome. */
  constructor(scene: THREE.Scene, viewDistance: number) {
    this.scene = scene;
    this.fogColor = new THREE.Color().setRGB(SEA_COLORS.fog[0], SEA_COLORS.fog[1], SEA_COLORS.fog[2], THREE.SRGBColorSpace);
    // darker overall so the head lamp carries the scene in a vast ocean
    this.fogColor.multiplyScalar(0.42);
    this.baseFog = this.fogColor.clone();
    scene.background = null;
    scene.fog = new THREE.Fog(this.fogColor, 1.5, 34);
    this.water = createWaterUniforms(this.baseFog, viewDistance);
    this.fog = createFogUniforms();
    const w = this.water;
    this.baseWater = { top: w.uWaterTop.value.clone(), horizon: w.uWaterHorizon.value.clone(), bottom: w.uWaterBottom.value.clone() };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.ShaderMaterial({ uniforms: { ...this.water, ...this.fog }, vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false }),
    );
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    scene.add(this.dome);
  }

  /** Down-welling light: teal sky fill from above, very dark from below, plus a blue-green filtered "sun" from the surface. */
  addLights(): void {
    this.ambient = new THREE.HemisphereLight(0x3f86a6, 0x0a1426, 0.38);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(new THREE.Color(0.55, 0.85, 1.0), 0.4);
    this.sun.position.set(0.25, 1, 0.15);
    this.scene.add(this.sun);
  }

  /** The terrain material's resting absorption and the water's haze (the light modes scale them). */
  captureBase(seabedAbsorb: THREE.Vector3): void {
    this.baseAbsorb = seabedAbsorb.clone();
    this.baseHaze = this.water.uHaze.value;
  }

  /** Per frame, after the lamp rig: camera height (world units), the world scale. */
  update(cameraY: number, worldScale: number, rig: LampRig, seabed: SeabedLightTargets, snow: MarineSnow): void {
    const W = worldScale;
    const deep = THREE.MathUtils.smoothstep(-cameraY, 8 * W, 26 * W);
    const env = rig.env;
    const wk = env.water;
    const { water, fog } = this;
    if (Math.abs(deep - this.lastDeep) > 0.002 || wk !== this.lastWater) {
      this.lastDeep = deep;
      this.lastWater = wk;
      this.fogColor.copy(this.baseFog).multiplyScalar((1 - 0.7 * deep) * wk);
      (this.scene.fog as THREE.Fog).color.copy(this.fogColor);
      water.uWaterHorizon.value.copy(this.baseWater.horizon).multiplyScalar((1 - 0.72 * deep) * wk);
      water.uWaterTop.value.copy(this.baseWater.top).multiplyScalar((1 - 0.6 * deep) * wk);
      water.uWaterBottom.value.copy(this.baseWater.bottom).multiplyScalar((1 - 0.85 * deep) * wk);
    }
    seabed.envLight.value = wk;
    if (this.ambient) this.ambient.intensity = 0.38 * (1 - 0.6 * deep) * env.ambientMul + env.ambientAdd;
    if (this.sun) this.sun.intensity = 0.4 * (1 - 0.75 * deep) * env.sunMul + env.sunAdd;
    water.uHaze.value = this.baseHaze * env.haze;
    seabed.absorb.copy(this.baseAbsorb).multiplyScalar(env.absorb);
    fog.uFogK.value = env.fogK;
    fog.uFogColor.value.copy(FOG_TUNING.murk).multiplyScalar(env.murk * (1 - 0.6 * deep));
    fog.uGlowGain.value = env.glow;
    fog.uGlowCone.value.copy(env.glowCone);
    fog.uGlowDir.value.copy(rig.glowDir);
    snow.setFog(env.fogK);
  }

  dispose(): void {
    this.dome.geometry.dispose();
    (this.dome.material as THREE.Material).dispose();
  }
}
