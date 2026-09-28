/**
 * Seabed material uniforms (node-safe, no asset imports): texture arrays + per-layer
 * and palette constants of materialCatalog.ts. MaterialLibrary fills the arrays.
 */
import * as THREE from "three";
import { LAYERS, PALETTE_COUNT, REGION_PALETTES, ROT_CODE, paletteOf } from "./materialCatalog";

export type MaterialUniforms = {
  tMatA: { value: THREE.Texture };
  tMatN: { value: THREE.Texture };
  uLayer: { value: THREE.Vector4[] };
  uPal: { value: THREE.Vector4[] };
  uPalC: { value: THREE.Vector4[] };
  /** Flat-colour fallback (DM_FLAT_MAT): per region floor / wall / ceiling tone of its main palette. */
  uFlat: { value: THREE.Vector3[] };
};

/** Region r → [floor, wall, ceiling] mean albedo (× gain) of its main palette. */
export function flatTones(): THREE.Vector3[] {
  const tone = (l: number) => new THREE.Vector3(...LAYERS[l].tone).multiplyScalar(LAYERS[l].gain);
  const out: THREE.Vector3[] = [];
  for (const { main } of REGION_PALETTES) {
    out.push(tone(main[0]).add(tone(main[1])).multiplyScalar(0.5), tone(main[2]).add(tone(main[3])).multiplyScalar(0.5), tone(main[4]));
  }
  return out;
}

export function createMaterialUniforms(placeholder: THREE.Texture): MaterialUniforms {
  return {
    tMatA: { value: placeholder },
    tMatN: { value: placeholder },
    uLayer: { value: LAYERS.map((l) => new THREE.Vector4(1 / l.repeat, l.gain, ROT_CODE[l.rot], 0)) },
    uPal: { value: Array.from({ length: PALETTE_COUNT }, (_, p) => new THREE.Vector4(...paletteOf(p).slice(0, 4))) },
    uPalC: { value: Array.from({ length: PALETTE_COUNT }, (_, p) => new THREE.Vector4(paletteOf(p)[4], REGION_PALETTES[p >> 1].altAt, 0, 0)) },
    uFlat: { value: flatTones() },
  };
}
