/**
 * Port of SebLague `CamFollow.cs`: SmoothDamp toward sub-relative offset, and
 * slerp to look at a point ahead of the sub. Adds terrain-occlusion pull-in and
 * a first-person mode.
 */
import * as THREE from "three";
import type { SubController } from "./submarine";

export const CAM = {
  followOffset: new THREE.Vector3(0, 1.6, -2.86), // (x right, y up, z forward) like Unity
  lookAheadDst: 2.17,
  smoothTime: 0.1,
  rotSmoothSpeed: 8,
};

export type CamMode = "third" | "first";

function smoothDamp(current: THREE.Vector3, target: THREE.Vector3, vel: THREE.Vector3, smoothTime: number, dt: number) {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  for (const axis of ["x", "y", "z"] as const) {
    const change = current[axis] - target[axis];
    const temp = (vel[axis] + omega * change) * dt;
    vel[axis] = (vel[axis] - omega * temp) * exp;
    current[axis] = target[axis] + (change + temp) * exp;
  }
}

export class FollowCamera {
  mode: CamMode = "third";
  private readonly camera: THREE.PerspectiveCamera;
  private readonly vel = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  snap(sub: SubController) {
    this.computeDesired(sub);
    this.camera.position.copy(this.desired);
    this.vel.set(0, 0, 0);
    this.lookAtTarget(sub, 1);
  }

  private computeDesired(sub: SubController) {
    const o = CAM.followOffset;
    this.right.set(1, 0, 0).applyQuaternion(sub.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(sub.quaternion);
    if (this.mode === "first") {
      this.desired.copy(sub.position).addScaledVector(sub.forward, 0.55).addScaledVector(this.up, 0.14);
      return;
    }
    this.desired
      .copy(sub.position)
      .addScaledVector(sub.forward, o.z)
      .addScaledVector(this.up, o.y)
      .addScaledVector(this.right, o.x);
    // Pull in if rock sits between sub and camera.
    let best = 1;
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      this.tmp.lerpVectors(sub.position, this.desired, t);
      if (sub.clearance(this.tmp) < 0.25) {
        best = Math.max(0.15, (i - 1) / 6);
        break;
      }
    }
    if (best < 1) this.desired.lerpVectors(sub.position, this.desired, best);
  }

  private lookAtTarget(sub: SubController, t: number) {
    if (this.mode === "first") {
      this.camera.quaternion.slerp(sub.quaternion, t);
      return;
    }
    this.lookTarget.copy(sub.position).addScaledVector(sub.forward, CAM.lookAheadDst);
    this.m.lookAt(this.camera.position, this.lookTarget, THREE.Object3D.DEFAULT_UP);
    this.q.setFromRotationMatrix(this.m);
    this.camera.quaternion.slerp(this.q, t);
  }

  update(sub: SubController, dt: number) {
    this.computeDesired(sub);
    if (this.mode === "first") {
      this.camera.position.copy(this.desired);
      this.lookAtTarget(sub, Math.min(1, dt * 20));
      return;
    }
    smoothDamp(this.camera.position, this.desired, this.vel, CAM.smoothTime, dt);
    this.lookAtTarget(sub, Math.min(1, dt * CAM.rotSmoothSpeed));
  }
}
