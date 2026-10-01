/**
 * The colossal eye (design doc §4.6 stage 5, D7, D12): the only part of the
 * thing beyond the wall that is ever seen, and only through the main breach. A
 * 24-segment curtain (48 triangles, one additive depth-tested draw) bent round
 * the breach's outer mouth carries a per-pixel traced sphere 1.5 km across
 * (eyeShader.ts). Placed once per breach; drawn only within `near` m of it.
 * Its look turns from past the world to the base; its slit opens and closes.
 */
import * as THREE from "three";
import type { ChaosCrackView } from "../../conserve";
import type { FogUniforms } from "../fog";
import { GAZE_LOOK } from "./config";
import { EYE_FRAG, EYE_VERT } from "./eyeShader";

export type EyeFrame = {
  camera: THREE.Vector3;
  /** Where it ends up looking (world: the base core, else into the world). */
  target: { x: number; y: number; z: number };
  /** 0 looking past the world … 1 straight at the target. */
  turn: number;
  /** Slit 0 a thin line … 1 open. */
  slit: number;
  /** 0 … 1 (the 封界潮 dims it out). */
  presence: number;
  time: number;
};

export class EyeCurtain {
  readonly mesh: THREE.Mesh;
  private readonly u: Record<string, THREE.IUniform>;
  private readonly centre = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private placed: ChaosCrackView | null = null;

  constructor(fog: FogUniforms) {
    const L = GAZE_LOOK.eye, n = L.curtain.segments, c = L.colors;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array((n + 1) * 2 * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.u = {
      uEyeC: { value: this.centre },
      uEyeR: { value: new THREE.Vector4(L.size, Math.sin(L.iris), L.slit[0], L.slitH) },
      uEyeLook: { value: this.look },
      uMouth: { value: new THREE.Vector4(0, 0, 1, L.edge) },
      uMouthN: { value: new THREE.Vector4(1, 0, 0, 1) },
      uBand: { value: new THREE.Vector2(L.voidLo, L.voidHi) },
      uEyeGlow: { value: new THREE.Vector4(L.gain, L.pierce, 0, 0) },
      uIris: { value: new THREE.Color(...c.iris) },
      uInner: { value: new THREE.Color(...c.inner) },
      uRim: { value: new THREE.Color(...c.rim) },
      uSclera: { value: new THREE.Color(...c.sclera) },
      uFogK: fog.uFogK,
    };
    const material = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: EYE_VERT, fragmentShader: EYE_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.mesh.name = "gaze-eye";
  }

  /** Bend the curtain round the breach's outer mouth (the wall's thickness past its outline point). */
  place(c: ChaosCrackView, thickness: number): void {
    const L = GAZE_LOOK.eye, C = L.curtain, n = C.segments;
    const ox = c.x + c.nx * thickness, oz = c.z + c.nz * thickness;
    const pos = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i <= n; i++) {
      const a = C.halfAngle * ((2 * i) / n - 1);
      const x = ox + C.radius * (c.nx * Math.cos(a) + c.tx * Math.sin(a));
      const z = oz + C.radius * (c.nz * Math.cos(a) + c.tz * Math.sin(a));
      pos.setXYZ(2 * i, x, C.yBot, z);
      pos.setXYZ(2 * i + 1, x, C.yTop, z);
    }
    pos.needsUpdate = true;
    this.centre.set(ox + c.nx * L.distance, L.centreY, oz + c.nz * L.distance);
    (this.u.uMouth.value as THREE.Vector4).set(ox, oz, c.width / 2, L.edge);
    (this.u.uMouthN.value as THREE.Vector4).set(c.nx, c.nz, c.tx, c.tz);
    this.placed = c;
  }

  update(c: ChaosCrackView | null, thickness: number, f: EyeFrame): void {
    const L = GAZE_LOOK.eye;
    const near = !!c && Math.hypot(f.camera.x - c.x, f.camera.z - c.z) < L.near;
    this.mesh.visible = near && f.presence > 0.001;
    if (!this.mesh.visible) return;
    if (this.placed !== c) this.place(c!, thickness);
    const t = f.target, k = f.turn * f.turn * (3 - 2 * f.turn);
    const a = (1 - k) * L.turnFrom;
    const dx = t.x - this.centre.x, dz = t.z - this.centre.z;
    const ca = Math.cos(a), sa = Math.sin(a);
    this.look.set(dx * ca - dz * sa, t.y - this.centre.y, dx * sa + dz * ca).normalize();
    (this.u.uEyeR.value as THREE.Vector4).z = L.slit[0] + (L.slit[1] - L.slit[0]) * f.slit;
    (this.u.uEyeGlow.value as THREE.Vector4).set(L.gain, L.pierce, f.time, f.presence);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
