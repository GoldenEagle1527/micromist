/**
 * The HUD's slow readouts, refreshed at 4 Hz: the terrain chip (lookup in the
 * generation-time class grid, no probing, with a short hold so the label
 * doesn't flicker on class-cell borders), the region chip (dominant macro
 * region with hysteresis: switch at ≥ 60 % weight), the fps / streaming stats line.
 */
import { REGION_KEYS, createRegionSample, type RegionField, type RegionKey } from "../../terrain/regions";
import type { EnvironmentKind, TerrainInfoStore } from "../../terrain/terrainInfo";
import type { ChunkStats } from "../../terrain/chunks";

const TERRAIN_HOLD = 0.3;
const PERIOD = 0.25;

export type StatsLabels = { chunks: string; floaters: string; tris: string; mainThread: string; classify: string };

export class HudChips {
  private readonly store: TerrainInfoStore;
  private readonly regions: RegionField;
  private terrainKind: EnvironmentKind | null = null;
  private candidate: EnvironmentKind | null = null;
  private hold = 0;
  private readonly sample = createRegionSample();
  private regionId = -1;
  private timer = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;

  constructor(store: TerrainInfoStore, regions: RegionField) {
    this.store = store;
    this.regions = regions;
  }

  get terrain(): EnvironmentKind | null {
    return this.terrainKind;
  }

  get region(): RegionKey | null {
    return this.regionId >= 0 ? REGION_KEYS[this.regionId] : null;
  }

  /** Refresh the chips on the next frame (language change). */
  refreshSoon(): void {
    this.timer = 0;
  }

  /** Per frame: real and simulated dt; `onTick` runs at 4 Hz with the fps. */
  frame(rawDt: number, dt: number, x: number, y: number, z: number, onTick: (fps: number) => void): void {
    this.fpsFrames++;
    this.fpsTime += rawDt; // real time, not the clamped sim step
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.updateTerrain(PERIOD - this.timer, x, y, z);
    this.updateRegion(x, z);
    this.timer = PERIOD;
    onTick(this.fps);
  }

  private updateTerrain(dt: number, x: number, y: number, z: number): void {
    const k = this.store.getEnvAt(x, y, z)?.kind ?? null;
    if (k === null || k === this.terrainKind) {
      this.candidate = null;
      return;
    }
    if (this.terrainKind === null) {
      this.terrainKind = k;
      return;
    }
    if (k !== this.candidate) {
      this.candidate = k;
      this.hold = 0;
      return;
    }
    this.hold += dt;
    if (this.hold >= TERRAIN_HOLD) this.terrainKind = k;
  }

  private updateRegion(x: number, z: number): void {
    const r = this.regions.sample(x, z, this.sample);
    if (this.regionId < 0 || (r.id !== this.regionId && r.w[r.id] >= 0.6)) this.regionId = r.id;
  }
}

/** The stats line: fps, pixel ratio, streaming, occlusion. */
export function statsLine(fps: number, ratio: number, st: ChunkStats, l: StatsLabels, occ: { enabled: boolean; culledCount: number }): string {
  return `${fps.toFixed(0)} fps ×${ratio.toFixed(2)} · ${l.chunks} ${st.meshes}/${st.active} (LOD ${st.lodMeshes.join("/")}) · −${st.floaters} ${l.floaters} · q${st.queued}+${st.pending} · ${(st.triangles / 1000).toFixed(0)}k ${l.tris} · ${st.workers ? `${st.workers}w` : l.mainThread} ${st.avgMs.toFixed(1)}ms (${l.classify} ${st.avgInfoMs.toFixed(1)}) · occ ${occ.enabled ? `−${occ.culledCount}` : "off"}`;
}
