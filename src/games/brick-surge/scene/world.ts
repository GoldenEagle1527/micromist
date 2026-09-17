import * as THREE from "three";
import type { BrickKind, BrickSurgeGameOptions, BrickSurgeLabels } from "../types";
import { readBestScore, writeBestScore } from "../scores";
import { BRICK_SIZE, createBrickField, kindColor } from "./bricks";
import { createParticlePool } from "./particles";

const TUNNEL_HALF_X = 4.2;
const TUNNEL_HALF_Y = 2.6;
const PLAY_Z = 14;
const WAVE_GAP = 9;
const PADDLE_Z = 2.2;
const BALL_R = 0.22;
const TRAIL_LEN = 10;
const CLEAR_RATIO = 0.75;

type Phase = "idle" | "playing" | "gameover";

type WaveMeta = {
  index: number;
  initialCount: number;
  z: number;
};

function pickKind(wave: number, gx: number, gy: number): BrickKind {
  const roll = Math.random();
  // Slightly more specials as waves climb
  const specialChance = Math.min(0.42, 0.12 + wave * 0.03);
  if (roll > 1 - specialChance) {
    const t = (gx + gy + wave) % 3;
    if (t === 0) return "multi";
    if (t === 1) return "deflect";
    return "explode";
  }
  return "normal";
}

