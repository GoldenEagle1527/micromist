import * as THREE from "three";
import type { BrickKind } from "../types";

export const MAX_BRICKS = 256;

export type BrickSlot = {
  alive: boolean;
  kind: BrickKind;
  hp: number;
  maxHp: number;
  wave: number;
  /** Local grid indices for explode neighbor lookup */
  gx: number;
  gy: number;
  color: number;
  /** World target / current position */
  x: number;
  y: number;
  z: number;
  /** Flash timer after hit */
  flash: number;
};

const BRICK_W = 1.05;
const BRICK_H = 0.55;
const BRICK_D = 0.45;

export const BRICK_SIZE = { w: BRICK_W, h: BRICK_H, d: BRICK_D };

const KIND_COLORS: Record<BrickKind, number> = {
  normal: 0x5ec8c4,
  multi: 0xd4a574,
  deflect: 0xb48cff,
  explode: 0xff6b6b,
};

export function kindColor(kind: BrickKind): number {
  return KIND_COLORS[kind];
}

export function createBrickField(scene: THREE.Scene) {
  const geo = new THREE.BoxGeometry(BRICK_W, BRICK_H, BRICK_D);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.45,
    metalness: 0.15,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX_BRICKS);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  scene.add(mesh);

  const colorAttr = new THREE.InstancedBufferAttribute(
    new Float32Array(MAX_BRICKS * 3),
    3,
  );
  mesh.instanceColor = colorAttr;

  const slots: BrickSlot[] = [];
  for (let i = 0; i < MAX_BRICKS; i += 1) {
    slots.push({
      alive: false,
      kind: "normal",
      hp: 0,
      maxHp: 1,
      wave: 0,
      gx: 0,
      gy: 0,
      color: KIND_COLORS.normal,
      x: 0,
      y: 0,
      z: -100,
      flash: 0,
    });
  }

  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  const syncInstance = (i: number) => {
    const s = slots[i]!;
    if (!s.alive) {
      dummy.position.set(0, 0, -200);
      dummy.scale.setScalar(0.001);
    } else {
      dummy.position.set(s.x, s.y, s.z);
      const scale = s.kind === "multi" && s.hp < s.maxHp ? 0.92 : 1;
      dummy.scale.setScalar(scale);
    }
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    if (s.alive && s.flash > 0) {
      tmpColor.setHex(0xffffff);
    } else if (s.alive) {
      tmpColor.setHex(s.color);
      if (s.kind === "multi") {
        const t = s.hp / s.maxHp;
        tmpColor.multiplyScalar(0.55 + 0.45 * t);
      }
    } else {
      tmpColor.setRGB(0, 0, 0);
    }
    mesh.setColorAt(i, tmpColor);
  };

  const syncAll = () => {
    for (let i = 0; i < MAX_BRICKS; i += 1) syncInstance(i);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = MAX_BRICKS;
  };

  const alloc = (): number => {
    for (let i = 0; i < MAX_BRICKS; i += 1) {
      if (!slots[i]!.alive) return i;
    }
    return -1;
  };

  const spawn = (opts: {
    kind: BrickKind;
    wave: number;
    gx: number;
    gy: number;
    x: number;
    y: number;
    z: number;
  }): number => {
    const i = alloc();
    if (i < 0) return -1;
    const s = slots[i]!;
    s.alive = true;
    s.kind = opts.kind;
    s.wave = opts.wave;
    s.gx = opts.gx;
    s.gy = opts.gy;
    s.x = opts.x;
    s.y = opts.y;
    s.z = opts.z;
    s.flash = 0;
    s.maxHp = opts.kind === "multi" ? 2 + (opts.wave % 2) : 1;
    s.hp = s.maxHp;
    s.color = KIND_COLORS[opts.kind];
    syncInstance(i);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return i;
  };

  const kill = (i: number) => {
    const s = slots[i];
    if (!s || !s.alive) return;
    s.alive = false;
    s.hp = 0;
    syncInstance(i);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  const damage = (i: number): "hit" | "dead" | "none" => {
    const s = slots[i];
    if (!s || !s.alive) return "none";
    s.hp -= 1;
    s.flash = 0.12;
    if (s.hp <= 0) {
      kill(i);
      return "dead";
    }
    syncInstance(i);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return "hit";
  };

  const updateFlash = (dt: number) => {
    let dirty = false;
    for (let i = 0; i < MAX_BRICKS; i += 1) {
      const s = slots[i]!;
      if (!s.alive || s.flash <= 0) continue;
      s.flash -= dt;
      if (s.flash <= 0) s.flash = 0;
      syncInstance(i);
      dirty = true;
    }
    if (dirty) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  };

  const forWave = (wave: number, fn: (i: number, s: BrickSlot) => void) => {
    for (let i = 0; i < MAX_BRICKS; i += 1) {
      const s = slots[i]!;
      if (s.alive && s.wave === wave) fn(i, s);
    }
  };

  const countWave = (wave: number) => {
    let alive = 0;
    let total = 0;
    for (const s of slots) {
      if (s.wave !== wave) continue;
      // total = slots that were spawned for this wave still tracked...
      // We only know alive; track separately in world.
      if (s.alive) alive += 1;
    }
    return { alive, total };
  };

  const neighbors = (wave: number, gx: number, gy: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < MAX_BRICKS; i += 1) {
      const s = slots[i]!;
      if (!s.alive || s.wave !== wave) continue;
      const dx = Math.abs(s.gx - gx);
      const dy = Math.abs(s.gy - gy);
      if (dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0)) out.push(i);
    }
    return out;
  };

  const dispose = () => {
    scene.remove(mesh);
    geo.dispose();
    mat.dispose();
  };

  syncAll();

  return {
    mesh,
    slots,
    spawn,
    kill,
    damage,
    updateFlash,
    forWave,
    countWave,
    neighbors,
    syncInstance,
    syncAll,
    dispose,
  };
}

export type BrickField = ReturnType<typeof createBrickField>;
