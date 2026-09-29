/** Deep March scene: renderer, underwater look, chunked terrain, first-person diver loop. */
import * as THREE from "three";
import { SEA_COLORS, TERRAIN, isLowSpecDevice, terrainForDevice } from "../terrain/config";
import { createDensityField } from "../terrain/density";
import { ChunkManager } from "../terrain/chunks";
import type { EnvironmentKind, SurfaceType } from "../terrain/terrainInfo";
import { REGION_KEYS, createRegionSample, type RegionField, type RegionKey } from "../terrain/regions";
import { SpawnDebugView } from "./spawnDebug";
import { findSpawn } from "../terrain/spawn";
import { InputController, type PanelInput } from "./input";
import { MarineSnow } from "./particles";
import { MaterialLibrary, type MaterialStatus } from "./materialLibrary";
import { WATER_GLSL, createSeabedMaterial, createWaterUniforms } from "./seabedMaterial";
import { failureReport, gpuInfo, type GpuInfo } from "./gpuDiagnostics";
import { DiverController, type DiverState } from "./diver";
import { LampRig } from "./lampRig";
import { FOG_GLSL, FOG_TUNING, createFogUniforms, parseFogParam } from "./fog";
import { SONAR_TUNING, SonarPulses, createSonarUniforms } from "./sonar";
import { FramePacer } from "./framePacer";
import { TerrainOcclusion } from "./occlusion";
import { createParticleLightUniforms } from "./particleLight";
import { SURVIVAL_TUNING, createSurvival, type LightMode, type LightState } from "../survival";
import { createDiveAudio, type AudioStatus } from "./audio";

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
  lockPrompt: string;
  /** In-game alert: WebGL context lost (GPU reset). */
  gpuLost: string;
  /** In-game alert: a shader program failed to build during the dive. */
  shaderFailed: string;
};

