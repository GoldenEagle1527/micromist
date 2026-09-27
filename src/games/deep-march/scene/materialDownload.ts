/**
 * Download bookkeeping of the seabed material library (pure, node-tested):
 * which files each layer needs on the current path, bytes received vs total,
 * layers complete, retries per file, and the switch to the WebP fallback path.
 * All 22 layers are downloaded before the dive starts (loading screen step 3).
 */
import { LAYERS, LAYER_COUNT } from "./materialCatalog";
import { MATERIAL_FILE_BYTES } from "./materialFiles";

export type MaterialPath = "ktx2" | "webp";
export type LayerLoad = "idle" | "loading" | "done" | "failed";

/** Extra attempts per file after the first one fails. */
export const MATERIAL_RETRIES = 2;

/** Files of layer i on a path (albedo, normal). */
export function layerFiles(i: number, path: MaterialPath, lowSpec: boolean): [string, string] {
  const k = LAYERS[i].key;
  return path === "ktx2" ? [`${k}_a${lowSpec ? 512 : 1024}.ktx2`, `${k}_n512.ktx2`] : [`${k}_a512.webp`, `${k}_n512.webp`];
}

export function pathBytes(path: MaterialPath, lowSpec: boolean): number {
  let s = 0;
  for (let i = 0; i < LAYER_COUNT; i++) for (const f of layerFiles(i, path, lowSpec)) s += MATERIAL_FILE_BYTES[f] ?? 0;
  return s;
}

export type MaterialProgress = {
  path: MaterialPath;
  done: number;
  total: number;
  bytes: number;
  totalBytes: number;
  /** Most recently completed layer (−1 = none yet). */
  last: number;
  /** Layers that failed on the final path (loading cannot finish until retried). */
  failed: number;
  /** Set once the KTX2 path was abandoned. */
  fellBack: boolean;
  /** Files currently being retried. */
  retrying: number;
};

export class MaterialDownload {
  readonly lowSpec: boolean;
  path: MaterialPath;
  fellBack = false;
  readonly state: LayerLoad[] = new Array(LAYER_COUNT).fill("idle");
  last = -1;
  private received = new Map<string, number>();
  private attempts = new Map<string, number>();
  private retryingFiles = new Set<string>();

  constructor(lowSpec: boolean, path: MaterialPath = "ktx2") {
    this.lowSpec = lowSpec;
    this.path = path;
  }

  files(i: number): [string, string] {
    return layerFiles(i, this.path, this.lowSpec);
  }

  /** Next idle layer in catalogue order (marks it loading), −1 = none. */
  next(): number {
    const i = this.state.indexOf("idle");
    if (i >= 0) this.state[i] = "loading";
    return i;
  }

  /** Bytes of `file` received so far in the current attempt. */
  progress(file: string, bytes: number) {
    this.received.set(file, Math.min(bytes, MATERIAL_FILE_BYTES[file] ?? bytes));
  }

  /** A fetch attempt of `file` failed: true if it may be retried (its bytes restart at 0). */
  attemptFailed(file: string): boolean {
    const n = (this.attempts.get(file) ?? 0) + 1;
    this.attempts.set(file, n);
    this.received.set(file, 0);
    const again = n <= MATERIAL_RETRIES;
    if (again) this.retryingFiles.add(file);
    else this.retryingFiles.delete(file);
    return again;
  }

  /** Failed attempts of `file` so far. */
  attemptsOf(file: string): number {
    return this.attempts.get(file) ?? 0;
  }

  fileDone(file: string) {
    this.retryingFiles.delete(file);
    this.received.set(file, MATERIAL_FILE_BYTES[file] ?? this.received.get(file) ?? 0);
  }

  layerDone(i: number) {
    this.state[i] = "done";
    this.last = i;
    for (const f of this.files(i)) this.fileDone(f);
  }

  layerFailed(i: number) {
    this.state[i] = "failed";
  }

  /** Abandon KTX2: every layer is fetched again from the WebP copies. */
  switchToWebp() {
    this.path = "webp";
    this.fellBack = true;
    this.state.fill("idle");
    this.last = -1;
    this.received.clear();
    this.attempts.clear();
    this.retryingFiles.clear();
  }

  /** User retry after a final failure: failed layers go back to idle with fresh attempts. */
  retryFailed() {
    for (let i = 0; i < LAYER_COUNT; i++) {
      if (this.state[i] !== "failed") continue;
      this.state[i] = "idle";
      for (const f of this.files(i)) {
        this.attempts.delete(f);
        this.received.set(f, 0);
      }
    }
  }

  allDone(): boolean {
    return this.state.every((s) => s === "done");
  }

  snapshot(): MaterialProgress {
    let bytes = 0;
    for (let i = 0; i < LAYER_COUNT; i++) for (const f of this.files(i)) bytes += this.received.get(f) ?? 0;
    return {
      path: this.path,
      done: this.state.filter((s) => s === "done").length,
      total: LAYER_COUNT,
      bytes,
      totalBytes: pathBytes(this.path, this.lowSpec),
      last: this.last,
      failed: this.state.filter((s) => s === "failed").length,
      fellBack: this.fellBack,
      retrying: this.retryingFiles.size,
    };
  }
}
