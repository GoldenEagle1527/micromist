/**
 * The WebGL renderer and frame pacing, and the canvas overlay (lock prompt,
 * stats line, in-game alert).
 */
import * as THREE from "three";
import { FramePacer } from "../framePacer";

export function createRenderer(host: HTMLElement, lowSpec: boolean, dpr: number): { renderer: THREE.WebGLRenderer; pacer: FramePacer } {
  // Desktop keeps MSAA and a pixel ratio floating 1.25–1.75; low-spec (touch / ≤ 4 cores)
  // drops MSAA and stays ≤ 1.25. The debug panel's 像素比 pins the ratio (screenshots / debugging).
  const renderer = new THREE.WebGLRenderer({ antialias: !lowSpec, powerPreference: "high-performance" });
  const deviceRatio = window.devicePixelRatio || 1;
  const maxRatio = Math.min(deviceRatio, lowSpec ? 1.25 : 1.75);
  const pacer = new FramePacer({
    // phones / low-spec: 30 fps (half the GPU work and heat); desktop 60
    maxFps: lowSpec ? 30 : 60,
    maxRatio,
    minRatio: Math.min(maxRatio, lowSpec ? 0.75 : 1.25),
    fixed: dpr > 0 ? Math.min(dpr, 3) : undefined,
  });
  renderer.setPixelRatio(pacer.ratio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  host.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = "none";
  return { renderer, pacer };
}

export type Overlay = { root: HTMLDivElement; lockPrompt: HTMLDivElement; stats: HTMLDivElement; alert: HTMLDivElement };

export function createOverlay(host: HTMLElement, lockPrompt: string): Overlay {
  const div = (cls: string) => {
    const d = document.createElement("div");
    d.className = cls;
    return d;
  };
  const root = div("dm-overlay");
  host.appendChild(root);
  const prompt = div("dm-lock-prompt");
  prompt.textContent = lockPrompt;
  root.appendChild(prompt);
  const stats = div("dm-stats");
  root.appendChild(stats);
  // in-game alert (GPU context lost / shader failure after the loading screen)
  const alert = div("dm-alert");
  alert.setAttribute("role", "alert");
  root.appendChild(alert);
  return { root, lockPrompt: prompt, stats, alert };
}

/** Keep the canvas and the camera's aspect at the host's size; returns the resize (also for pixel-ratio changes). */
export function watchResize(host: HTMLElement, renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): { resize: () => void; dispose: () => void } {
  const resize = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  return { resize, dispose: () => ro.disconnect() };
}
