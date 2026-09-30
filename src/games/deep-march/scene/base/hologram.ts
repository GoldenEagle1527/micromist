/**
 * Placement preview (plan M5, §6.1 "hologram, red / green"): the chosen
 * building's mesh as a hologram at the probed ground point (1 draw), and two
 * flat rings (1 instanced draw): its footprint, and the protection radius
 * (or, for the core, the radius the base starts with).
 */
import * as THREE from "three";
import type { StructureKind } from "../../conserve";
import { HOLO_FRAG, HOLO_VERT } from "./hologramShader";
import type { StructureGeometry } from "./structureGeometry";

const OK = new THREE.Color(0.25, 1.0, 0.55);
const BAD = new THREE.Color(1.0, 0.28, 0.22);
const RING_BASE = new THREE.Color(0.35, 0.7, 1.0);

export class Hologram {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly rings: THREE.InstancedMesh;
  private readonly color = { value: OK.clone() };
  private readonly params = { value: new THREE.Vector2(0.9, 0) };
  private readonly geos: Readonly<Record<StructureKind, StructureGeometry>>;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly c = new THREE.Color();

  constructor(geometries: Readonly<Record<StructureKind, StructureGeometry>>) {
    this.geos = geometries;
    const material = new THREE.ShaderMaterial({
      uniforms: { uHoloColor: this.color, uHoloParams: this.params },
      vertexShader: HOLO_VERT,
      fragmentShader: HOLO_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometries.core.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    const ring = new THREE.RingGeometry(0.965, 1, 64, 1).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false });
    this.rings = new THREE.InstancedMesh(ring, ringMat, 2);
    // instance colours from the start: one program variant (the warm compile's)
    this.rings.setColorAt(0, OK);
    this.rings.setColorAt(1, RING_BASE);
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 12;
    this.group.add(this.mesh, this.rings);
    this.group.visible = false;
    this.group.name = "deep-march-hologram";
  }

  /** Show `kind` at (x, y, z) facing `yaw`; area: centre and radius of the base ring (null: none). */
  show(kind: StructureKind, x: number, y: number, z: number, yaw: number, radius: number, ok: boolean, area: { x: number; y: number; z: number; r: number } | null, time: number): void {
    this.group.visible = true;
    this.mesh.geometry = this.geos[kind].geometry;
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.set(0, yaw, 0);
    this.color.value.copy(ok ? OK : BAD);
    this.params.value.y = time;
    this.q.setFromAxisAngle(this.up, 0);
    this.m.compose(new THREE.Vector3(x, y + 0.4, z), this.q, new THREE.Vector3(radius, 1, radius));
    this.rings.setMatrixAt(0, this.m);
    this.rings.setColorAt(0, this.c.copy(ok ? OK : BAD));
    if (area) {
      this.m.compose(new THREE.Vector3(area.x, area.y + 0.6, area.z), this.q, new THREE.Vector3(area.r, 1, area.r));
      this.rings.setMatrixAt(1, this.m);
      this.rings.setColorAt(1, this.c.copy(RING_BASE));
    }
    this.rings.count = area ? 2 : 1;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
  }

  /** Stand-ins with the same programs, for the loading screen's warm compile. */
  warmObjects(): THREE.Object3D[] {
    const rings = new THREE.InstancedMesh(this.rings.geometry, this.rings.material, 1);
    rings.setColorAt(0, OK);
    return [new THREE.Mesh(this.mesh.geometry, this.mesh.material), rings];
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(): void {
    (this.mesh.material as THREE.Material).dispose();
    this.rings.geometry.dispose();
    (this.rings.material as THREE.Material).dispose();
    this.rings.dispose();
  }
}