export function createWorld(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  options: BrickSurgeGameOptions,
) {
  const speedMul = options.speed ?? 1;
  let labels: BrickSurgeLabels = options.labels;

  // --- tunnel ---
  scene.background = new THREE.Color(0x05070c);
  scene.fog = new THREE.FogExp2(0x05070c, 0.045);

  const amb = new THREE.AmbientLight(0x3a4558, 0.55);
  scene.add(amb);
  const key = new THREE.PointLight(0x7ec8c4, 1.4, 40, 2);
  key.position.set(0, 0, 4);
  scene.add(key);
  const rim = new THREE.PointLight(0xd4a574, 0.55, 50, 2);
  rim.position.set(0, 0, 22);
  scene.add(rim);

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x121820,
    roughness: 0.9,
    metalness: 0.05,
    side: THREE.BackSide,
  });
  const tunnel = new THREE.Mesh(
    new THREE.BoxGeometry(TUNNEL_HALF_X * 2, TUNNEL_HALF_Y * 2, 80),
    wallMat,
  );
  tunnel.position.z = 28;
  scene.add(tunnel);

  // subtle grid lines on floor
  const grid = new THREE.GridHelper(80, 40, 0x1e2a36, 0x15202a);
  grid.rotation.x = Math.PI / 2;
  grid.position.set(0, -TUNNEL_HALF_Y + 0.02, 28);
  const gridMat = grid.material as THREE.Material | THREE.Material[];
  if (Array.isArray(gridMat)) {
    for (const m of gridMat) {
      m.transparent = true;
      (m as THREE.Material & { opacity: number }).opacity = 0.35;
    }
  } else {
    gridMat.transparent = true;
    (gridMat as THREE.Material & { opacity: number }).opacity = 0.35;
  }
  scene.add(grid);

  // --- paddle ---
  const paddle = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.9, 0.28),
    new THREE.MeshStandardMaterial({
      color: 0x9ad8d4,
      emissive: 0x1a4040,
      emissiveIntensity: 0.4,
      roughness: 0.35,
      metalness: 0.2,
    }),
  );
  paddle.position.set(0, 0, PADDLE_Z);
  scene.add(paddle);

  // --- ball ---
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0xf2efe8,
      emissive: 0x8899aa,
      emissiveIntensity: 0.55,
      roughness: 0.25,
    }),
  );
  ball.position.set(0, 0, PADDLE_Z + 0.5);
  scene.add(ball);

  // trail
  const trailMats: THREE.MeshBasicMaterial[] = [];
  const trail: THREE.Mesh[] = [];
  for (let i = 0; i < TRAIL_LEN; i += 1) {
    const m = new THREE.MeshBasicMaterial({
      color: 0xa8d8d4,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    trailMats.push(m);
    const t = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 0.55, 8, 6), m);
    t.visible = false;
    scene.add(t);
    trail.push(t);
  }
  const trailPos: THREE.Vector3[] = [];

  const bricks = createBrickField(scene);
  const particles = createParticlePool(scene);

  // HUD overlay (DOM)
  const hud = document.createElement("div");
  hud.className = "brick-surge-hud";
  const status = document.createElement("div");
  status.className = "brick-surge-status";
  const flashEl = document.createElement("div");
  flashEl.className = "brick-surge-flash";

  // state
  let phase: Phase = "idle";
  let score = 0;
  let best = readBestScore();
  let lives = 3;
  let waveMult = 1;
  let activeWave = 1;
  let nextWaveToSpawn = 1;
  const waveMeta = new Map<number, WaveMeta>();
  let ballVel = new THREE.Vector3(0, 0, 0);
  let ballHeld = true;
  let pointerNX = 0;
  let pointerNY = 0;
  let keys = new Set<string>();
  let shake = 0;
  let pushT = 0;
  let pushFrom = 0;
  let pushWave = 0;
  let whiteFlash = 0;
  let paused = false;
  const camBase = new THREE.Vector3(0, 0, 0);
  camera.position.copy(camBase);
  camera.lookAt(0, 0, 24);

  const colsForWave = (w: number) => Math.min(7, 5 + Math.floor((w - 1) / 3));
  const rowsForWave = (w: number) => Math.min(4, 3 + Math.floor((w - 1) / 4));

  const spawnWave = (index: number, z: number) => {
    const cols = colsForWave(index);
    const rows = rowsForWave(index);
    const gapX = BRICK_SIZE.w + 0.12;
    const gapY = BRICK_SIZE.h + 0.12;
    const originX = -((cols - 1) * gapX) / 2;
    const originY = -((rows - 1) * gapY) / 2;
    let count = 0;
    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1) {
        const kind = pickKind(index, gx, gy);
        const id = bricks.spawn({
          kind,
          wave: index,
          gx,
          gy,
          x: originX + gx * gapX,
          y: originY + gy * gapY,
          z,
        });
        if (id >= 0) count += 1;
      }
    }
    waveMeta.set(index, { index, initialCount: count, z });
    return count;
  };

  const ensureWavesAhead = () => {
    while (nextWaveToSpawn <= activeWave + 2) {
      const z =
        nextWaveToSpawn === activeWave
          ? PLAY_Z
          : PLAY_Z + (nextWaveToSpawn - activeWave) * WAVE_GAP;
      spawnWave(nextWaveToSpawn, z);
      nextWaveToSpawn += 1;
    }
  };

  const aliveInWave = (w: number) => {
    let n = 0;
    bricks.forWave(w, () => {
      n += 1;
    });
    return n;
  };

  const clearedRatio = (w: number) => {
    const meta = waveMeta.get(w);
    if (!meta || meta.initialCount <= 0) return 1;
    return 1 - aliveInWave(w) / meta.initialCount;
  };

  const refreshHud = () => {
    hud.textContent = `${labels.score} ${score}   ${labels.best} ${best}   ${labels.lives} ${lives}   ${labels.wave} ${activeWave}   ${labels.mult}${waveMult}`;
  };

  const setStatus = (text: string) => {
    status.textContent = text;
    status.style.opacity = text ? "1" : "0";
  };

  const resetBallOnPaddle = () => {
    ballHeld = true;
    ballVel.set(0, 0, 0);
    ball.position.set(paddle.position.x, paddle.position.y, PADDLE_Z + 0.55);
    for (const t of trail) t.visible = false;
    trailPos.length = 0;
  };

  const launchBall = () => {
    if (!ballHeld || phase !== "playing") return;
    ballHeld = false;
    const sx = (Math.random() - 0.5) * 2.2;
    const sy = (Math.random() - 0.5) * 1.6;
    const sz = 9.5 + activeWave * 0.15;
    ballVel.set(sx, sy, sz).normalize().multiplyScalar((10.5 + activeWave * 0.25) * speedMul);
    setStatus("");
  };

  const startRun = () => {
    // clear bricks
    for (let i = 0; i < bricks.slots.length; i += 1) {
      if (bricks.slots[i]!.alive) bricks.kill(i);
    }
    waveMeta.clear();
    score = 0;
    lives = 3;
    waveMult = 1;
    activeWave = 1;
    nextWaveToSpawn = 1;
    phase = "playing";
    shake = 0;
    pushT = 0;
    whiteFlash = 0;
    ensureWavesAhead();
    resetBallOnPaddle();
    setStatus(labels.clickStart);
    refreshHud();
  };

  const gameOver = () => {
    phase = "gameover";
    best = writeBestScore(score);
    options.onBestChange?.(best);
    options.onGameOver?.(score, best);
    setStatus(labels.gameOver(score));
    refreshHud();
  };

  const miss = () => {
    lives -= 1;
    waveMult = 1;
    refreshHud();
    if (lives <= 0) {
      gameOver();
      return;
    }
    resetBallOnPaddle();
    setStatus(labels.clickStart);
  };

  const addScore = (base: number) => {
    score += Math.max(1, Math.floor(base * waveMult));
    best = writeBestScore(score);
    options.onBestChange?.(best);
    refreshHud();
  };

  const hitBrick = (i: number) => {
    const s = bricks.slots[i];
    if (!s || !s.alive) return;
    const kind = s.kind;
    const result = bricks.damage(i);
    if (result === "none") return;

    if (kind === "deflect") {
      // sharp angle deflect
      const ang = (Math.random() - 0.5) * Math.PI * 0.9;
      const speed = ballVel.length();
      ballVel.x = Math.sin(ang) * speed;
      ballVel.y = Math.cos(ang) * speed * 0.55;
      ballVel.z = -Math.abs(ballVel.z) * 0.35 - speed * 0.25;
      if (ballVel.z > -4) ballVel.z = -4 * speedMul;
    } else {
      ballVel.z *= -1;
      // slight positional bias
      ballVel.x += (ball.position.x - s.x) * 2.5;
      ballVel.y += (ball.position.y - s.y) * 2.5;
    }

    if (result === "dead") {
      // damage already killed; restore for destroy scoring/VFX path
      // Actually damage() already killed — rebuild burst manually
      const pos = new THREE.Vector3(s.x, s.y, s.z);
      particles.burst(pos, kindColor(kind), kind === "explode" ? 14 : 8);
      addScore(kind === "multi" ? 30 : kind === "explode" ? 40 : kind === "deflect" ? 25 : 10);
      if (kind === "explode") {
        const neigh = bricks.neighbors(s.wave, s.gx, s.gy);
        for (const ni of neigh) {
          const ns = bricks.slots[ni];
          if (!ns?.alive) continue;
          const npos = new THREE.Vector3(ns.x, ns.y, ns.z);
          const ncol = ns.color;
          bricks.kill(ni);
          particles.burst(npos, ncol, 6);
          addScore(10);
        }
      }
    } else {
      particles.burst(new THREE.Vector3(s.x, s.y, s.z), 0xffffff, 4, 3);
    }
  };

  const tryAdvanceWave = () => {
    if (pushT > 0) return;
    if (clearedRatio(activeWave) < CLEAR_RATIO) return;

    const next = activeWave + 1;
    // ensure next exists
    ensureWavesAhead();
    const meta = waveMeta.get(next);
    if (!meta) return;

    pushWave = next;
    pushFrom = meta.z;
    pushT = 0.001; // start
    whiteFlash = 0.22;
    shake = 0.35;
    waveMult += 1;
    activeWave = next;
    // retire leftovers of previous wave (fade by killing)
    const prev = next - 1;
    bricks.forWave(prev, (i) => {
      bricks.kill(i);
    });
    ensureWavesAhead();
    refreshHud();
  };

  const updatePush = (dt: number) => {
    if (pushT <= 0) return;
    pushT += dt;
    const dur = 0.38;
    const t = Math.min(1, pushT / dur);
    const ease = 1 - (1 - t) * (1 - t);
    const z = pushFrom + (PLAY_Z - pushFrom) * ease;
    bricks.forWave(pushWave, (_i, s) => {
      s.z = z;
    });
    // also park further waves
    for (let w = pushWave + 1; w < nextWaveToSpawn; w += 1) {
      const m = waveMeta.get(w);
      if (!m) continue;
      const target = PLAY_Z + (w - activeWave) * WAVE_GAP;
      bricks.forWave(w, (_i, s) => {
        s.z = target;
      });
      m.z = target;
    }
    bricks.syncAll();
    const meta = waveMeta.get(pushWave);
    if (meta) meta.z = z;
    if (t >= 1) {
      pushT = 0;
      bricks.forWave(pushWave, (_i, s) => {
        s.z = PLAY_Z;
      });
      if (meta) meta.z = PLAY_Z;
      bricks.syncAll();
    }
  };

  const updatePaddle = (dt: number) => {
    const move = 9 * speedMul * dt;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) pointerNX -= move * 0.08;
    if (keys.has("KeyD") || keys.has("ArrowRight")) pointerNX += move * 0.08;
    if (keys.has("KeyW") || keys.has("ArrowUp")) pointerNY += move * 0.08;
    if (keys.has("KeyS") || keys.has("ArrowDown")) pointerNY -= move * 0.08;
    pointerNX = THREE.MathUtils.clamp(pointerNX, -1, 1);
    pointerNY = THREE.MathUtils.clamp(pointerNY, -1, 1);

    const targetX = pointerNX * (TUNNEL_HALF_X - 1.0);
    const targetY = pointerNY * (TUNNEL_HALF_Y - 0.7);
    paddle.position.x = THREE.MathUtils.damp(paddle.position.x, targetX, 14, dt);
    paddle.position.y = THREE.MathUtils.damp(paddle.position.y, targetY, 14, dt);
    paddle.position.z = PADDLE_Z;

    if (ballHeld) {
      ball.position.x = paddle.position.x;
      ball.position.y = paddle.position.y;
      ball.position.z = PADDLE_Z + 0.55;
    }
  };

  const bounceWalls = () => {
    const limX = TUNNEL_HALF_X - BALL_R - 0.05;
    const limY = TUNNEL_HALF_Y - BALL_R - 0.05;
    if (ball.position.x > limX) {
      ball.position.x = limX;
      ballVel.x *= -1;
    } else if (ball.position.x < -limX) {
      ball.position.x = -limX;
      ballVel.x *= -1;
    }
    if (ball.position.y > limY) {
      ball.position.y = limY;
      ballVel.y *= -1;
    } else if (ball.position.y < -limY) {
      ball.position.y = -limY;
      ballVel.y *= -1;
    }
  };

  const bouncePaddle = () => {
    const dx = ball.position.x - paddle.position.x;
    const dy = ball.position.y - paddle.position.y;
    const halfW = 0.85;
    const halfH = 0.5;
    const nearZ =
      ball.position.z <= PADDLE_Z + BALL_R + 0.2 &&
      ball.position.z >= PADDLE_Z - 0.15 &&
      ballVel.z < 0;
    if (!nearZ) return;
    if (Math.abs(dx) > halfW || Math.abs(dy) > halfH) return;

    ball.position.z = PADDLE_Z + BALL_R + 0.2;
    const speed = Math.max(ballVel.length(), 9 * speedMul);
    const nx = dx / halfW;
    const ny = dy / halfH;
    ballVel.set(nx * 7, ny * 5.5, Math.abs(ballVel.z) + 1.2);
    ballVel.normalize().multiplyScalar(speed * 1.02);
    // keep primarily going into the tunnel
    if (ballVel.z < 6 * speedMul) ballVel.z = 6 * speedMul;
  };

  const collideBricks = () => {
    const hw = BRICK_SIZE.w * 0.5 + BALL_R;
    const hh = BRICK_SIZE.h * 0.5 + BALL_R;
    const hd = BRICK_SIZE.d * 0.5 + BALL_R;
    for (let i = 0; i < bricks.slots.length; i += 1) {
      const s = bricks.slots[i]!;
      if (!s.alive) continue;
      // only collide waves at/near play depth or approaching
      if (s.z > PLAY_Z + WAVE_GAP * 1.2) continue;
      const dx = ball.position.x - s.x;
      const dy = ball.position.y - s.y;
      const dz = ball.position.z - s.z;
      if (Math.abs(dx) > hw || Math.abs(dy) > hh || Math.abs(dz) > hd) continue;

      // push out along dominant axis
      const ox = hw - Math.abs(dx);
      const oy = hh - Math.abs(dy);
      const oz = hd - Math.abs(dz);
      if (oz <= ox && oz <= oy) {
        ball.position.z = s.z + Math.sign(dz || -1) * hd;
      } else if (ox <= oy) {
        ball.position.x = s.x + Math.sign(dx || 1) * hw;
        ballVel.x *= -1;
      } else {
        ball.position.y = s.y + Math.sign(dy || 1) * hh;
        ballVel.y *= -1;
      }
      hitBrick(i);
      break;
    }
  };

  const updateTrail = () => {
    if (ballHeld) {
      for (const t of trail) t.visible = false;
      trailPos.length = 0;
      return;
    }
    trailPos.unshift(ball.position.clone());
    if (trailPos.length > TRAIL_LEN) trailPos.length = TRAIL_LEN;
    for (let i = 0; i < TRAIL_LEN; i += 1) {
      const t = trail[i]!;
      const p = trailPos[i];
      if (!p) {
        t.visible = false;
        continue;
      }
      t.visible = true;
      t.position.copy(p);
      trailMats[i]!.opacity = 0.35 * (1 - i / TRAIL_LEN);
      t.scale.setScalar(1 - i * 0.07);
    }
  };

  const updateCamera = (dt: number) => {
    if (shake > 0) {
      shake -= dt;
      camera.position.x = camBase.x + (Math.random() - 0.5) * shake * 0.6;
      camera.position.y = camBase.y + (Math.random() - 0.5) * shake * 0.45;
    } else {
      camera.position.x = THREE.MathUtils.damp(camera.position.x, camBase.x, 10, dt);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, camBase.y, 10, dt);
    }
    camera.position.z = camBase.z;
    camera.lookAt(0, 0, 24);

    if (whiteFlash > 0) {
      whiteFlash -= dt;
      flashEl.style.opacity = String(Math.min(0.85, whiteFlash * 4));
    } else {
      flashEl.style.opacity = "0";
    }
  };

  const update = (dt: number) => {
    const d = Math.min(dt, 0.05);
    if (paused) {
      refreshHud();
      return;
    }

    updatePaddle(d);
    bricks.updateFlash(d);
    particles.update(d);
    updatePush(d);
    updateCamera(d);

    if (phase !== "playing" || ballHeld) {
      updateTrail();
      return;
    }

    ball.position.addScaledVector(ballVel, d);
    bounceWalls();
    bouncePaddle();
    collideBricks();
    updateTrail();

    // missed past paddle toward camera
    if (ball.position.z < PADDLE_Z - 1.2) {
      miss();
      return;
    }
    // runaway deep — soft recycle
    if (ball.position.z > PLAY_Z + WAVE_GAP * 2.5) {
      ballVel.z *= -1;
      ball.position.z = PLAY_Z + WAVE_GAP * 2.4;
    }

    tryAdvanceWave();
  };

  // input API
  const setPointerNdc = (nx: number, ny: number) => {
    pointerNX = THREE.MathUtils.clamp(nx, -1, 1);
    pointerNY = THREE.MathUtils.clamp(ny, -1, 1);
  };

  const setKey = (code: string, down: boolean) => {
    if (down) keys.add(code);
    else keys.delete(code);
  };

  const pointerDown = () => {
    if (phase === "idle" || phase === "gameover") {
      startRun();
      return;
    }
    if (phase === "playing" && ballHeld) launchBall();
  };

  const attachHud = (parent: HTMLElement) => {
    parent.appendChild(hud);
    parent.appendChild(status);
    parent.appendChild(flashEl);
    refreshHud();
    setStatus(labels.clickStart);
    // idle until first click
    phase = "idle";
    ensureWavesAhead();
    // park waves for preview
    bricks.forWave(1, (_i, s) => {
      s.z = PLAY_Z;
    });
    bricks.syncAll();
    resetBallOnPaddle();
    setStatus(`${labels.clickStart}`);
  };

  const setLabels = (next: BrickSurgeLabels) => {
    labels = next;
    refreshHud();
    if (phase === "idle") setStatus(labels.clickStart);
    if (phase === "gameover") setStatus(labels.gameOver(score));
  };

  const pause = () => {
    paused = true;
  };
  const resume = () => {
    paused = false;
  };

  const dispose = () => {
    hud.remove();
    status.remove();
    flashEl.remove();
    bricks.dispose();
    particles.dispose();
    scene.remove(paddle, ball, tunnel, grid, amb, key, rim);
    paddle.geometry.dispose();
    (paddle.material as THREE.Material).dispose();
    ball.geometry.dispose();
    (ball.material as THREE.Material).dispose();
    tunnel.geometry.dispose();
    wallMat.dispose();
    for (const t of trail) {
      scene.remove(t);
      t.geometry.dispose();
    }
    for (const m of trailMats) m.dispose();
  };

  const isPlaying = () => phase === "playing";

  return {
    update,
    dispose,
    attachHud,
    setPointerNdc,
    setKey,
    pointerDown,
    setLabels,
    pause,
    resume,
    isPlaying,
    getBest: () => best,
  };
}

export type BrickWorld = ReturnType<typeof createWorld>;
