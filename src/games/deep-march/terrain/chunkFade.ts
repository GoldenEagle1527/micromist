/**
 * LOD crossfades (chunks.ts): a swap between a column and its replacements is a
 * short screen-door dissolve (LOD_FADE_S, seabedMaterial fadeMaterial) instead of
 * a one-frame pop. Fade materials are pooled; a finished fade puts the column's
 * resting material back.
 */
import type * as THREE from "three";
import type { LodFadeMaterial } from "../scene/seabedMaterial";
import { LOD_FADE_S, type ChunkNode } from "./chunkNode";

export class LodFader {
  private readonly factory: (() => LodFadeMaterial) | null;
  private readonly pool: LodFadeMaterial[] = [];
  private readonly fading = new Set<ChunkNode>();
  private readonly material: THREE.Material;
  private clock = 0;

  constructor(material: THREE.Material, factory: (() => LodFadeMaterial) | null) {
    this.material = material;
    this.factory = factory;
  }

  /** Crossfades available (else swaps are instant). */
  get enabled(): boolean {
    return !!this.factory;
  }

  tick(dt: number) {
    this.clock += dt;
  }

  start(n: ChunkNode, dir: number) {
    if (!n.mesh || !this.factory) return;
    n.awaitFade = false;
    n.resident = false;
    if (!n.fadeMat) n.fadeMat = this.pool.pop() ?? this.factory();
    n.fade = dir;
    n.fadeStart = this.clock;
    n.fadeMat.fade.set(0, dir);
    n.mesh.material = n.fadeMat.material;
    n.mesh.visible = true;
    n.mesh.userData.fadeDir = dir; // the sonar scan skips meshes dissolving away
    this.fading.add(n);
  }

  end(n: ChunkNode) {
    this.fading.delete(n);
    n.fade = 0;
    if (n.mesh) {
      n.mesh.material = this.material;
      delete n.mesh.userData.fadeDir;
    }
    if (n.fadeMat) {
      this.pool.push(n.fadeMat);
      n.fadeMat = null;
    }
  }

  /** Advance every fade; a finished fade-out hands its node to `faded` (dropCovered). */
  step(faded: (n: ChunkNode) => void) {
    for (const n of [...this.fading]) {
      const f = Math.min(1, (this.clock - n.fadeStart) / LOD_FADE_S);
      if (f < 1) {
        n.fadeMat!.fade.x = f;
        continue;
      }
      if (n.fade < 0) faded(n);
      else this.end(n);
    }
  }
}
