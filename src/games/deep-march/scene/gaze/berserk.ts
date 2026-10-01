/**
 * The world's creatures gone berserk under the gaze (design doc §7.3 直视期间的
 * 发狂, §9.1), as the sonar shows them: a ring of huge silhouettes closing in on
 * the base phase by phase (① 900 m → ④ 110 m), one coiling round the building
 * being squeezed, and from ③ the echo giant circling over the dome. One
 * instanced draw of the omen silhouette (scene/chaos/omenMesh.ts), lit only by
 * the long sonar pulses, never seen by the lamp: they are heard, then pinged —
 * nothing ever appears at once.
 */
import * as THREE from "three";
import type { GazeView } from "../../conserve";
import { omenParts } from "../chaos/omenMesh";
import type { SonarPulses, SonarUniforms } from "../sonar";
import { GAZE_LOOK } from "./config";

export type SwarmFrame = {
  /** Where they gather (the base core, else the diver). */
  center: { x: number; y: number; z: number };
  view: GazeView;
  time: number;
  /** 1 while a long pulse is alive (else 0). */
  sonar: number;
  presence: number;
};

const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 31.7) * 43758.5453;
  return x - Math.floor(x);
};

export class GazeSwarm {
  readonly mesh: THREE.InstancedMesh;
  private readonly uniforms: ReturnType<typeof omenParts>["uniforms"];
  private readonly parts: ReturnType<typeof omenParts>;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(opts: { sonar: SonarUniforms; long: SonarPulses }) {
    this.parts = omenParts(opts);
    this.uniforms = this.parts.uniforms;
    this.mesh = new THREE.InstancedMesh(this.parts.geo, this.parts.material, GAZE_LOOK.swarm.count + 1);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.visible = false;
    this.mesh.name = "gaze-swarm";
  }

  update(f: SwarmFrame): void {
    const k = f.presence * f.sonar;
    this.uniforms.uOmen.value = k;
    this.uniforms.uTime.value = f.time;
    this.mesh.visible = k > 0.001;
    if (!this.mesh.visible) return;
    const W = GAZE_LOOK.swarm, v = f.view, R = W.radius;
    const ring = R[v.phase] + (R[v.phase + 1] - R[v.phase]) * v.phaseU;
    for (let i = 0; i < W.count; i++) {
      const dir = i % 2 ? 1 : -0.7, a = (i / W.count) * Math.PI * 2 + (dir * f.time * Math.PI * 2) / W.lapS;
      const r = ring * (0.85 + 0.3 * hash(i)), y = f.center.y + W.height[0] + (W.height[1] - W.height[0]) * hash(i + 7);
      const sq = i === 0 && v.squeeze;
      if (sq) this.set(i, sq.pos[0] + 14 * Math.cos(f.time * 0.2), sq.pos[1] + 8, sq.pos[2] + 14 * Math.sin(f.time * 0.2), f.time * 0.2 + Math.PI, 1);
      else this.set(i, f.center.x + r * Math.cos(a), y, f.center.z + r * Math.sin(a), a + (dir > 0 ? Math.PI / 2 : -Math.PI / 2), 1);
    }
    const G = W.giant, ga = (f.time * Math.PI * 2) / G.lapS, giant = v.phase >= 2 ? G.scale : 0;
    this.set(W.count, f.center.x + G.radius * Math.cos(ga), f.center.y + G.above, f.center.z + G.radius * Math.sin(ga), ga + Math.PI / 2, giant);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Instance i at (x, y, z) heading `heading` (rad in the x–z plane, from +x toward +z), scaled. */
  private set(i: number, x: number, y: number, z: number, heading: number, scale: number): void {
    const dx = Math.cos(heading), dz = Math.sin(heading);
    this.e.set(0, -Math.atan2(dx, -dz), 0);
    this.s.setScalar(Math.max(scale, 1e-4));
    this.mesh.setMatrixAt(i, this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e), this.s));
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.parts.geo.dispose();
    this.parts.material.dispose();
  }
}
