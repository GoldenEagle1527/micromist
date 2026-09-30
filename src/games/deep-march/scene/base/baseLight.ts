/**
 * The lighthouse light (plan M5, §6.2: 80 m): uniforms shared by the terrain
 * and building materials, and which lanterns fill them — the lit lighthouses
 * nearest the camera, at most BL_N (the rest still glow and show their
 * column). The free dive creates the uniforms too and leaves uBLCount at 0,
 * so the terrain shader's light block is skipped (a uniform branch).
 */
import * as THREE from "three";
import { BASE_LIGHT } from "./config";
import { BL_N } from "./baseLightShader";

export type BaseLightUniforms = {
  uBL: { value: THREE.Vector4[] };
  uBLDir: { value: THREE.Vector2[] };
  uBLCount: { value: number };
  uBLColor: { value: THREE.Color };
  uBLGain: { value: number };
  uBLSweep: { value: THREE.Vector2 };
};

export function createBaseLightUniforms(): BaseLightUniforms {
  return {
    uBL: { value: Array.from({ length: BL_N }, () => new THREE.Vector4(0, 0, 0, 1)) },
    uBLDir: { value: Array.from({ length: BL_N }, () => new THREE.Vector2(1, 0)) },
    uBLCount: { value: 0 },
    uBLColor: { value: new THREE.Color(...BASE_LIGHT.color) },
    uBLGain: { value: BASE_LIGHT.gain },
    uBLSweep: { value: new THREE.Vector2(BASE_LIGHT.sweepCos, BASE_LIGHT.sweepGain) },
  };
}

export type Lantern = { x: number; y: number; z: number };

/** Sweep angle of the beams at `time` (s); every lighthouse turns in step. */
export function sweepAngle(time: number): number {
  return (time * BASE_LIGHT.sweepHz * Math.PI * 2) % (Math.PI * 2);
}

/** Fill the uniforms with the lanterns nearest `cam` (only those whose light can reach the view). */
export function updateBaseLight(u: BaseLightUniforms, lanterns: readonly Lantern[], cam: Lantern, time: number, reach: number): void {
  const near = lanterns
    .map((l) => ({ l, d: Math.hypot(l.x - cam.x, l.y - cam.y, l.z - cam.z) }))
    .filter((e) => e.d < reach + BASE_LIGHT.radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, BL_N);
  const a = sweepAngle(time);
  near.forEach((e, i) => {
    u.uBL.value[i].set(e.l.x, e.l.y, e.l.z, BASE_LIGHT.radius);
    u.uBLDir.value[i].set(Math.cos(a), Math.sin(a));
  });
  u.uBLCount.value = near.length;
}
