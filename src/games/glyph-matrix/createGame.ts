import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { GlyphMatrixHandle, GlyphMatrixOptions } from "./types";
import { createWorld } from "./scene/world";

export type { GlyphMatrixHandle, GlyphMatrixOptions } from "./types";

export function createGlyphMatrixGame(
  parent: HTMLElement,
  options: GlyphMatrixOptions,
): GlyphMatrixHandle {
  parent.replaceChildren();

  const stage = document.createElement("div");
  stage.className = "glyph-matrix-stage";
  parent.appendChild(stage);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x03060c, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "none";
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(68, 800 / 480, 0.08, 120);

  const world = createWorld(scene, camera, options);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(800, 480), 0.72, 0.48, 0.18);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const clock = new THREE.Clock();
  let disposed = false;

  const fit = () => {
    if (disposed) return;
    const w = Math.max(2, stage.clientWidth || 800);
    const h = Math.max(2, stage.clientHeight || 480);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const ro = new ResizeObserver(fit);
  ro.observe(stage);
  fit();

  const canvas = renderer.domElement;

  const toNdc = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    return {
      nx: ((event.clientX - rect.left) / w) * 2 - 1,
      ny: -(((event.clientY - rect.top) / h) * 2 - 1),
    };
  };

  const onPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const { nx, ny } = toNdc(event);
    world.setPointerNdc(nx, ny);
  };
  const onPointerMove = (event: PointerEvent) => {
    const { nx, ny } = toNdc(event);
    world.setPointerNdc(nx, ny);
  };
  const onPointerUp = (event: PointerEvent) => {
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    // Keep last position for desktop hover; clear on touch end
    if (event.pointerType === "touch") {
      world.clearPointer();
    }
  };
  const onPointerLeave = () => {
    world.clearPointer();
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);

  const tick = () => {
    if (disposed) return;
    world.update(clock.getDelta());
    composer.render();
  };
  renderer.setAnimationLoop(tick);

  const destroy = (_removeCanvas?: boolean) => {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    ro.disconnect();
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    world.dispose();
    composer.dispose();
    renderer.dispose();
    parent.replaceChildren();
  };

  return { destroy };
}
