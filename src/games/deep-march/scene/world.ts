/** Deep March scene: renderer, underwater look, chunked terrain, first-person diver loop. */
import * as THREE from "three";
import { SEA_COLORS, TERRAIN, isLowSpecDevice, terrainForDevice } from "../terrain/config";
import { createDensityField } from "../terrain/density";
import { ChunkManager } from "../terrain/chunks";
import type { EnvironmentKind, SurfaceType } from "../terrain/terrainInfo";
import { REGION_KEYS, createRegionSample, type RegionKey } from "../terrain/regions";
import { SpawnDebugView } from "./spawnDebug";
import { findSpawn } from "../terrain/spawn";
import { InputController, type PanelInput } from "./input";
import { MarineSnow } from "./particles";
import { WATER_GLSL, createSeabedMaterial, createWaterUniforms } from "./seabedMaterial";
import { DiverController, type DiverState } from "./diver";
import { LampRig } from "./lampRig";
import { NightVision } from "./nightVision";
import { FramePacer } from "./framePacer";
import { createParticleLightUniforms } from "./particleLight";
import { SURVIVAL_TUNING, createSurvival, type LightMode, type LightState } from "../survival";

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
  light: LightState;
  battery: { value: number; capacity: number; ratio: number; rate: number; low: boolean };
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
  /** Next available light mode (turns the light on). */
  cycleLight: () => LightMode;
  toggleSwimLatch: () => boolean;
  telemetry: () => Telemetry;
};

