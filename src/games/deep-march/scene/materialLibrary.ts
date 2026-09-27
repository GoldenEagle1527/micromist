/**
 * Seabed material library: two texture arrays (albedo, packed normal) holding the
 * 22 sets of materialCatalog.ts. Everything is downloaded and uploaded to the GPU
 * before the dive starts (the loading screen shows the progress); nothing streams
 * in at runtime.
 *
 * - KTX2 path (primary): albedo ETC1S (1024 desktop / 512 phone), normals UASTC 512;
 *   each file fetched with byte progress, transcoded by three's KTX2Loader into the
 *   GPU's block format and copied into one CompressedArrayTexture per kind.
 * - Each file fetch is retried (MATERIAL_RETRIES) with a short back-off. If the KTX2
 *   path still fails (transcoder / compressed arrays unavailable, a file keeps
 *   failing, or transcoding yields an uncompressed format) every layer is fetched
 *   again from the WebP copies into RGBA8 DataArrayTextures (512 desktop / 256
 *   phone, mips generated) — the same multi-material system, lower resolution.
 *   `?ktx2=0` forces it (debug). If WebP fails too, the loading screen offers retry().
 * - When all layers are in, both arrays are uploaded (renderer.initTexture) and
 *   `ready` turns true.
 */
import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { LAYERS, LAYER_COUNT } from "./materialCatalog";
import { createMaterialUniforms, type MaterialUniforms } from "./materialUniforms";

export type { MaterialUniforms };
import { MaterialDownload, type MaterialProgress } from "./materialDownload";

