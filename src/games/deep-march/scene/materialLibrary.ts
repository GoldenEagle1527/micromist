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
 *   The debug panel's KTX2 switch (dive/params.ts `webp`) forces it. If WebP fails too, the loading screen offers retry().
 * - When all layers are in, both arrays are uploaded (renderer.initTexture) and
 *   `ready` turns true.
 *
 * Parts: file fetch + load tuning (materialFetch.ts), array insertion / WebP decode
 * (materialArrays.ts).
 */
import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { LAYERS } from "./materialCatalog";
import { createMaterialUniforms, type MaterialUniforms } from "./materialUniforms";

export type { MaterialUniforms };
import { MaterialDownload, type MaterialProgress } from "./materialDownload";
import { diveParams } from "./dive/params";
import { MATERIAL_LOAD, fetchMaterialFile } from "./materialFetch";
import { decodeImage, insertCompressed, insertData, type MaterialArrays } from "./materialArrays";

export { MATERIAL_LOAD };

/** Basis transcoder (copied into public/ by scripts/deep-march-materials.py). */
const TRANSCODER_PATH = `${import.meta.env.BASE_URL}deep-march/basis/`;

export type MaterialStatus = MaterialProgress & {
  /** All layers downloaded and both arrays uploaded. */
  ready: boolean;
  /** Final failure (WebP path too): loading waits for retry(). */
  error: string | null;
};

export class MaterialLibrary {
  readonly uniforms: MaterialUniforms;
  readonly download: MaterialDownload;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly lowSpec: boolean;
  private readonly anisotropy: number;
  private readonly placeholder: THREE.DataArrayTexture;
  private ktx: KTX2Loader | null = null;
  private arrays: MaterialArrays = {};
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
    const forceWebp = diveParams().webp;
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
  private fetchFile(file: string, gen: number): Promise<ArrayBuffer> {
    return fetchMaterialFile(this.download, file, () => gen !== this.gen || this.disposed);
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
      insertCompressed(this.arrays, "a", i, ta, true, this.anisotropy);
      insertCompressed(this.arrays, "n", i, tn, false, this.anisotropy);
    } finally {
      ta.dispose();
      tn.dispose();
    }
  }

  private async loadWebp(i: number, gen: number) {
    const size = this.lowSpec ? 256 : 512;
    const [fa, fn] = this.download.files(i);
    const [ba, bn] = await Promise.all([this.fetchFile(fa, gen), this.fetchFile(fn, gen)]);
    const [a, n] = await Promise.all([decodeImage(ba, size), decodeImage(bn, size)]);
    if (this.disposed || gen !== this.gen) throw new Error("superseded");
    insertData(this.arrays, "a", i, a, size, true, this.anisotropy);
    insertData(this.arrays, "n", i, n, size, false, this.anisotropy);
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