export function createDeepMarch(host: HTMLElement, opts: DeepMarchOptions): DeepMarchHandle {
  // Desktop keeps MSAA and a pixel ratio floating 1.25–1.75; low-spec (touch / ≤ 4 cores)
  // drops MSAA and stays ≤ 1.25. ?dpr=<n> pins the ratio (screenshots / debugging).
  const lowSpec = isLowSpecDevice();
  const renderer = new THREE.WebGLRenderer({ antialias: !lowSpec, powerPreference: "high-performance" });
  const dprParam = Number(new URLSearchParams(window.location.search).get("dpr"));
  const deviceRatio = window.devicePixelRatio || 1;
  const maxRatio = Math.min(deviceRatio, lowSpec ? 1.25 : 1.75);
  const pacer = new FramePacer({
    maxFps: 60,
    maxRatio,
    minRatio: Math.min(maxRatio, lowSpec ? 0.75 : 1.25),
    fixed: dprParam > 0 ? Math.min(dprParam, 3) : undefined,
  });
  renderer.setPixelRatio(pacer.ratio);
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

  const terrain = terrainForDevice(lowSpec);

  // Underwater look for a vast world: the reference water colour (0, .168, .453) is the
  // horizon of an open-water gradient (brighter toward the surface, black below) drawn
  // by a background dome; the terrain hazes toward a darker tone of the same colour, so
  // far masses loom as silhouettes and resolve as the diver closes in (seabedMaterial.ts).
  const fogColor = new THREE.Color().setRGB(SEA_COLORS.fog[0], SEA_COLORS.fog[1], SEA_COLORS.fog[2], THREE.SRGBColorSpace);
  // darker overall so the head lamp carries the scene in a vast ocean
  fogColor.multiplyScalar(0.42);
  const baseFog = fogColor.clone();
  let lastDeep = -1;
  let lastWater = -1;
  const scene = new THREE.Scene();
  scene.background = null;
  // three's fog now only tints the marine snow near the camera
  scene.fog = new THREE.Fog(fogColor, 1.5, 34);
  const water = createWaterUniforms(baseFog, terrain.viewDistance);
  const baseWater = { top: water.uWaterTop.value.clone(), horizon: water.uWaterHorizon.value.clone(), bottom: water.uWaterBottom.value.clone() };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: water,
      vertexShader: /* glsl */ `varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
}`,
      fragmentShader: /* glsl */ `${WATER_GLSL}
varying vec3 vDir;
void main() {
  gl_FragColor = vec4(dmWater(normalize(vDir)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    }),
  );
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  scene.add(dome);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, terrain.viewDistance + 40);
  // Survival layer (battery, gear, light modes) and the scene side of the lights.
  const survival = createSurvival();
  const lights = survival.lights;
  const rig = new LampRig(camera);
  const nightVision = new NightVision(renderer, lowSpec ? 0 : 4);
  const particleLights = createParticleLightUniforms();
  const camForward = new THREE.Vector3();

  // Down-welling light: teal sky fill from above, very dark from below,
  // plus a blue-green filtered "sun" from the surface.
  const ambient = new THREE.HemisphereLight(0x3f86a6, 0x0a1426, 0.38);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(new THREE.Color(0.55, 0.85, 1.0), 0.4);
  sun.position.set(0.25, 1, 0.15);
  scene.add(sun);

  let texturesReady = false;
  const seabed = createSeabedMaterial({
    lowSpec,
    water,
    worldScale: terrain.worldScale,
    beam: rig.beam,
    particleLights,
    anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
    onReady: () => {
      texturesReady = true;
    },
  });
  const terrainMat = seabed.material;
  const baseAbsorb = seabed.absorb.clone();
  const baseHaze = water.uHaze.value;

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
  // Spawn in a seeded region (uniform over the 6), at an open-water spot with clearance
  // near that region's core, facing the longest sightline (terrain/spawn.ts).
  // Always searched on the desktop-preset field so a seed spawns at the same spot on every device.
  const spawnAt = findSpawn(lowSpec ? createDensityField(opts.seed, TERRAIN) : field);
  diver.spawnAt(spawnAt.x, spawnAt.y, spawnAt.z, spawnAt.yaw);
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
  // First person: the camera is the diver's eyes; the head lamp (LampRig) rides just above them.
  const BASE_FOV = 70;
  scene.add(camera);

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

  // Optional start mode for screenshots: ?light=beam|high|night|off.
  const lightParam = new URLSearchParams(window.location.search).get("light");
  if (lightParam === "off") lights.setOn(false);
  else if (lightParam === "beam" || lightParam === "high" || lightParam === "night") lights.select(lightParam);
  const toggleLamp = () => lights.toggle();
  const cycleLight = () => lights.cycle();
  const input = new InputController(renderer.domElement, {
    sensitivity: opts.sensitivity,
    invertY: opts.invertY,
    onLampToggle: toggleLamp,
    onLightCycle: cycleLight,
    onLightSelect: (i) => {
      const m = lights.available()[i];
      if (m) lights.select(m);
    },
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
    const pr = renderer.getPixelRatio();
    nightVision.setSize(Math.floor(w * pr), Math.floor(h * pr));
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
    // 60 fps cap (120/144 Hz displays would otherwise render 2–2.4× the frames)
    if (!pacer.shouldRender(now)) return;
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
    if (ready) survival.tick(dt);
    camera.updateMatrixWorld();
    rig.update(dt, lights.state(), !ready);
    chunks.update(diver.position, camera, dt);
    spawnDebug.update();
    snow.update(camera.position, dt);
    snow.fillLights(camera.position, camera.getWorldDirection(camForward), particleLights);
    seabed.update(now / 1000);

    // Lighting: depth-driven base (deeper = darker) × light mode (lights off = black
    // water and no ambient; night vision brings its own fill).
    const W = terrain.worldScale;
    const deep = THREE.MathUtils.smoothstep(-camera.position.y, 8 * W, 26 * W);
    const env = rig.env;
    const wk = env.water;
    if (Math.abs(deep - lastDeep) > 0.002 || wk !== lastWater) {
      lastDeep = deep;
      lastWater = wk;
      fogColor.copy(baseFog).multiplyScalar((1 - 0.7 * deep) * wk);
      (scene.fog as THREE.Fog).color.copy(fogColor);
      water.uWaterHorizon.value.copy(baseWater.horizon).multiplyScalar((1 - 0.72 * deep) * wk);
      water.uWaterTop.value.copy(baseWater.top).multiplyScalar((1 - 0.6 * deep) * wk);
      water.uWaterBottom.value.copy(baseWater.bottom).multiplyScalar((1 - 0.85 * deep) * wk);
    }
    seabed.envLight.value = wk;
    ambient.intensity = 0.38 * (1 - 0.6 * deep) * env.ambientMul + env.ambientAdd;
    sun.intensity = 0.4 * (1 - 0.75 * deep) * env.sunMul + env.sunAdd;
    water.uHaze.value = baseHaze * env.haze;
    seabed.absorb.copy(baseAbsorb).multiplyScalar(env.absorb);

    nightVision.render(scene, camera, rig.night, now / 1000);
    if (pacer.frameDone(performance.now())) {
      renderer.setPixelRatio(pacer.ratio);
      resize();
    }

    fpsFrames++;
    fpsTime += rawDt; // real time, not the clamped sim step
    if (fpsTime >= 0.5) {
      fps = fpsFrames / fpsTime;
      fpsFrames = 0;
      fpsTime = 0;
    }
    hudTimer -= dt;
    if (hudTimer <= 0) {
      updateTerrainKind(0.25 - hudTimer);
      updateRegion();
      spawnDebug.updateDiver(diver.position.x, diver.position.z, -diver.yaw);
      hudTimer = 0.25;
      const st = chunks.stats();
      stats.textContent = `${fps.toFixed(0)} fps ×${pacer.ratio.toFixed(2)} · ${labels.chunks} ${st.meshes}/${st.active} (LOD ${st.lodMeshes.join("/")}) · −${st.floaters} ${labels.floaters} · q${st.queued}+${st.pending} · ${(st.triangles / 1000).toFixed(0)}k ${labels.tris} · ${st.workers ? `${st.workers}w` : labels.mainThread} ${st.avgMs.toFixed(1)}ms (${labels.classify} ${st.avgInfoMs.toFixed(1)})`;
    }
  };
  raf = requestAnimationFrame(frame);
  // Nothing to draw while the tab is hidden (rAF mostly stops anyway; this also
  // halts terrain streaming and resets the pacing history on return).
  const onVisibility = () => {
    cancelAnimationFrame(raf);
    if (document.hidden) return;
    last = performance.now();
    pacer.reset(last);
    raf = requestAnimationFrame(frame);
  };
  document.addEventListener("visibilitychange", onVisibility);

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
    cycleLight,
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
      lamp: lights.state().on,
      light: lights.state(),
      battery: (() => {
        const b = survival.resources.view("battery");
        return { value: b.value, capacity: b.capacity, ratio: b.ratio, rate: b.rate, low: b.ratio <= SURVIVAL_TUNING.battery.lowFraction };
      })(),
      swimLatch: input.panel.swimLatch,
      ready,
      ticks: diver.totalTicks,
      x: diver.position.x,
      y: diver.position.y,
      z: diver.position.z,
    }),
    destroy: () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
      input.dispose();
      window.removeEventListener("keydown", onDebugKey);
      spawnDebug.dispose();
      chunks.dispose();
      snow.dispose();
      rig.dispose();
      nightVision.dispose();
      survival.dispose();
      seabed.dispose();
      dome.geometry.dispose();
      (dome.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
      overlay.remove();
    },
  };
}
