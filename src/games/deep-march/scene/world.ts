/** Deep March scene: renderer, underwater look, chunked terrain, first-person sub loop. */
import * as THREE from "three";
import { SEA_COLORS, terrainForDevice } from "../terrain/config";
import { createDensityField } from "../terrain/density";
import { ChunkManager } from "../terrain/chunks";
import { InputController } from "./input";
import { MarineSnow } from "./particles";
import { SubController } from "./submarine";

export type HudLabels = {
  depth: string;
  speed: string;
  heading: string;
  chunks: string;
  loading: string;
  bump: string;
};

export type DeepMarchOptions = {
  seed: number;
  invertPitch: boolean;
  labels: HudLabels;
};

export type DeepMarchHandle = {
  destroy: () => void;
  setThrottleHold: (v: number) => void;
  setBoost: (v: boolean) => void;
};

export function createDeepMarch(host: HTMLElement, opts: DeepMarchOptions): DeepMarchHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  host.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = "none";

  const overlay = document.createElement("div");
  overlay.className = "dm-overlay";
  host.appendChild(overlay);
  const hud = document.createElement("div");
  hud.className = "dm-hud";
  overlay.appendChild(hud);
  const stats = document.createElement("div");
  stats.className = "dm-stats";
  overlay.appendChild(stats);
  const loading = document.createElement("div");
  loading.className = "dm-loading";
  loading.textContent = opts.labels.loading;
  overlay.appendChild(loading);

  const terrain = terrainForDevice();

  // Underwater look — reference: fog == camera background (0, .168, .453), linear fog to viewDistance * .81.
  const fogColor = new THREE.Color().setRGB(SEA_COLORS.fog[0], SEA_COLORS.fog[1], SEA_COLORS.fog[2], THREE.SRGBColorSpace);
  const scene = new THREE.Scene();
  scene.background = fogColor;
  scene.fog = new THREE.Fog(fogColor, 1.5, terrain.viewDistance * SEA_COLORS.fogDstMultiplier);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, terrain.viewDistance + 12);

  const ambient = new THREE.HemisphereLight(0x6a8cbc, 0x1d2c4c, 1.35);
  scene.add(ambient);
  // Reference directional light: colour (1, .957, .839), intensity .57.
  const sun = new THREE.DirectionalLight(new THREE.Color(1, 0.957, 0.839), 1.1);
  sun.position.set(0.3, 1, 0.2);
  scene.add(sun);

  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });

  const field = createDensityField(opts.seed, terrain);
  const chunks = new ChunkManager(scene, field, opts.seed, terrainMat);

  const sub = new SubController(field);
  sub.spawn(0, 0);
  // First person: the camera *is* the sub. Headlight rides on the camera
  // (reference: spot, colour (1, .88, .40), range 60, angle 46°).
  const headlight = new THREE.SpotLight(new THREE.Color(1, 0.884, 0.401), 28, 60, THREE.MathUtils.degToRad(30), 0.55, 1.2);
  headlight.position.set(0, -0.12, 0);
  headlight.target.position.set(0, -0.4, -5);
  camera.add(headlight, headlight.target);
  scene.add(camera);

  const syncCamera = () => {
    camera.position.copy(sub.position);
    camera.quaternion.copy(sub.quaternion);
  };
  syncCamera();

  const snow = new MarineSnow(900, opts.seed);
  scene.add(snow.points);

  const input = new InputController(renderer.domElement, overlay, {
    invertPitch: opts.invertPitch,
  });

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

  let ready = false;
  let raf = 0;
  let last = performance.now();
  let hudTimer = 0;
  let fpsFrames = 0;
  let fpsTime = 0;
  let fps = 0;

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const inp = input.read();
    if (ready) {
      sub.update(dt, inp);
    } else if (chunks.nearReady(sub.position, 14)) {
      ready = true;
      loading.classList.add("done");
    }
    syncCamera();
    chunks.update(sub.position, camera, dt);
    snow.update(camera.position, dt);

    renderer.render(scene, camera);

    fpsFrames++;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      fps = fpsFrames / fpsTime;
      fpsFrames = 0;
      fpsTime = 0;
    }
    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.15;
      const L = opts.labels;
      const heading = ((((-sub.yaw * 180) / Math.PI) % 360) + 360) % 360;
      hud.innerHTML =
        `<span>${L.depth} <b>${(100 - sub.position.y).toFixed(1)} m</b></span>` +
        `<span>${L.speed} <b>${sub.speed.toFixed(1)}</b></span>` +
        `<span>${L.heading} <b>${heading.toFixed(0).padStart(3, "0")}°</b></span>` +
        (sub.sinceBump < 0.4 ? `<span class="dm-bump">${L.bump}</span>` : "");
      const s = chunks.stats();
      stats.textContent = `${fps.toFixed(0)} fps · ${L.chunks} ${s.meshes}/${s.active} · q${s.queued}+${s.pending} · ${(s.triangles / 1000).toFixed(0)}k tri · ${s.workers ? `${s.workers}w` : "main"} ${s.avgMs.toFixed(1)}ms`;
    }
  };
  raf = requestAnimationFrame(frame);

  return {
    setThrottleHold: (v) => {
      input.throttleHold = v;
    },
    setBoost: (v) => {
      input.boostHold = v;
    },
    destroy: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      input.dispose();
      chunks.dispose();
      snow.dispose();
      headlight.dispose();
      terrainMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      overlay.remove();
    },
  };
}
