/**
 * Deep March scene: renderer, underwater look, chunked terrain, first-person
 * diver loop. The orchestrator: builds the parts (scene/dive/*) in their fixed
 * order, starts the loop (dive/diveLoop.ts) and hands out the handle.
 */
import * as THREE from "three";
import { TERRAIN, isLowSpecDevice } from "../terrain/config";
import { createDensityField } from "../terrain/density";
import { ChunkManager } from "../terrain/chunks";
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
import { SpawnDebugView } from "./spawnDebug";
import { createWallRing } from "./wallRing";
import { CameraSync } from "./dive/cameraSync";
import { ConserveLayer } from "./dive/conserveLayer";
import { listenSpawnDebugKey } from "./dive/debugKey";
import { DiveCues, lightControls } from "./dive/diveCues";
import { startDiveLoop } from "./dive/diveLoop";
import { GpuHealth } from "./dive/gpuHealth";
import { createHandle } from "./dive/handle";
import { HudChips } from "./dive/hudChips";
import { LoadingGate } from "./dive/loadingGate";
import { diveTerrain, parseViewpoint, readDiveParams } from "./dive/params";
import { createOverlay, createRenderer, watchResize } from "./dive/rendererRig";
import type { DeepMarchHandle, DeepMarchOptions } from "./dive/types";
import { WaterLook } from "./dive/waterLook";

export type { DeepMarchHandle, DeepMarchOptions, HudLabels, LoadingSnapshot, Telemetry } from "./dive/types";
export { AUDIO_GRACE_MS } from "./dive/loadingGate";

