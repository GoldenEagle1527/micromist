/**
 * The streaming quadtree's node set and its footprint geometry (chunks.ts):
 * where a node lies, how far it is from the viewer, and whether a footprint is
 * already drawn (by an ancestor, itself, or all its descendants with terrain).
 *
 * Bounded world: one predicate, the terrain extent (terrainExtent.ts: the world
 * rectangle grown by the ring wall's thickness, plus the open cracks' reach),
 * decides which footprints hold terrain. Footprints wholly outside it are never
 * requested, and a quadrant outside it counts as covered, so a column straddling
 * the extent's edge (built whole) refines and merges exactly like any other. The
 * endless field has no extent and is unaffected.
 */
import type * as THREE from "three";
import { INFO_GRID } from "./config";
import type { DensityField } from "./density";
import { hasTerrain, type TerrainExtent } from "./terrainExtent";
import { drawn, meshKey, type ChunkNode, type NodeKind } from "./chunkNode";

export class ChunkTree {
  readonly nodes = new Map<string, ChunkNode>();
  readonly field: DensityField;
  readonly levels: number;
  /** Bounded world: where there is terrain to stream (terrainExtent.ts); null = endless. */
  readonly extent: TerrainExtent | null;

  constructor(field: DensityField, levels: number, extent: TerrainExtent | null) {
    this.field = field;
    this.levels = levels;
    this.extent = extent;
  }

  /** Width of a node's footprint (units). */
  size(n: { kind: NodeKind; lod: number }): number {
    const b = this.field.settings.boundsSize;
    return n.kind === "info" ? INFO_GRID.boundsSize * this.field.settings.worldScale : b * (1 << n.lod);
  }

  /** Footprint of a node: [x0, z0] (min corner). */
  origin(kind: NodeKind, lod: number, cx: number, cz: number): [number, number] {
    const b = this.field.settings.boundsSize;
    const bi = INFO_GRID.boundsSize * this.field.settings.worldScale;
    const size = kind === "info" ? bi : b * (1 << lod);
    // lattice origin −b/2 (base columns: −b/2 in base units = −b·S/2 in world)
    const o = kind === "info" ? -bi / 2 : -b / 2;
    return [o + cx * size, o + cz * size];
  }

  /** Squared XZ distance from the viewer to a footprint. */
  sqrDstRect(p: THREE.Vector3, x0: number, z0: number, size: number): number {
    const ox = Math.max(x0 - p.x, 0, p.x - (x0 + size));
    const oz = Math.max(z0 - p.z, 0, p.z - (z0 + size));
    return ox * ox + oz * oz;
  }

  sqrDst(p: THREE.Vector3, n: ChunkNode): number {
    const [x0, z0] = this.origin(n.kind, n.lod, n.cx, n.cz);
    return this.sqrDstRect(p, x0, z0, this.size(n));
  }

  /** Mesh footprint (lod, cx, cz) holds terrain (terrainExtent.ts; always in the endless world). */
  hasTerrainAt(lod: number, cx: number, cz: number): boolean {
    const [x0, z0] = this.origin("mesh", lod, cx, cz);
    return hasTerrain(this.extent, x0, z0, this.field.settings.boundsSize * (1 << lod));
  }

  /**
   * Every child of mesh node (lod, cx, cz) that holds terrain lies within
   * viewDistance (a node splits only then). A child beyond it is never built, so
   * after a split its quadrant would stay undrawn, the node would never count as
   * drawn finer, and it would be wanted back as soon as its children are drawn — a
   * merge / split loop. Only a top-level column on the phone preset can hit it: it
   * splits within lodNear·4 = 128 m, its far children start up to 128 m further
   * out, beyond the 230 m view (desktop: 420 m, never). Such a column stays whole.
   */
  childrenInView(viewer: THREE.Vector3, lod: number, cx: number, cz: number): boolean {
    const s = this.field.settings;
    const size = s.boundsSize * (1 << (lod - 1));
    for (let dz = 0; dz <= 1; dz++) for (let dx = 0; dx <= 1; dx++) {
      const [x0, z0] = this.origin("mesh", lod - 1, cx * 2 + dx, cz * 2 + dz);
      if (hasTerrain(this.extent, x0, z0, size) && this.sqrDstRect(viewer, x0, z0, size) > s.viewDistance * s.viewDistance) return false;
    }
    return true;
  }

  /**
   * The footprint of mesh node (lod, cx, cz) is fully drawn by its descendants;
   * quadrants without terrain need nothing drawn.
   */
  coveredBelow(lod: number, cx: number, cz: number): boolean {
    if (lod === 0) return false;
    for (let dz = 0; dz <= 1; dz++) for (let dx = 0; dx <= 1; dx++) {
      const c = lod - 1, x = cx * 2 + dx, z = cz * 2 + dz;
      if (!this.hasTerrainAt(c, x, z)) continue;
      if (!drawn(this.nodes.get(meshKey(c, x, z))) && !this.coveredBelow(c, x, z)) return false;
    }
    return true;
  }

  /**
   * Some drawn mesh node (ancestor, itself, or its full set of descendants with
   * terrain) covers the footprint, or it holds no terrain.
   */
  coveredAt(lod: number, cx: number, cz: number): boolean {
    if (!this.hasTerrainAt(lod, cx, cz)) return true;
    for (let l = lod; l < this.levels; l++) {
      const d = l - lod;
      if (drawn(this.nodes.get(meshKey(l, cx >> d, cz >> d)))) return true;
    }
    return this.coveredBelow(lod, cx, cz);
  }

  /**
   * True when level-0 lattice point (gi, gj, gk) was removed as floating rock by its
   * (built) column (gjMin: the level-0 rows' lowest row).
   */
  isRemovedPoint(gi: number, gj: number, gk: number, gjMin: number): boolean {
    const n = this.field.settings.numPointsPerAxis;
    const cx = Math.floor(gi / (n - 1)), cz = Math.floor(gk / (n - 1));
    const set = this.nodes.get(meshKey(0, cx, cz))?.removed;
    if (!set || set.size === 0) return false;
    const j = gj - gjMin;
    return set.has((j * (n - 1) + (gk - cz * (n - 1))) * (n - 1) + (gi - cx * (n - 1)));
  }
}
