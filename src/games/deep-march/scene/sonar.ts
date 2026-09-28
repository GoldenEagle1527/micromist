/**
 * SONAR render mode (drawn inside the seabed shader, no extra pass). While
 * active the diver emits a pulse every `period` seconds; each pulse is a sphere expanding from where it was emitted at `speed` to `range`.
 * Terrain the wavefront crosses lights up as cyan scan lines — world-space height
 * contours (anti-aliased with screen-space derivatives and a minimum pixel width,
 * blended to a flat tone where they would get denser than a few pixels), rim /
 * facing emphasis from the normals, and a bright band at the front — and the hit
 * keeps glowing, fading over `trail` seconds. Turbidity doesn't apply (sound
 * carries), so distant masses resolve out to the pulse range.
 *
 *  - SonarPulses: pure scheduling / fade logic + the uniform arrays;
 *  - sonarFront / sonarTrail / sonarRangeFade / sonarAmp: JS mirrors of the GLSL
 *    (scripts/deep-march-sonar-test.ts);
 *  - SONAR_DECLS / SONAR_OPAQUE: shader chunks (seabedShader.ts), strength uSonar
 *    (0 = off: one uniform branch, nothing evaluated).
 */
import * as THREE from "three";

export const SONAR_TUNING = {
  /** Seconds between pulses. */
  period: 2.5,
  /** Wavefront speed (m/s, stylised: real sound is ~1500 m/s). */
  speed: 120,
  /** Pulse reach (m); faded over its last 15 %. */
  range: 300,
  /** Hit fade time constant (s) after the front passes. */
  trail: 2.2,
  /** Front band half-width (m). */
  front: 5,
  /** Height-contour spacing (m) and world line width (m). */
  contour: 4,
  lineWidth: 0.12,
  /** Minimum on-screen line width (px). */
  minPx: 1.25,
  /** Pulses tracked at once (desktop / low spec). */
  maxPulses: 5,
  maxPulsesLow: 3,
  color: new THREE.Color(0.25, 0.95, 1.0),
};

export type SonarTuning = typeof SONAR_TUNING;

