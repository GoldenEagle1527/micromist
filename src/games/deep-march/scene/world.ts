/** Deep March scene: renderer, underwater look, chunked terrain, first-person diver loop. */
import * as THREE from "three";
import { SEA_COLORS, isLowSpecDevice, terrainForDevice } from "../terrain/config";
import { createDensityField } from "../terrain/density";
import { ChunkManager } from "../terrain/chunks";
import type { EnvironmentKind, SurfaceType } from "../terrain/terrainInfo";
import { REGION_KEYS, createRegionSample, type RegionKey } from "../terrain/regions";
import { SpawnDebugView } from "./spawnDebug";
import { InputController, type PanelInput } from "./input";
import { MarineSnow } from "./particles";
import { createSeabedMaterial } from "./seabedMaterial";
import { DiverController, type DiverState } from "./diver";

export type HudLabels = {
  chunks: string;
  floaters: string;
  tris: string;
  mainThread: string;
  classify: string;
  spawnDebugTitle: string;
  surfaceTypes: Record<SurfaceType, string>;
  regionDebugTitle: string;
  regionNames: Record<RegionKey, string>;
  regionEdge: string;
  loading: string;
  lockPrompt: string;
};

export type DeepMarchOptions = {
  seed: number;
  sensitivity: number;
  invertY: boolean;
  panel: boolean;
  labels: HudLabels;
};

export type Telemetry = {
  depth: number;
  heading: number;
  pitch: number;
  speed: number;
  state: DiverState;
  contact: "floor" | "ceiling" | "wall" | null;
  /** Stable terrain classification around the diver (null until first evaluation). */
  terrain: EnvironmentKind | null;
  /** Macro region under the diver (switches once the new region dominates, no flicker on borders). */
  region: RegionKey | null;
  lamp: boolean;
  swimLatch: boolean;
  ready: boolean;
  /** Simulated ticks so far (20/s of sim time). */
  ticks: number;
  x: number;
  y: number;
  z: number;
};

