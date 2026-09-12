import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { createSoftPointTexture } from "./scene/glow";
import { createHud } from "./scene/hud";
import { createPlayfield } from "./scene/playfield";
import { seedFromInput } from "./scene/seed";
import type { LumenGameOptions, LumenLabels } from "./types";

export type { LumenGameOptions, LumenLabels };

export type LumenWeaveHandle = {
  destroy: (removeCanvas?: boolean) => void;
};

export function createLumenWeaveGame(
  parent: HTMLElement,
  options: LumenGameOptions,
): LumenWeaveHandle {
  parent.replaceChildren();

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.autoClear = true;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "none";
  parent.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, 18, 72);

  const camera = new THREE.PerspectiveCamera(72, 800 / 480, 0.08, 120);

  const glowMap = createSoftPointTexture();
  const hud = createHud(parent, options.labels);
  const seedNumeric = seedFromInput(options.seed);
  const playfield = createPlayfield({
    scene,
    camera,
    seed: options.seed.trim() || String(seedNumeric),
    seedNumeric,
    cruise: options.cruise,
    labels: options.labels,
    hud,
    glowMap,
    biomeName: options.biomeName,
  });

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(800, 480), 0.88, 0.52, 0.14);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const clock = new THREE.Clock();
  let disposed = false;

  const fit = () => {
    if (disposed) return;
    const w = Math.max(2, parent.clientWidth || 800);
    const h = Math.max(2, parent.clientHeight || 480);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const ro = new ResizeObserver(fit);
  ro.observe(parent);
  fit();

  const canvas = renderer.domElement;

  const toNdc = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    return {
      nx: ((event.clientX - rect.left) / w) * 2 - 1,
      ny: ((event.clientY - rect.top) / h) * 2 - 1,
    };
  };

  const onPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const { nx, ny } = toNdc(event);
    playfield.pointerDown(nx, ny);
  };
  const onPointerMove = (event: PointerEvent) => {
    const { nx, ny } = toNdc(event);
    playfield.pointerMove(nx, ny);
  };
  const onPointerUp = (event: PointerEvent) => {
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    playfield.pointerUp();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    playfield.setKey(event.code, true);
    if (
      event.code === "ArrowUp" ||
      event.code === "ArrowDown" ||
      event.code === "ArrowLeft" ||
      event.code === "ArrowRight" ||
      event.code === "Space"
    ) {
      event.preventDefault();
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    playfield.setKey(event.code, false);
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  const tick = () => {
    if (disposed) return;
    playfield.update(clock.getDelta());
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
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    playfield.dispose();
    hud.dispose();
    glowMap.dispose();
    composer.dispose();
    renderer.dispose();
    parent.replaceChildren();
  };

  return { destroy };
}
