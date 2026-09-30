/**
 * The per-frame loop, in a fixed order: look and move (or the loading gate),
 * camera, survival, conserve layer, lamp rig, terrain streaming and occlusion,
 * the tide (conserve), marine snow, lighting, chaos (conserve), sonar, sounds, render, pacing, the 4 Hz HUD. Paused
 * while the tab is hidden (rAF mostly stops anyway; this also halts terrain
 * streaming and resets the pacing history on return).
 */
import * as THREE from "three";
import type { ChunkManager } from "../../terrain/chunks";
import type { Survival } from "../../survival";
import type { DiverController } from "../diver";
import type { FramePacer } from "../framePacer";
import type { InputController } from "../input";
import type { LampRig } from "../lampRig";
import type { TerrainOcclusion } from "../occlusion";
import type { MarineSnow } from "../particles";
import type { ParticleLightUniforms } from "../particleLight";
import type { SonarPulses, SonarUniforms } from "../sonar";
import { longPingDue } from "../sonarLong";
import type { SpawnDebugView } from "../spawnDebug";
import type { WallRing } from "../wallRing";
import type { CameraSync } from "./cameraSync";
import type { ConserveLayer } from "./conserveLayer";
import type { DiveCues } from "./diveCues";
import { statsLine, type HudChips, type StatsLabels } from "./hudChips";
import type { LoadingGate } from "./loadingGate";
import type { SeabedMaterial } from "../seabedMaterial";
import type { WaterLook } from "./waterLook";
import type { TideDirector } from "../tide/tideDirector";
import type { ChaosDirector } from "../chaos/chaosDirector";

/** No movement (the recall's black screen). */
const STILL = { forward: 0, strafe: 0, up: false, down: false, sprint: false };

export type DiveParts = {
  renderer: THREE.WebGLRenderer;
  pacer: FramePacer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  input: InputController;
  diver: DiverController;
  cameraSync: CameraSync;
  gate: LoadingGate;
  survival: Survival;
  conserve: ConserveLayer | null;
  /** Conserve with a tide port (M7): the tide's frame, after the terrain; null in the free dive. */
  tide: TideDirector | null;
  /** Conserve (M8): the chaos presentation, after the water look and the sonar; null in the free dive. */
  chaos: ChaosDirector | null;
  rig: LampRig;
  chunks: ChunkManager;
  occlusion: TerrainOcclusion;
  spawnDebug: SpawnDebugView;
  snow: MarineSnow;
  particleLights: ParticleLightUniforms;
  seabed: SeabedMaterial;
  look: WaterLook;
  worldScale: number;
  sonarPulses: SonarPulses;
  sonar: SonarUniforms;
  longPulses: SonarPulses;
  wallRing: WallRing | null;
  cues: DiveCues;
  hud: HudChips;
  stats: HTMLElement;
  labels: () => StatsLabels;
  /** The dive started (after the gate). */
  onDiveStart: () => void;
  resize: () => void;
  bornAt: number;
};

export function startDiveLoop(p: DiveParts): { stop: () => void } {
  const camForward = new THREE.Vector3();
  let raf = 0;
  let last = performance.now();

  const step = (dt: number) => {
    const { input, diver, gate } = p;
    const [dYaw, dPitch] = input.takeLook();
    diver.look(-dYaw, -dPitch);
    if (gate.ready) {
      diver.update(dt, p.conserve?.busy() ? STILL : input.move());
      if (diver.lastTicks > 0) input.consumePulse();
      p.cues.bump(dt, diver);
    } else if (gate.tick()) p.onDiveStart();
  };

  const world = (now: number, dt: number, rawMs: number) => {
    const { camera, diver, rig } = p;
    const ready = p.gate.ready;
    p.cameraSync.sync(dt);
    if (ready) p.survival.tick(dt);
    camera.updateMatrixWorld();
    const time = (now - p.bornAt) / 1000;
    p.conserve?.update({ dt, time, ready, camera, diver: diver.position, input: p.input });
    rig.update(dt, p.survival.lights.state(), !ready);
    p.chunks.update(diver.position, camera, dt);
    p.occlusion.update(p.chunks.meshGroup, camera, (m) => p.chunks.isStable(m));
    // after occlusion: the tide's front overrides which columns draw
    if (ready) p.tide?.update(dt, rawMs, time);
    p.spawnDebug.update();
    p.snow.update(camera.position, dt);
    p.snow.fillLights(camera.position, camera.getWorldDirection(camForward), p.particleLights);
    p.seabed.update(now / 1000);
    p.look.update(camera.position.y, p.worldScale, rig, p.seabed, p.snow);
    p.chaos?.frame({ dt, time, camera: camera.position, suppressed: p.tide?.active() ?? false });
  };

  const sonarAndSound = (now: number, dt: number) => {
    const { camera } = p;
    const t = now / 1000;
    // SONAR: the pings accepted since the last frame (key 3 / button) go out from the diver
    const pings = p.survival.sonar.take();
    for (let i = 0; i < pings; i++) {
      p.sonarPulses.ping(t, camera.position);
      if (p.wallRing && longPingDue(p.longPulses, t)) p.longPulses.ping(t, camera.position);
    }
    p.sonarPulses.update(t);
    const longAlive = p.wallRing ? (p.longPulses.update(t), p.longPulses.count > 0 ? 1 : 0) : 0;
    p.wallRing?.update(longAlive);
    if (pings > 0) p.cues.ping(t);
    p.chaos?.sonar({ dt, pulseTime: t, time: (now - p.bornAt) / 1000, pings, sonar: longAlive, diver: camera.position, blocked: !p.gate.ready || (p.tide?.active() ?? false) });
    p.cues.loops(dt, p.gate.ready, p.diver);
    // additive overlay while any pulse (a ping or a ghost echo) is alive; 0 skips the shader branch
    p.sonar.uSonar.value = p.sonarPulses.count > 0 ? 1 : 0;
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    // 60 fps cap (120/144 Hz displays would otherwise render 2–2.4× the frames)
    if (!p.pacer.shouldRender(now)) return;
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.05, rawDt);
    last = now;
    step(dt);
    world(now, dt, rawDt * 1000);
    sonarAndSound(now, dt);
    p.renderer.render(p.scene, p.camera);
    if (p.pacer.frameDone(performance.now())) {
      p.renderer.setPixelRatio(p.pacer.ratio);
      p.resize();
    }
    const d = p.diver;
    p.hud.frame(rawDt, dt, d.position.x, d.position.y, d.position.z, (fps) => {
      p.spawnDebug.updateDiver(d.position.x, d.position.z, -d.yaw);
      p.stats.textContent = statsLine(fps, p.pacer.ratio, p.chunks.stats(), p.labels(), p.occlusion);
    });
  };
  raf = requestAnimationFrame(frame);

  const onVisibility = () => {
    // (audio follows visibility on its own: audioLifecycle.ts)
    cancelAnimationFrame(raf);
    if (document.hidden) return;
    last = performance.now();
    p.pacer.reset(last);
    raf = requestAnimationFrame(frame);
  };
  document.addEventListener("visibilitychange", onVisibility);
  return {
    stop: () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
