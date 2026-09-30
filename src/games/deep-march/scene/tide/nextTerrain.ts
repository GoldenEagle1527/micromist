/**
 * gen + 1's terrain during a tide (design doc §5.5 key point 1, "double
 * buffer"): its density field and a second ChunkManager on the same mesher
 * workers (terrain/poolRouter.ts: the workers add gen + 1's field next to the
 * current one). It streams around the diver from the warning on, hidden, with
 * no LOD crossfades; `ready` = the loading gate's rule (every footprint in view
 * drawn, level 0 around the diver) and the set settled (nothing queued or
 * building), so P4 shows it at full detail. At the switch it becomes the current
 * terrain (the director hands `chunks` / `field` to the loop).
 */
import type * as THREE from "three";
import { ChunkManager } from "../../terrain/chunks";
import type { TerrainSettings } from "../../terrain/config";
import { createDensityField, type DensityField } from "../../terrain/density";
import type { PoolRouter } from "../../terrain/poolRouter";
import type { SiteLayout } from "../../terrain/siteLayout";
import type { SeabedMaterial } from "../seabedMaterial";

/** The loading gate's level-0 radius (dive/loadingGate.ts). */
const NEAR_RADIUS = 14;

export class NextTerrain {
  readonly field: DensityField;
  readonly chunks: ChunkManager;

  constructor(scene: THREE.Scene, router: PoolRouter, seed: number, settings: TerrainSettings, layout: SiteLayout, gen: number, seabed: SeabedMaterial, lowSpec: boolean) {
    this.field = createDensityField(seed, settings, undefined, layout);
    this.chunks = new ChunkManager(scene, this.field, seed, seabed.material, lowSpec, seabed.fadeMaterial, router.view(gen, layout));
    this.chunks.meshGroup.visible = false;
  }

  update(viewer: THREE.Vector3, camera: THREE.Camera, dt: number): void {
    this.chunks.update(viewer, camera, dt);
  }

  ready(viewer: THREE.Vector3): boolean {
    const c = this.chunks;
    return c.nearReady(viewer, NEAR_RADIUS) && c.coverageComplete(viewer) && c.queueLength === 0 && c.stats().pending === 0;
  }

  /** The switch: drawn from now on (the front decides where). */
  show(): void {
    this.chunks.meshGroup.visible = true;
  }

  dispose(): void {
    this.chunks.dispose();
  }
}
