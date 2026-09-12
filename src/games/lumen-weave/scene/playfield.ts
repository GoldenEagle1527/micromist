import * as THREE from "three";
import type { LumenCruise } from "../i18n";
import type { LumenLabels } from "../types";
import type { BiomeId } from "../biomeIds";
import { sampleBiomeAt } from "./biomes";
import type { Hud } from "./hud";
import { clamp } from "./seed";
import { createWorldField } from "./world";

const CRUISE_SPEED: Record<LumenCruise, number> = {
  slow: 5.5,
  normal: 11,
  fast: 20,
};

const LOOK_SENS = 1.35;
const STRAFE = 7.5;
const PITCH_MAX = 1.35;

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
    up: false,
    down: false,
    forward: false,
    back: false,
  };

  let yaw = 0;
  let pitch = 0;
  let drag = false;
  let dragNx = 0;
  let dragNy = 0;
  let dragYaw = 0;
  let dragPitch = 0;
  let biomeAcc = 0;
  let lastBiome: BiomeId = "dunes";

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const lookTarget = new THREE.Vector3();

  camera.position.set(0, 1.2, 0);
  world.update(camera.position);
  hud.setExplore(seed, biomeName(lastBiome));

  const refreshLookVectors = () => {
    const cp = Math.cos(pitch);
    forward
      .set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp)
      .normalize();
    right.crossVectors(forward, worldUp).normalize();
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  };

  const updateCamera = () => {
    refreshLookVectors();
    lookTarget.copy(camera.position).add(forward);
    camera.up.copy(worldUp);
    camera.lookAt(lookTarget);
  };

  const update = (dtSec: number) => {
    const dt = Math.min(dtSec, 0.048);
    refreshLookVectors();

    const cruiseMul = keys.forward ? 1.35 : keys.back ? 0.45 : 1;
    camera.position.addScaledVector(forward, speed * cruiseMul * dt);
    if (keys.left) camera.position.addScaledVector(right, -STRAFE * dt);
    if (keys.right) camera.position.addScaledVector(right, STRAFE * dt);
    if (keys.up) camera.position.y += STRAFE * dt;
    if (keys.down) camera.position.y -= STRAFE * dt;

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
      lastBiome = info.id;
      hud.setExplore(seed, biomeName(lastBiome));
    }
  };

  const pointerDown = (nx: number, ny: number) => {
    drag = true;
    dragNx = nx;
    dragNy = ny;
    dragYaw = yaw;
    dragPitch = pitch;
  };

  const pointerMove = (nx: number, ny: number) => {
    if (!drag) return;
    yaw = dragYaw + (nx - dragNx) * LOOK_SENS;
    pitch = clamp(
      dragPitch + (ny - dragNy) * LOOK_SENS * 0.85,
      -PITCH_MAX,
      PITCH_MAX,
    );
  };

  const pointerUp = () => {
    drag = false;
  };

  const setKey = (code: string, down: boolean) => {
    if (code === "ArrowLeft" || code === "KeyA") keys.left = down;
    else if (code === "ArrowRight" || code === "KeyD") keys.right = down;
    else if (code === "KeyW") keys.forward = down;
    else if (code === "KeyS") keys.back = down;
    else if (code === "ArrowUp" || code === "Space") keys.up = down;
    else if (
      code === "ArrowDown" ||
      code === "ShiftLeft" ||
      code === "ShiftRight"
    )
      keys.down = down;
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
