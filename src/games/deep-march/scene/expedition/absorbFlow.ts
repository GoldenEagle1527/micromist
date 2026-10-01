/**
 * The particle inflow while absorbing (backlog "粒子流入特效", the light version):
 * one THREE.Points draw — phone 48 / desktop 160 specks — streaming from the
 * aimed node or cache into the tank just below the view, tinted by the node's
 * particle kind. Everything moves in the vertex shader (absorbFlowShader.ts); the
 * CPU sets two points and a fade per frame. Fades in / out over ~0.25 s; hidden
 * when idle. A soft running-water loop ("flow") follows the same fade.
 */
import * as THREE from "three";
import type { DiveAudio } from "../audio";
import { FLOW_FRAG, FLOW_VERT } from "./absorbFlowShader";

export const ABSORB_FLOW = { count: 160, countLow: 48, fadeS: 0.25, gain: 0.32, below: 0.32, ahead: 0.55 } as const;

export type FlowSource = { x: number; y: number; z: number; tint: THREE.Color };

export class AbsorbFlow {
  readonly points: THREE.Points;
  private readonly u: { [k: string]: THREE.IUniform };
  private level = 0;
  private readonly audio: DiveAudio;

  constructor(lowSpec: boolean, seed: number, audio: DiveAudio) {
    this.audio = audio;
    const n = lowSpec ? ABSORB_FLOW.countLow : ABSORB_FLOW.count;
    let s = (seed ^ 0x51f15e) >>> 0 || 1;
    const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const seeds = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) seeds.set([rand(), rand() * Math.PI * 2, 0.05 + 0.3 * rand() * rand()], i * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
    this.u = {
      uTime: { value: 0 },
      uFrom: { value: new THREE.Vector3() },
      uTo: { value: new THREE.Vector3() },
      uFlow: { value: 0 },
      uPR: { value: 1 },
      uTint: { value: new THREE.Color() },
    };
    const material = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: FLOW_VERT, fragmentShader: FLOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.renderOrder = 12;
    this.points.name = "absorb-flow";
  }

  /** Per frame: the source while particles move (null = none), the eye and unit view direction. */
  update(dt: number, time: number, from: FlowSource | null, eye: THREE.Vector3, dir: THREE.Vector3): void {
    const F = ABSORB_FLOW;
    this.level = Math.max(0, Math.min(1, this.level + (from ? dt : -dt) / F.fadeS));
    this.audio.setLoop("flow", this.level * F.gain);
    this.points.visible = this.level > 0.001;
    if (!this.points.visible) return;
    const u = this.u;
    if (from) {
      (u.uFrom.value as THREE.Vector3).set(from.x, from.y, from.z);
      (u.uTint.value as THREE.Color).copy(from.tint);
    }
    (u.uTo.value as THREE.Vector3).copy(eye).addScaledVector(dir, F.ahead).y -= F.below;
    u.uTime.value = time;
    u.uFlow.value = this.level;
    u.uPR.value = Math.min(window.devicePixelRatio || 1, 2);
  }

  dispose(): void {
    this.audio.setLoop("flow", 0);
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
