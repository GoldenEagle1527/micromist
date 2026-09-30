/**
 * Seabed material uniforms (node-safe, no asset imports): texture arrays + per-layer
 * and palette constants of materialCatalog.ts. MaterialLibrary fills the arrays.
 */
import * as THREE from "three";
import { LAYERS, MATERIAL_PALETTES, PALETTE_COUNT, ROT_CODE, paletteOf } from "./materialCatalog";

export type MaterialUniforms = {
  tMatA: { value: THREE.Texture };
  tMatN: { value: THREE.Texture };
  uLayer: { value: THREE.Vector4[] };
  uPal: { value: THREE.Vector4[] };
  uPalC: { value: THREE.Vector4[] };
};

export function createMaterialUniforms(placeholder: THREE.Texture): MaterialUniforms {
  return {
    tMatA: { value: placeholder },
    tMatN: { value: placeholder },
    uLayer: { value: LAYERS.map((l) => new THREE.Vector4(1 / l.repeat, l.gain, ROT_CODE[l.rot], 0)) },
    uPal: { value: Array.from({ length: PALETTE_COUNT }, (_, p) => new THREE.Vector4(...paletteOf(p).slice(0, 4))) },
    uPalC: { value: Array.from({ length: PALETTE_COUNT }, (_, p) => new THREE.Vector4(paletteOf(p)[4], MATERIAL_PALETTES[p >> 1].altAt, 0, 0)) },
  };
}
