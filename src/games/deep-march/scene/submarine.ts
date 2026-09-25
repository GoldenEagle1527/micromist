/**
 * Submarine model (primitives) + controller — port of SebLague `Submarine.cs`:
 * Q/E change throttle, vertical axis pitches, horizontal axis yaws; turn rates
 * are smoothed and scaled by speed. Adds density-based terrain collision.
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
  rudderAngle: 30, // deg
  propellerSpeed: 14, // rad/s at full speed
  /** Extension: keep a little steering authority when nearly stopped. */
  minTurnFactor: 0.3,
  maxPitch: THREE.MathUtils.degToRad(75),
  hullRadius: 0.42,
};

export type SubInput = {
  pitch: number; // +1 nose up
  yaw: number; // +1 turn right
  throttle: number; // +1 accelerate
  boost: boolean;
  /** Instant throttle delta from the mouse wheel (units/s). */
  throttleImpulse: number;
};

export type SubModel = {
  root: THREE.Group;
  body: THREE.Group;
  propeller: THREE.Group;
  rudderYaw: THREE.Object3D;
  rudderPitch: THREE.Object3D;
  headlight: THREE.SpotLight;
  dispose: () => void;
};

export function createSubModel(): SubModel {
  const disposables: { dispose: () => void }[] = [];
  const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2, ...extra });
    disposables.push(m);
    return m;
  };
  const geo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };

  const root = new THREE.Group();
  const body = new THREE.Group(); // visual (rolls); root carries yaw/pitch
  root.add(body);

  const hullMat = mat(0xf2b632);
  const darkMat = mat(0x2b2f36, { roughness: 0.7 });
  const glassMat = mat(0x9fe8ff, { emissive: 0x3fb8d8, emissiveIntensity: 0.6, roughness: 0.1 });

  // Hull: capsule lying along -Z (forward).
  const hull = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.3, 1.0, 6, 16)), hullMat);
  hull.rotation.x = Math.PI / 2;
  body.add(hull);

  const tower = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.13, 0.28, 4, 12)), hullMat);
  tower.rotation.x = Math.PI / 2;
  tower.position.set(0, 0.3, -0.1);
  body.add(tower);

  const periscope = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 6)), darkMat);
  periscope.position.set(0, 0.5, -0.05);
  body.add(periscope);

  const windowMesh = new THREE.Mesh(geo(new THREE.SphereGeometry(0.2, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2)), glassMat);
  windowMesh.rotation.x = -Math.PI / 2;
  windowMesh.position.set(0, 0.02, -0.72);
  windowMesh.scale.set(1, 1, 0.55);
  body.add(windowMesh);

  // Side lamps
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8)), mat(0xfff0c0, { emissive: 0xffd866, emissiveIntensity: 2 }));
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(sx * 0.26, -0.12, -0.55);
    body.add(lamp);
  }

  // Tail: rudders + propeller
  const tail = new THREE.Group();
  tail.position.set(0, 0, 0.72);
  body.add(tail);

  const rudderYaw = new THREE.Group();
  const finV = new THREE.Mesh(geo(new THREE.BoxGeometry(0.03, 0.46, 0.22)), darkMat);
  finV.position.z = 0.08;
  rudderYaw.add(finV);
  tail.add(rudderYaw);

  const rudderPitch = new THREE.Group();
  const finH = new THREE.Mesh(geo(new THREE.BoxGeometry(0.52, 0.03, 0.2)), darkMat);
  finH.position.z = 0.08;
  rudderPitch.add(finH);
  tail.add(rudderPitch);

  const propeller = new THREE.Group();
  propeller.position.z = 0.28;
  const hub = new THREE.Mesh(geo(new THREE.ConeGeometry(0.06, 0.12, 8)), darkMat);
  hub.rotation.x = Math.PI / 2;
  propeller.add(hub);
  const bladeGeo = geo(new THREE.BoxGeometry(0.05, 0.2, 0.015));
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(bladeGeo, darkMat);
    const a = (i / 3) * Math.PI * 2;
    blade.position.set(Math.sin(a) * 0.1, Math.cos(a) * 0.1, 0);
    blade.rotation.z = -a;
    blade.rotation.y = 0.5;
    propeller.add(blade);
  }
  tail.add(propeller);

  // Headlight — reference: spot, colour (1, .88, .40), range 60, angle 46°.
  const headlight = new THREE.SpotLight(new THREE.Color(1, 0.884, 0.401), 28, 60, THREE.MathUtils.degToRad(30), 0.55, 1.2);
  headlight.position.set(0, -0.05, -0.8);
  headlight.target.position.set(0, -0.35, -5);
  root.add(headlight, headlight.target);

  return {
    root,
    body,
    propeller,
    rudderYaw,
    rudderPitch,
    headlight,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

const HULL_POINTS = [
  new THREE.Vector3(0, 0, -0.7),
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0, 0.7),
];

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
  private readonly tmp = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly g = new Float64Array(3);
  private propAngle = 0;

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
    this.propAngle += dt * SUB.propellerSpeed * speedPercent;
  }

  /** Signed distance estimate to the surface (positive in water). */
  clearance(p: THREE.Vector3): number {
    const f = this.field;
    const d = f.sample(p.x, p.y, p.z);
    f.gradient(p.x, p.y, p.z, this.g);
    const len = Math.hypot(this.g[0], this.g[1], this.g[2]) || 1;
    return (f.settings.isoLevel - d) / len;
  }

  /** Push the hull out of rock along the density gradient; kill inward velocity. */
  resolveCollisions() {
    const f = this.field;
    const iso = f.settings.isoLevel;
    const r = SUB.hullRadius;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const local of HULL_POINTS) {
        const p = this.tmp.copy(local).applyQuaternion(this.quaternion).add(this.position);
        const d = f.sample(p.x, p.y, p.z);
        f.gradient(p.x, p.y, p.z, this.g);
        const len = Math.hypot(this.g[0], this.g[1], this.g[2]);
        if (len < 1e-6) continue;
        const sd = (iso - d) / len;
        if (sd >= r) continue;
        // Normal toward open water = -gradient.
        const nx = -this.g[0] / len, ny = -this.g[1] / len, nz = -this.g[2] / len;
        const push = Math.min(r - sd, 1.5);
        this.position.x += nx * push;
        this.position.y += ny * push;
        this.position.z += nz * push;
        const vn = this.velocity.x * nx + this.velocity.y * ny + this.velocity.z * nz;
        if (vn < 0) {
          this.velocity.x -= nx * vn;
          this.velocity.y -= ny * vn;
          this.velocity.z -= nz * vn;
          // Scrape: bleed a bit of throttle on head-on contact.
          const head = -(this.forward.x * nx + this.forward.y * ny + this.forward.z * nz);
          if (head > 0.6) this.speed *= 0.96;
        }
        moved = true;
      }
      if (!moved) break;
      this.sinceBump = 0;
    }
  }

  /** Apply controller state to the model (rudders/propeller follow input like the reference). */
  applyToModel(model: SubModel) {
    model.root.position.copy(this.position);
    model.root.quaternion.copy(this.quaternion);
    const d2r = Math.PI / 180;
    model.rudderYaw.rotation.y = (-this.yawVelocity / SUB.maxTurnSpeed) * SUB.rudderAngle * d2r;
    model.rudderPitch.rotation.x = (this.pitchVelocity / SUB.maxPitchSpeed) * SUB.rudderAngle * d2r;
    model.propeller.rotation.z = this.propAngle;
    // Visual bank into turns.
    model.body.rotation.z = (-this.yawVelocity / SUB.maxTurnSpeed) * 0.35;
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