export type DeepMarchHandle = {
  destroy: () => void;
  /** Analog state from the on-screen panel. */
  panelInput: PanelInput;
  setPanelMode: (on: boolean) => void;
  /** Push new UI strings (language change) to the canvas overlay and debug legend. */
  setLabels: (labels: HudLabels) => void;
  addLook: (dxPx: number, dyPx: number, touch: boolean) => void;
  toggleLamp: () => boolean;
  toggleSwimLatch: () => boolean;
  telemetry: () => Telemetry;
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
  const lockPrompt = document.createElement("div");
  lockPrompt.className = "dm-lock-prompt";
  lockPrompt.textContent = opts.labels.lockPrompt;
  overlay.appendChild(lockPrompt);
  const stats = document.createElement("div");
  stats.className = "dm-stats";
  overlay.appendChild(stats);
  const loading = document.createElement("div");
  loading.className = "dm-loading";
  loading.textContent = opts.labels.loading;
  overlay.appendChild(loading);

  const lowSpec = isLowSpecDevice();
  const terrain = terrainForDevice(lowSpec);

  // Underwater look — reference: fog == camera background (0, .168, .453), linear fog to viewDistance * .81.
  const fogColor = new THREE.Color().setRGB(SEA_COLORS.fog[0], SEA_COLORS.fog[1], SEA_COLORS.fog[2], THREE.SRGBColorSpace);
  const baseFog = fogColor.clone();
  let lastDeep = 0;
  const scene = new THREE.Scene();
  scene.background = fogColor;
  scene.fog = new THREE.Fog(fogColor, 1.5, terrain.viewDistance * SEA_COLORS.fogDstMultiplier);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, terrain.viewDistance + 12);

  // Down-welling light: teal sky fill from above, very dark from below,
  // plus a blue-green filtered "sun" from the surface.
  const ambient = new THREE.HemisphereLight(0x3f86a6, 0x0a1426, 0.95);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(new THREE.Color(0.55, 0.85, 1.0), 1.05);
  sun.position.set(0.25, 1, 0.15);
  scene.add(sun);

  let texturesReady = false;
  const seabed = createSeabedMaterial({
    lowSpec,
    anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
    onReady: () => {
      texturesReady = true;
    },
  });
  const terrainMat = seabed.material;

  const field = createDensityField(opts.seed, terrain);
  const chunks = new ChunkManager(scene, field, opts.seed, terrainMat);

  const diver = new DiverController(field, (x, y, z) => chunks.isRemoved(x, y, z));
  // HUD terrain chip: lookup in the generation-time class grid (no probing), with
  // a short hold so the label doesn't flicker on class-cell borders.
  let terrainKind: EnvironmentKind | null = null;
  let terrainCandidate: EnvironmentKind | null = null;
  let terrainHold = 0;
  const TERRAIN_HOLD = 0.3;
  const updateTerrainKind = (dt: number) => {
    const k = chunks.terrain.getEnvAt(diver.position.x, diver.position.y, diver.position.z)?.kind ?? null;
    if (k === null || k === terrainKind) {
      terrainCandidate = null;
      return;
    }
    if (terrainKind === null) {
      terrainKind = k;
      return;
    }
    if (k !== terrainCandidate) {
      terrainCandidate = k;
      terrainHold = 0;
      return;
    }
    terrainHold += dt;
    if (terrainHold >= TERRAIN_HOLD) terrainKind = k;
  };
  // Debug: spawn-candidate markers (B, or ?debugSpawns=1); off in normal play.
  let labels = opts.labels;
  const spawnDebug = new SpawnDebugView(scene, chunks.terrain, field.regions, overlay, labels);
  // HUD region chip: dominant macro region with hysteresis (switch at ≥ 60 % weight).
  const regionSample = createRegionSample();
  let regionId = -1;
  const updateRegion = () => {
    const r = field.regions.sample(diver.position.x, diver.position.z, regionSample);
    if (regionId < 0 || (r.id !== regionId && r.w[r.id] >= 0.6)) regionId = r.id;
  };
  if (new URLSearchParams(window.location.search).get("debugSpawns") === "1") spawnDebug.setVisible(true);
  const onDebugKey = (ev: KeyboardEvent) => {
    if (ev.code !== "KeyB" || ev.repeat) return;
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    spawnDebug.setVisible(!spawnDebug.visible);
  };
  window.addEventListener("keydown", onDebugKey);
  // Spawn at the core of the reef-forest region nearest the origin (in water: diver.spawn
  // picks the tallest water gap around that point).
  const spawnAt = field.regions.spawnPoint();
  diver.spawn(spawnAt.x, spawnAt.z);
  // Optional viewpoint for sharing / screenshots: ?at=x,y,z,yawDeg,pitchDeg.
  const at = new URLSearchParams(window.location.search).get("at");
  if (at) {
    const v = at.split(",").map(Number);
    if (v.length >= 3 && v.every(Number.isFinite)) {
      diver.position.set(v[0], v[1], v[2]);
      diver.prev.copy(diver.position);
      diver.setView(((v[3] ?? 0) * Math.PI) / 180, ((v[4] ?? 0) * Math.PI) / 180);
    }
  }
  // First person: the camera is the diver's eyes; the head lamp rides just above them.
  const BASE_FOV = 70;
  const lamp = new THREE.SpotLight(new THREE.Color(1, 0.95, 0.85), 8, 40, THREE.MathUtils.degToRad(30), 0.75, 1.3);
  // Source sits a little behind the eyes so a wall at arm's length doesn't blow out.
  lamp.position.set(0.04, 0.06, 0.35);
  lamp.target.position.set(0, -0.1, -5);
  camera.add(lamp, lamp.target);
  scene.add(camera);
  let lampOn = true;

  let fovMod = 1;
  let swimBlend = 0;
  let bobT = 0;
  const renderPos = new THREE.Vector3();
  const syncCamera = (dt: number) => {
    // MC sprint FOV: fov × (1 + 0.15) eased ~0.5 per tick; body goes horizontal → eyes a bit lower.
    const swimming = diver.state === "swim";
    const target = swimming ? 1.15 : 1;
    fovMod += (target - fovMod) * (1 - Math.pow(0.5, dt * 20));
    swimBlend += ((swimming ? 1 : 0) - swimBlend) * Math.min(1, dt * 6);
    bobT += dt * (1.2 + swimBlend * 1.6);
    const fov = BASE_FOV * fovMod;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    diver.renderPosition(renderPos);
    camera.position.copy(renderPos);
    camera.position.y += -0.05 * swimBlend + Math.sin(bobT) * (0.008 + 0.006 * swimBlend);
    camera.quaternion.copy(diver.quaternion);
    if (swimBlend > 0.001) {
      // subtle roll with the stroke while swimming
      camera.rotateZ(Math.sin(bobT * 0.5) * 0.012 * swimBlend);
    }
  };
  syncCamera(0);

  const snow = new MarineSnow(900, opts.seed);
  scene.add(snow.points);

  const toggleLamp = () => {
    lampOn = !lampOn;
    lamp.visible = lampOn;
    return lampOn;
  };
  const input = new InputController(renderer.domElement, {
    sensitivity: opts.sensitivity,
    invertY: opts.invertY,
    onLampToggle: toggleLamp,
    onLockChange: () => updatePrompt(),
  });
  input.panelMode = opts.panel;
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const updatePrompt = () => {
    lockPrompt.classList.toggle("on", ready && !input.panelMode && !input.locked && !coarse);
  };

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
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.05, rawDt);
    last = now;

    const [dYaw, dPitch] = input.takeLook();
    diver.look(-dYaw, -dPitch);
    if (ready) {
      diver.update(dt, input.move());
      if (diver.lastTicks > 0) input.consumePulse();
    } else if (texturesReady && chunks.nearReady(diver.position, 14)) {
      ready = true;
      loading.classList.add("done");
      updatePrompt();
    }
    syncCamera(dt);
    chunks.update(diver.position, camera, dt);
    spawnDebug.update();
    snow.update(camera.position, dt);
    seabed.update(now / 1000);

    renderer.render(scene, camera);

    fpsFrames++;
    fpsTime += rawDt; // real time, not the clamped sim step
    if (fpsTime >= 0.5) {
      fps = fpsFrames / fpsTime;
      fpsFrames = 0;
      fpsTime = 0;
    }
    // Deeper water is darker (deep trench): fog and light fade below y ≈ −8.
    const deep = THREE.MathUtils.smoothstep(-camera.position.y, 8, 22);
    if (Math.abs(deep - lastDeep) > 0.002) {
      lastDeep = deep;
      fogColor.copy(baseFog).multiplyScalar(1 - 0.62 * deep);
      (scene.fog as THREE.Fog).color.copy(fogColor);
      ambient.intensity = 0.95 * (1 - 0.55 * deep);
      sun.intensity = 1.05 * (1 - 0.7 * deep);
    }

    hudTimer -= dt;
    if (hudTimer <= 0) {
      updateTerrainKind(0.25 - hudTimer);
      updateRegion();
      spawnDebug.updateDiver(diver.position.x, diver.position.z, -diver.yaw);
      hudTimer = 0.25;
      const st = chunks.stats();
      stats.textContent = `${fps.toFixed(0)} fps · ${labels.chunks} ${st.meshes}/${st.active} · −${st.floaters} ${labels.floaters} · q${st.queued}+${st.pending} · ${(st.triangles / 1000).toFixed(0)}k ${labels.tris} · ${st.workers ? `${st.workers}w` : labels.mainThread} ${st.avgMs.toFixed(1)}ms (${labels.classify} ${st.avgInfoMs.toFixed(1)})`;
    }
  };
  raf = requestAnimationFrame(frame);

  return {
    panelInput: input.panel,
    setPanelMode: (on) => {
      input.panelMode = on;
      if (on) input.releaseLock();
      updatePrompt();
    },
    setLabels: (next) => {
      labels = next;
      lockPrompt.textContent = next.lockPrompt;
      loading.textContent = next.loading;
      spawnDebug.setLabels(next);
      hudTimer = 0;
    },
    addLook: (dx, dy, touch) => input.addLookPx(dx, dy, touch),
    toggleLamp,
    toggleSwimLatch: () => {
      input.panel.swimLatch = !input.panel.swimLatch;
      return input.panel.swimLatch;
    },
    telemetry: () => ({
      depth: 100 - diver.position.y,
      heading: ((((-diver.yaw * 180) / Math.PI) % 360) + 360) % 360,
      pitch: (diver.pitch * 180) / Math.PI,
      speed: diver.speed,
      state: diver.state,
      contact: diver.contact,
      terrain: terrainKind,
      region: regionId >= 0 ? REGION_KEYS[regionId] : null,
      lamp: lampOn,
      swimLatch: input.panel.swimLatch,
      ready,
      ticks: diver.totalTicks,
      x: diver.position.x,
      y: diver.position.y,
      z: diver.position.z,
    }),
    destroy: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      input.dispose();
      window.removeEventListener("keydown", onDebugKey);
      spawnDebug.dispose();
      chunks.dispose();
      snow.dispose();
      lamp.dispose();
      seabed.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      overlay.remove();
    },
  };
}
