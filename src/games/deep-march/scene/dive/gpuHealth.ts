/**
 * System check and GPU health: compile the dive's programs (terrain base + LOD
 * crossfade, wall ring, nodes, buildings) before the dive, so neither the first
 * frame nor the first LOD swap hitches. A program that fails to link is skipped
 * by three at draw time (nothing drawn, no exception), so the check touches
 * every compiled program (three's link check runs on first use) and surfaces a
 * failure, with the driver logs and GPU facts, on the loading screen (and
 * in-game) instead of silently rendering nothing. Also WebGL context loss.
 */
import * as THREE from "three";
import type { DiveAudio } from "../audio";
import { failureReport, gpuInfo, type GpuInfo } from "../gpuDiagnostics";

export type AlertLabels = { gpuLost: string; shaderFailed: string };

export class GpuHealth {
  readonly gpu: GpuInfo;
  shadersReady = false;
  shaderError: string | null = null;
  gpuLost = false;
  private destroyed = false;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly audio: DiveAudio;
  private readonly alertBox: HTMLElement;
  private readonly labels: () => AlertLabels;

  constructor(renderer: THREE.WebGLRenderer, audio: DiveAudio, alertBox: HTMLElement, labels: () => AlertLabels) {
    this.renderer = renderer;
    this.audio = audio;
    this.alertBox = alertBox;
    this.labels = labels;
    // GPU facts for the system check (and for any failure report)
    const gpu = (this.gpu = gpuInfo(renderer.getContext()));
    console.info(`[deep-march] GPU: ${gpu.renderer} · texture units ${gpu.textureUnits} · fragment uniform vectors ${gpu.fragmentVectors} · fragment highp ${gpu.highp ? "yes" : "no"}`);
    renderer.debug.onShaderError = (gl, program, vs, fs) => {
      const fsSource = gl.getShaderSource(fs) ?? "";
      const seabedProgram = /#define DM_SONAR_N/.test(fsSource) && !/#define DM_NODE/.test(fsSource);
      const report = failureReport(gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs));
      console.error(`[deep-march] shader program failed to link${seabedProgram ? " (seabed)" : ""}:\n${report}\nGPU: ${gpu.renderer}`);
      this.shaderError ??= `${seabedProgram ? "seabed: " : ""}${report}`;
      this.updateAlert();
    };
  }

  /** Warm-compile `materials` (on an empty geometry) and `extras` (stand-ins with their own geometry). */
  warm(materials: readonly THREE.Material[], extras: readonly THREE.Object3D[], camera: THREE.Camera, scene: THREE.Scene): void {
    const geo = new THREE.BufferGeometry();
    const group = new THREE.Group();
    for (const m of materials) group.add(new THREE.Mesh(geo, m));
    for (const o of extras) group.add(o);
    const renderer = this.renderer;
    renderer
      .compileAsync(group, camera, scene)
      .catch((e: unknown) => console.error("[deep-march] shader compile failed:", e))
      .then(() => {
        // first use runs three's link check → onShaderError on failure
        if (!this.destroyed) for (const p of renderer.info.programs ?? []) p.getUniforms();
      })
      .finally(() => {
        this.shadersReady = true;
        geo.dispose();
      });
  }

  /** Listen for WebGL context loss / restore. */
  listen(): void {
    this.renderer.domElement.addEventListener("webglcontextlost", this.onLost);
    this.renderer.domElement.addEventListener("webglcontextrestored", this.onRestored);
  }

  private readonly onLost = (e: Event) => {
    e.preventDefault(); // allow three to restore
    this.gpuLost = true;
    this.audio.hold("gpu", true);
    console.error("[deep-march] WebGL context lost");
    this.updateAlert();
  };

  private readonly onRestored = () => {
    this.gpuLost = false;
    this.audio.hold("gpu", false);
    this.updateAlert();
  };

  /** The in-game alert line (also after a language change). */
  updateAlert(): void {
    const l = this.labels();
    const msg = this.gpuLost ? l.gpuLost : this.shaderError ? `${l.shaderFailed}: ${this.shaderError}` : "";
    this.alertBox.textContent = msg;
    this.alertBox.classList.toggle("on", msg !== "");
  }

  dispose(): void {
    this.destroyed = true;
    this.renderer.domElement.removeEventListener("webglcontextlost", this.onLost);
    this.renderer.domElement.removeEventListener("webglcontextrestored", this.onRestored);
    this.renderer.debug.onShaderError = null;
  }
}
