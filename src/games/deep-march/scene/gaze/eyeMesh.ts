/**
 * The colossal eye (design doc §4.6 stage 5, D7, D12): the only part of the
 * thing beyond the wall that is ever seen, and only through the main slit, in its
 * darkness. A 12-segment curtain (24 triangles, one additive depth-tested draw)
 * inside the slit's dark cut, following the outline across the opening, carries a
 * per-pixel traced sphere 1.5 km across (eyeShader.ts); the lip's rock hides the
 * rest. Placed once per breach; drawn only within `near` m of it. Its look turns
 * from past the world to the base; its slit opens and closes.
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
    const L = GAZE_LOOK.eye, c = L.colors;
    const geo = new THREE.BufferGeometry();
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.u = {
      uEyeC: { value: this.centre },
      uEyeR: { value: new THREE.Vector4(L.size, Math.sin(L.iris), L.slit[0], L.slitH) },
      uEyeLook: { value: this.look },
      uMouth: { value: new THREE.Vector4(0, 0, 1, L.edge) },
      uMouthN: { value: new THREE.Vector4(1, 0, 0, 1) },
      uBand: { value: new THREE.Vector2(L.bandLo, L.bandHi) },
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

  /** Lay the curtain inside the slit's dark cut, `curtain.back` m past the outline across the opening. */
  place(c: ChaosCrackView): void {
    const L = GAZE_LOOK.eye, C = L.curtain;
    const pos = this.strip(c.rim.length);
    c.rim.forEach((r, i) => {
      const x = r.x + r.nx * C.back, z = r.z + r.nz * C.back;
      pos.setXYZ(2 * i, x, C.yBot, z);
      pos.setXYZ(2 * i + 1, x, C.yTop, z);
    });
    pos.needsUpdate = true;
    const ox = c.x + c.nx * C.back, oz = c.z + c.nz * C.back;
    this.centre.set(ox + c.nx * L.distance, L.centreY, oz + c.nz * L.distance);
    (this.u.uMouth.value as THREE.Vector4).set(ox, oz, c.width / 2 + L.jag, L.edge);
    (this.u.uMouthN.value as THREE.Vector4).set(c.nx, c.nz, c.tx, c.tz);
    this.placed = c;
  }

  /** The curtain's vertex buffer for `samples` outline points (two rows), (re)built on a change. */
  private strip(samples: number): THREE.BufferAttribute {
    const geo = this.mesh.geometry;
    const old = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (old?.count === samples * 2) return old;
    const idx: number[] = [];
    for (let i = 0; i + 1 < samples; i++) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    const pos = new THREE.BufferAttribute(new Float32Array(samples * 2 * 3), 3);
    geo.setAttribute("position", pos);
    geo.setIndex(idx);
    return pos;
  }

  update(c: ChaosCrackView | null, f: EyeFrame): void {
    const L = GAZE_LOOK.eye;
    const near = !!c && Math.hypot(f.camera.x - c.x, f.camera.z - c.z) < L.near;
    this.mesh.visible = near && f.presence > 0.001;
    if (!this.mesh.visible) return;
    if (this.placed !== c) this.place(c!);
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
