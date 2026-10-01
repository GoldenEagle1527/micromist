/**
 * Applies the dissolve front to one ChunkManager's columns (design doc §5.5
 * key point 2): each frame, after occlusion culling, every column is classed by
 * its footprint (frontSchedule.boxZone) — wholly inside → its normal material
 * (no discard, early depth kept); across the band → the tide variant (screen
 * door); wholly beyond → moved to the culled layer. The band's variant matches
 * the columns' program (`tideFor(base)`: with DM_CHAOS for a chaotic generation, so
 * its veins and crack light stay in the band). The manager's own `visible`
 * bookkeeping is untouched; its recycling resets the material. `clear()` puts
 * back everything this changed.
 */
import * as THREE from "three";
import type { ChunkManager } from "../../terrain/chunks";
import type { TideFrontMaterial } from "../seabedMaterial";
import { boxZone } from "./frontSchedule";
import { TIDE_VIEW } from "./config";

/** Same culled layer as the occlusion pass (occlusion.ts): the camera renders layer 0 only. */
const HIDDEN_LAYER = 5;

export type FrontCounts = { drawn: number; band: number; hidden: number };

export class TerrainFront {
  private readonly tideFor: (base: THREE.Material) => TideFrontMaterial;
  private readonly hidden = new Set<THREE.Mesh>();
  private readonly banded = new Set<THREE.Mesh>();
  private readonly tides = new Set<THREE.Material>();
  counts: FrontCounts = { drawn: 0, band: 0, hidden: 0 };

  constructor(tideFor: (base: THREE.Material) => TideFrontMaterial) {
    this.tideFor = tideFor;
  }

  /** Keep `chunks`' terrain inside radius r around (cx, cz); r null = no front (undo). */
  apply(chunks: ChunkManager, base: THREE.Material, cx: number, cz: number, r: number | null): void {
    if (r === null) return this.clear(base);
    const w = TIDE_VIEW.front.width;
    const tide = this.tideFor(base);
    this.tides.add(tide.material);
    const [gr, gg, gb] = TIDE_VIEW.front.glow;
    tide.glow.setRGB(gr, gg, gb).multiplyScalar(TIDE_VIEW.front.glowGain);
    tide.front.set(cx, cz, r, w);
    const counts = { drawn: 0, band: 0, hidden: 0 };
    for (const o of chunks.meshGroup.children) {
      const mesh = o as THREE.Mesh;
      const bb = mesh.geometry?.boundingBox;
      if (!bb) continue;
      const zone = boxZone(bb.min.x, bb.min.z, bb.max.x, bb.max.z, cx, cz, r, w);
      if (zone === "out") {
        mesh.layers.set(HIDDEN_LAYER);
        this.hidden.add(mesh);
        counts.hidden++;
        continue;
      }
      if (this.hidden.delete(mesh)) mesh.layers.set(0);
      if (zone === "band" && mesh.material === base) {
        mesh.material = tide.material;
        this.banded.add(mesh);
      } else if (zone === "in" && mesh.material === tide.material) {
        mesh.material = base;
        this.banded.delete(mesh);
      }
      if (zone === "band") counts.band++;
      else counts.drawn++;
    }
    this.counts = counts;
  }

  /** Every column back to its normal material and layer (the occlusion pass re-culls next frame). */
  clear(base: THREE.Material): void {
    for (const m of this.hidden) m.layers.set(0);
    for (const m of this.banded) if (this.tides.has(m.material as THREE.Material)) m.material = base;
    this.hidden.clear();
    this.banded.clear();
    this.counts = { drawn: 0, band: 0, hidden: 0 };
  }
}
