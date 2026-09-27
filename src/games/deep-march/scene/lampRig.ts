/**
 * Scene side of the diver's lights: turns the LightController state into
 *  - beam: the classic head-lamp SpotLight (bright centre, falls off with distance);
 *  - high: the shader-side fog-light cone (highBeam.ts), uniform with distance;
 *  - night: night-vision strength for the post pass (nightVision.ts) plus
 *    its own additive fill light (haze/absorption down) and a dim IR illuminator;
 *  - off: total darkness — ambient, sun, caustics and water/haze colour fade to 0,
 *    leaving only the fluorescent plankton (particleLight.ts).
 * - turbidity (fog.ts): extinction per mode (visibility), murk colour and cone
 *   backscatter scale with the lamps, so lights off stays black.
 * Mode changes cross-fade quickly. world.ts hosts it and applies `env`.
 */
import * as THREE from "three";
import type { LightMode, LightState } from "../survival";
import { createBeamUniforms, type BeamUniforms } from "./highBeam";
import { FOG_TUNING, fogK, type FogVisibility } from "./fog";

export const LAMP_TUNING = {
  spot: { intensity: 26, distance: 150, angleDeg: 32, penumbra: 0.7, decay: 1.1 },
  high: { gain: 1.15, range: 280, outerDeg: 48, innerDeg: 18, hazeCut: 0.75, globalHaze: 0.85 },
  /** Night vision: additive hemisphere / sun fill (the base environment is dark without a lamp). */
  night: { ambient: 2.4, sun: 1.0, water: 1, haze: 0.22, absorb: 0.35, irSpot: 0.3 },
  /** Cross-fade speed (1/s). */
  fade: 14,
};

/**
 * What world.ts applies on top of its depth-driven lighting:
 * ambient/sun = base × mul + add; water scales the open-water / haze colour and
 * caustics (0 = black); haze / absorb scale their densities.
 */
export type LampEnv = {
  ambientMul: number;
  ambientAdd: number;
  sunMul: number;
  sunAdd: number;
  water: number;
  haze: number;
  absorb: number;
  /** Turbidity extinction per metre (0 = fog off). */
  fogK: number;
  /** Lamp level scaling the murk colour (0 = black murk). */
  murk: number;
  /** Cone backscatter gain and cone (cos outer, cos inner). */
  glow: number;
  glowCone: THREE.Vector2;
};

export class LampRig {
  readonly spot: THREE.SpotLight;
  readonly beam: BeamUniforms = createBeamUniforms();
  readonly env: LampEnv = { ambientMul: 1, ambientAdd: 0, sunMul: 1, sunAdd: 0, water: 1, haze: 1, absorb: 1, fogK: 0, murk: 1, glow: 0, glowCone: new THREE.Vector2(1, 1) };
  /** Glow direction (world): the lamps' aim. */
  readonly glowDir = new THREE.Vector3(0, 0, -1);
  private readonly fog: FogVisibility | null;
  private readonly spotCone: THREE.Vector2;
  private readonly highCone: THREE.Vector2;
  private readonly level: Record<LightMode, number> = { beam: 0, high: 0, night: 0 };
  private readonly tmp = new THREE.Vector3();

  /** fog: visibility per mode (fog.ts parseFogParam), null = no turbidity. */
  constructor(camera: THREE.Camera, fog: FogVisibility | null = FOG_TUNING.visibility) {
    this.fog = fog;
    const s = LAMP_TUNING.spot;
    this.spot = new THREE.SpotLight(new THREE.Color(1, 0.95, 0.85), s.intensity, s.distance, THREE.MathUtils.degToRad(s.angleDeg), s.penumbra, s.decay);
    // Source sits a little behind the eyes so a wall at arm's length doesn't blow out.
    this.spot.position.set(0.04, 0.06, 0.35);
    this.spot.target.position.set(0, -0.1, -5);
    camera.add(this.spot, this.spot.target);
    const h = LAMP_TUNING.high;
    // with turbidity the high beam is brighter but fog-limited (fog.ts)
    this.beam.uBeamRange.value = fog ? FOG_TUNING.highRange : h.range;
    this.beam.uBeamHazeCut.value = h.hazeCut;
    this.beam.uBeamCone.value.set(Math.cos(THREE.MathUtils.degToRad(h.outerDeg)), Math.cos(THREE.MathUtils.degToRad(h.innerDeg)));
    this.highCone = this.beam.uBeamCone.value.clone();
    this.spotCone = new THREE.Vector2(Math.cos(THREE.MathUtils.degToRad(s.angleDeg)), Math.cos(THREE.MathUtils.degToRad(s.angleDeg * (1 - s.penumbra))));
  }

  /** Night-vision post strength (0…1). */
  get night(): number {
    return this.level.night;
  }

  /** Call after the camera moved and its world matrix was updated. */
  update(dt: number, st: LightState, snap = false) {
    const k = snap ? 1 : 1 - Math.exp(-dt * LAMP_TUNING.fade);
    for (const m of ["beam", "high", "night"] as const) {
      const target = st.on && st.mode === m ? 1 : 0;
      this.level[m] += (target - this.level[m]) * k;
      if (Math.abs(target - this.level[m]) < 1e-3) this.level[m] = target;
    }
    const { beam, high, night } = this.level;
    const T = LAMP_TUNING;

    this.spot.intensity = T.spot.intensity * (beam + night * T.night.irSpot);
    // stays "visible" at 0: toggling light visibility would recompile every lit shader

    this.beam.uBeamGain.value = (this.fog ? FOG_TUNING.highGain : T.high.gain) * high;
    if (high > 0 || beam > 0) {
      this.spot.getWorldPosition(this.beam.uBeamPos.value);
      this.spot.target.getWorldPosition(this.tmp);
      this.beam.uBeamDir.value.copy(this.tmp).sub(this.beam.uBeamPos.value).normalize();
      this.glowDir.copy(this.beam.uBeamDir.value);
    }

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    // beam / high keep the natural environment; off and night vision drop it
    const lamp = Math.min(1, beam + high);
    this.env.ambientMul = lamp;
    this.env.sunMul = lamp;
    this.env.ambientAdd = T.night.ambient * night;
    this.env.sunAdd = T.night.sun * night;
    this.env.water = Math.min(1, lamp + T.night.water * night);
    this.env.haze = lerp(1, T.high.globalHaze, high) * lerp(1, T.night.haze, night);
    this.env.absorb = lerp(1, T.night.absorb, night);

    // turbidity: extinction blended by mode; murk + backscatter only with a lamp on
    const f = this.fog;
    if (f) {
      const rest = Math.max(0, 1 - beam - high);
      this.env.fogK = beam * fogK(f.beam) + high * fogK(f.high) + rest * fogK(f.off);
    } else this.env.fogK = 0;
    this.env.murk = lamp;
    this.env.glow = FOG_TUNING.glow.beam * beam + FOG_TUNING.glow.high * high;
    const hw = high / Math.max(1e-4, beam + high);
    this.env.glowCone.set(lerp(this.spotCone.x, this.highCone.x, hw), lerp(this.spotCone.y, this.highCone.y, hw));
  }

  dispose() {
    this.spot.dispose();
  }
}
