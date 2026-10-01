/**
 * Endless terrain around the viewer — full-height columns (hard floor → hard
 * ceiling) in a distance-LOD quadtree. Level L columns are boundsSize·2^L wide
 * with the same lattice point count (mesher.ts lodSpacing), so a level-L column
 * covers exactly the 2^L × 2^L level-0 columns below it; coarse columns carry
 * skirts that hide the small cracks along a level change. The parts:
 * - chunkPlan.ts: the wanted leaves (split within lodNear·2^(L−1), look-ahead) and build order;
 * - chunkTree.ts: the node set, footprint geometry and coverage;
 * - chunkJobs.ts / chunkUpload.ts / chunkColumns.ts: building, uploading, recycling;
 * - chunkRetire.ts + chunkFade.ts: swaps without holes or pops (crossfades);
 * - chunkStats.ts: counters and the loading gates.
 *
 * Level-0 columns report which lattice points they removed as floating rock;
 * `isRemovedPoint()` lets collision ignore exactly what the renderer dropped.
 */
import * as THREE from "three";
import { INFO_GRID } from "./config";
import type { DensityField } from "./density";
import { columnRows, lodCoord, type ColumnRows } from "./mesher";
import { mesherWorkerCount, WorkerPool, type JobPool } from "./jobPool";
import type { LodFadeMaterial } from "../scene/seabedMaterial";
import { TerrainInfoStore } from "./terrainInfo";
import { MACRO } from "./regions";
import { layoutRect, type WorldRect } from "./siteLayout";
import { terrainExtent } from "./terrainExtent";
import { drawn, meshKey, newNode, type ChunkNode, type ChunkStats } from "./chunkNode";
import { ChunkTree } from "./chunkTree";
import { CameraView, ViewerMotion, prioritize, wantedSet } from "./chunkPlan";
import { LodFader } from "./chunkFade";
import { retire } from "./chunkRetire";
import { LocalMesher } from "./chunkUpload";
import { ChunkJobs } from "./chunkJobs";
import { ChunkColumns } from "./chunkColumns";
import { coverageHoles, loadProgress, nearReady } from "./chunkStats";

export { PREFETCH_U, type ChunkStats } from "./chunkNode";

export class ChunkManager {
  private readonly tree: ChunkTree;
  private readonly nodes: Map<string, ChunkNode>;
  private readonly jobs: ChunkJobs;
  private readonly columns: ChunkColumns;
  private readonly fader: LodFader;
  private readonly motion = new ViewerMotion();
  private readonly view = new CameraView();
  private readonly scene: THREE.Scene;
  private readonly field: DensityField;
  private readonly material: THREE.Material;
  private readonly rows: ColumnRows;
  private readonly yMin: number;
  private readonly yMax: number;
  private lastViewerKey = "";
  private resortTimer = 0;
  private disposed = false;
  /**
   * Generation-time terrain classification near the viewer (base-scale columns,
   * world / worldScale, within infoRadius; getEnvAt / getSpawnCandidates in world units).
   */
  readonly terrain: TerrainInfoStore;
  /** Bounded world: the layout's cell rectangle (the diver's edge, coverage); null = endless. */
  readonly worldRect: WorldRect | null;
  /** Loading screen up: swaps are instant (no crossfade); world.ts clears it once coverageComplete(). */
  loading = true;

  /**
   * lowSpec: at most 2 mesher workers (leaves the main thread / GPU driver room on phones).
   * pool: job runner override (tests); default a WorkerPool.
   */
  constructor(scene: THREE.Scene, field: DensityField, seed: number, material: THREE.Material, lowSpec = false, fadeMaterial?: () => LodFadeMaterial, pool?: JobPool) {
    this.scene = scene;
    this.fader = new LodFader(material, fadeMaterial ?? null);
    this.field = field;
    this.material = material;
    this.rows = columnRows(field);
    const s = field.settings;
    const layout = field.regions.layout;
    this.worldRect = layout ? layoutRect(layout, MACRO.cell * s.worldScale) : null;
    this.tree = new ChunkTree(field, Math.max(1, s.lodLevels), terrainExtent(field));
    this.nodes = this.tree.nodes;
    this.terrain = new TerrainInfoStore({ seed, boundsSize: INFO_GRID.boundsSize, numPointsPerAxis: INFO_GRID.numPointsPerAxis, scale: s.worldScale, layout });
    this.yMin = lodCoord(this.rows.gjMin, field, 0);
    this.yMax = lodCoord(this.rows.gjMax, field, 0);
    this.jobs = new ChunkJobs(pool ?? new WorkerPool(seed, s, mesherWorkerCount(lowSpec), layout), new LocalMesher(field, this.rows));
    this.columns = new ChunkColumns(this.tree, this.jobs, field, material, this.fader, this.terrain, () => this.loading);
    scene.add(this.columns.group);
  }

