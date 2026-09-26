/**
 * Scene side of the diver's lights: turns the LightController state into
 *  - beam: the classic head-lamp SpotLight (bright centre, falls off with distance);
 *  - high: the shader-side fog-light cone (highBeam.ts), uniform with distance;
 *  - night: night-vision strength for the post pass (nightVision.ts) plus
 *    its own additive fill light (haze/absorption down) and a dim IR illuminator;
 *  - off: total darkness — ambient, sun, caustics and water/haze colour fade to 0,
 *    leaving only the fluorescent plankton (particleLight.ts).
 * Mode changes cross-fade quickly. world.ts hosts it and applies `env`.
 */
import * as THREE from "three";
import type { LightMode, LightState } from "../survival";
import { createBeamUniforms, type BeamUniforms } from "./highBeam";

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
};

export class LampRig {
  readonly spot: THREE.SpotLight;
  readonly beam: BeamUniforms = createBeamUniforms();
  readonly env: LampEnv = { ambientMul: 1, ambientAdd: 0, sunMul: 1, sunAdd: 0, water: 1, haze: 1, absorb: 1 };
  private readonly level: Record<LightMode, number> = { beam: 0, high: 0, night: 0 };
  private readonly tmp = new THREE.Vector3();

  constructor(camera: THREE.Camera) {
    const s = LAMP_TUNING.spot;
    this.spot = new THREE.SpotLight(new THREE.Color(1, 0.95, 0.85), s.intensity, s.distance, THREE.MathUtils.degToRad(s.angleDeg), s.penumbra, s.decay);
    // Source sits a little behind the eyes so a wall at arm's length doesn't blow out.
    this.spot.position.set(0.04, 0.06, 0.35);
    this.spot.target.position.set(0, -0.1, -5);
    camera.add(this.spot, this.spot.target);
    const h = LAMP_TUNING.high;
    this.beam.uBeamRange.value = h.range;
    this.beam.uBeamHazeCut.value = h.hazeCut;
    this.beam.uBeamCone.value.set(Math.cos(THREE.MathUtils.degToRad(h.outerDeg)), Math.cos(THREE.MathUtils.degToRad(h.innerDeg)));
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

    this.beam.uBeamGain.value = T.high.gain * high;
    if (high > 0) {
      this.spot.getWorldPosition(this.beam.uBeamPos.value);
      this.spot.target.getWorldPosition(this.tmp);
      this.beam.uBeamDir.value.copy(this.tmp).sub(this.beam.uBeamPos.value).normalize();
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
  }

  dispose() {
    this.spot.dispose();
  }
}
