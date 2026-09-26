/**
 * First-person diver — a port of Minecraft Java (1.13+) underwater movement.
 *
 * Simulated at MC's fixed 20 ticks/s in MC units (blocks, blocks/tick), then
 * scaled by DIVER.blockSize world units per block; rendering interpolates
 * between ticks. Per tick (LivingEntity/Player.travel in water):
 *   - swimming (sprint underwater): vy += (look.y − vy) · (look.y < −0.2 ? 0.085 : 0.06)
 *   - Space (jumpInLiquid) vy += 0.04 · Shift (goDownInWater) vy −= 0.04
 *   - moveRelative(0.02, input·0.98) along camera yaw (not pitch)
 *   - move (with collisions), then drag: horizontal ×0.8 (×0.9 when sprinting), vertical ×0.8
 *   - not sprinting: vy −= gravity/16 (0.005) → slow sink (terminal ≈ 0.025 b/t)
 * Sprint: double-tap forward within 7 ticks, or the sprint key while forward
 * ≥ 0.8; ends when forward is released. Extensions: while swimming the forward
 * push is scaled by cos(pitch) so steep dives follow the look direction, and a
 * hard head-on hit that kills most speed also ends the swim.
 *
 * Collision is a single small sphere at the camera, pushed out of rock along
 * the density gradient (sub-stepped so fast swims can't tunnel).
 */
import * as THREE from "three";
import type { DensityField } from "../terrain/density";

export const DIVER = {
  /** World units per Minecraft block. */
  blockSize: 1.25,
  tickRate: 20,
  moveAccel: 0.02,
  inputScale: 0.98,
  dragWater: 0.8,
  dragSprint: 0.9,
  dragVertical: 0.8,
  gravity: 0.08,
  liquidJump: 0.04,
  liquidSink: 0.04,
  swimFollow: 0.06,
  swimFollowDown: 0.085,
  sprintTriggerTicks: 7,
  sprintMinForward: 0.8,
  maxPitch: THREE.MathUtils.degToRad(89.9),
  /** Point collider: just larger than camera.near (0.05) so the view never clips rock. */
  colliderRadius: 0.15,
};

export type DiverInput = {
  /** −1..1 back/forward, −1..1 left/right (analog from the dial, ±1 from keys). */
  forward: number;
  strafe: number;
  up: boolean;
  down: boolean;
  /** Sprint requested (sprint key held, swim latch, dial swim zone, or a double-tap pulse). */
  sprint: boolean;
};

export type DiverState = "swim" | "hover";

export class DiverController {
  /** Simulated position (world units) at the latest tick. */
  readonly position = new THREE.Vector3();
  /** Position at the previous tick, for render interpolation. */
  readonly prev = new THREE.Vector3();
  /** Velocity in blocks per tick (MC units). */
  readonly velocity = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly forward = new THREE.Vector3(0, 0, -1);
  yaw = 0;
  pitch = 0;
  sprinting = false;
  /** Seconds left on the HUD contact hold; refreshed only by a real contact this frame. */
  contactTimer = 0;
  /** y component of the last real contact normal (toward open water). */
  contactNormalY = 0;
  /** Ticks simulated by the last update() call. */
  lastTicks = 0;
  /** Total ticks simulated (20 per simulated second). */
  totalTicks = 0;

  private acc = 0;
  private blockSprint = false;
  private tickHeadOn = 0;
  private readonly field: DensityField;
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly g = new Float64Array(3);
  private readonly isRemoved: (x: number, y: number, z: number) => boolean;

  constructor(field: DensityField, isRemoved: (x: number, y: number, z: number) => boolean = () => false) {
    this.field = field;
    this.isRemoved = isRemoved;
  }

  get state(): DiverState {
    return this.sprinting ? "swim" : "hover";
  }

  /** Speed in world units per second. */
  get speed(): number {
    return this.velocity.length() * DIVER.blockSize * DIVER.tickRate;
  }

