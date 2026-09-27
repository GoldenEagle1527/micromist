/**
 * Seabed material library at runtime: two texture arrays (albedo, packed normal)
 * holding the 22 sets of materialCatalog.ts, streamed in layer by layer.
 *
 * - KTX2 path (primary): albedo ETC1S (1024 desktop / 512 phone), normals UASTC 512,
 *   each layer a separate file transcoded by three's KTX2Loader into the GPU's block
 *   format and copied into one CompressedArrayTexture (uploaded per layer with
 *   addLayerUpdate, full mip chains from the files).
 * - Fallback path (transcoder / compressed arrays unavailable, or the first layer
 *   fails): the WebP copies decoded into RGBA8 DataArrayTextures (512 desktop /
 *   256 phone, mips generated) — same multi-material system, lower resolution.
 *   `?ktx2=0` forces it (debug).
 * - Order (materialStream.ts): every layer of the regions around the spawn first
 *   (the world keeps its loading screen until those are in), then the rest, nearest
 *   region first as the diver moves. A layer arriving after the reveal cross-fades
 *   in from its stand-in (no pop).
 */
import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { REGION_COUNT, createRegionSample, type RegionField } from "../terrain/regions";
import { LAYERS, LAYER_COUNT, PALETTE_COUNT, REGION_PALETTES, ROT_CODE, paletteOf, regionsOfLayer } from "./materialCatalog";
import { MaterialStream } from "./materialStream";

const FILES = import.meta.glob("../assets/materials/*", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const fileUrl = (name: string): string => {
  const u = FILES[`../assets/materials/${name}`];
  if (!u) throw new Error(`missing material file ${name}`);
  return u;
};

export const MATERIAL_STREAM = {
  /** Layers fetched concurrently. */
  inFlight: 3,
  /** Regions within this radius (world units) of the spawn load before the reveal. */
  startupRadius: 160,
  /** Cross-fade of a layer arriving after the reveal (s). */
  fade: 1.5,
  /** Give up on one layer after this long. */
  timeoutMs: 20000,
};

/** Basis transcoder (copied into public/ by scripts/deep-march-materials.py). */
const TRANSCODER_PATH = `${import.meta.env.BASE_URL}deep-march/basis/`;

export type MaterialUniforms = {
  tMatA: { value: THREE.Texture };
  tMatN: { value: THREE.Texture };
  uLayer: { value: THREE.Vector4[] };
  uLayerS: { value: THREE.Vector4[] };
  uPal: { value: THREE.Vector4[] };
  uPalC: { value: THREE.Vector4[] };
};

type Mip = { data: Uint8Array; width: number; height: number };
type ArraySlot = { tex: THREE.CompressedArrayTexture | THREE.DataArrayTexture; format: THREE.AnyPixelFormat | THREE.CompressedPixelFormat; bytes: number[] };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout")), ms);
    p.then((v) => (clearTimeout(t), res(v)), (e) => (clearTimeout(t), rej(e)));
  });
}

async function decodeImage(url: string, size: number): Promise<Uint8Array> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { resizeWidth: size, resizeHeight: size, resizeQuality: "high", colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(size, size) : Object.assign(document.createElement("canvas"), { width: size, height: size });
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0, size, size);
  bmp.close();
  return new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer);
}

export class MaterialLibrary {
  readonly uniforms: MaterialUniforms;
  readonly stream = new MaterialStream(MATERIAL_STREAM.fade);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly lowSpec: boolean;
  private readonly anisotropy: number;
  private readonly placeholder: THREE.DataArrayTexture;
  private mode: "ktx2" | "webp";
  private ktx: KTX2Loader | null = null;
  private arrays: { a?: ArraySlot; n?: ArraySlot } = {};
  private anyLoaded = false;
  private inFlight = 0;
  /** Bumped when switching to the fallback path: results of older jobs are dropped. */
  private gen = 0;
  private revealed = false;
  private disposed = false;
  private started = false;
  private dirty = true;
  private cores: { x: number; z: number; edge: number }[][] = [];
  private getPos: () => THREE.Vector3 = () => new THREE.Vector3();
  private onReady: () => void = () => {};

