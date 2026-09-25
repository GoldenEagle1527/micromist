/**
 * First-person submarine controller — port of SebLague `Submarine.cs`:
 * Q/E change throttle, vertical axis pitches, horizontal axis yaws; turn rates
 * are smoothed and scaled by speed. The camera sits at `position`; collision is
 * a single small sphere there, pushed out of rock along the density gradient.
 */
import * as THREE from "three";
import type { DensityField } from "../terrain/density";

export const SUB = {
  maxSpeed: 5,
  boostMultiplier: 1.8,
  maxPitchSpeed: 50, // deg/s
  maxTurnSpeed: 80, // deg/s
  acceleration: 2,
  smoothSpeed: 3,
  smoothTurnSpeed: 2,
  /** Extension: keep a little steering authority when nearly stopped. */
  minTurnFactor: 0.3,
  maxPitch: THREE.MathUtils.degToRad(75),
  /** Point collider: just larger than camera.near (0.05) so the view never clips rock. */
  colliderRadius: 0.15,
};

export type SubInput = {
  pitch: number; // +1 nose up
  yaw: number; // +1 turn right
  throttle: number; // +1 accelerate
  boost: boolean;
  /** Instant throttle delta from the mouse wheel (units/s). */
  throttleImpulse: number;
};

export class SubController {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly forward = new THREE.Vector3(0, 0, -1);
  yaw = 0;
  pitch = 0;
  speed = SUB.maxSpeed * 0.6;
  yawVelocity = 0;
  pitchVelocity = 0;
  /** Seconds left on the HUD contact hold; refreshed only by a real contact this frame. */
  contactTimer = 0;
  /** y component of the last real contact normal (toward open water). */
  contactNormalY = 0;

  private readonly field: DensityField;
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly target = new THREE.Vector3();
  private readonly g = new Float64Array(3);

  /** Returns true where floating rock was removed from the rendered terrain. */
  private readonly isRemoved: (x: number, y: number, z: number) => boolean;

  constructor(field: DensityField, isRemoved: (x: number, y: number, z: number) => boolean = () => false) {
    this.field = field;
    this.isRemoved = isRemoved;
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

  update(dt: number, input: SubInput) {
    const maxSpeed = SUB.maxSpeed * (input.boost ? SUB.boostMultiplier : 1);
    this.speed += SUB.acceleration * dt * input.throttle + input.throttleImpulse;
    this.speed = THREE.MathUtils.clamp(this.speed, 0, maxSpeed);
    if (!input.boost && this.speed > SUB.maxSpeed) this.speed = Math.max(SUB.maxSpeed, this.speed - 4 * dt);
    const speedPercent = Math.min(1, this.speed / SUB.maxSpeed);
    const turnFactor = Math.max(speedPercent, SUB.minTurnFactor);

    const k = Math.min(1, dt * SUB.smoothTurnSpeed);
    this.pitchVelocity += (input.pitch * SUB.maxPitchSpeed - this.pitchVelocity) * k;
    this.yawVelocity += (input.yaw * SUB.maxTurnSpeed - this.yawVelocity) * k;

    const d2r = Math.PI / 180;
    this.yaw -= this.yawVelocity * d2r * dt * turnFactor;
    this.pitch += this.pitchVelocity * d2r * dt * turnFactor;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -SUB.maxPitch, SUB.maxPitch);
    this.updateOrientation();

    this.target.copy(this.forward).multiplyScalar(this.speed);
    this.velocity.lerp(this.target, Math.min(1, dt * SUB.smoothSpeed));
    this.position.addScaledVector(this.velocity, dt);

    this.contactTimer = Math.max(0, this.contactTimer - dt);
    this.resolveCollisions();
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
   * density's y-discontinuities (terrace steps are real mesh faces).
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
   * Point collider: a sphere of radius SUB.colliderRadius at the camera.
   * Contact = rock actually within r (verified by sampling, not just by the
   * linear distance estimate). Push out along the contact normal and remove
   * inward velocity.
   */
  resolveCollisions() {
    const f = this.field;
    const iso = f.settings.isoLevel;
    const r = SUB.colliderRadius;
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
        // Probe toward the nearest surface and straight down / up (terrace steps).
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
        // Scrape: bleed a bit of throttle on head-on contact.
        const head = -(this.forward.x * nx + this.forward.y * ny + this.forward.z * nz);
        if (head > 0.6) this.speed *= 0.96;
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
    this.contactTimer = 0;
  }
}
