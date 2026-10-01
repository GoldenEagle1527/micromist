/**
 * The four 封界 anchors beyond the main breach (design doc §9.1 锁界): solid
 * glowing octahedra (one instanced draw, 32 triangles) on the wall's outer
 * face — dim until lit, then bright and slowly turning. Fogged like the water;
 * drawn only near the breach while a gaze is on. No lines, no sprites.
 */
import * as THREE from "three";
import { GAZE_LOOK } from "./config";

export type AnchorFrame = { anchors: readonly { x: number; y: number; z: number; lit: boolean }[]; camera: THREE.Vector3; time: number; reach: number; hold: number };

export class AnchorMesh {
  readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly litColor = new THREE.Color(...GAZE_LOOK.anchors.lit);

  constructor() {
    const A = GAZE_LOOK.anchors;
    const geo = new THREE.OctahedronGeometry(A.size, 0);
    geo.scale(1, 1.8, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, 4);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(12), 3);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = "gaze-anchors";
  }

  update(f: AnchorFrame | null): void {
    const A = GAZE_LOOK.anchors, list = f?.anchors ?? [];
    const near = !!f && list.some((a) => Math.hypot(a.x - f.camera.x, a.z - f.camera.z) < A.near);
    this.mesh.visible = near;
    if (!near || !f) return;
    this.mesh.count = list.length;
    list.forEach((a, i) => {
      const held = i === f.reach ? f.hold : 0;
      const k = a.lit ? 1 : held;
      this.e.set(0, f.time * A.spin * (a.lit ? 1 : 0.3) + i, 0);
      this.p.set(a.x, a.y + Math.sin(f.time * 0.6 + i) * 0.4, a.z);
      this.s.setScalar(1 + 0.25 * k);
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q.setFromEuler(this.e), this.s));
      const pulse = a.lit ? 0.85 + 0.15 * Math.sin(f.time * 1.3 + i) : 0.6 + 0.4 * Math.sin(f.time * 2 + i) * (i === f.reach ? 1 : 0);
      this.c.fromArray(a.lit ? A.lit : A.unlit).lerp(this.litColor, held * 0.7).multiplyScalar(A.gain * pulse);
      this.mesh.setColorAt(i, this.c);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