export function createDeepMarch(host: HTMLElement, opts: DeepMarchOptions): DeepMarchHandle {
  const params = readDiveParams(window.location.search);
  const lowSpec = isLowSpecDevice();
  const { renderer, pacer } = createRenderer(host, lowSpec, params.dpr);
  const overlay = createOverlay(host, opts.labels.lockPrompt);
  const terrain = diveTerrain(lowSpec, params);
  let labels = opts.labels;

  const scene = new THREE.Scene();
  const look = new WaterLook(scene, terrain.viewDistance);
  const { water, fog } = look;
  // Turbidity (fog.ts): ?fog=0|off disables, ?fog=60 sets the beam visibility (m), ?fog=50,80 beam + high beam
  const fogVis = parseFogParam(params.fog);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, terrain.viewDistance + 40);
  // Survival layer (battery, gear, light modes) and the scene side of the lights.
  const survival = createSurvival();
  const lights = survival.lights;
  const audio = createDiveAudio(opts.audioContext ?? null, { sound: opts.sound });
  const cues = new DiveCues(survival, audio);
  const rig = new LampRig(camera, fogVis);
  // SONAR mode: pulse scheduler + seabed-shader uniforms (sonar.ts)
  const sonarPulses = new SonarPulses(lowSpec ? SONAR_TUNING.maxPulsesLow : SONAR_TUNING.maxPulses);
  const sonar = createSonarUniforms(sonarPulses);
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
  const seabed = createSeabedMaterial({
    // ?detail=0: no shader detail normal (creases + facet blend, detailNormal.ts)
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
  });
  look.captureBase(seabed.absorb);

  const layout = opts.world ?? null;
  const field = createDensityField(opts.seed, terrain, undefined, layout);
  const chunks = new ChunkManager(scene, field, opts.seed, seabed.material, lowSpec, seabed.fadeMaterial);
  // bounded world with a ring wall: near = terrain columns (density Wall term), far = the
  // proxy ring, lit by long sonar pulses (wallRing.ts, sonarLong.ts)
  const longPulses = createLongPulses();
  const wallRing = createWallRing(field, { water, fog, sonar, long: longPulses, far: terrain.viewDistance });
  if (wallRing) scene.add(wallRing.mesh);
  // conserve: nodes, absorbing, lost caches, recall, the base (dive/conserveLayer.ts); the free dive has none
  const conserve =
    opts.expedition && layout
      ? new ConserveLayer(scene, {
          expedition: opts.expedition,
          base: opts.base,
          field,
          layout,
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
          respawn: (home) => {
            const at = home ?? spawnAt;
            diver.spawnAt(at.x, at.y, at.z, at.yaw);
            survival.resources.add("battery", SURVIVAL_TUNING.battery.capacity);
          },
          releaseLock: () => input.releaseLock(),
        })
      : null;
  const bornAt = performance.now();
  // GPU occlusion culling of terrain columns (?occ=0 disables)
  const occlusion = new TerrainOcclusion(renderer, scene, params.occlusion);
  const health = new GpuHealth(renderer, audio, overlay.alert, () => labels);
  // the wall ring's program too (drawn only in sonar mode: no hitch on the first ping)
  const warmMaterials = [seabed.material, seabed.fadeMaterial().material, ...(wallRing ? [wallRing.mesh.material as THREE.Material] : [])];
  health.warm(warmMaterials, conserve?.warmObjects() ?? [], camera, scene);
  health.listen();

  const diver = new DiverController(field, (gi, gj, gk) => chunks.isRemovedPoint(gi, gj, gk));
  diver.edge = chunks.worldRect;
  const hud = new HudChips(chunks.terrain, field.regions);
  // Debug: spawn-candidate markers (B, or ?debugSpawns=1); off in normal play.
  const spawnDebug = new SpawnDebugView(scene, chunks.terrain, field.regions, overlay.root, labels);
  if (params.debugSpawns) spawnDebug.setVisible(true);
  const unbindDebugKey = listenSpawnDebugKey(spawnDebug);
  // Spawn in a seeded region (uniform over the 6), at an open-water spot with clearance
  // near that region's core, facing the longest sightline (terrain/spawn.ts).
  // Always searched on the desktop-preset field so a seed spawns at the same spot on every device.
  const spawnAt = findSpawn(lowSpec ? createDensityField(opts.seed, TERRAIN, undefined, layout) : field);
  // conserve (M5): a dive starts at the base core once it stands
  const startAt = conserve?.home() ?? spawnAt;
  diver.spawnAt(startAt.x, startAt.y, startAt.z, startAt.yaw);
  // Optional viewpoint for sharing / screenshots: ?at=x,y,z,yawDeg,pitchDeg.
  const view = parseViewpoint(params.at);
  if (view) {
    diver.position.set(view.x, view.y, view.z);
    diver.prev.copy(diver.position);
    diver.setView(view.yaw, view.pitch);
  }
  scene.add(camera);
  const cameraSync = new CameraSync(camera, diver);
  cameraSync.sync(0);
  const snow = new MarineSnow(900, opts.seed);
  scene.add(snow.points);

  // Optional start mode for screenshots: ?light=beam|high|sonar|off.
  if (params.light === "off") lights.setOn(false);
  else if (params.light === "beam" || params.light === "high" || params.light === "sonar") lights.select(params.light);
  const controls = lightControls(survival, audio, cues);
  const input = new InputController(renderer.domElement, {
    sensitivity: opts.sensitivity,
    invertY: opts.invertY,
    onLampToggle: controls.toggleLamp,
    onLightCycle: controls.cycleLight,
    onLightSelect: controls.selectLight,
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
  const loop = startDiveLoop({
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
    cues,
    hud,
    stats: overlay.stats,
    labels: () => labels,
    onDiveStart: () => updatePrompt(),
    resize: sizing.resize,
    bornAt,
  });

  return createHandle({
    opts,
    startAt,
    field,
    chunks,
    conserve,
    materials,
    gate,
    health,
    survival,
    sonar,
    audio,
    input,
    diver,
    hud,
    controls,
    updatePrompt,
    setLabels: (next) => {
      labels = next;
      overlay.lockPrompt.textContent = next.lockPrompt;
      spawnDebug.setLabels(next);
      health.updateAlert();
      hud.refreshSoon();
    },
    destroy: () => {
      loop.stop();
      audio.dispose();
      sizing.dispose();
      input.dispose();
      unbindDebugKey();
      spawnDebug.dispose();
      chunks.dispose();
      snow.dispose();
      rig.dispose();
      conserve?.dispose();
      survival.dispose();
      occlusion.dispose();
      health.dispose();
      seabed.dispose();
      materials.dispose();
      look.dispose();
      wallRing?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      overlay.root.remove();
    },
  });
}