export type DeepMarchOptions = {
  seed: number;
  sensitivity: number;
  invertY: boolean;
  panel: boolean;
  labels: HudLabels;
  /** Created inside the dive-start click so the browser allows playback. Null skips audio. */
  audioContext?: AudioContext | null;
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

/** Longest the dive waits for sounds once terrain, textures and shaders are in. */
export const AUDIO_GRACE_MS = 5000;

/** Raw initialization state for the loading screen (ui/loading), polled per frame. */
export type LoadingSnapshot = {
  seed: number;
  spawn: { x: number; y: number; z: number };
  /** Macro region field of this world (world units) for the region map. */
  regions: RegionField;
  materials: MaterialStatus;
  /** Terrain around the spawn: gate items done / total, and the gate itself. */
  terrain: { done: number; total: number; ready: boolean };
  system: {
    battery: number;
    lamps: LightMode[];
    sonar: boolean;
    /** Program compile / link check finished. */
    shaders: boolean;
    /** A program failed to build: program / fragment / vertex info logs. */
    shaderError: string | null;
    /** Renderer string and key limits. */
    gpu: GpuInfo;
    /** WebGL context lost (GPU reset / out of memory). */
    gpuLost: boolean;
  };
  /** Sound clips (optional: settles on failure / timeout, never holds the dive for long). */
  audio: AudioStatus;
  /** Everything above is ready: the dive can start (startDive). */
  loaded: boolean;
  /** The dive started (simulation running). */
  diving: boolean;
};

export type DeepMarchHandle = {
  /** Loading-screen state (textures, terrain, system check). */
  loading: () => LoadingSnapshot;
  /** Leave the loading screen: the simulation starts once everything is loaded. */
  startDive: () => void;
  /** After a final texture download failure: try the failed layers again. */
  retryMaterials: () => void;
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
    // phones / low-spec: 30 fps (half the GPU work and heat); desktop 60
    maxFps: lowSpec ? 30 : 60,
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
  // in-game alert (GPU context lost / shader failure after the loading screen)
  const alertBox = document.createElement("div");
  alertBox.className = "dm-alert";
  alertBox.setAttribute("role", "alert");
  overlay.appendChild(alertBox);

  // ?lodNear=<units> overrides the full-resolution ring radius (LOD comparisons / debugging)
  const lodNearParam = Number(new URLSearchParams(window.location.search).get("lodNear"));
  const terrainBase = lodNearParam > 0 ? { ...terrainForDevice(lowSpec), lodNear: lodNearParam } : terrainForDevice(lowSpec);
  // ?refine=0 forces full noise evaluation in mesh jobs (no coarse pre-pass, terrain/refine.ts)
  const qs = new URLSearchParams(window.location.search);
  const wasmParam = qs.get("wasm");
  const terrain = {
    ...terrainBase,
    ...(qs.get("refine") === "0" ? { refine: false } : {}),
    // ?bricks=0: dense mesher passes instead of sparse 8³ bricks (terrain/bricks.ts; same output)
    ...(qs.get("bricks") === "0" ? { bricks: false } : {}),
    // ?wasm=1: WebAssembly noise (bit-exact; default JS, see TerrainSettings.wasm); ?wasm=0: JS
    ...(wasmParam === "1" ? { wasm: true } : wasmParam === "0" ? { wasm: false } : {}),
  };

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
  // Turbidity (fog.ts): ?fog=0|off disables, ?fog=60 sets the beam visibility (m), ?fog=50,80 beam + high beam
  const fogVis = parseFogParam(qs.get("fog"));
  const fog = createFogUniforms();
  const baseWater = { top: water.uWaterTop.value.clone(), horizon: water.uWaterHorizon.value.clone(), bottom: water.uWaterBottom.value.clone() };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: { ...water, ...fog },
      vertexShader: /* glsl */ `varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
}`,
      fragmentShader: /* glsl */ `${WATER_GLSL}${FOG_GLSL}
varying vec3 vDir;
void main() {
  gl_FragColor = vec4(dmBackground(normalize(vDir)), 1.0);
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
  const audio = createDiveAudio(opts.audioContext ?? null);
  const lowCut = SURVIVAL_TUNING.battery.lowFraction * SURVIVAL_TUNING.battery.capacity;
  survival.resources.on("changed", "battery", (e) => {
    if (e.prev > lowCut && e.value <= lowCut) audio.play("warn", { gain: 0.4, rate: 0.92 });
  });
  survival.resources.on("depleted", "battery", () => {
    audio.play("warn", { gain: 0.55, rate: 0.72 });
  });
  const rig = new LampRig(camera, fogVis);
  // SONAR mode: pulse scheduler + seabed-shader uniforms (sonar.ts)
  const sonarPulses = new SonarPulses(lowSpec ? SONAR_TUNING.maxPulsesLow : SONAR_TUNING.maxPulses);
  const sonar = createSonarUniforms(sonarPulses);
  const particleLights = createParticleLightUniforms();
  const camForward = new THREE.Vector3();

  // Down-welling light: teal sky fill from above, very dark from below,
  // plus a blue-green filtered "sun" from the surface.
  const ambient = new THREE.HemisphereLight(0x3f86a6, 0x0a1426, 0.38);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(new THREE.Color(0.55, 0.85, 1.0), 0.4);
  sun.position.set(0.25, 1, 0.15);
  scene.add(sun);

  // Seabed materials: all 22 downloaded into texture arrays and uploaded before the dive
  // (materialLibrary.ts); the download starts right away, alongside terrain generation.
  let texturesReady = false;
  const materials = new MaterialLibrary(renderer, lowSpec, Math.min(8, renderer.capabilities.getMaxAnisotropy()), () => {
    texturesReady = true;
  });
  const seabed = createSeabedMaterial({
    // ?detail=0: no shader detail normal (creases + facet blend, detailNormal.ts)
    detail: qs.get("detail") !== "0",
    lowSpec,
    water,
    fog,
    sonar,
    worldScale: terrain.worldScale,
    beam: rig.beam,
    particleLights,
    materials: materials.uniforms,
  });
  const terrainMat = seabed.material;
  const baseAbsorb = seabed.absorb.clone();
  const baseHaze = water.uHaze.value;

  const field = createDensityField(opts.seed, terrain);
  const chunks = new ChunkManager(scene, field, opts.seed, terrainMat, lowSpec, seabed.fadeMaterial);
  // GPU occlusion culling of terrain columns (?occ=0 disables)
  const occlusion = new TerrainOcclusion(renderer, scene, new URLSearchParams(window.location.search).get("occ") !== "0");
  // System check: compile the terrain programs (base + LOD crossfade) before the dive,
  // so neither the first frame nor the first LOD swap hitches.
  // A program that fails to link is skipped by three at draw time (nothing drawn, no
  // exception), so the check touches every compiled program (three's link check runs on
  // first use) and surfaces a failure, with the driver logs and GPU facts, on the
  // loading screen (and in-game) instead of silently rendering nothing.
  let shadersReady = false;
  let shaderError: string | null = null;
  let gpuLost = false;
  let destroyed = false;
  // GPU facts for the system check (and for any failure report)
  const gpu = gpuInfo(renderer.getContext());
  console.info(`[deep-march] GPU: ${gpu.renderer} · texture units ${gpu.textureUnits} · fragment uniform vectors ${gpu.fragmentVectors} · fragment highp ${gpu.highp ? "yes" : "no"}`);
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const seabedProgram = /#define DM_SONAR_N/.test(gl.getShaderSource(fs) ?? "");
    const report = failureReport(gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs));
    console.error(`[deep-march] shader program failed to link${seabedProgram ? " (seabed)" : ""}:\n${report}\nGPU: ${gpu.renderer}`);
    shaderError ??= `${seabedProgram ? "seabed: " : ""}${report}`;
    updateAlert();
  };
  {
    const geo = new THREE.BufferGeometry();
    const warm = new THREE.Group();
    warm.add(new THREE.Mesh(geo, terrainMat), new THREE.Mesh(geo, seabed.fadeMaterial().material));
    renderer
      .compileAsync(warm, camera, scene)
      .catch((e: unknown) => console.error("[deep-march] shader compile failed:", e))
      .then(() => {
        // first use runs three's link check → onShaderError on failure
        if (!destroyed) for (const p of renderer.info.programs ?? []) p.getUniforms();
      })
      .finally(() => {
        shadersReady = true;
        geo.dispose();
      });
  }
  const onContextLost = (e: Event) => {
    e.preventDefault(); // allow three to restore
    gpuLost = true;
    audio.hold("gpu", true);
    console.error("[deep-march] WebGL context lost");
    updateAlert();
  };
  const onContextRestored = () => {
    gpuLost = false;
    audio.hold("gpu", false);
    updateAlert();
  };
  renderer.domElement.addEventListener("webglcontextlost", onContextLost);
  renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);
  function updateAlert() {
    const msg = gpuLost ? labels.gpuLost : shaderError ? `${labels.shaderFailed}: ${shaderError}` : "";
    alertBox.textContent = msg;
    alertBox.classList.toggle("on", msg !== "");
  }

  const diver = new DiverController(field, (gi, gj, gk) => chunks.isRemovedPoint(gi, gj, gk));
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

  // Optional start mode for screenshots: ?light=beam|high|sonar|off.
  const lightParam = new URLSearchParams(window.location.search).get("light");
  if (lightParam === "off") lights.setOn(false);
  else if (lightParam === "beam" || lightParam === "high" || lightParam === "sonar") lights.select(lightParam);
  const toggleLamp = () => {
    const before = lights.state();
    const on = lights.toggle();
    if (on !== before.on) audio.play("switch", { gain: on ? 0.5 : 0.32, rate: on ? 1 : 0.88 });
    else if (before.locked) audio.play("warn", { gain: 0.28, rate: 1.2 });
    return on;
  };
  const cycleLight = () => {
    const before = lights.state().mode;
    const mode = lights.cycle();
    if (mode !== before) audio.play("mode", { gain: 0.42 });
    return mode;
  };
  const input = new InputController(renderer.domElement, {
    sensitivity: opts.sensitivity,
    invertY: opts.invertY,
    onLampToggle: toggleLamp,
    onLightCycle: cycleLight,
    onLightSelect: (i) => {
      const m = lights.available()[i];
      if (!m) return;
      const before = lights.state().mode;
      lights.select(m);
      if (lights.state().mode !== before) audio.play("mode", { gain: 0.42 });
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
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  let ready = false;
  let diveRequested = false;
  let terrainReady = false;
  let hadContact = false;
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
      const touching = diver.contact !== null;
      if (touching && !hadContact) {
        audio.play("bump", { gain: 0.22 + Math.min(0.35, diver.speed / 24), rate: 0.82, lowpass: 480 });
      }
      hadContact = touching;
    } else {
      // loading gate: every footprint in view drawn + level 0 around the diver, all
      // materials on the GPU, programs compiled, sounds settled (loaded, missing or
      // timed out: audio.ts); then the loading screen starts the dive
      if (!terrainReady) terrainReady = chunks.nearReady(diver.position, 14) && chunks.coverageComplete(diver.position);
      if (diveRequested && terrainReady && texturesReady && shadersReady && audioGate().settled) {
        ready = true;
        chunks.loading = false;
        updatePrompt();
      }
    }
    syncCamera(dt);
    if (ready) survival.tick(dt);
    camera.updateMatrixWorld();
    rig.update(dt, lights.state(), !ready);
    chunks.update(diver.position, camera, dt);
    occlusion.update(chunks.meshGroup, camera, (m) => chunks.isStable(m));
    spawnDebug.update();
    snow.update(camera.position, dt);
    snow.fillLights(camera.position, camera.getWorldDirection(camForward), particleLights);
    seabed.update(now / 1000);

    // Lighting: depth-driven base (deeper = darker) × light mode (lights off = black
    // water and no ambient; sonar draws on a dark background).
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
    fog.uFogK.value = env.fogK;
    fog.uFogColor.value.copy(FOG_TUNING.murk).multiplyScalar(env.murk * (1 - 0.6 * deep));
    fog.uGlowGain.value = env.glow;
    fog.uGlowCone.value.copy(env.glowCone);
    fog.uGlowDir.value.copy(rig.glowDir);
    snow.setFog(env.fogK);
    // SONAR: pulses from the diver while the mode is on; plankton dimmed underneath
    const ls = lights.state();
    const pings = sonarPulses.update(now / 1000, ls.on && ls.mode === "sonar", camera.position);
    if (pings > 0) audio.play("sonar", { gain: 0.48 });
    const moving = Math.min(1, Math.max(0, (diver.speed - 0.6) / 6));
    audio.setLoop("ambience", 0.4);
    audio.setLoop("swim", ready ? moving * (diver.state === "swim" ? 0.5 : 0.2) : 0);
    audio.tick(dt);
    sonar.uSonar.value = rig.sonar;
    snow.setDim(1 - 0.85 * rig.sonar);

    renderer.render(scene, camera);
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
      stats.textContent = `${fps.toFixed(0)} fps ×${pacer.ratio.toFixed(2)} · ${labels.chunks} ${st.meshes}/${st.active} (LOD ${st.lodMeshes.join("/")}) · −${st.floaters} ${labels.floaters} · q${st.queued}+${st.pending} · ${(st.triangles / 1000).toFixed(0)}k ${labels.tris} · ${st.workers ? `${st.workers}w` : labels.mainThread} ${st.avgMs.toFixed(1)}ms (${labels.classify} ${st.avgInfoMs.toFixed(1)}) · occ ${occlusion.enabled ? `−${occlusion.culledCount}` : "off"}`;
    }
  };
  raf = requestAnimationFrame(frame);
  // Nothing to draw while the tab is hidden (rAF mostly stops anyway; this also
  // halts terrain streaming and resets the pacing history on return).
  const onVisibility = () => {
    // (audio follows visibility on its own: audioLifecycle.ts)
    cancelAnimationFrame(raf);
    if (document.hidden) return;
    last = performance.now();
    pacer.reset(last);
    raf = requestAnimationFrame(frame);
  };
  document.addEventListener("visibilitychange", onVisibility);

  // Sounds are optional: once everything else is in, wait at most AUDIO_GRACE_MS for
  // them; slow clips keep loading and play when they arrive.
  let restReadyAt = -1;
  const audioGate = (): AudioStatus => {
    const s = audio.status();
    if (s.settled) return s;
    const rest = terrainReady && texturesReady && shadersReady;
    if (!rest) {
      restReadyAt = -1;
      return s;
    }
    const t = performance.now();
    if (restReadyAt < 0) restReadyAt = t;
    return t - restReadyAt >= AUDIO_GRACE_MS ? { ...s, settled: true, late: true } : s;
  };
  let terrainProgressAt = -1e9;
  let terrainProgress = { done: 0, total: 0 };
  const systemState = () => {
    const avail = lights.available();
    return {
      battery: survival.resources.view("battery").ratio,
      lamps: avail.filter((m) => m !== "sonar"),
      sonar: avail.includes("sonar") && sonar.uSonarPulse.value.length > 0,
      shaders: shadersReady,
      shaderError,
      gpu,
      gpuLost,
    };
  };
  return {
    loading: () => {
      // terrain progress walks the column set: refreshed at most every 150 ms
      const t = performance.now();
      if (t - terrainProgressAt > 150) {
        terrainProgressAt = t;
        terrainProgress = chunks.loadProgress(diver.position, 14);
      }
      const tp = terrainProgress;
      const system = systemState();
      const mat = materials.status();
      const snd = audioGate();
      return {
        seed: opts.seed,
        spawn: { x: spawnAt.x, y: spawnAt.y, z: spawnAt.z },
        regions: field.regions,
        materials: mat,
        terrain: { done: tp.done, total: tp.total, ready: terrainReady },
        system,
        audio: snd,
        loaded: terrainReady && mat.ready && system.shaders && !system.shaderError && !system.gpuLost && snd.settled,
        diving: ready,
      };
    },
    startDive: () => {
      diveRequested = true;
    },
    retryMaterials: () => materials.retry(),
    panelInput: input.panel,
    setPanelMode: (on) => {
      input.panelMode = on;
      if (on) input.releaseLock();
      updatePrompt();
    },
    setLabels: (next) => {
      labels = next;
      lockPrompt.textContent = next.lockPrompt;
      spawnDebug.setLabels(next);
      updateAlert();
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
      audio.dispose();
      ro.disconnect();
      input.dispose();
      window.removeEventListener("keydown", onDebugKey);
      spawnDebug.dispose();
      chunks.dispose();
      snow.dispose();
      rig.dispose();
      survival.dispose();
      occlusion.dispose();
      destroyed = true;
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      renderer.debug.onShaderError = null;
      seabed.dispose();
      materials.dispose();
      dome.geometry.dispose();
      (dome.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
      overlay.remove();
    },
  };
}
