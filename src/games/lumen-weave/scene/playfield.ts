import * as THREE from "three";
import type { LumenDifficulty } from "../i18n";
import { readBestScore, writeBestScore } from "../scores";
import type { LumenLabels } from "../types";
import { createPointsMaterial } from "./glow";
import type { Hud } from "./hud";
import { clamp, createPathFrame, pathFrame, pathPoint, pathToWorld } from "./path";
import { createTrack, trackBudget } from "./track";
import { createTunnel, tunnelBudget } from "./tunnel";

type DiffConfig = {
  baseSpeed: number;
  spawnInterval: number;
  gapWidth: number;
  accel: number;
  maxSpeed: number;
  density: number;
};

const DIFF: Record<LumenDifficulty, DiffConfig> = {
  easy: {
    baseSpeed: 8.2,
    spawnInterval: 1.45,
    gapWidth: 0.5,
    accel: 0.09,
    maxSpeed: 16.5,
    density: 0.82,
  },
  normal: {
    baseSpeed: 11.5,
    spawnInterval: 1.12,
    gapWidth: 0.38,
    accel: 0.13,
    maxSpeed: 22,
    density: 1,
  },
  hard: {
    baseSpeed: 15.2,
    spawnInterval: 0.86,
    gapWidth: 0.28,
    accel: 0.18,
    maxSpeed: 28,
    density: 1.16,
  },
};

type BeamKind = "h-bar" | "v-bar" | "ring";

type Beam = {
  kind: BeamKind;
  gap: number;
  gapSize: number;
  t: number;
  hue: number;
  scoredNear: boolean;
  hit: boolean;
};

const MAX_BEAMS = 8;
const PTS_PER_BEAM = 92;
const STEER_MAX = 1.38;
const WALL_NEAR = 1.18;
const SPAWN_AHEAD = 40;
const HIT_NEAR = 0.55;
const HIT_FAR = 1.55;

const BEAM_CYAN = new THREE.Color(0x67e8f9);
const BEAM_MAGENTA = new THREE.Color(0xe879f9);
const BEAM_AMBER = new THREE.Color(0xf59e0b);
const CRAFT_CYAN = new THREE.Color(0xb8f4ff);
const CRAFT_PINK = new THREE.Color(0xf0abfc);