const FILES = import.meta.glob("../assets/materials/*", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const fileUrl = (name: string): string => {
  const u = FILES[`../assets/materials/${name}`];
  if (!u) throw new Error(`missing material file ${name}`);
  return u;
};

export const MATERIAL_LOAD = {
  /** Layers fetched concurrently. */
  inFlight: 4,
  /** One fetch attempt is abandoned after this long (then retried). */
  attemptTimeoutMs: 30000,
  /** Back-off before retry n (× n). */
  retryDelayMs: 700,
};

/** Basis transcoder (copied into public/ by scripts/deep-march-materials.py). */
const TRANSCODER_PATH = `${import.meta.env.BASE_URL}deep-march/basis/`;

export type MaterialStatus = MaterialProgress & {
  /** All layers downloaded and both arrays uploaded. */
  ready: boolean;
  /** Final failure (WebP path too): loading waits for retry(). */
  error: string | null;
};

type Mip = { data: Uint8Array; width: number; height: number };
type ArraySlot = { tex: THREE.CompressedArrayTexture | THREE.DataArrayTexture; format: THREE.AnyPixelFormat | THREE.CompressedPixelFormat; bytes: number[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function decodeImage(buf: ArrayBuffer, size: number): Promise<Uint8Array> {
  const bmp = await createImageBitmap(new Blob([buf], { type: "image/webp" }), { resizeWidth: size, resizeHeight: size, resizeQuality: "high", colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(size, size) : Object.assign(document.createElement("canvas"), { width: size, height: size });
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0, size, size);
  bmp.close();
  return new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer);
}

export class MaterialLibrary {
  readonly uniforms: MaterialUniforms;
  readonly download: MaterialDownload;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly lowSpec: boolean;
  private readonly anisotropy: number;
  private readonly placeholder: THREE.DataArrayTexture;
  private ktx: KTX2Loader | null = null;
  private arrays: { a?: ArraySlot; n?: ArraySlot } = {};
  private inFlight = 0;
  /** Bumped when switching to the fallback path: results of older jobs are dropped. */
  private gen = 0;
  private disposed = false;
  private ready = false;
  private error: string | null = null;
  private readonly onReady: () => void;

  /** Starts downloading immediately; onReady fires once every layer is on the GPU. */
  constructor(renderer: THREE.WebGLRenderer, lowSpec: boolean, anisotropy: number, onReady: () => void) {
    this.renderer = renderer;
    this.lowSpec = lowSpec;
    this.anisotropy = anisotropy;
    this.onReady = onReady;
    this.placeholder = new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1);
    this.placeholder.needsUpdate = true;
    const forceWebp = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ktx2") === "0";
    this.download = new MaterialDownload(lowSpec, forceWebp ? "webp" : "ktx2");
    this.uniforms = createMaterialUniforms(this.placeholder);
    if (this.download.path === "ktx2") {
      try {
        this.ktx = new KTX2Loader().setTranscoderPath(TRANSCODER_PATH).detectSupport(renderer);
      } catch (e) {
        this.fallBack(e);
      }
    }
    this.pump();
  }

  status(): MaterialStatus {
    return { ...this.download.snapshot(), ready: this.ready, error: this.error };
  }

  /** After a final failure: fetch the failed layers again. */
  retry() {
    if (!this.error) return;
    this.error = null;
    this.download.retryFailed();
    this.pump();
  }

  private pump() {
    if (this.disposed) return;
    while (this.inFlight < MATERIAL_LOAD.inFlight) {
      const i = this.download.next();
      if (i < 0) break;
      this.inFlight++;
      const gen = this.gen;
      const job = this.download.path === "ktx2" ? this.loadKtx(i, gen) : this.loadWebp(i, gen);
      job
        .then(() => {
          if (this.disposed || gen !== this.gen) return;
          this.download.layerDone(i);
        })
        .catch((e) => {
          if (this.disposed || gen !== this.gen) return;
          if (this.download.path === "ktx2") return this.fallBack(e);
          console.warn(`[deep-march] material ${LAYERS[i].key} failed`, e);
          this.download.layerFailed(i);
          this.error = String(e instanceof Error ? e.message : e);
        })
        .finally(() => {
          this.inFlight--;
          this.settle();
        });
    }
  }

  private settle() {
    if (this.disposed || this.ready) return;
    if (this.download.allDone()) return this.finish();
    this.pump();
  }

  /** All layers in: upload both arrays now, before the dive. */
  private finish() {
    for (const [which, u] of [["a", "tMatA"], ["n", "tMatN"]] as const) {
      const slot = this.arrays[which];
      if (!slot) continue;
      slot.tex.needsUpdate = true;
      this.uniforms[u].value = slot.tex;
      this.renderer.initTexture(slot.tex);
    }
    this.ktx?.dispose(); // frees the transcoder workers
    this.ktx = null;
    this.ready = true;
    this.onReady();
  }

  private fallBack(e: unknown) {
    console.warn("[deep-march] KTX2 materials unavailable, using the WebP texture arrays", e);
    this.gen++;
    this.ktx?.dispose();
    this.ktx = null;
    this.arrays.a?.tex.dispose();
    this.arrays.n?.tex.dispose();
    this.arrays = {};
    this.download.switchToWebp();
  }

  /** Fetch one file with byte progress, retrying failed attempts. */
  private async fetchFile(file: string, gen: number): Promise<ArrayBuffer> {
    for (;;) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), MATERIAL_LOAD.attemptTimeoutMs);
      try {
        const res = await fetch(fileUrl(file), { signal: ctl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${file}`);
        const reader = res.body?.getReader();
        if (!reader) {
          const buf = await res.arrayBuffer();
          this.download.progress(file, buf.byteLength);
          return buf;
        }
        const parts: Uint8Array[] = [];
        let n = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (gen !== this.gen || this.disposed) throw new Error("superseded");
          parts.push(value);
          n += value.byteLength;
          this.download.progress(file, n);
        }
        const out = new Uint8Array(n);
        let o = 0;
        for (const p of parts) {
          out.set(p, o);
          o += p.byteLength;
        }
        return out.buffer;
      } catch (e) {
        if (gen !== this.gen || this.disposed) throw e;
        if (!this.download.attemptFailed(file)) throw e;
        await sleep(MATERIAL_LOAD.retryDelayMs * this.download.attemptsOf(file));
      } finally {
        clearTimeout(timer);
      }
    }
  }

  private async loadKtx(i: number, gen: number) {
    const ktx = this.ktx;
    if (!ktx) throw new Error("no KTX2 loader");
    const [fa, fn] = this.download.files(i);
    const [ba, bn] = await Promise.all([this.fetchFile(fa, gen), this.fetchFile(fn, gen)]);
    const parse = (b: ArrayBuffer) => new Promise<THREE.Texture>((res, rej) => ktx.parse(b, res, rej));
    const [ta, tn] = await Promise.all([parse(ba), parse(bn)]);
    try {
      if (this.disposed || gen !== this.gen) throw new Error("superseded");
      this.insertCompressed("a", i, ta, true);
      this.insertCompressed("n", i, tn, false);
    } finally {
      ta.dispose();
      tn.dispose();
    }
  }

  private setup(t: THREE.Texture, srgb: boolean) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = this.anisotropy;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
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
    }
    if (format !== slot.format || mips.length !== slot.bytes.length || mips.some((m, k) => m.data.byteLength !== slot.bytes[k])) throw new Error("layer format differs from the array");
    const levels = slot.tex.mipmaps as unknown as Mip[];
    mips.forEach((m, k) => levels[k].data.set(m.data, i * slot.bytes[k]));
  }

  private async loadWebp(i: number, gen: number) {
    const size = this.lowSpec ? 256 : 512;
    const [fa, fn] = this.download.files(i);
    const [ba, bn] = await Promise.all([this.fetchFile(fa, gen), this.fetchFile(fn, gen)]);
    const [a, n] = await Promise.all([decodeImage(ba, size), decodeImage(bn, size)]);
    if (this.disposed || gen !== this.gen) throw new Error("superseded");
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
    }
    (slot.tex.image as { data: Uint8Array }).data.set(px, i * slot.bytes[0]);
  }

  dispose() {
    this.disposed = true;
    this.ktx?.dispose();
    this.ktx = null;
    this.arrays.a?.tex.dispose();
    this.arrays.n?.tex.dispose();
    this.arrays = {};
    this.placeholder.dispose();
  }
}