  /** The columns' resting material (the tide's front swaps some to its variant and back). */
  get baseMaterial(): THREE.Material {
    return this.material;
  }

  /** The group holding every column mesh (occlusion culling walks it). */
  get meshGroup(): THREE.Object3D {
    return this.columns.group;
  }

  /** True unless the mesh is mid LOD-crossfade (drawn with a fade variant). */
  isStable(mesh: THREE.Mesh): boolean {
    return mesh.material === this.material;
  }

  update(viewer: THREE.Vector3, camera: THREE.Camera, dt: number) {
    if (this.disposed) return;
    const b = this.field.settings.boundsSize;
    this.view.update(camera);

    this.fader.tick(dt);
    this.motion.update(viewer, dt);
    const ahead = this.motion.ahead;
    const viewerKey = `${Math.round(viewer.x / b)},${Math.round(viewer.z / b)},${Math.round(ahead.x / b)},${Math.round(ahead.z / b)}`;
    this.resortTimer -= dt;
    if (viewerKey !== this.lastViewerKey || this.resortTimer <= 0) {
      this.lastViewerKey = viewerKey;
      this.resortTimer = 0.2;
      this.refreshSet(viewer);
    }
    this.jobs.dispatch(this.nodes);
    this.jobs.pool.drain(this.jobs.results);
    this.columns.applyResults();
    this.columns.stepFades();
  }

  private refreshSet(viewer: THREE.Vector3) {
    const want = wantedSet(this.tree, viewer, this.motion.ahead);
    for (const n of this.nodes.values()) {
      n.wanted = want.has(n.key);
      // wanted again while dissolving away: hide it and let retire() fade it back
      // in against whatever had started replacing it
      if (n.wanted && n.fade < 0) {
        this.fader.end(n);
        if (n.mesh) {
          n.mesh.visible = false;
          n.awaitFade = true;
        }
      }
    }
    const jobs = this.jobs;
    for (const [key, w] of want) {
      if (this.nodes.has(key)) continue;
      const node = newNode(key, w);
      this.nodes.set(key, node);
      jobs.queue.push(node);
    }
    retire(this.columns.swap);

    // stale (unwanted / recycled) jobs drop out of the queue here
    jobs.queue = jobs.queue.filter((e) => e.state === "queued" && this.nodes.get(e.key) === e);
    prioritize(this.tree, jobs.queue, viewer, this.motion, this.view, this.yMin, this.yMax);
    jobs.queue.sort((a, b) => b.priority - a.priority);
  }

  stats(): ChunkStats {
    return this.columns.counters.stats(this.nodes, this.tree.levels, this.jobs.queue.length, this.jobs.pool.live());
  }

  /** Level-0 lattice point removed as floating rock by its column: collision (latticeSampler) treats it as water. */
  isRemovedPoint(gi: number, gj: number, gk: number): boolean {
    return this.tree.isRemovedPoint(gi, gj, gk, this.rows.gjMin);
  }

  /** True once every wanted level-0 column within radius is drawn (and the classification columns built). */
  nearReady(viewer: THREE.Vector3, radius: number): boolean {
    return nearReady(this.tree, viewer, radius);
  }

  /** View points (XZ, `step` grid) no drawn column covers (0 = full coverage; chunkStats.ts). */
  coverageHoles(viewer: THREE.Vector3, step = 8): number {
    return coverageHoles(this.tree, this.worldRect, viewer, step);
  }

  /** Mesh column (lod, cx, cz) is on screen. */
  drawnAt(lod: number, cx: number, cz: number): boolean {
    return drawn(this.nodes.get(meshKey(lod, cx, cz)));
  }

  /** Loading-screen progress toward the gate (chunkStats.ts loadProgress). */
  loadProgress(viewer: THREE.Vector3, radius: number): { done: number; total: number } {
    return loadProgress(this.tree, this.worldRect, viewer, radius);
  }

  /** Every footprint inside the view is drawn (the loading gate). */
  coverageComplete(viewer: THREE.Vector3): boolean {
    return this.coverageHoles(viewer, 16) === 0;
  }

  /** Queued (not yet dispatched) jobs. */
  get queueLength(): number {
    return this.jobs.queue.length;
  }

  dispose() {
    this.disposed = true;
    this.jobs.pool.dispose();
    this.columns.dispose();
    this.scene.remove(this.columns.group);
  }
}
