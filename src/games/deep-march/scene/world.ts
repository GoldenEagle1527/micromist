/**
 * Deep March scene: renderer, underwater look, chunked terrain, first-person
 * diver loop. The orchestrator: builds the parts (scene/dive/*) in their fixed
 * order, starts the loop (dive/diveLoop.ts) and hands out the handle.
 */
import * as THREE from "three";
import { TERRAIN, isLowSpecDevice } from "../terrain/config";
import { createDensityField } from "../terrain/density";
import { ChunkManager } from "../terrain/chunks";
import { mesherWorkerCount, WorkerPool } from "../terrain/jobPool";
import { PoolRouter } from "../terrain/poolRouter";
import { findSpawn } from "../terrain/spawn";
import { SURVIVAL_TUNING, createSurvival } from "../survival";
import { createDiveAudio } from "./audio";
import { createBaseLightUniforms } from "./base/baseLight";
import { DiverController } from "./diver";
import { parseFogParam } from "./fog";
import { InputController } from "./input";
import { LampRig } from "./lampRig";
import { MaterialLibrary } from "./materialLibrary";
import { TerrainOcclusion } from "./occlusion";
import { MarineSnow } from "./particles";
import { createParticleLightUniforms } from "./particleLight";
import { createSeabedMaterial } from "./seabedMaterial";
import { SONAR_TUNING, SonarPulses, createSonarUniforms } from "./sonar";
import { createLongPulses } from "./sonarLong";
import { SonarScanner } from "./sonarScan/sonarScanner";
import { sessionScanStore } from "./sonarScan/scanStore";
import { SpawnDebugView } from "./spawnDebug";
import { createWallRing } from "./wallRing";
import type { HomeSpot } from "./base/home";
import { CameraSync } from "./dive/cameraSync";
import { ConserveLayer, type ConserveLayerDeps } from "./dive/conserveLayer";
import { listenSpawnDebugKey } from "./dive/debugKey";
import { debugPortOf } from "./dive/debugWiring";
import { DiveCues, lightControls } from "./dive/diveCues";
import { startDiveLoop, type DiveParts } from "./dive/diveLoop";
import { GpuHealth } from "./dive/gpuHealth";
import { createHandle, type HandleParts } from "./dive/handle";
import { HudChips } from "./dive/hudChips";
import { LoadingGate } from "./dive/loadingGate";
import { diveParams, diveTerrain } from "./dive/params";
import { createOverlay, createRenderer, watchResize } from "./dive/rendererRig";
import { createTideDirector } from "./dive/tideWiring";
import { ChaosDirector, needsChaosProgram } from "./chaos/chaosDirector";
import { createChaosUniforms } from "./chaos/seabedChaos";
import type { TideDirector } from "./tide/tideDirector";
import type { DeepMarchHandle, DeepMarchOptions } from "./dive/types";
import { WaterLook } from "./dive/waterLook";

export type { DeepMarchHandle, DeepMarchOptions, HudLabels, LoadingSnapshot, Telemetry } from "./dive/types";
export { AUDIO_GRACE_MS } from "./dive/loadingGate";

