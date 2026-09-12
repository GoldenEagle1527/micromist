import * as THREE from "three";
import type { LumenCruise } from "../i18n";
import type { LumenLabels } from "../types";
import type { BiomeId } from "../biomeIds";
import { biomeBlendLabel, sampleBiomeAt } from "./biomes";
import type { Hud } from "./hud";
import { clamp } from "./seed";
import {
  createWorldField,
  sampleSurfaceHeight,
  sampleSurfaceSlopePitch,
} from "./world";

/** Cruise = skim speed only (auto-forward along heading). */
const CRUISE_SPEED: Record<LumenCruise, number> = {
  slow: 4.2,
  normal: 8.5,
  fast: 15,
};

/** Fixed ride height above the particle sea surface. */
const SKIM_HEIGHT = 2.15;
const TURN_RATE = 1.55;
const DRAG_YAW_SENS = 1.55;
const Y_SMOOTH = 6.5;
const PITCH_SMOOTH = 4.2;

export type Playfield = {
  update: (dtSec: number) => void;
  pointerDown: (nx: number, ny: number) => void;
  pointerMove: (nx: number, ny: number) => void;
  pointerUp: () => void;
  setKey: (code: string, down: boolean) => void;
  isPlaying: () => boolean;
  dispose: () => void;
};

export function createPlayfield(args: {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  seed: string;
  seedNumeric: number;
  cruise: LumenCruise;
  labels: LumenLabels;
  hud: Hud;
  glowMap: THREE.Texture;
  biomeName: (id: BiomeId) => string;
}): Playfield {
  const { scene, camera, seed, seedNumeric, cruise, hud, glowMap, biomeName } =
    args;

  const world = createWorldField(scene, glowMap, seedNumeric);
  const speed = CRUISE_SPEED[cruise];

  const keys = {
    left: false,
    right: false,
  };

  let yaw = 0;
  let pitch = 0;
  let drag = false;
  let dragNx = 0;
  let dragYaw = 0;
  let biomeAcc = 0;
  let lastBiomeLabel = biomeName("dunes");
  let ySmoothed = sampleSurfaceHeight(seedNumeric, 0, 0) + SKIM_HEIGHT;

  const forward = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const lookTarget = new THREE.Vector3();

  camera.position.set(0, ySmoothed, 0);
  world.update(camera.position);
  hud.setExplore(seed, lastBiomeLabel);

  const refreshLookVectors = () => {
    const cp = Math.cos(pitch);
    forward
      .set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp)
      .normalize();
  };

  const updateCamera = () => {
    refreshLookVectors();
    lookTarget.copy(camera.position).add(forward);
    camera.up.copy(worldUp);
    camera.lookAt(lookTarget);
  };

  const update = (dtSec: number) => {
    const dt = Math.min(dtSec, 0.048);

    // Steer only left/right — sightseeing skim, not free-fly.
    if (keys.left) yaw += TURN_RATE * dt;
    if (keys.right) yaw -= TURN_RATE * dt;

    const hx = Math.sin(yaw);
    const hz = Math.cos(yaw);
    camera.position.x += hx * speed * dt;
    camera.position.z += hz * speed * dt;

    const surfaceY = sampleSurfaceHeight(
      seedNumeric,
      camera.position.x,
      camera.position.z,
    );
    const targetY = surfaceY + SKIM_HEIGHT;
    const yAlpha = 1 - Math.exp(-Y_SMOOTH * dt);
    ySmoothed += (targetY - ySmoothed) * yAlpha;
    camera.position.y = ySmoothed;

    const slopePitch = sampleSurfaceSlopePitch(
      seedNumeric,
      camera.position.x,
      camera.position.z,
      yaw,
      7,
    );
    const pAlpha = 1 - Math.exp(-PITCH_SMOOTH * dt);
    pitch += (slopePitch - pitch) * pAlpha;
    pitch = clamp(pitch, -0.3, 0.3);

    updateCamera();
    world.update(camera.position);

    biomeAcc += dt;
    if (biomeAcc > 0.35) {
      biomeAcc = 0;
      const info = sampleBiomeAt(
        seedNumeric,
        camera.position.x,
        camera.position.z,
      );
      lastBiomeLabel = biomeBlendLabel(info.weights, biomeName);
      hud.setExplore(seed, lastBiomeLabel);
    }
  };

  const pointerDown = (nx: number, _ny: number) => {
    drag = true;
    dragNx = nx;
    dragYaw = yaw;
  };

  const pointerMove = (nx: number, _ny: number) => {
    if (!drag) return;
    // Horizontal drag only — yaw steer on the particle sea.
    yaw = dragYaw - (nx - dragNx) * DRAG_YAW_SENS;
  };

  const pointerUp = () => {
    drag = false;
  };

  const setKey = (code: string, down: boolean) => {
    if (code === "ArrowLeft" || code === "KeyA") keys.left = down;
    else if (code === "ArrowRight" || code === "KeyD") keys.right = down;
    // W/S, Space/Shift, ArrowUp/Down intentionally ignored (no free-fly).
  };

  const dispose = () => {
    world.dispose();
  };

  updateCamera();

  return {
    update,
    pointerDown,
    pointerMove,
    pointerUp,
    setKey,
    isPlaying: () => true,
    dispose,
  };
}
