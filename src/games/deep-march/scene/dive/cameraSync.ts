/**
 * First person: the camera is the diver's eyes (the head lamp, LampRig, rides
 * just above them). MC sprint FOV: fov × (1 + 0.15) eased ~0.5 per tick; the
 * body goes horizontal while swimming → eyes a bit lower, a gentle bob and roll.
 */
import * as THREE from "three";
import type { DiverController } from "../diver";

const BASE_FOV = 70;

export class CameraSync {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly diver: DiverController;
  private fovMod = 1;
  private swimBlend = 0;
  private bobT = 0;
  private readonly renderPos = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, diver: DiverController) {
    this.camera = camera;
    this.diver = diver;
  }

  sync(dt: number): void {
    const { camera, diver } = this;
    const swimming = diver.state === "swim";
    const target = swimming ? 1.15 : 1;
    this.fovMod += (target - this.fovMod) * (1 - Math.pow(0.5, dt * 20));
    this.swimBlend += ((swimming ? 1 : 0) - this.swimBlend) * Math.min(1, dt * 6);
    this.bobT += dt * (1.2 + this.swimBlend * 1.6);
    const fov = BASE_FOV * this.fovMod;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    diver.renderPosition(this.renderPos);
    camera.position.copy(this.renderPos);
    camera.position.y += -0.05 * this.swimBlend + Math.sin(this.bobT) * (0.008 + 0.006 * this.swimBlend);
    camera.quaternion.copy(diver.quaternion);
    if (this.swimBlend > 0.001) {
      // subtle roll with the stroke while swimming
      camera.rotateZ(Math.sin(this.bobT * 0.5) * 0.012 * this.swimBlend);
    }
  }
}
