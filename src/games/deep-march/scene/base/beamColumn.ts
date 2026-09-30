/**
 * The lit lighthouses' visible light (plan M5, §6.2): one instanced additive
 * draw — per lit lighthouse a vertical column over the lantern and two
 * horizontal cones that sweep around it (the instance's yaw follows
 * baseLight.ts sweepAngle, in step with the light on the terrain).
 */
import * as THREE from "three";
import { BASE_LIGHT } from "./config";
import { BEAM_COLUMN_FRAG, BEAM_COLUMN_VERT } from "./beamShader";

const SIDES = 8;

/** Column (part 0) and two sweep cones (part 1) around the lantern at the origin, metres. */
export function beamGeometry(): { geometry: THREE.BufferGeometry; triangles: number } {
  const pos: number[] = [], nrm: number[] = [], beam: number[] = [], idx: number[] = [];
  const ring = (cx: number, cy: number, cz: number, axis: "y" | "x", sign: number, r: number, t: number, part: number) => {
    const base = pos.length / 3;
    for (let i = 0; i < SIDES; i++) {
      const a = (i / SIDES) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      if (axis === "y") pos.push(cx + c * r, cy, cz + s * r), nrm.push(c, 0, s);
      else pos.push(cx, cy + c * r, cz + s * r * sign), nrm.push(0, c, s * sign);
      beam.push(t, part);
    }
    return base;
  };
  const tube = (a: number, b: number) => {
    for (let i = 0; i < SIDES; i++) {
      const j = (i + 1) % SIDES;
      idx.push(a + i, b + i, b + j, a + i, b + j, a + j);
    }
  };
  const H = BASE_LIGHT.columnHeight, R = BASE_LIGHT.columnRadius;
  const c0 = ring(0, 0, 0, "y", 1, R * 0.7, 0, 0), c1 = ring(0, H * 0.35, 0, "y", 1, R, 0.35, 0), c2 = ring(0, H, 0, "y", 1, R * 1.5, 1, 0);
  tube(c0, c1);
  tube(c1, c2);
  const L = BASE_LIGHT.radius, spread = L * Math.tan(Math.acos(BASE_LIGHT.sweepCos));
  for (const sign of [1, -1]) {
    const b0 = ring(sign * 1.5, 0, 0, "x", sign, 0.8, 0, 1), b1 = ring(sign * L, 0, 0, "x", sign, spread, 1, 1);
    tube(b0, b1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("aBeam", new THREE.Float32BufferAttribute(beam, 2));
  g.setIndex(idx);
  return { geometry: g, triangles: idx.length / 3 };
}

export class BeamColumns {
  readonly mesh: THREE.InstancedMesh;
  readonly triangles: number;
  private readonly time = { value: 0 };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(max: number, far: number) {
    const { geometry, triangles } = beamGeometry();
    this.triangles = triangles;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uBeamTint: { value: new THREE.Color(...BASE_LIGHT.color) },
        uBeamParams: { value: new THREE.Vector4(BASE_LIGHT.columnAlpha, BASE_LIGHT.columnFog, far, 0) },
        uTime: this.time,
      },
      vertexShader: BEAM_COLUMN_VERT,
      fragmentShader: BEAM_COLUMN_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 10;
    this.mesh.name = "deep-march-lighthouse-beams";
  }

  /** Lanterns of the lit lighthouses; `angle`: sweep (rad, baseLight.ts). */
  set(lanterns: readonly { x: number; y: number; z: number }[], angle: number, time: number): void {
    const n = Math.min(lanterns.length, this.mesh.instanceMatrix.count);
    this.q.setFromAxisAngle(this.up, -angle);
    for (let i = 0; i < n; i++) {
      const l = lanterns[i];
      this.m.compose(this.v.set(l.x, l.y, l.z), this.q, this.one);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.time.value = time;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