  constructor(renderer: THREE.WebGLRenderer, lowSpec: boolean, anisotropy: number) {
    this.renderer = renderer;
    this.lowSpec = lowSpec;
    this.anisotropy = anisotropy;
    this.placeholder = new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1);
    this.placeholder.needsUpdate = true;
    const forceWebp = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ktx2") === "0";
    this.mode = forceWebp ? "webp" : "ktx2";
    this.uniforms = {
      tMatA: { value: this.placeholder },
      tMatN: { value: this.placeholder },
      uLayer: { value: LAYERS.map((l) => new THREE.Vector4(1 / l.repeat, l.gain, ROT_CODE[l.rot], 0)) },
      uLayerS: { value: LAYERS.map((_, i) => new THREE.Vector4(0, i, 0, 0)) },
      uPal: { value: Array.from({ length: PALETTE_COUNT }, (_, p) => new THREE.Vector4(...paletteOf(p).slice(0, 4))) },
      uPalC: { value: Array.from({ length: PALETTE_COUNT }, (_, p) => new THREE.Vector4(paletteOf(p)[4], REGION_PALETTES[p >> 1].altAt, 0, 0)) },
    };
  }

  /** Begin streaming once the spawn is known; onReady fires when the spawn area's layers are in. */
  start(spawn: THREE.Vector3, regions: RegionField, getPos: () => THREE.Vector3, onReady: () => void) {
    if (this.started) return;
    this.started = true;
    this.getPos = getPos;
    this.onReady = onReady;
    const present = new Float64Array(REGION_COUNT);
    const rs = createRegionSample();
    const R = MATERIAL_STREAM.startupRadius, step = 16;
    for (let dz = -R; dz <= R; dz += step) {
      for (let dx = -R; dx <= R; dx += step) {
        if (dx * dx + dz * dz > R * R) continue;
        const s = regions.sample(spawn.x + dx, spawn.z + dz, rs);
        for (let r = 0; r < REGION_COUNT; r++) present[r] = Math.max(present[r], s.w[r]);
      }
    }
    this.stream.setStartup(present);
    this.cores = Array.from({ length: REGION_COUNT }, (_, r) => regions.coresOf(r, 8));
    if (this.mode === "ktx2") {
      try {
        this.ktx = new KTX2Loader().setTranscoderPath(TRANSCODER_PATH).detectSupport(this.renderer);
      } catch {
        this.mode = "webp";
      }
    }
    this.pump();
  }

  /** Per frame: advance cross-fades and refresh the per-layer shader state. */
  update(dt: number) {
    if (this.stream.update(dt)) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    const S = this.uniforms.uLayerS.value;
    for (let i = 0; i < LAYER_COUNT; i++) {
      const st = this.stream.state[i];
      const f = this.stream.fallback[i];
      S[i].set(st === "loaded" ? this.stream.ready[i] : 0, f >= 0 ? f : i, 0, 0);
    }
  }

  /** Approximate distance from the diver to region r (0 inside). */
  private regionDistance(r: number, x: number, z: number): number {
    let d = 1e9;
    for (const c of this.cores[r]) d = Math.min(d, Math.max(0, Math.hypot(c.x - x, c.z - z) - c.edge));
    return d;
  }

  private pump() {
    if (this.disposed) return;
    const p = this.getPos();
    while (this.inFlight < MATERIAL_STREAM.inFlight) {
      const i = this.stream.next((l) => Math.min(...regionsOfLayer(l).map((r) => this.regionDistance(r, p.x, p.z))));
      if (i < 0) break;
      this.inFlight++;
      const gen = this.gen;
      const job = this.mode === "ktx2" ? this.loadKtx(i) : this.loadWebp(i);
      withTimeout(job, MATERIAL_STREAM.timeoutMs)
        .then(() => {
          if (this.disposed || gen !== this.gen) return;
          this.anyLoaded = true;
          this.stream.loaded(i, !this.revealed);
        })
        .catch((e) => {
          if (this.disposed || gen !== this.gen) return;
          if (this.mode === "ktx2" && !this.anyLoaded) return this.switchToWebp(e);
          console.warn(`[deep-march] material layer ${LAYERS[i].key} failed; keeping its stand-in`, e);
          this.stream.failed(i);
        })
        .finally(() => {
          this.inFlight--;
          this.settle();
        });
    }
  }

  private settle() {
    if (this.disposed) return;
    this.dirty = true;
    if (!this.revealed && this.stream.startupDone()) {
      this.revealed = true;
      this.update(0);
      this.onReady();
    }
    if (this.stream.allSettled()) {
      this.ktx?.dispose(); // frees the transcoder workers
      this.ktx = null;
    }
    this.pump();
  }

  private switchToWebp(e: unknown) {
    console.warn("[deep-march] KTX2 materials unavailable, using the WebP texture arrays", e);
    this.mode = "webp";
    this.gen++;
    this.ktx?.dispose();
    this.ktx = null;
    this.dropArrays();
    for (let i = 0; i < LAYER_COUNT; i++) if (this.stream.state[i] !== "idle") this.stream.reset(i);
  }

  private dropArrays() {
    this.arrays.a?.tex.dispose();
    this.arrays.n?.tex.dispose();
    this.arrays = {};
    this.uniforms.tMatA.value = this.placeholder;
    this.uniforms.tMatN.value = this.placeholder;
  }

  private setup(t: THREE.Texture, srgb: boolean) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = this.anisotropy;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }

  private async loadKtx(i: number) {
    const ktx = this.ktx;
    if (!ktx) throw new Error("no KTX2 loader");
    const key = LAYERS[i].key;
    const [ta, tn] = await Promise.all([ktx.loadAsync(fileUrl(`${key}_a${this.lowSpec ? 512 : 1024}.ktx2`)), ktx.loadAsync(fileUrl(`${key}_n512.ktx2`))]);
    try {
      if (this.disposed || this.mode !== "ktx2") throw new Error("superseded");
      this.insertCompressed("a", i, ta, true);
      this.insertCompressed("n", i, tn, false);
    } finally {
      ta.dispose();
      tn.dispose();
    }
  }

  private insertCompressed(which: "a" | "n", i: number, t: THREE.Texture, srgb: boolean) {
    if (!(t as THREE.CompressedTexture).isCompressedTexture) throw new Error("transcoded to an uncompressed format");
    const mips = (t as THREE.CompressedTexture).mipmaps as Mip[];
    const format = t.format as THREE.CompressedPixelFormat;
    for (const m of mips) {
      if (m.data.byteLength !== THREE.TextureUtils.getByteLength(m.width, m.height, format, t.type)) throw new Error("unexpected compressed layer size");
    }
    let slot = this.arrays[which];
    if (!slot) {
      const levels = mips.map((m) => ({ data: new Uint8Array(m.data.byteLength * LAYER_COUNT), width: m.width, height: m.height }));
      const tex = new THREE.CompressedArrayTexture(levels as unknown as ImageData[], mips[0].width, mips[0].height, LAYER_COUNT, format, t.type);
      this.setup(tex, srgb);
      tex.generateMipmaps = false;
      slot = { tex, format, bytes: mips.map((m) => m.data.byteLength) };
      this.arrays[which] = slot;
      this.uniforms[which === "a" ? "tMatA" : "tMatN"].value = tex;
    }
    if (format !== slot.format || mips.length !== slot.bytes.length || mips.some((m, k) => m.data.byteLength !== slot.bytes[k])) throw new Error("layer format differs from the array");
    const levels = slot.tex.mipmaps as unknown as Mip[];
    mips.forEach((m, k) => levels[k].data.set(m.data, i * slot.bytes[k]));
    slot.tex.addLayerUpdate(i);
    slot.tex.needsUpdate = true;
  }

  private async loadWebp(i: number) {
    const key = LAYERS[i].key;
    const size = this.lowSpec ? 256 : 512;
    const [a, n] = await Promise.all([decodeImage(fileUrl(`${key}_a512.webp`), size), decodeImage(fileUrl(`${key}_n512.webp`), size)]);
    if (this.disposed) throw new Error("disposed");
    this.insertData("a", i, a, size, true);
    this.insertData("n", i, n, size, false);
  }

  private insertData(which: "a" | "n", i: number, px: Uint8Array, size: number, srgb: boolean) {
    let slot = this.arrays[which];
    if (!slot) {
      const tex = new THREE.DataArrayTexture(new Uint8Array(size * size * 4 * LAYER_COUNT), size, size, LAYER_COUNT);
      tex.format = THREE.RGBAFormat;
      tex.type = THREE.UnsignedByteType;
      this.setup(tex, srgb);
      tex.generateMipmaps = true;
      slot = { tex, format: THREE.RGBAFormat, bytes: [size * size * 4] };
      this.arrays[which] = slot;
      this.uniforms[which === "a" ? "tMatA" : "tMatN"].value = tex;
    }
    (slot.tex.image as { data: Uint8Array }).data.set(px, i * slot.bytes[0]);
    slot.tex.addLayerUpdate(i);
    slot.tex.needsUpdate = true;
  }

  dispose() {
    this.disposed = true;
    this.ktx?.dispose();
    this.ktx = null;
    this.dropArrays();
    this.placeholder.dispose();
  }
}
