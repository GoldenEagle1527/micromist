/**
 * Mesher results → GPU-ready data (chunks.ts): the column geometry with its
 * attributes and tight bounds, the level-0 removed-point set, and the main-thread
 * fallback that generates a job in place when no worker is alive.
 */
import * as THREE from "three";
import { baseTerrain } from "./config";
import { createDensityField, type DensityField } from "./density";
import { columnRows, generateColumnMesh, type ColumnRows } from "./mesher";
import type { MesherResponse } from "./protocol";
import { REGION_STRIDE } from "./regionWeights";
import type { ChunkNode } from "./chunkNode";

/** Removed lattice points of a level-0 column, keyed (j*(n-1) + k)*(n-1) + i. */
export function removedSet(r: MesherResponse, n: number): Set<number> {
  const removed = new Set<number>();
  for (let q = 0; q < r.removed.length; q += 3) {
    removed.add((r.removed[q + 1] * (n - 1) + r.removed[q + 2]) * (n - 1) + r.removed[q]);
  }
  return removed;
}

/** The column's geometry (wall: the field has a ring wall → aChaos attribute). */
export function columnGeometry(r: MesherResponse, lod: number, wall: boolean): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(r.positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(r.normals, 3));
  geo.setAttribute("ao", new THREE.BufferAttribute(r.ao, 1));
  // macro-region weights (regionWeights.ts): 8 normalised bytes → aRegA (4) + aRegB (2 + ring wall)
  const reg = new THREE.InterleavedBuffer(r.region, REGION_STRIDE);
  geo.setAttribute("aRegA", new THREE.InterleavedBufferAttribute(reg, 4, 0, true));
  geo.setAttribute("aRegB", new THREE.InterleavedBufferAttribute(reg, 3, 4, true));
  // ring wall (conserve): the chaos byte → aChaos (crack glow, read by the chaos program only)
  if (wall) geo.setAttribute("aChaos", new THREE.InterleavedBufferAttribute(reg, 1, 7, true));
  geo.setIndex(new THREE.BufferAttribute(r.indices, 1));
  // the sonar scan (scene/sonarScan) reads the surface vertices (skirts excluded) straight from here
  geo.userData.surfaceVerts = r.surfaceVerts;
  geo.userData.lod = lod;
  // Tight bounds from the actual vertices (worker-computed): full-height column boxes
  // (~240 m tall) let about half of the drawn triangles through the frustum test off-screen.
  const bb = r.bounds;
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(bb[0], bb[1], bb[2]), new THREE.Vector3(bb[3], bb[4], bb[5]));
  geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
  return geo;
}

/**
 * Main-thread job runner (workers failed). Terrain classification (info nodes) is
 * generated on the base-scale field (world / worldScale, see config.baseTerrain).
 */
export class LocalMesher {
  private readonly field: DensityField;
  private readonly rows: ColumnRows;
  private base: DensityField | null = null;

  constructor(field: DensityField, rows: ColumnRows) {
    this.field = field;
    this.rows = rows;
  }

  generate(e: ChunkNode): MesherResponse {
    const t1 = performance.now();
    let m: ReturnType<typeof generateColumnMesh>;
    if (e.kind === "info") {
      const s = this.field.settings;
      if (!this.base) this.base = createDensityField(this.field.seed, baseTerrain(s), undefined, this.field.regions.layout);
      const full = generateColumnMesh(this.base, e.cx, e.cz, columnRows(this.base), this.base.settings.floaterMargin, undefined, true);
      m = { ...full, positions: new Float32Array(0), normals: new Float32Array(0), ao: new Float32Array(0), region: new Uint8Array(0), indices: new Uint16Array(0), removed: new Int32Array(0) };
    } else {
      const rows = e.lod === 0 ? this.rows : columnRows(this.field, e.lod);
      m = generateColumnMesh(this.field, e.cx, e.cz, rows, this.field.settings.floaterMargin * (1 << e.lod), undefined, false, undefined, e.lod);
    }
    return { type: e.kind === "info" ? "info" : "column", id: e.id, ...m, ms: performance.now() - t1 };
  }
}
