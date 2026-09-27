/**
 * Streaming state of the material library (pure logic, no IO; node-tested).
 *
 * - startup set: every layer of every region present near the spawn (the world
 *   waits for these before revealing the terrain);
 * - the rest load one at a time (materialLibrary.ts keeps a few in flight), nearest
 *   region first by the caller's priority function, re-evaluated per pick as the
 *   diver moves;
 * - a layer that isn't in yet is drawn with a loaded stand-in (same look-alike
 *   group, else same floor / wall role, else any loaded layer) and, once it arrives,
 *   cross-fades in over `fade` seconds instead of popping. Failed layers keep
 *   their stand-in. After the startup set is in, stand-ins are sticky (no swaps).
 */
import { LAYERS, LAYER_COUNT, layersOfRegion, type LayerGroup } from "./materialCatalog";

export type LayerState = "idle" | "loading" | "loaded" | "failed";

const ROLE: Record<LayerGroup, "floor" | "wall"> = { sand: "floor", gravel: "floor", "rock-light": "wall", "rock-dark": "wall" };

export class MaterialStream {
  readonly state: LayerState[] = new Array(LAYER_COUNT).fill("idle");
  /** Cross-fade progress 0…1 (1 = fully shown). */
  readonly ready = new Float32Array(LAYER_COUNT);
  /** Stand-in layer while not fully ready (−1 = none loaded yet). */
  readonly fallback = new Int32Array(LAYER_COUNT).fill(-1);
  private startup = new Set<number>();
  private revealed = false;
  private readonly fade: number;

  constructor(fadeSeconds = 1.5) {
    this.fade = fadeSeconds;
  }

  /** regionsPresent[r] > 0 for regions visible around the spawn. Returns the startup layers. */
  setStartup(regionsPresent: ArrayLike<number>): number[] {
    const s = new Set<number>();
    for (let r = 0; r < regionsPresent.length; r++) if (regionsPresent[r] > 0) layersOfRegion(r).forEach((l) => s.add(l));
    this.startup = s;
    return [...s].sort((a, b) => a - b);
  }

  /** All startup layers settled (loaded or failed). */
  startupDone(): boolean {
    for (const l of this.startup) if (this.state[l] === "idle" || this.state[l] === "loading") return false;
    return true;
  }

  allSettled(): boolean {
    return this.state.every((s) => s === "loaded" || s === "failed");
  }

  /** Next layer to fetch (startup layers first, then lowest priority value); marks it loading. −1 = none. */
  next(priority: (layer: number) => number): number {
    let best = -1, bestP = Infinity;
    for (let i = 0; i < LAYER_COUNT; i++) {
      if (this.state[i] !== "idle") continue;
      const p = (this.startup.has(i) ? -1e9 : 0) + priority(i);
      if (p < bestP) {
        bestP = p;
        best = i;
      }
    }
    if (best >= 0) this.state[best] = "loading";
    return best;
  }

  /** Layer data arrived (instant: no cross-fade, e.g. startup layers behind the loading screen). */
  loaded(i: number, instant: boolean) {
    this.state[i] = "loaded";
    if (instant) this.ready[i] = 1;
    this.pickFallbacks();
  }

  failed(i: number) {
    this.state[i] = "failed";
    this.pickFallbacks();
  }

  /** Back to idle (e.g. the loader switched to the fallback path and must refetch). */
  reset(i: number) {
    this.state[i] = "idle";
    this.ready[i] = 0;
    this.pickFallbacks();
  }

  /** Advance cross-fades; returns true if anything changed. */
  update(dt: number): boolean {
    let changed = false, done = false;
    for (let i = 0; i < LAYER_COUNT; i++) {
      if (this.state[i] === "loaded" && this.ready[i] < 1) {
        this.ready[i] = Math.min(1, this.ready[i] + dt / this.fade);
        changed = true;
        if (this.ready[i] >= 1) done = true;
      }
    }
    if (done) this.pickFallbacks();
    return changed;
  }

  /** Stand-in used for layer i right now (itself once fully ready). */
  shown(i: number): number {
    return this.ready[i] >= 1 ? i : this.fallback[i];
  }

  private pickFallbacks() {
    const sticky = this.revealed;
    const loaded = (j: number) => this.state[j] === "loaded" && this.ready[j] >= 1;
    for (let i = 0; i < LAYER_COUNT; i++) {
      if (loaded(i)) {
        this.fallback[i] = i;
        continue;
      }
      const g = LAYERS[i].group;
      let f = -1;
      for (let j = 0; j < LAYER_COUNT && f < 0; j++) if (j !== i && loaded(j) && LAYERS[j].group === g) f = j;
      for (let j = 0; j < LAYER_COUNT && f < 0; j++) if (j !== i && loaded(j) && ROLE[LAYERS[j].group] === ROLE[g]) f = j;
      for (let j = 0; j < LAYER_COUNT && f < 0; j++) if (j !== i && loaded(j)) f = j;
      // once the terrain is revealed a valid stand-in is kept (a stand-in swap would
      // be a hard switch); before that the best match is re-picked as layers arrive
      if (sticky && this.fallback[i] >= 0 && loaded(this.fallback[i])) continue;
      this.fallback[i] = f;
    }
    if (this.startup.size > 0 && this.startupDone()) this.revealed = true;
  }
}
