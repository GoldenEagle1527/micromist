/**
 * The chaos beyond the wall (design doc §4.4 壁外混沌, backlog "墙外混沌壳层"): a
 * low concave curtain (24 segments, 48 triangles, one additive depth-tested draw)
 * standing `radius` m beyond the outer mouth of the nearest THROUGH crack, facing
 * it. The wall's rock hides it everywhere else, so it is only ever seen through
 * the crack. Drawn only while the camera is within `near` m of that crack; else
 * not at all. Its light is the eye's (uShellGlow.y: the director's "watch"
 * factor × the blink); the pupil sweeps across it at stage 4+.
 */
import * as THREE from "three";
import type { ChaosCrackView } from "../../conserve";
import type { FogUniforms } from "../fog";
import { CHAOS_LOOK } from "./config";
import { SHELL_FRAG, SHELL_VERT } from "./chaosShellShader";

export type ShellFrame = { time: number; camera: THREE.Vector3; crack: ChaosCrackView | null; thickness: number; light: number; pupil: number; pupilK: number; stage: number };

export class ChaosShell {
  readonly mesh: THREE.Mesh;
  private readonly u: Record<string, THREE.IUniform>;
  private placed: ChaosCrackView | null = null;

  constructor(fog: FogUniforms) {
    const L = CHAOS_LOOK.shell, n = L.segments;
    const pos = new Float32Array((n + 1) * 2 * 3), side = new Float32Array((n + 1) * 2), idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      side[2 * i] = side[2 * i + 1] = (2 * i) / n - 1;
      if (i < n) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
    geo.setIndex(idx);
    const [a] = L.colors;
    this.u = {
      uTime: { value: 0 },
      uShellGlow: { value: new THREE.Vector4(L.gain, 0, L.pierce, L.cell) },
      uShellBand: { value: new THREE.Vector4(L.yBot, L.yTop, L.edge, L.drift) },
      uShellPupil: { value: new THREE.Vector3(0, 0, CHAOS_LOOK.deep.pupil.width) },
      uShellA: { value: new THREE.Color(...a) },
      uShellB: { value: new THREE.Color(...a) },
      uShellHue: { value: 0 },
      uFogK: fog.uFogK,
    };
    const material = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.mesh.name = "chaos-shell";
  }

  /** Bend the curtain around the crack's outer mouth (the wall's thickness beyond its outline point). */
  private place(c: ChaosCrackView, thickness: number): void {
    const L = CHAOS_LOOK.shell, n = L.segments;
    const ox = c.x + c.nx * thickness, oz = c.z + c.nz * thickness;
    const pos = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i <= n; i++) {
      const a = L.halfAngle * ((2 * i) / n - 1);
      const x = ox + L.radius * (c.nx * Math.cos(a) + c.tx * Math.sin(a));
      const z = oz + L.radius * (c.nz * Math.cos(a) + c.tz * Math.sin(a));
      pos.setXYZ(2 * i, x, L.yBot, z);
      pos.setXYZ(2 * i + 1, x, L.yTop, z);
    }
    pos.needsUpdate = true;
    this.placed = c;
  }

  update(f: ShellFrame): void {
    const L = CHAOS_LOOK.shell, c = f.crack;
    const near = !!c && Math.hypot(f.camera.x - c.x, f.camera.z - c.z) < L.near;
    this.mesh.visible = near && f.light > 0.001;
    if (!this.mesh.visible) return;
    if (this.placed !== c) this.place(c!, f.thickness);
    const u = this.u, cols = L.colors;
    const from = cols[Math.min(cols.length - 1, Math.max(0, f.stage - 3))], to = cols[Math.min(cols.length - 1, Math.max(1, f.stage - 2))];
    (u.uShellA.value as THREE.Color).setRGB(from[0], from[1], from[2]);
    (u.uShellB.value as THREE.Color).setRGB(to[0], to[1], to[2]);
    u.uShellHue.value = 0.5 + 0.5 * Math.sin((2 * Math.PI * f.time) / L.hueS);
    u.uTime.value = f.time;
    (u.uShellGlow.value as THREE.Vector4).y = f.light;
    (u.uShellPupil.value as THREE.Vector3).set(f.pupil, f.pupilK * CHAOS_LOOK.deep.pupil.dark, CHAOS_LOOK.deep.pupil.width);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
