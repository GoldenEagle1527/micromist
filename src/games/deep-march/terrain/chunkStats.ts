/**
 * Streaming statistics and the loading-screen gates (chunks.ts): per-level
 * triangle / timing counters, and whether the footprints around the viewer are
 * drawn (nearReady, coverageHoles, loadProgress).
 */
import type * as THREE from "three";
import { insideRect, type WorldRect } from "./siteLayout";
import type { ChunkTree } from "./chunkTree";
import { drawn, meshKey, type ChunkNode, type ChunkStats } from "./chunkNode";

export class ChunkCounters {
  readonly lodTris: number[];
  readonly lodMsTotal: number[];
  readonly lodMsCount: number[];
  infoMsTotal = 0;
  infoMsCount = 0;
  floaters = 0;

  constructor(levels: number) {
    this.lodTris = new Array(levels).fill(0);
    this.lodMsTotal = new Array(levels).fill(0);
    this.lodMsCount = new Array(levels).fill(0);
  }

  stats(nodes: Map<string, ChunkNode>, levels: number, queued: number, workers: number): ChunkStats {
    let meshes = 0;
    let pending = 0;
    let active = 0;
    const lodMeshes = new Array(levels).fill(0);
    for (const e of nodes.values()) {
      if (e.kind !== "mesh") continue;
      active++;
      if (e.mesh) {
        meshes++;
        lodMeshes[e.lod]++;
      }
      if (e.state === "pending") pending++;
    }
    for (const e of nodes.values()) if (e.kind === "info" && e.state === "pending") pending++;
    return {
      active,
      meshes,
      queued,
      pending,
      triangles: this.lodTris.reduce((a, b) => a + b, 0),
      workers,
      avgMs: this.lodMsCount[0] ? this.lodMsTotal[0] / this.lodMsCount[0] : 0,
      avgInfoMs: this.infoMsCount ? this.infoMsTotal / this.infoMsCount : 0,
      floaters: this.floaters,
      lodMeshes,
      lodTriangles: [...this.lodTris],
      lodMs: this.lodMsTotal.map((t, i) => (this.lodMsCount[i] ? t / this.lodMsCount[i] : 0)),
    };
  }
}

/** True once every wanted level-0 column within radius is drawn (and the classification columns built). */
export function nearReady(tree: ChunkTree, viewer: THREE.Vector3, radius: number): boolean {
  const r2 = radius * radius;
  let any = false;
  for (const e of tree.nodes.values()) {
    if (!e.wanted) continue;
    if (e.kind === "mesh" && e.lod > 0) continue;
    if (tree.sqrDst(viewer, e) > r2) continue;
    any = true;
    if (e.kind === "info" ? e.state !== "ready" : !drawn(e)) return false;
  }
  return any;
}

/**
 * Points on a `step` grid within viewDistance (XZ) of the viewer whose footprint
 * no drawn column covers (0 = full coverage). Points outside a bounded world
 * never count.
 */
export function coverageHoles(tree: ChunkTree, worldRect: WorldRect | null, viewer: THREE.Vector3, step: number): number {
  const s = tree.field.settings;
  const b = s.boundsSize;
  const r = s.viewDistance;
  const top = tree.levels - 1;
  let holes = 0;
  for (let z = Math.ceil((viewer.z - r) / step) * step; z <= viewer.z + r; z += step) {
    for (let x = Math.ceil((viewer.x - r) / step) * step; x <= viewer.x + r; x += step) {
      const dx = x - viewer.x, dz = z - viewer.z;
      if (dx * dx + dz * dz > r * r) continue;
      if (worldRect && !insideRect(worldRect, x, z)) continue;
      const gx = Math.floor((x + b / 2) / b), gz = Math.floor((z + b / 2) / b);
      let ok = false;
      for (let l = top; l >= 0 && !ok; l--) ok = drawn(tree.nodes.get(meshKey(l, gx >> l, gz >> l)));
      if (!ok) holes++;
    }
  }
  return holes;
}

/**
 * Loading-screen progress toward the gate (nearReady + coverageComplete): ready
 * level-0 / classification columns within `radius` plus covered view points, of
 * their totals (totals grow while the column set is still being planned).
 */
export function loadProgress(tree: ChunkTree, worldRect: WorldRect | null, viewer: THREE.Vector3, radius: number): { done: number; total: number } {
  const r2 = radius * radius;
  let done = 0, total = 0;
  for (const e of tree.nodes.values()) {
    if (!e.wanted) continue;
    if (e.kind === "mesh" && e.lod > 0) continue;
    if (tree.sqrDst(viewer, e) > r2) continue;
    total++;
    if (e.kind === "info" ? e.state === "ready" : drawn(e)) done++;
  }
  const s = tree.field.settings;
  const step = 16, r = s.viewDistance;
  let points = 0;
  for (let z = Math.ceil((viewer.z - r) / step) * step; z <= viewer.z + r; z += step) {
    for (let x = Math.ceil((viewer.x - r) / step) * step; x <= viewer.x + r; x += step) {
      const dx = x - viewer.x, dz = z - viewer.z;
      if (dx * dx + dz * dz <= r * r && (!worldRect || insideRect(worldRect, x, z))) points++;
    }
  }
  const holes = coverageHoles(tree, worldRect, viewer, step);
  return { done: done + points - holes, total: total + points };
}