  /** Mouse/touch look, in radians. */
  look(dYaw: number, dPitch: number) {
    this.yaw += dYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dPitch, -DIVER.maxPitch, DIVER.maxPitch);
    this.updateOrientation();
  }

  setView(yaw: number, pitch: number) {
    this.yaw = yaw;
    this.pitch = THREE.MathUtils.clamp(pitch, -DIVER.maxPitch, DIVER.maxPitch);
    this.updateOrientation();
  }

  /** Interpolated render position. */
  renderPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.lerpVectors(this.prev, this.position, this.acc * DIVER.tickRate);
  }

  /** Density as rendered: removed floating rock counts as water. */
  private sample(x: number, y: number, z: number): number {
    const d = this.field.sample(x, y, z);
    const iso = this.field.settings.isoLevel;
    return d >= iso && this.isRemoved(x, y, z) ? iso - 1 : d;
  }

  private updateOrientation() {
    this.euler.set(this.pitch, this.yaw, 0, "YXZ");
    this.quaternion.setFromEuler(this.euler);
    this.forward.set(0, 0, -1).applyQuaternion(this.quaternion);
  }

  update(dt: number, input: DiverInput) {
    this.contactTimer = Math.max(0, this.contactTimer - dt);
    this.acc += dt;
    const step = 1 / DIVER.tickRate;
    let ticks = 0;
    while (this.acc >= step && ticks < 5) {
      this.acc -= step;
      this.tick(input);
      ticks++;
      this.totalTicks++;
    }
    if (ticks === 5) this.acc = Math.min(this.acc, step);
    this.lastTicks = ticks;
  }

  private tick(input: DiverInput) {
    const D = DIVER;
    const v = this.velocity;
    this.prev.copy(this.position);

    // --- sprint state (LocalPlayer.aiStep) ---
    const fwdImpulse = input.forward > 1e-5;
    if (!fwdImpulse) this.blockSprint = false;
    if (!this.sprinting && input.sprint && input.forward >= D.sprintMinForward && !this.blockSprint) this.sprinting = true;
    if (this.sprinting && !fwdImpulse) this.sprinting = false;
    const swimming = this.sprinting;

    const lookY = this.forward.y;
    const falling = v.y <= 0;

    // --- Player.travel: while swimming, vertical velocity chases the look direction ---
    if (swimming) {
      const k = lookY < -0.2 ? D.swimFollowDown : D.swimFollow;
      v.y += (lookY - v.y) * k;
    }
    // --- LivingEntity.aiStep: jumpInLiquid / goDownInWater ---
    if (input.up) v.y += D.liquidJump;
    if (input.down) v.y -= D.liquidSink;

    // --- moveRelative(0.02, input) along yaw ---
    let s = input.strafe * D.inputScale;
    let f = input.forward * D.inputScale;
    const l2 = s * s + f * f;
    if (l2 > 1) {
      const l = Math.sqrt(l2);
      s /= l;
      f /= l;
    }
    if (swimming) f *= Math.cos(this.pitch);
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // forward = (−sin yaw, 0, −cos yaw), right = (cos yaw, 0, −sin yaw)
    v.x += (-sy * f + cy * s) * D.moveAccel;
    v.z += (-cy * f - sy * s) * D.moveAccel;

    // --- move with collisions (sub-stepped) ---
    const alongBefore = v.dot(this.forward);
    this.tickHeadOn = 0;
    const dist = v.length() * D.blockSize;
    const n = Math.max(1, Math.ceil(dist / 0.07));
    for (let i = 0; i < n; i++) {
      this.position.addScaledVector(v, D.blockSize / n);
      this.resolveCollisions();
    }
    // Extension: a hard head-on hit that stops the swimmer ends the swim.
    if (swimming && this.tickHeadOn > 0.75 && alongBefore > 0.08) {
      if (v.dot(this.forward) < alongBefore * 0.3) {
        this.sprinting = false;
        this.blockSprint = true;
      }
    }

    // --- water drag ---
    const fr = this.sprinting ? D.dragSprint : D.dragWater;
    v.x *= fr;
    v.z *= fr;
    v.y *= D.dragVertical;

    // --- getFluidFallingAdjustedMovement: slow sink when not sprinting ---
    if (!this.sprinting) {
      const g16 = D.gravity / 16;
      if (falling && Math.abs(v.y - 0.005) >= 0.003 && Math.abs(v.y - g16) < 0.003) v.y = -0.003;
      else v.y -= g16;
    }
  }

  /** Current contact kind for the HUD (held ~0.3 s after the last real contact). */
  get contact(): "floor" | "ceiling" | "wall" | null {
    if (this.contactTimer <= 0) return null;
    if (this.contactNormalY > 0.5) return "floor";
    if (this.contactNormalY < -0.5) return "ceiling";
    return "wall";
  }

  /**
   * Distance t ∈ [0, r] along unit dir (dx,dy,dz) from p to the first rock, or -1
   * if the probe end is still water. Bisection, so it also works across the
   * field's thin, high-frequency features.
   */
  private probe(dx: number, dy: number, dz: number, r: number): number {
    const f = this.field;
    const iso = f.settings.isoLevel;
    const p = this.position;
    if (this.sample(p.x + dx * r, p.y + dy * r, p.z + dz * r) < iso) return -1;
    let lo = 0;
    let hi = r;
    for (let i = 0; i < 8; i++) {
      const m = (lo + hi) * 0.5;
      if (this.sample(p.x + dx * m, p.y + dy * m, p.z + dz * m) >= iso) hi = m;
      else lo = m;
    }
    return hi;
  }

  /**
   * Point collider: a sphere of radius DIVER.colliderRadius at the camera.
   * Contact = rock actually within r (verified by sampling, not just by the
   * linear distance estimate). Push out along the contact normal and remove
   * inward velocity.
   */
  resolveCollisions() {
    const f = this.field;
    const iso = f.settings.isoLevel;
    const r = DIVER.colliderRadius;
    const p = this.position;
    for (let iter = 0; iter < 4; iter++) {
      const d = this.sample(p.x, p.y, p.z);
      f.gradient(p.x, p.y, p.z, this.g, 0.05);
      const len = Math.hypot(this.g[0], this.g[1], this.g[2]);
      let nx = 0, ny = 1, nz = 0;
      if (len > 1e-6) {
        nx = -this.g[0] / len;
        ny = -this.g[1] / len;
        nz = -this.g[2] / len;
      }
      let push = 0;
      if (d >= iso) {
        // Inside rock: linear estimate along the smooth normal.
        push = Math.min(r + (d - iso) / Math.max(len, 1e-3), 1.5);
      } else {
        // Probe toward the nearest surface and straight down / up (thin ledges).
        const probes: [number, number, number][] = [[-nx, -ny, -nz], [0, -1, 0], [0, 1, 0]];
        for (const [dx, dy, dz] of probes) {
          const t = this.probe(dx, dy, dz, r);
          if (t < 0) continue;
          const pen = r - t;
          if (pen > push) {
            push = pen;
            nx = -dx;
            ny = -dy;
            nz = -dz;
          }
        }
      }
      if (push <= 1e-4) break;
      push += 1e-3;
      p.x += nx * push;
      p.y += ny * push;
      p.z += nz * push;
      const vn = this.velocity.x * nx + this.velocity.y * ny + this.velocity.z * nz;
      if (vn < 0) {
        this.velocity.x -= nx * vn;
        this.velocity.y -= ny * vn;
        this.velocity.z -= nz * vn;
        const head = -(this.forward.x * nx + this.forward.y * ny + this.forward.z * nz);
        if (head > this.tickHeadOn) this.tickHeadOn = head;
      }
      this.contactTimer = 0.3;
      this.contactNormalY = ny;
    }
  }

  /** Find open water near (x, z): the middle of the tallest water gap in the column. */
  spawn(x0: number, z0: number) {
    const f = this.field;
    const iso = f.settings.isoLevel;
    let best = { score: -1, x: x0, y: 5, z: z0 };
    for (let ring = 0; ring < 6 && best.score < 6; ring++) {
      const candidates = ring === 0 ? [[0, 0]] : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
      for (const [dx, dz] of candidates) {
        const x = x0 + dx * ring * 12;
        const z = z0 + dz * ring * 12;
        let start = NaN;
        for (let y = -16; y <= 30; y += 0.5) {
          const water = f.sample(x, y, z) < iso;
          if (water && Number.isNaN(start)) start = y;
          if ((!water || y >= 30) && !Number.isNaN(start)) {
            const gap = y - start;
            if (gap > best.score) best = { score: gap, x, y: start + gap * 0.5, z };
            start = NaN;
          }
        }
      }
    }
    this.position.set(best.x, best.y, best.z);
    this.velocity.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.updateOrientation();
    for (let i = 0; i < 10; i++) this.resolveCollisions();
    this.velocity.set(0, 0, 0);
    this.prev.copy(this.position);
    this.contactTimer = 0;
  }
}
