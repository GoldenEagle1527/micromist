import * as THREE from "three";

const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _altUp = new THREE.Vector3(1, 0, 0);

export type PathFrame = {
  origin: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
};

export function createPathFrame(): PathFrame {
  return {
    origin: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0),
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function pathPoint(t: number, target: THREE.Vector3): THREE.Vector3 {
  const x = Math.sin(t * 0.11) * 4.15 + Math.sin(t * 0.037) * 2.05;
  const y = Math.cos(t * 0.079) * 2.15 + Math.sin(t * 0.148) * 0.82;
  return target.set(x, y, t);
}

export function pathFrame(t: number, frame: PathFrame): PathFrame {
  pathPoint(t, frame.origin);
  pathPoint(t + 0.4, _p1);
  pathPoint(t - 0.4, _p0);
  frame.forward.subVectors(_p1, _p0).normalize();
  const ref = Math.abs(frame.forward.dot(_worldUp)) > 0.9 ? _altUp : _worldUp;
  frame.right.crossVectors(frame.forward, ref).normalize();
  frame.up.crossVectors(frame.right, frame.forward).normalize();
  return frame;
}

export function pathToWorld(
  frame: PathFrame,
  lx: number,
  ly: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  return target
    .copy(frame.origin)
    .addScaledVector(frame.right, lx)
    .addScaledVector(frame.up, ly);
}
