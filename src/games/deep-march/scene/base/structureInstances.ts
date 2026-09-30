/**
 * The base's buildings: one InstancedMesh per kind (4 draws for any number of
 * buildings, all one program), per instance a matrix (ground point, yaw) and
 * aState (working, birth time). No LOD: the meshes are low-poly enough to draw
 * whole at any distance (test:placement counts draws and triangles).
 */
import * as THREE from "three";
import type { BaseBuilding, StructureKind } from "../../conserve";
import { createStructureGeometry, type StructureGeometry } from "./structureGeometry";

export type PlacedBuilding = BaseBuilding & { birth: number };

export class StructureInstances {
  readonly group = new THREE.Group();
  readonly geometries: Readonly<Record<StructureKind, StructureGeometry>>;
  private readonly meshes = new Map<StructureKind, THREE.InstancedMesh>();
  private readonly state = new Map<StructureKind, THREE.InstancedBufferAttribute>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);

  /** kinds: the port's (BasePort.kinds; the scene never imports conserve at runtime). */
  constructor(material: THREE.Material, kinds: readonly StructureKind[], max: number) {
    const geos = {} as Record<StructureKind, StructureGeometry>;
    for (const kind of kinds) {
      const g = createStructureGeometry(kind);
      geos[kind] = g;
      const state = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
      state.setUsage(THREE.DynamicDrawUsage);
      const geometry = g.geometry.clone();
      geometry.setAttribute("aState", state);
      const mesh = new THREE.InstancedMesh(geometry, material, max);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.name = `deep-march-structure-${kind}`;
      this.meshes.set(kind, mesh);
      this.state.set(kind, state);
      this.group.add(mesh);
    }
    this.geometries = geos;
  }

  /** Upload every building. */
  set(buildings: readonly PlacedBuilding[]): void {
    const counts = new Map<StructureKind, number>();
    for (const b of buildings) {
      const mesh = this.meshes.get(b.kind)!;
      const i = counts.get(b.kind) ?? 0;
      if (i >= mesh.instanceMatrix.count) continue;
      counts.set(b.kind, i + 1);
      this.q.setFromAxisAngle(this.up, b.yaw);
      this.m.compose(this.v.set(b.pos[0], b.pos[1], b.pos[2]), this.q, this.one);
      mesh.setMatrixAt(i, this.m);
      this.state.get(b.kind)!.setXYZW(i, b.working ? 1 : 0, b.birth, 0, 0);
    }
    for (const [kind, mesh] of this.meshes) {
      mesh.count = counts.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      this.state.get(kind)!.needsUpdate = true;
    }
  }

  /** Draw calls and triangles of the current set. */
  cost(): { draws: number; triangles: number } {
    let draws = 0, triangles = 0;
    for (const [kind, mesh] of this.meshes) {
      if (mesh.count === 0) continue;
      draws++;
      triangles += mesh.count * this.geometries[kind].triangles;
    }
    return { draws, triangles };
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    for (const g of Object.values(this.geometries)) g.geometry.dispose();
  }
}
