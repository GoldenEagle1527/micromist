/**
 * The base dome in the dive (design doc §5.5, §5.6): a low cap (≤ 1k
 * triangles) of the protection radius over the base core, lit up from the
 * tide's call to its end; its surface brightens in front of a diver near the
 * edge. One draw, additive, no depth writes.
 */
import * as THREE from "three";
import { TIDE_VIEW } from "./config";
import { DOME_FRAG, DOME_VERT } from "./domeShader";

export class TideDome {
  readonly mesh: THREE.Mesh;
  private readonly u = {
    uColor: { value: new THREE.Color(...TIDE_VIEW.dome.color) },
    uGlow: { value: 0 },
    uTime: { value: 0 },
    uDiver: { value: new THREE.Vector4() },
  };

  constructor() {
    const d = TIDE_VIEW.dome;
    const geo = new THREE.SphereGeometry(1, d.segments, d.rings, 0, Math.PI * 2, 0, Math.PI * d.thetaFraction);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = "deep-march-tide-dome";
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  get triangles(): number {
    return (this.mesh.geometry.index?.count ?? 0) / 3;
  }

  /** glow 0 hides it; edge 0…1 = how close the diver is to leaving. */
  update(at: { x: number; y: number; z: number; radius: number } | null, glow: number, edge: number, diver: THREE.Vector3, time: number): void {
    this.mesh.visible = !!at && glow > 0.001;
    if (!at || !this.mesh.visible) return;
    this.mesh.position.set(at.x, at.y, at.z);
    this.mesh.scale.setScalar(at.radius);
    this.mesh.updateMatrixWorld();
    this.u.uGlow.value = glow;
    this.u.uTime.value = time;
    this.u.uDiver.value.set(diver.x, diver.y, diver.z, edge * TIDE_VIEW.dome.edgeGlow);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
