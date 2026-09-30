/**
 * The tide's particle currents: one THREE.Points draw of phone 3k / desktop
 * 12k particles plus the 500 of the diver's particle-ization burst (design doc
 * §5.5 key point 3, §5.6). Seeds are fixed at creation (from the world seed);
 * the motion is in tideParticleShader.ts, so a frame costs a few uniforms.
 */
import * as THREE from "three";
import { mulberry32 } from "../../terrain/noise";
import { TIDE_VIEW } from "./config";
import { PARTICLE_FRAG, PARTICLE_VERT } from "./tideParticleShader";

export type ParticleClock = { stripStart: number; stripLen: number; gatherStart: number; gatherLen: number };

export class TideParticles {
  readonly points: THREE.Points;
  readonly count: number;
  private readonly u = {
    uT: { value: -1 },
    uCenter: { value: new THREE.Vector3() },
    uGeom: { value: new THREE.Vector4(50, 300, TIDE_VIEW.particles.height, 0) },
    uTimes: { value: new THREE.Vector4() },
    uBurst: { value: new THREE.Vector4(0, 0, 0, -1e4) },
    uView: { value: new THREE.Vector3(TIDE_VIEW.particles.size, 600, TIDE_VIEW.particles.fade) },
    uColor: { value: new THREE.Color(...TIDE_VIEW.particles.color) },
  };

  constructor(lowSpec: boolean, seed: number, clock: ParticleClock) {
    const P = TIDE_VIEW.particles;
    const n = lowSpec ? P.phone : P.desktop;
    this.count = n + P.burst;
    const rnd = mulberry32((seed ^ 0x71de) >>> 0);
    const seeds = new Float32Array(this.count * 4);
    for (let i = 0; i < this.count; i++) {
      const burst = i >= n;
      seeds[i * 4] = burst ? rnd() : rnd() * Math.PI * 2;
      seeds[i * 4 + 1] = burst ? rnd() : Math.sqrt(rnd());
      seeds[i * 4 + 2] = rnd();
      seeds[i * 4 + 3] = burst ? -1 - rnd() : rnd();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    // a dummy position attribute: three needs one to know the draw count
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.count * 3), 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.name = "deep-march-tide-particles";
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.u.uTimes.value.set(clock.stripStart, clock.stripLen, clock.gatherStart, clock.gatherLen);
  }

  /**
   * t: seconds since the commit (the show's clock; < 0 hides everything);
   * currents false (the murk): only the burst is drawn.
   */
  update(t: number, currents: boolean, dome: { x: number; y: number; z: number; radius: number } | null, reach: number, pxPerM: number): void {
    this.points.visible = t >= 0 && !!dome;
    if (!this.points.visible || !dome) return;
    const u = this.u;
    u.uT.value = t;
    u.uGeom.value.w = currents ? 1 : 0;
    u.uCenter.value.set(dome.x, dome.y, dome.z);
    u.uGeom.value.x = dome.radius;
    u.uGeom.value.y = reach;
    u.uView.value.y = pxPerM;
  }

  /** The tide takes the diver at time t (update's clock): the burst streams out of (x, y, z). */
  burst(x: number, y: number, z: number, t: number): void {
    this.u.uBurst.value.set(x, y, z, t);
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
