/** structureShapes.ts → BufferGeometry (position, normal, aGlow) per building kind, shared by instances and the hologram. */
import * as THREE from "three";
import type { StructureKind } from "../../conserve";
import { structureShape } from "./structureShapes";

export type StructureGeometry = { geometry: THREE.BufferGeometry; triangles: number; height: number };

export function createStructureGeometry(kind: StructureKind): StructureGeometry {
  const s = structureShape(kind);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(s.position, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(s.normal, 3));
  g.setAttribute("aGlow", new THREE.Float32BufferAttribute(s.glow, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return { geometry: g, triangles: s.triangles, height: g.boundingBox!.max.y };
}