/** Front band: exp(-((R - r) / W)²). */
export function sonarFront(R: number, r: number, W = SONAR_TUNING.front): number {
  const x = (R - r) / W;
  return Math.exp(-x * x);
}
/** Hit afterglow: the point was crossed (R - r) / v seconds ago. */
export function sonarTrail(R: number, r: number, v = SONAR_TUNING.speed, tau = SONAR_TUNING.trail): number {
  return r <= R ? Math.exp(-(R - r) / v / tau) : 0;
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Fade over the last 15 % of the range. */
export function sonarRangeFade(r: number, range = SONAR_TUNING.range): number {
  return 1 - smooth(0.85 * range, range, r);
}
/** Pulse lifetime: until its trail is ~2 % everywhere, capped so `max` pulses fit. */
export function sonarLifetime(t: SonarTuning = SONAR_TUNING, max = t.maxPulses): number {
  return Math.min(t.range / t.speed + 4 * t.trail, max * t.period);
}
/** Whole-pulse amplitude: fades out over the last second of its life (no pop on retire). */
export function sonarAmp(age: number, life: number): number {
  return 1 - smooth(life - 1, life, age);
}

type Pulse = { x: number; y: number; z: number; t0: number };

export class SonarPulses {
  /** xyz = origin, w = radius (negative = unused slot). */
  readonly pulse: THREE.Vector4[];
  /** Per-pulse amplitude (0…1). */
  readonly amp: number[];
  private readonly list: Pulse[] = [];
  private next = 0;
  private wasActive = false;
  readonly life: number;
  readonly max: number;
  readonly tuning: SonarTuning;

  constructor(max = SONAR_TUNING.maxPulses, tuning: SonarTuning = SONAR_TUNING) {
    this.max = max;
    this.tuning = tuning;
    this.pulse = Array.from({ length: max }, () => new THREE.Vector4(0, 0, 0, -1e4));
    this.amp = new Array(max).fill(0);
    this.life = sonarLifetime(tuning, max);
  }

  get count(): number {
    return this.list.length;
  }

  /** time: seconds (monotonic); active: sonar selected and on; origin: diver position. */
  update(time: number, active: boolean, origin: THREE.Vector3) {
    const T = this.tuning;
    if (active && !this.wasActive) this.next = time; // first ping right away
    this.wasActive = active;
    if (active) {
      while (time >= this.next) {
        this.list.push({ x: origin.x, y: origin.y, z: origin.z, t0: this.next });
        this.next += T.period;
      }
    }
    // retire expired pulses, and the oldest beyond capacity
    while (this.list.length && (time - this.list[0].t0 >= this.life || this.list.length > this.max)) this.list.shift();
    for (let i = 0; i < this.max; i++) {
      const p = this.list[i];
      if (p) {
        const age = time - p.t0;
        this.pulse[i].set(p.x, p.y, p.z, age * T.speed);
        this.amp[i] = sonarAmp(age, this.life);
      } else {
        this.pulse[i].w = -1e4;
        this.amp[i] = 0;
      }
    }
  }

  clear() {
    this.list.length = 0;
    this.wasActive = false;
  }
}

export type SonarUniforms = {
  uSonar: { value: number };
  uSonarPulse: { value: THREE.Vector4[] };
  uSonarAmp: { value: number[] };
  /** x speed, y trail, z front width, w range. */
  uSonarWave: { value: THREE.Vector4 };
  /** x contour spacing, y world line width, z min px. */
  uSonarLine: { value: THREE.Vector3 };
  uSonarColor: { value: THREE.Color };
};

export function createSonarUniforms(pulses: SonarPulses): SonarUniforms {
  const T = pulses.tuning;
  return {
    uSonar: { value: 0 },
    uSonarPulse: { value: pulses.pulse },
    uSonarAmp: { value: pulses.amp },
    uSonarWave: { value: new THREE.Vector4(T.speed, T.trail, T.front, T.range) },
    uSonarLine: { value: new THREE.Vector3(T.contour, T.lineWidth, T.minPx) },
    uSonarColor: { value: T.color.clone() },
  };
}

/** Declarations; DM_SONAR_N = pulse slots (material define). */
export const SONAR_DECLS = /* glsl */ `
#ifndef DM_SONAR_N
#define DM_SONAR_N 5
#endif
uniform float uSonar;
uniform DM_P vec4 uSonarPulse[DM_SONAR_N];
uniform DM_P float uSonarAmp[DM_SONAR_N];
uniform vec4 uSonarWave;
uniform vec3 uSonarLine;
uniform vec3 uSonarColor;
`;

/**
 * Opaque block tail (after turbidity / far fade): needs vWPos, cameraPosition,
 * dist, dir, dmWorldNormal, uFar. Derivatives are taken before the branch-free
 * pulse loop; the uSonar test is uniform control flow.
 */
export const SONAR_OPAQUE = /* glsl */ `
    if (uSonar > 0.001) {
      // height contours, AA'd in screen space with a minimum pixel width
      float hs = vWPos.y / uSonarLine.x;
      float fw = max(fwidth(hs), 1e-5);
      float dl = abs(fract(hs + 0.5) - 0.5);
      float hw = max(0.5 * uSonarLine.y / uSonarLine.x, 0.5 * uSonarLine.z * fw);
      float line = 1.0 - smoothstep(hw - 0.5 * fw, hw + 0.5 * fw, dl);
      // closer than ~4 px apart: blend to their mean coverage (no moire / shimmer)
      line = mix(line, min(1.0, 2.0 * hw), smoothstep(0.12, 0.3, fw));
      float facing = abs(dot(dmWorldNormal, dir));
      float rim = pow(1.0 - facing, 3.0);
      float trail = 0.0, front = 0.0;
      for (int i = 0; i < DM_SONAR_N; i++) {
        vec4 p = uSonarPulse[i];
        float r = distance(vWPos, p.xyz);
        float behind = p.w - r;
        float rf = uSonarAmp[i] * (1.0 - smoothstep(0.85 * uSonarWave.w, uSonarWave.w, r));
        float x = behind / uSonarWave.z;
        front = max(front, exp(-x * x) * rf);
        trail = max(trail, behind >= 0.0 ? exp(-behind / (uSonarWave.x * uSonarWave.y)) * rf : 0.0);
      }
      float echo = 0.25 + 0.75 * facing;
      vec3 sonarCol = uSonarColor * (trail * (0.07 * echo + 0.75 * line + 0.45 * rim) + front * (0.3 + 0.7 * echo));
      sonarCol *= 1.0 - smoothstep(uFar * 0.85, uFar, dist);
      outgoingLight = mix(outgoingLight, sonarCol, uSonar);
    }
`;
