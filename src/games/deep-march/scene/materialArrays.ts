/**
 * The two material texture arrays (materialLibrary.ts): one layer inserted into
 * the albedo ("a") or packed-normal ("n") array — transcoded KTX2 into a
 * CompressedArrayTexture, decoded WebP pixels into an RGBA8 DataArrayTexture.
 */
import * as THREE from "three";
import { LAYER_COUNT } from "./materialCatalog";

type Mip = { data: Uint8Array; width: number; height: number };
export type ArraySlot = { tex: THREE.CompressedArrayTexture | THREE.DataArrayTexture; format: THREE.AnyPixelFormat | THREE.CompressedPixelFormat; bytes: number[] };
export type MaterialArrays = { a?: ArraySlot; n?: ArraySlot };

/** WebP file → RGBA8 pixels at size × size. */
export async function decodeImage(buf: ArrayBuffer, size: number): Promise<Uint8Array> {
  const bmp = await createImageBitmap(new Blob([buf], { type: "image/webp" }), { resizeWidth: size, resizeHeight: size, resizeQuality: "high", colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(size, size) : Object.assign(document.createElement("canvas"), { width: size, height: size });
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0, size, size);
  bmp.close();
  return new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer);
}

function setup(t: THREE.Texture, srgb: boolean, anisotropy: number) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
}

export function insertCompressed(arrays: MaterialArrays, which: "a" | "n", i: number, t: THREE.Texture, srgb: boolean, anisotropy: number) {
  if (!(t as THREE.CompressedTexture).isCompressedTexture) throw new Error("transcoded to an uncompressed format");
  const mips = (t as THREE.CompressedTexture).mipmaps as Mip[];
  const format = t.format as THREE.CompressedPixelFormat;
  for (const m of mips) {
    if (m.data.byteLength !== THREE.TextureUtils.getByteLength(m.width, m.height, format, t.type)) throw new Error("unexpected compressed layer size");
  }
  let slot = arrays[which];
  if (!slot) {
    const levels = mips.map((m) => ({ data: new Uint8Array(m.data.byteLength * LAYER_COUNT), width: m.width, height: m.height }));
    const tex = new THREE.CompressedArrayTexture(levels as unknown as ImageData[], mips[0].width, mips[0].height, LAYER_COUNT, format, t.type);
    setup(tex, srgb, anisotropy);
    tex.generateMipmaps = false;
    slot = { tex, format, bytes: mips.map((m) => m.data.byteLength) };
    arrays[which] = slot;
  }
  if (format !== slot.format || mips.length !== slot.bytes.length || mips.some((m, k) => m.data.byteLength !== slot.bytes[k])) throw new Error("layer format differs from the array");
  const levels = slot.tex.mipmaps as unknown as Mip[];
  mips.forEach((m, k) => levels[k].data.set(m.data, i * slot.bytes[k]));
}

export function insertData(arrays: MaterialArrays, which: "a" | "n", i: number, px: Uint8Array, size: number, srgb: boolean, anisotropy: number) {
  let slot = arrays[which];
  if (!slot) {
    const tex = new THREE.DataArrayTexture(new Uint8Array(size * size * 4 * LAYER_COUNT), size, size, LAYER_COUNT);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    setup(tex, srgb, anisotropy);
    tex.generateMipmaps = true;
    slot = { tex, format: THREE.RGBAFormat, bytes: [size * size * 4] };
    arrays[which] = slot;
  }
  (slot.tex.image as { data: Uint8Array }).data.set(px, i * slot.bytes[0]);
}
