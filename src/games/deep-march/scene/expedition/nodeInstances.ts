/**
 * The one instanced draw of every visible node and cache (nodeGeometry.ts +
 * nodeMaterial.ts): per instance a matrix (anchor, growth axis, spin, scale)
 * and two attributes — aTint (emissive colour, part) and aGlow (glow, pulse
 * phase, –, birth time). Frustum culling off (the set is already near the diver).
 */
import * as THREE from "three";
import { createNodeGeometry } from "./nodeGeometry";

export type NodeInstance = {
  x: number;
  y: number;
  z: number;
  /** Unit growth axis. */
  ax: number;
  ay: number;
  az: number;
  spin: number;
  scale: number;
  tint: THREE.Color;
  /** 0 crystal cluster, 1 cache. */
  part: 0 | 1;
  glow: number;
  phase: number;
  birth: number;
};

const UP = new THREE.Vector3(0, 1, 0);

export class NodeInstances {
  readonly mesh: THREE.InstancedMesh;
  readonly max: number;
  readonly crystalTriangles: number;
  readonly cacheTriangles: number;
  private readonly tint: THREE.InstancedBufferAttribute;
  private readonly glow: THREE.InstancedBufferAttribute;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qs = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(material: THREE.Material, max: number) {
    const g = createNodeGeometry();
    this.max = max;
    this.crystalTriangles = g.crystalTriangles;
    this.cacheTriangles = g.cacheTriangles;
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.glow = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.tint.setUsage(THREE.DynamicDrawUsage);
    this.glow.setUsage(THREE.DynamicDrawUsage);
    g.geometry.setAttribute("aTint", this.tint);
    g.geometry.setAttribute("aGlow", this.glow);
    this.mesh = new THREE.InstancedMesh(g.geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.name = "deep-march-nodes";
  }

  /** Upload `items` (the first `max`). */
  set(items: readonly NodeInstance[]): void {
    const n = Math.min(items.length, this.max);
    for (let i = 0; i < n; i++) {
      const it = items[i];
      this.q.setFromUnitVectors(UP, this.v.set(it.ax, it.ay, it.az));
      this.qs.setFromAxisAngle(UP, it.spin);
      this.q.multiply(this.qs);
      this.m.compose(this.v.set(it.x, it.y, it.z), this.q, this.s.setScalar(it.scale));
      this.mesh.setMatrixAt(i, this.m);
      this.tint.setXYZW(i, it.tint.r, it.tint.g, it.tint.b, it.part);
      this.glow.setXYZW(i, it.glow, it.phase, 0, it.birth);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.tint.needsUpdate = true;
    this.glow.needsUpdate = true;
  }

  /** Triangles drawn by the current set. */
  triangles(items: readonly NodeInstance[]): number {
    const n = Math.min(items.length, this.max);
    return n * (this.crystalTriangles + this.cacheTriangles);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}