export function createDeepMarch(host: HTMLElement, opts: DeepMarchOptions): DeepMarchHandle {
  // the debug panel's overrides (staging; production: the defaults), read once per dive
  const params = diveParams();
  const lowSpec = isLowSpecDevice();
  const { renderer, pacer } = createRenderer(host, lowSpec, params.dpr);
  const overlay = createOverlay(host, opts.labels.lockPrompt);
  const terrain = diveTerrain(lowSpec, params);
  let labels = opts.labels;

  const scene = new THREE.Scene();
  const look = new WaterLook(scene, terrain.viewDistance);
  const { water, fog } = look;
  // Turbidity (fog.ts): the panel's 浑浊度 (off / beam visibility m), else the defaults
  const fogVis = parseFogParam(params.fog);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, terrain.viewDistance + 40);
  // Survival layer (battery, gear, light modes) and the scene side of the lights.
  const survival = createSurvival();
  const audio = createDiveAudio(opts.audioContext ?? null, { sound: opts.sound });
  const cues = new DiveCues(survival, audio);
  const rig = new LampRig(camera, fogVis);
  // active sonar: pings (survival/sonarPing.ts) → pulses + seabed-shader uniforms (sonar.ts)
  const sonarPulses = new SonarPulses(lowSpec ? SONAR_TUNING.maxPulsesLow : SONAR_TUNING.maxPulses);
  const sonar = createSonarUniforms(sonarPulses);
  // what the pings recorded + the observation view (N); conserve: kept in the save, free dive: this session
  const scanner = new SonarScanner(opts.scans ?? sessionScanStore(opts.seed), lowSpec, terrain.viewDistance);
  const particleLights = createParticleLightUniforms();
  // lighthouse light (scene/base): the free dive keeps uBLCount at 0
  const baseLight = createBaseLightUniforms();
  look.addLights();

  // Seabed materials: all 22 downloaded into texture arrays and uploaded before the dive
  // (materialLibrary.ts); the download starts right away, alongside terrain generation.
  let texturesReady = false;
  const materials = new MaterialLibrary(renderer, lowSpec, Math.min(8, renderer.capabilities.getMaxAnisotropy()), () => {
    texturesReady = true;
  });
  const layout = opts.world ?? null;
  const conserveWorld = !!(opts.expedition && layout);
  // conserve (M8): the chaos program's uniforms (its columns use it only while their generation shows chaos)
  const chaosUniforms = conserveWorld ? createChaosUniforms() : null;
  const seabed = createSeabedMaterial({
    // off: no shader detail normal (creases + facet blend, detailNormal.ts)
    detail: params.detail,
    lowSpec,
    water,
    fog,
    sonar,
    worldScale: terrain.worldScale,
    beam: rig.beam,
    particleLights,
    materials: materials.uniforms,
    baseLight,
    chaos: chaosUniforms,
  });
  look.captureBase(seabed.absorb);
  const seabedNow = seabed.variant(needsChaosProgram(opts.chaos ?? null));

  const field = createDensityField(opts.seed, terrain, undefined, layout);
  // conserve: one worker pool for the current terrain and, during a tide, gen + 1's (terrain/poolRouter.ts)
  const router = conserveWorld ? new PoolRouter(new WorkerPool(opts.seed, field.settings, mesherWorkerCount(lowSpec), layout)) : null;
  const chunks = new ChunkManager(scene, field, opts.seed, seabedNow.material, lowSpec, seabedNow.fadeMaterial, router?.view(0));
  // bounded world with a ring wall: near = terrain columns (density Wall term), far = the
  // proxy ring, lit by long sonar pulses (wallRing.ts, sonarLong.ts)
  const longPulses = createLongPulses();
  const ringFor = (f: typeof field) => {
    const ring = createWallRing(f, { water, fog, sonar, long: longPulses, far: terrain.viewDistance });
    if (ring) scene.add(ring.mesh);
    return ring;
  };
  const wallRing = ringFor(field);
  const chaos = chaosUniforms
    ? new ChaosDirector({ uniforms: chaosUniforms, fog, rig, audio, pulses: sonarPulses, sonar, long: longPulses, scene, calm: opts.calmLights ?? false, seed: opts.seed }, opts.chaos ?? null)
    : null;
  let tide: TideDirector | null = null;
  // after a recall / death / the tide: the base core once it stands, else the lander spawn; battery full
  const respawn = (home: HomeSpot | null) => {
    const at = home ?? spawnAt;
    diver.spawnAt(at.x, at.y, at.z, at.yaw);
    survival.resources.add("battery", SURVIVAL_TUNING.battery.capacity);
  };
  // conserve: nodes, absorbing, lost caches, recall, the base (dive/conserveLayer.ts); the free dive has none.
  // Built on a generation's ports and field (the tide builds the next one at its commit).
  const layerFor = (ports: Pick<ConserveLayerDeps, "expedition" | "base">, f: typeof field) =>
    new ConserveLayer(scene, {
      ...ports,
      field: f,
      layout: f.regions.layout!,
      rect: chunks.worldRect,
      resources: survival.resources,
      audio,
      overlay: overlay.root,
      lowSpec,
      water,
      fog,
      sonar,
      beam: rig.beam,
      absorb: seabed.absorb,
      baseLight,
      far: terrain.viewDistance + 40,
      respawn,
      releaseLock: () => input.releaseLock(),
      tide: { call: () => tide?.call() ?? false, active: () => tide?.active() ?? false },
    });
  const conserve = conserveWorld ? layerFor({ expedition: opts.expedition!, base: opts.base }, field) : null;
  const bornAt = performance.now();
  // GPU occlusion culling of terrain columns (the panel can switch it off)
  const occlusion = new TerrainOcclusion(renderer, scene, params.occlusion);
  const health = new GpuHealth(renderer, audio, overlay.alert, () => labels);
  const diver = new DiverController(field, (gi, gj, gk) => chunks.isRemovedPoint(gi, gj, gk));
  diver.edge = chunks.worldRect;
  // conserve with a tide port (M7): 唤潮, the show, the switch to gen + 1 (scene/tide)
  let parts: { loop: DiveParts; handle: HandleParts } | null = null;
  if (conserveWorld && opts.tide && router) {
    tide = createTideDirector({
      port: opts.tide, scene, camera, renderer, router, seed: opts.seed, settings: field.settings, lowSpec,
      viewDistance: terrain.viewDistance, seabed, look, audio, diver, simple: params.tideSimple, gpuLost: () => health.gpuLost,
      conserveLayer: layerFor, wallRing: ringFor, wake: () => respawn(parts!.loop.conserve?.home() ?? null), parts: () => parts!,
      chaos, warm: (ms) => health.warm(ms, [], camera, scene),
    });
  }
  // the wall ring's program too (drawn only after a ping: no hitch on the first one); conserve: the tide's
  const warmMaterials = [seabedNow.material, seabedNow.fadeMaterial().material, ...(wallRing ? [wallRing.mesh.material as THREE.Material] : [])];
  if (tide) warmMaterials.push(seabed.tideMaterial().material);
  health.warm(warmMaterials, [...(conserve?.warmObjects() ?? []), ...(tide?.warmObjects ?? [])], camera, scene);
  health.listen();
  const hud = new HudChips(chunks.terrain, field.regions);
  // Debug: spawn-candidate markers (B, or the debug panel); off in normal play.
  const spawnDebug = new SpawnDebugView(scene, chunks.terrain, field.regions, overlay.root, labels);
  const unbindDebugKey = listenSpawnDebugKey(spawnDebug);
  // Spawn in a seeded region (uniform over the 6), at an open-water spot with clearance
  // near that region's core, facing the longest sightline (terrain/spawn.ts).
  // Always searched on the desktop-preset field so a seed spawns at the same spot on every device.
  const spawnAt = findSpawn(lowSpec ? createDensityField(opts.seed, TERRAIN, undefined, layout) : field);
  // conserve (M5): a dive starts at the base core once it stands
  const startAt = conserve?.home() ?? spawnAt;
  diver.spawnAt(startAt.x, startAt.y, startAt.z, startAt.yaw);
  scene.add(camera);
  const cameraSync = new CameraSync(camera, diver);
  cameraSync.sync(0);
  const snow = new MarineSnow(900, opts.seed);
  scene.add(snow.points);

  const controls = lightControls(survival, audio, cues);
  const toggleObserve = (): boolean => {
    const on = scanner.setObserve(!scanner.observing, gate.ready && !(tide?.active() ?? false));
    audio.play("mode", { gain: 0.42, rate: on ? 1.15 : 0.9 });
    return on;
  };
  const input = new InputController(renderer.domElement, {
    sensitivity: opts.sensitivity,
    invertY: opts.invertY,
    onLampToggle: controls.toggleLamp,
    onLightCycle: controls.cycleLight,
    onLightSelect: controls.selectLight,
    onPing: controls.ping,
    onObserveToggle: () => void toggleObserve(),
    onMuteToggle: () => opts.onMuteToggle?.(),
    onLockChange: () => updatePrompt(),
    holdKeys: conserve?.holdKeys(),
  });
  input.panelMode = opts.panel;
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const updatePrompt = () => {
    overlay.lockPrompt.classList.toggle("on", gate.ready && !input.panelMode && !input.locked && !coarse);
  };

  const sizing = watchResize(host, renderer, camera);

  const gate = new LoadingGate(chunks, audio, health, diver.position, () => texturesReady);
  const loopParts: DiveParts = {
    renderer,
    pacer,
    scene,
    camera,
    input,
    diver,
    cameraSync,
    gate,
    survival,
    conserve,
    tide,
    chaos,
    rig,
    chunks,
    occlusion,
    spawnDebug,
    snow,
    particleLights,
    seabed,
    look,
    worldScale: terrain.worldScale,
    sonarPulses,
    sonar,
    longPulses,
    wallRing,
    scanner,
    cues,
    hud,
    stats: overlay.stats,
    labels: () => labels,
    onDiveStart: () => updatePrompt(),
    resize: sizing.resize,
    bornAt,
  };
  const loop = startDiveLoop(loopParts);

  // the generation-bound parts (terrain, field, conserve layer, HUD lookups, wall ring) are read
  // from these two objects: the tide rebinds them at its switch (dive/tideWiring.ts)
  const handleParts: HandleParts = {
    opts,
    startAt,
    field,
    chunks,
    conserve,
    tide,
    materials,
    gate,
    health,
    survival,
    sonar,
    scanner,
    audio,
    input,
    diver,
    hud,
    controls: { ...controls, toggleObserve },
    updatePrompt,
    setLabels: (next) => {
      labels = next;
      overlay.lockPrompt.textContent = next.lockPrompt;
      spawnDebug.setLabels(next);
      health.updateAlert();
      handleParts.hud.refreshSoon();
    },
    debug: null,
    destroy: () => {
      loop.stop();
      scanner.dispose();
      audio.dispose();
      sizing.dispose();
      input.dispose();
      unbindDebugKey();
      spawnDebug.dispose();
      tide?.dispose();
      chaos?.dispose();
      loopParts.chunks.dispose();
      router?.dispose();
      snow.dispose();
      rig.dispose();
      loopParts.conserve?.dispose();
      survival.dispose();
      occlusion.dispose();
      health.dispose();
      seabed.dispose();
      materials.dispose();
      look.dispose();
      loopParts.wallRing?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      overlay.root.remove();
    },
  };
  parts = { loop: loopParts, handle: handleParts };
  // staging debug panel: its runtime port, only when the page passes the factory (dive/debugWiring.ts)
  handleParts.debug = debugPortOf(opts.debug, { handle: handleParts, loop: loopParts, chaos, spawnAt, worldScale: terrain.worldScale, conserve: conserveWorld });
  return createHandle(handleParts);
}
