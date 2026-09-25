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
  /** Seconds since the last terrain contact (for HUD feedback). */
  sinceBump = 99;

  private readonly field: DensityField;
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly target = new THREE.Vector3();
  private readonly g = new Float64Array(3);

  constructor(field: DensityField) {
    this.field = field;
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

    this.sinceBump += dt;
    this.resolveCollisions();
  }

  /** Push the camera sphere out of rock along the density gradient; kill inward velocity. */
  resolveCollisions() {
    const f = this.field;
    const iso = f.settings.isoLevel;
    const r = SUB.colliderRadius;
    const p = this.position;
    for (let iter = 0; iter < 4; iter++) {
      const d = f.sample(p.x, p.y, p.z);
      f.gradient(p.x, p.y, p.z, this.g, 0.05);
      const len = Math.hypot(this.g[0], this.g[1], this.g[2]);
      if (len < 1e-6) break;
      const sd = (iso - d) / len; // signed distance estimate, positive in water
      if (sd >= r) break;
      // Normal toward open water = -gradient.
      const nx = -this.g[0] / len, ny = -this.g[1] / len, nz = -this.g[2] / len;
      const push = Math.min(r - sd, 1.5);
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
      this.sinceBump = 0;
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
  }
}