export type Playfield = {
  update: (dtSec: number) => void;
  startRun: () => void;
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
  difficulty: LumenDifficulty;
  labels: LumenLabels;
  hud: Hud;
  glowMap: THREE.Texture;
  onBestChange?: (best: number) => void;
}): Playfield {
  const { scene, camera, difficulty, labels, hud, glowMap, onBestChange } = args;
  const cfg = DIFF[difficulty];
  const track = createTrack(scene, glowMap, trackBudget(cfg.density));
  const tunnel = createTunnel(scene, glowMap, tunnelBudget(cfg.density));

  const camFrame = createPathFrame();
  const beamFrame = createPathFrame();
  const look = new THREE.Vector3();
  const world = new THREE.Vector3();
  const craftPos = new THREE.Vector3();

  const keys = {
    left: false,
    right: false,
    up: false,
    down: false,
  };

  let travel = 0;
  let steerX = 0;
  let steerY = 0.18;
  let score = 0;
  let best = readBestScore();
  let lives = 3;
  let playing = false;
  let spawnAcc = 0;
  let runSec = 0;
  let speed = cfg.baseSpeed;
  let invuln = 0;
  let shake = 0;
  let wallNearArmed = true;
  let drag = false;
  let dragNx = 0;
  let dragNy = 0;
  let dragSteerX = 0;
  let dragSteerY = 0;
  const beams: Beam[] = [];

  const beamGeo = new THREE.BufferGeometry();
  const beamPos = new Float32Array(MAX_BEAMS * PTS_PER_BEAM * 3);
  const beamCol = new Float32Array(MAX_BEAMS * PTS_PER_BEAM * 3);
  beamGeo.setAttribute("position", new THREE.BufferAttribute(beamPos, 3));
  beamGeo.setAttribute("color", new THREE.BufferAttribute(beamCol, 3));
  const beamPoints = new THREE.Points(beamGeo, createPointsMaterial(glowMap, 0.14, 1));
  beamPoints.frustumCulled = false;
  scene.add(beamPoints);

  const craftCount = 28;
  const craftGeo = new THREE.BufferGeometry();
  const craftArr = new Float32Array(craftCount * 3);
  const craftCol = new Float32Array(craftCount * 3);
  for (let i = 0; i < craftCount; i += 1) {
    const c = i < 10 ? CRAFT_CYAN : i < 20 ? CRAFT_PINK : BEAM_AMBER;
    craftCol[i * 3] = c.r;
    craftCol[i * 3 + 1] = c.g;
    craftCol[i * 3 + 2] = c.b;
  }
  craftGeo.setAttribute("position", new THREE.BufferAttribute(craftArr, 3));
  craftGeo.setAttribute("color", new THREE.BufferAttribute(craftCol, 3));
  const craft = new THREE.Points(craftGeo, createPointsMaterial(glowMap, 0.09, 1));
  craft.frustumCulled = false;
  scene.add(craft);

  const horizonGeo = new THREE.BufferGeometry();
  horizonGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
  horizonGeo.setAttribute(
    "color",
    new THREE.BufferAttribute(new Float32Array([0.85, 0.95, 1]), 3),
  );
  const horizon = new THREE.Points(horizonGeo, createPointsMaterial(glowMap, 2.4, 0.85));
  horizon.frustumCulled = false;
  scene.add(horizon);

  const showIdle = () => {
    hud.setStatus(`${labels.tryAgain}\n${labels.hint}`);
    hud.setHud(score, best, lives);
  };

  const maybeWriteBest = () => {
    const prev = best;
    best = writeBestScore(score);
    if (best !== prev) onBestChange?.(best);
  };

  const startRun = () => {
    beams.length = 0;
    score = 0;
    lives = 3;
    spawnAcc = 0.35;
    runSec = 0;
    speed = cfg.baseSpeed;
    steerX = 0;
    steerY = 0.18;
    invuln = 0;
    shake = 0;
    wallNearArmed = true;
    playing = true;
    hud.setStatus("");
    hud.setHud(score, best, lives);
  };

  const endRun = () => {
    playing = false;
    maybeWriteBest();
    hud.setStatus(`${labels.gameOver}  ·  ${score}\n${labels.tryAgain}`);
  };

  const onHit = (beam: Beam | null) => {
    if (beam) beam.hit = true;
    lives -= 1;
    invuln = 0.9;
    shake = 1;
    hud.flash();
    if (lives <= 0) endRun();
  };

  const spawnBeam = () => {
    if (beams.length >= MAX_BEAMS) return;
    const roll = Math.random();
    const kind: BeamKind = roll < 0.38 ? "h-bar" : roll < 0.72 ? "v-bar" : "ring";
    beams.push({
      kind,
      gap: (Math.random() * 2 - 1) * 0.55,
      gapSize: cfg.gapWidth * (0.9 + Math.random() * 0.22),
      t: travel + SPAWN_AHEAD,
      hue: Math.floor(Math.random() * 3),
      scoredNear: false,
      hit: false,
    });
  };

  const collides = (beam: Beam, px: number, py: number): boolean => {
    if (invuln > 0) return false;
    const half = beam.gapSize * 0.5;
    if (beam.kind === "h-bar") {
      const inGapX = Math.abs(px - beam.gap) < half;
      const inBandY = Math.abs(py - 0.05) < 0.26;
      return inBandY && !inGapX;
    }
    if (beam.kind === "v-bar") {
      const inGapY = Math.abs(py - beam.gap) < half * 0.85;
      const stripX = Math.abs(px - beam.gap) < 0.22;
      return stripX && !inGapY;
    }
    const dist = Math.hypot(px - beam.gap * 0.22, py - 0.05);
    const inner = half * 0.72;
    return dist >= inner && dist <= inner + 0.2;
  };

  const isNearMiss = (beam: Beam, px: number, py: number): boolean => {
    const half = beam.gapSize * 0.5;
    if (beam.kind === "h-bar") {
      const edge = Math.abs(Math.abs(px - beam.gap) - half);
      const inBandY = Math.abs(py - 0.05) < 0.32;
      return inBandY && edge < 0.1 && Math.abs(px - beam.gap) < half + 0.09;
    }
    if (beam.kind === "v-bar") {
      const edge = Math.abs(Math.abs(py - beam.gap) - half * 0.85);
      const stripX = Math.abs(px - beam.gap) < 0.3;
      return stripX && edge < 0.1;
    }
    const dist = Math.hypot(px - beam.gap * 0.22, py - 0.05);
    return Math.abs(dist - half * 0.72) < 0.09;
  };

  const awardNear = () => {
    const bonus = 25 + Math.floor(speed * 0.85);
    score += bonus;
    maybeWriteBest();
    hud.pulse(`${labels.nearMiss}${bonus}`);
  };

  const steerKeyboard = (dt: number) => {
    if (!playing) return;
    const rate = 1.65 * dt;
    if (keys.left) steerX -= rate;
    if (keys.right) steerX += rate;
    if (keys.up) steerY -= rate * 0.85;
    if (keys.down) steerY += rate * 0.85;
    steerX = clamp(steerX, -STEER_MAX, STEER_MAX);
    steerY = clamp(steerY, -1.05, 1.22);
  };

  const hideBeamPoint = (index: number) => {
    const o = index * 3;
    beamPos[o] = 0;
    beamPos[o + 1] = 0;
    beamPos[o + 2] = -20;
  };

  const paintBeam = (slot: number, beam: Beam, origin: THREE.Vector3) => {
    pathFrame(beam.t, beamFrame);
    const half = beam.gapSize * 0.5;
    const tint = beam.hue === 1 ? BEAM_MAGENTA : beam.hue === 2 ? BEAM_AMBER : BEAM_CYAN;
    const base = slot * PTS_PER_BEAM;
    for (let n = 0; n < PTS_PER_BEAM; n += 1) {
      const idx = base + n;
      let lx = 0;
      let ly = 0;
      let live = true;
      const u = n / (PTS_PER_BEAM - 1);
      if (beam.kind === "h-bar") {
        lx = (u * 2 - 1) * 2.15;
        ly = 0.05 + Math.sin(n * 1.7) * 0.03 + (n % 3) * 0.035;
        live = Math.abs(lx - beam.gap) > half;
      } else if (beam.kind === "v-bar") {
        lx = beam.gap + (n % 3 - 1) * 0.045;
        ly = (u * 2 - 1) * 1.55;
        live = Math.abs(ly - beam.gap) > half * 0.85;
      } else {
        const ang = u * Math.PI * 2;
        const rad = half * 0.72 + 0.1 + (n % 2) * 0.05;
        lx = Math.cos(ang) * rad + beam.gap * 0.22;
        ly = Math.sin(ang) * rad * 0.82 + 0.05;
      }
      if (!live) {
        hideBeamPoint(idx);
        continue;
      }
      pathToWorld(beamFrame, lx, ly, world).sub(origin);
      beamPos[idx * 3] = world.x;
      beamPos[idx * 3 + 1] = world.y;
      beamPos[idx * 3 + 2] = world.z;
      const glow = 0.75 + (n % 5) * 0.05;
      beamCol[idx * 3] = tint.r * glow;
      beamCol[idx * 3 + 1] = tint.g * glow;
      beamCol[idx * 3 + 2] = tint.b * glow;
    }
  };

  const updateBeams = (origin: THREE.Vector3) => {
    const playerT = travel + 0.85;
    for (let i = beams.length - 1; i >= 0; i -= 1) {
      const beam = beams[i]!;
      const rel = beam.t - playerT;
      if (rel < HIT_FAR && rel > HIT_NEAR && !beam.hit) {
        if (collides(beam, steerX, steerY)) {
          onHit(beam);
        } else if (!beam.scoredNear && isNearMiss(beam, steerX, steerY)) {
          beam.scoredNear = true;
          awardNear();
        }
      }
      if (beam.t < travel - 2.2) beams.splice(i, 1);
    }

    beamPos.fill(0);
    for (let s = 0; s < MAX_BEAMS; s += 1) {
      const beam = beams[s];
      if (beam) paintBeam(s, beam, origin);
      else {
        for (let n = 0; n < PTS_PER_BEAM; n += 1) hideBeamPoint(s * PTS_PER_BEAM + n);
      }
    }
    (beamPoints.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (beamPoints.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  };

  const updateCraft = (origin: THREE.Vector3) => {
    const blink = invuln > 0 && Math.floor(invuln * 12) % 2 === 0;
    craft.visible = !blink;
    pathFrame(travel + 0.7, beamFrame);
    pathToWorld(beamFrame, steerX, steerY, craftPos).sub(origin);
    for (let i = 0; i < craftCount; i += 1) {
      const trail = i / craftCount;
      const ang = trail * Math.PI * 2;
      const rad = i < 8 ? 0.04 : 0.02 + trail * 0.05;
      craftArr[i * 3] = craftPos.x + Math.cos(ang) * rad - beamFrame.forward.x * trail * 0.28;
      craftArr[i * 3 + 1] = craftPos.y + Math.sin(ang) * rad * 0.55 - 0.01 - trail * 0.02;
      craftArr[i * 3 + 2] = craftPos.z + Math.sin(ang * 2) * 0.02 - beamFrame.forward.z * trail * 0.28;
    }
    (craft.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  };

  const updateCamera = (origin: THREE.Vector3) => {
    const jx = shake > 0 ? (Math.random() - 0.5) * shake * 0.1 : 0;
    const jy = shake > 0 ? (Math.random() - 0.5) * shake * 0.08 : 0;
    camera.position
      .copy(camFrame.right)
      .multiplyScalar(steerX * 0.82 + jx)
      .addScaledVector(camFrame.up, steerY * 0.82 + 0.16 + jy);
    pathPoint(travel + 7.5, look).sub(origin);
    look.addScaledVector(camFrame.right, steerX * 0.28);
    look.addScaledVector(camFrame.up, steerY * 0.22);
    camera.up.copy(camFrame.up);
    camera.lookAt(look);
    camera.fov = 70 + Math.min(8, speed * 0.12);
    camera.updateProjectionMatrix();

    pathPoint(travel + 46, world).sub(origin);
    const hp = horizon.geometry.getAttribute("position") as THREE.BufferAttribute;
    hp.setXYZ(0, world.x, world.y, world.z);
    hp.needsUpdate = true;
  };

  const update = (dtSec: number) => {
    const dt = Math.min(dtSec, 0.048);
    invuln = Math.max(0, invuln - dt);
    shake = Math.max(0, shake - dt * 3.4);
    steerKeyboard(dt);

    const cruise = playing ? speed : cfg.baseSpeed * 0.32;
    travel += cruise * dt;

    pathFrame(travel, camFrame);
    track.update(travel, camFrame.origin);
    tunnel.update(travel, camFrame.origin, cruise, dt);

    if (playing) {
      runSec += dt;
      speed = Math.min(cfg.maxSpeed, cfg.baseSpeed + runSec * cfg.accel);
      score += Math.floor(speed * dt * 3.6);
      maybeWriteBest();

      spawnAcc += dt;
      const interval = Math.max(0.42, cfg.spawnInterval / (0.75 + speed * 0.028));
      if (spawnAcc >= interval) {
        spawnAcc = 0;
        spawnBeam();
      }

      const radial = Math.hypot(steerX, steerY);
      if (playing && wallNearArmed && radial > WALL_NEAR) {
        wallNearArmed = false;
        awardNear();
      } else if (radial < WALL_NEAR - 0.16) {
        wallNearArmed = true;
      }

      updateBeams(camFrame.origin);
    } else {
      updateBeams(camFrame.origin);
    }

    updateCraft(camFrame.origin);
    updateCamera(camFrame.origin);
    hud.setHud(score, best, lives);
  };

  const pointerDown = (nx: number, ny: number) => {
    if (!playing) {
      startRun();
      return;
    }
    drag = true;
    dragNx = nx;
    dragNy = ny;
    dragSteerX = steerX;
    dragSteerY = steerY;
  };

  const pointerMove = (nx: number, ny: number) => {
    if (!playing || !drag) return;
    steerX = clamp(dragSteerX + (nx - dragNx) * 1.2, -STEER_MAX, STEER_MAX);
    steerY = clamp(dragSteerY + (ny - dragNy) * 1.0, -1.05, 1.22);
  };

  const pointerUp = () => {
    drag = false;
  };

  const setKey = (code: string, down: boolean) => {
    if (code === "ArrowLeft" || code === "KeyA") keys.left = down;
    else if (code === "ArrowRight" || code === "KeyD") keys.right = down;
    else if (code === "ArrowUp" || code === "KeyW") keys.up = down;
    else if (code === "ArrowDown" || code === "KeyS") keys.down = down;
  };

  const dispose = () => {
    track.dispose();
    tunnel.dispose();
    scene.remove(beamPoints);
    scene.remove(craft);
    scene.remove(horizon);
    beamPoints.geometry.dispose();
    craft.geometry.dispose();
    horizon.geometry.dispose();
    (beamPoints.material as THREE.Material).dispose();
    (craft.material as THREE.Material).dispose();
    (horizon.material as THREE.Material).dispose();
  };

  showIdle();

  return {
    update,
    startRun,
    pointerDown,
    pointerMove,
    pointerUp,
    setKey,
    isPlaying: () => playing,
    dispose,
  };
}
