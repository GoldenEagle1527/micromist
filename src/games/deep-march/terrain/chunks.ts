/**
 * Endless terrain around the viewer — full-height columns (hard floor → hard
 * ceiling) in a distance-LOD quadtree:
 * - level L columns are boundsSize·2^L wide with the same lattice point count
 *   (spacing × 2^L, mesher.ts lodSpacing); a level-L column covers exactly the
 *   2^L × 2^L level-0 columns below it;
 * - the rendered set is the leaves of a quadtree over top-level nodes within
 *   viewDistance: a node splits while its footprint is within lodNear·2^(L−1)
 *   of the viewer (neighbouring leaves are usually one level apart); coarse
 *   columns carry skirts that hide the small cracks along a level change;
 * - a node that leaves the set stays drawn until the nodes replacing it are ready
 *   (no holes while refining / coarsening); the swap is then a short screen-door
 *   crossfade (LOD_FADE_S, seabedMaterial fadeMaterial) instead of a one-frame pop:
 *   replacement meshes stay hidden until the whole footprint is ready, then they
 *   dither in while the old ones dither out on the complementary pixels;
 * - streaming (coverage first): top-level columns are built before anything
 *   else and stay resident (hidden, not freed) while their children are drawn, so
 *   coarsening back is instant; a node splits only once it is drawn and settled
 *   (or its footprint is already drawn finer), so refinement only happens where
 *   terrain is on screen and every swap is one column ↔ its 4 children. Top-level
 *   columns are prefetched PREFETCH_U beyond viewDistance so nothing inside the view
 *   is ever uncovered while swimming;
 * - build order: uncovered footprints first, then refinements, near first,
 *   weighted towards the camera / swim direction; stale queued jobs are dropped
 *   and stale results discarded (jobPool.ts on in-flight jobs);
 * - the split distance and the build order use the viewer's position predicted
 *   LOOKAHEAD_S ahead along its smoothed velocity (min of both distances), so at
 *   swimming speed the fine rings are built ahead of the diver, in-view first;
 * - meshes are built by a JobPool (Web Workers, jobPool.ts) and uploaded under a
 *   per-frame budget; main-thread fallback if workers fail.
 *
 * Level-0 columns report which lattice points they removed as floating rock;
 * `isRemovedPoint()` lets collision ignore exactly what the renderer dropped (the diver
 * is always inside the level-0 area).
 *
 * Terrain classification (TerrainInfoStore `terrain`: getEnvAt / getSpawnCandidates)
 * is generated separately for the base-scale columns (world / worldScale, see
 * config.baseTerrain) within infoRadius of the viewer.
 */
import * as THREE from "three";
import { INFO_GRID, baseTerrain } from "./config";
import { createDensityField, type DensityField } from "./density";
import { columnRows, generateColumnMesh, lodCoord, type ColumnRows } from "./mesher";
import type { MesherResponse } from "./protocol";
import { WorkerPool, type JobPool, type JobRequest } from "./jobPool";
import type { LodFadeMaterial } from "../scene/seabedMaterial";
import { TerrainInfoStore } from "./terrainInfo";
import { REGION_STRIDE } from "./regionWeights";

type NodeState = "queued" | "pending" | "ready";

type Node = {
  key: string;
  /** "mesh": LOD column of the world field; "info": base-scale classification column. */
  kind: "mesh" | "info";
  lod: number;
  cx: number;
  cz: number;
  state: NodeState;
  id: number;
  mesh: THREE.Mesh | null;
  priority: number;
  /** Level 0 only: removed lattice points owned by this column, keyed (j*(n-1) + k)*(n-1) + i. */
  removed: Set<number> | null;
  /** Still part of the wanted set (else drawn only until its replacement is ready). */
  wanted: boolean;
  /** Mesh ready but hidden until the meshes it replaces can crossfade with it. */
  awaitFade: boolean;
  /** Crossfade in progress: +1 fading in, −1 fading out, 0 none. */
  fade: number;
  fadeStart: number;
  fadeMat: LodFadeMaterial | null;
  /** Top level only: built, hidden while finer columns cover it, kept for instant coarsening. */
  resident: boolean;
};

export type ChunkStats = {
  active: number;
  meshes: number;
  queued: number;
  pending: number;
  triangles: number;
  workers: number;
  /** Mean generation time of level-0 columns (ms). */
  avgMs: number;
  /** Mean base-scale classification job time (ms). */
  avgInfoMs: number;
  floaters: number;
  /** Drawn columns / triangles per LOD level. */
  lodMeshes: number[];
  lodTriangles: number[];
  /** Mean generation ms per LOD level. */
  lodMs: number[];
};

const UPLOAD_BUDGET_MS = 4;
const MAIN_THREAD_BUDGET_MS = 8;
/**
 * LOD crossfade duration (s): long enough to read as a dissolve rather than a pop,
 * short enough not to hold up the next refinement step (a column splits only once
 * it has settled, see wantedSet).
 */
const LOD_FADE_S = 0.5;
/** How far ahead (s of travel) the LOD split / build order looks. */
const LOOKAHEAD_S = 2.5;
/**
 * Top-level columns are wanted this far beyond viewDistance (units): at 9.8 u/s a
 * phone builds a top column (~0.1 s × 3–5) long before the view edge reaches it.
 */
export const PREFETCH_U = 48;
/** A split area merges back only this factor beyond the split distance (no split/merge churn). */
const SPLIT_HYST = 1.3;
/** Priority band of footprints nothing drawn covers (built before any refinement). */
const UNCOVERED_BAND = -1e6;

const meshKey = (lod: number, cx: number, cz: number) => `${lod}:${cx}:${cz}`;
const infoKey = (cx: number, cz: number) => `i:${cx}:${cz}`;

export class ChunkManager {
  private readonly nodes = new Map<string, Node>();
  private readonly byId = new Map<number, Node>();
  private readonly results: MesherResponse[] = [];
  private readonly meshPool: THREE.Mesh[] = [];
  private readonly pool: JobPool;
  private readonly group = new THREE.Group();
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private readonly box = new THREE.Box3();
  private readonly scene: THREE.Scene;
  private readonly field: DensityField;
  private base: DensityField | null = null;
  private readonly material: THREE.Material;
  private readonly rows: ColumnRows;
  private readonly yMin: number;
  private readonly yMax: number;
  private readonly levels: number;
  private queue: Node[] = [];
  private nextId = 1;
  private lastViewerKey = "";
  private resortTimer = 0;
  private readonly lodTris: number[];
  private readonly lodMsTotal: number[];
  private readonly lodMsCount: number[];
  private infoMsTotal = 0;
  private infoMsCount = 0;
  private readonly fadeFactory: (() => LodFadeMaterial) | null;
  private readonly fadePool: LodFadeMaterial[] = [];
  private readonly fading = new Set<Node>();
  private clock = 0;
  private readonly lastViewer = new THREE.Vector3();
  private hasLast = false;
  /** Smoothed viewer velocity (units/s) and the look-ahead point it gives. */
  private readonly vel = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();
  private readonly camFwd = new THREE.Vector3(0, 0, -1);
  /** Generation-time terrain classification near the viewer (base-scale columns, world-unit queries). */
  readonly terrain: TerrainInfoStore;
  private floaters = 0;
  private disposed = false;
  /**
   * Loading screen up: swaps are instant (no crossfade) so the start area refines
   * quickly; world.ts clears it once coverageComplete() and the dive starts.
   */
  loading = true;

  /**
   * lowSpec: at most 2 mesher workers (leaves the main thread / GPU driver room on phones).
   * pool: job runner override (tests); default a WorkerPool.
   */
  constructor(scene: THREE.Scene, field: DensityField, seed: number, material: THREE.Material, lowSpec = false, fadeMaterial?: () => LodFadeMaterial, pool?: JobPool) {
    this.scene = scene;
    this.fadeFactory = fadeMaterial ?? null;
    this.field = field;
    this.material = material;
    this.rows = columnRows(field);
    const s = field.settings;
    this.levels = Math.max(1, s.lodLevels);
    this.lodTris = new Array(this.levels).fill(0);
    this.lodMsTotal = new Array(this.levels).fill(0);
    this.lodMsCount = new Array(this.levels).fill(0);
    this.terrain = new TerrainInfoStore({ seed, boundsSize: INFO_GRID.boundsSize, numPointsPerAxis: INFO_GRID.numPointsPerAxis, scale: s.worldScale });
    this.yMin = lodCoord(this.rows.gjMin, field, 0);
    this.yMax = lodCoord(this.rows.gjMax, field, 0);
    scene.add(this.group);
    if (pool) this.pool = pool;
    else {
      const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
      // Desktop: min(4, cores − 2) keeps two cores for the main thread + GPU driver
      // (6 workers made the main thread stutter while streaming); low-spec: 2.
      const count = lowSpec ? Math.max(1, Math.min(2, cores - 1)) : Math.max(1, Math.min(4, cores - 2));
      this.pool = new WorkerPool(seed, s, typeof Worker === "undefined" ? 0 : count);
    }
    this.pool.onLost = (ids) => {
      for (const id of ids) {
        const node = this.byId.get(id);
        if (!node || node.state !== "pending") continue;
        this.byId.delete(id);
        node.state = "queued";
        this.queue.push(node);
      }
    };
  }

  /** The group holding every column mesh (occlusion culling walks it). */
  get meshGroup(): THREE.Object3D {
    return this.group;
  }

  /** True unless the mesh is mid LOD-crossfade (drawn with a fade variant). */
  isStable(mesh: THREE.Mesh): boolean {
    return mesh.material === this.material;
  }

  /** Width of a node's footprint (units). */
  private size(n: { kind: "mesh" | "info"; lod: number }): number {
    const b = this.field.settings.boundsSize;
    return n.kind === "info" ? INFO_GRID.boundsSize * this.field.settings.worldScale : b * (1 << n.lod);
  }

  /** Footprint of a node: [x0, z0] (min corner). */
  private origin(kind: "mesh" | "info", lod: number, cx: number, cz: number): [number, number] {
    const b = this.field.settings.boundsSize;
    const bi = INFO_GRID.boundsSize * this.field.settings.worldScale;
    const size = kind === "info" ? bi : b * (1 << lod);
    // lattice origin −b/2 (base columns: −b/2 in base units = −b·S/2 in world)
    const o = kind === "info" ? -bi / 2 : -b / 2;
    return [o + cx * size, o + cz * size];
  }

  /** Squared XZ distance from the viewer to a footprint. */
  private sqrDstRect(p: THREE.Vector3, x0: number, z0: number, size: number): number {
    const ox = Math.max(x0 - p.x, 0, p.x - (x0 + size));
    const oz = Math.max(z0 - p.z, 0, p.z - (z0 + size));
    return ox * ox + oz * oz;
  }

  private sqrDst(p: THREE.Vector3, n: Node): number {
    const [x0, z0] = this.origin(n.kind, n.lod, n.cx, n.cz);
    return this.sqrDstRect(p, x0, z0, this.size(n));
  }

  private setNodeBox(n: Node) {
    const [x0, z0] = this.origin(n.kind, n.lod, n.cx, n.cz);
    const size = this.size(n);
    this.box.min.set(x0, this.yMin, z0);
    this.box.max.set(x0 + size, this.yMax, z0 + size);
  }

  update(viewer: THREE.Vector3, camera: THREE.Camera, dt: number) {
    if (this.disposed) return;
    const b = this.field.settings.boundsSize;
    camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    camera.getWorldDirection(this.camFwd);

    this.clock += dt;
    // smoothed horizontal velocity → look-ahead point (teleports / respawns ignored)
    if (this.hasLast && dt > 0) {
      const vx = (viewer.x - this.lastViewer.x) / dt, vz = (viewer.z - this.lastViewer.z) / dt;
      const k = 1 - Math.exp(-dt / 0.35);
      if (Math.hypot(vx, vz) < 200) {
        this.vel.x += (vx - this.vel.x) * k;
        this.vel.z += (vz - this.vel.z) * k;
      }
    }
    this.lastViewer.copy(viewer);
    this.hasLast = true;
    this.ahead.set(viewer.x + this.vel.x * LOOKAHEAD_S, viewer.y, viewer.z + this.vel.z * LOOKAHEAD_S);

    const viewerKey = `${Math.round(viewer.x / b)},${Math.round(viewer.z / b)},${Math.round(this.ahead.x / b)},${Math.round(this.ahead.z / b)}`;
    this.resortTimer -= dt;
    if (viewerKey !== this.lastViewerKey || this.resortTimer <= 0) {
      this.lastViewerKey = viewerKey;
      this.resortTimer = 0.2;
      this.refreshSet(viewer);
    }
    this.dispatch();
    this.pool.drain(this.results);
    this.applyResults();
    this.stepFades();
  }

  /** Distance used for LOD splits and build order: to the viewer or to where it will be shortly. */
  private sqrDstAhead(viewer: THREE.Vector3, x0: number, z0: number, size: number): number {
    return Math.min(this.sqrDstRect(viewer, x0, z0, size), this.sqrDstRect(this.ahead, x0, z0, size));
  }

  /** Leaves of the LOD quadtree around the viewer + base info columns in range. */
  private wantedSet(viewer: THREE.Vector3): Map<string, { kind: "mesh" | "info"; lod: number; cx: number; cz: number }> {
    const s = this.field.settings;
    const out = new Map<string, { kind: "mesh" | "info"; lod: number; cx: number; cz: number }>();
    const top = this.levels - 1;
    const topSize = s.boundsSize * (1 << top);
    const view2 = s.viewDistance * s.viewDistance;
    // Coverage first, progressive refinement: a node splits only when it is drawn
    // and settled, or when its footprint is already drawn finer (keeps an existing
    // fine area). Everything therefore starts from the top level, and every swap
    // replaces a column by its 4 children (or back) in one crossfade — never a
    // hidden fine column waiting behind a big coarse one, never a hole.
    const visit = (lod: number, cx: number, cz: number) => {
      const [x0, z0] = this.origin("mesh", lod, cx, cz);
      const size = s.boundsSize * (1 << lod);
      const d2 = this.sqrDstRect(viewer, x0, z0, size);
      if (d2 > (lod === top ? prefetch2 : view2)) return;
      const key = meshKey(lod, cx, cz);
      // hysteresis: an area already drawn finer merges back only SPLIT_HYST further out
      const finer = lod > 0 && this.coveredBelow(lod, cx, cz);
      const near = lod > 0 && d2 <= view2 && this.sqrDstAhead(viewer, x0, z0, size) < (s.lodNear * (1 << (lod - 1)) * (finer ? SPLIT_HYST : 1)) ** 2;
      if (!near || !(finer || this.settled(this.nodes.get(key)))) {
        out.set(key, { kind: "mesh", lod, cx, cz });
        return;
      }
      for (let dz = 0; dz <= 1; dz++) for (let dx = 0; dx <= 1; dx++) visit(lod - 1, cx * 2 + dx, cz * 2 + dz);
    };
    const h = s.boundsSize / 2;
    const reach = s.viewDistance + PREFETCH_U;
    const prefetch2 = reach * reach;
    const tx0 = Math.floor((viewer.x + h - reach) / topSize), tx1 = Math.floor((viewer.x + h + reach) / topSize);
    const tz0 = Math.floor((viewer.z + h - reach) / topSize), tz1 = Math.floor((viewer.z + h + reach) / topSize);
    for (let cz = tz0; cz <= tz1; cz++) for (let cx = tx0; cx <= tx1; cx++) visit(top, cx, cz);
    // base-scale classification columns
    const bs = INFO_GRID.boundsSize * s.worldScale;
    const r = s.infoRadius;
    const ix0 = Math.floor((viewer.x + bs / 2 - r) / bs), ix1 = Math.floor((viewer.x + bs / 2 + r) / bs);
    const iz0 = Math.floor((viewer.z + bs / 2 - r) / bs), iz1 = Math.floor((viewer.z + bs / 2 + r) / bs);
    for (let cz = iz0; cz <= iz1; cz++) for (let cx = ix0; cx <= ix1; cx++) {
      const [x0, z0] = this.origin("info", 0, cx, cz);
      if (this.sqrDstRect(viewer, x0, z0, bs) <= r * r) out.set(infoKey(cx, cz), { kind: "info", lod: 0, cx, cz });
    }
    return out;
  }

  /** Drawn on its own: built, not waiting to crossfade in, not mid-crossfade. */
  private settled(n: Node | undefined): boolean {
    return !!n && n.state === "ready" && !n.awaitFade && n.fade === 0;
  }

  /** On screen (possibly mid-crossfade), or built empty. */
  private drawn(n: Node | undefined): boolean {
    return !!n && n.state === "ready" && !n.awaitFade && (!n.mesh || n.mesh.visible);
  }

  /** The footprint of mesh node (lod, cx, cz) is fully drawn by its descendants. */
  private coveredBelow(lod: number, cx: number, cz: number): boolean {
    if (lod === 0) return false;
    for (let dz = 0; dz <= 1; dz++) for (let dx = 0; dx <= 1; dx++) {
      const c = lod - 1, x = cx * 2 + dx, z = cz * 2 + dz;
      if (!this.drawn(this.nodes.get(meshKey(c, x, z))) && !this.coveredBelow(c, x, z)) return false;
    }
    return true;
  }

  /** Some drawn mesh node (ancestor, itself, or its full set of descendants) covers the footprint. */
  private coveredAt(lod: number, cx: number, cz: number): boolean {
    for (let l = lod; l < this.levels; l++) {
      const d = l - lod;
      if (this.drawn(this.nodes.get(meshKey(l, cx >> d, cz >> d)))) return true;
    }
    return this.coveredBelow(lod, cx, cz);
  }

  /** Node b's footprint contains node a's (both mesh nodes). */
  private static contains(b: Node, a: Node): boolean {
    if (b.lod <= a.lod) return b.lod === a.lod && b.cx === a.cx && b.cz === a.cz;
    const d = b.lod - a.lod;
    return a.cx >> d === b.cx && a.cz >> d === b.cz;
  }

  private refreshSet(viewer: THREE.Vector3) {
    const want = this.wantedSet(viewer);
    for (const n of this.nodes.values()) {
      n.wanted = want.has(n.key);
      // wanted again while dissolving away: hide it and let retire() fade it back
      // in against whatever had started replacing it
      if (n.wanted && n.fade < 0) {
        this.endFade(n);
        if (n.mesh) {
          n.mesh.visible = false;
          n.awaitFade = true;
        }
      }
    }
    for (const [key, w] of want) {
      if (this.nodes.has(key)) continue;
      const node: Node = {
        key, kind: w.kind, lod: w.lod, cx: w.cx, cz: w.cz, state: "queued", id: 0, mesh: null, priority: 0, removed: null, wanted: true,
        awaitFade: false, fade: 0, fadeStart: 0, fadeMat: null, resident: false,
      };
      this.nodes.set(key, node);
      this.queue.push(node);
    }
    this.retire();

    // stale (unwanted / recycled) jobs drop out of the queue here
    this.queue = this.queue.filter((e) => e.state === "queued" && this.nodes.get(e.key) === e);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const fl = Math.hypot(this.camFwd.x, this.camFwd.z) || 1;
    const fx = this.camFwd.x / fl, fz = this.camFwd.z / fl;
    for (const e of this.queue) {
      const [x0, z0] = this.origin(e.kind, e.lod, e.cx, e.cz);
      const size = this.size(e);
      const d = Math.sqrt(this.sqrDstAhead(viewer, x0, z0, size));
      this.setNodeBox(e);
      const inView = this.frustum.intersectsBox(this.box);
      // view / swim direction: ×1 straight ahead … ×2.2 behind
      const dx = x0 + size / 2 - viewer.x, dz = z0 + size / 2 - viewer.z;
      const dl = Math.hypot(dx, dz);
      let facing = 1;
      if (dl > size * 0.75) {
        facing = (dx * fx + dz * fz) / dl;
        if (speed > 1) facing = Math.max(facing, (dx * this.vel.x + dz * this.vel.z) / (dl * speed));
      }
      // near first; coarse rings early too (cheap, they give the far silhouettes)
      let p = (e.kind === "info" ? d + 6 : d / (1 + 0.3 * e.lod)) * (1.6 - 0.6 * facing);
      if (!inView) p = p * 3 + 60;
      if (e.kind === "mesh" && !this.coveredAt(e.lod, e.cx, e.cz)) p += UNCOVERED_BAND;
      e.priority = p;
    }
    this.queue.sort((a, b) => b.priority - a.priority);
  }

  private static overlaps(a: Node, b: Node): boolean {
    return ChunkManager.contains(a, b) || ChunkManager.contains(b, a);
  }

  /**
   * Drop unwanted nodes once whatever replaces their footprint is ready: crossfade
   * them out against the (hidden until now) replacement meshes.
   */
  private retire() {
    const wantedMesh: Node[] = [];
    for (const n of this.nodes.values()) if (n.wanted && n.kind === "mesh") wantedMesh.push(n);
    for (const n of [...this.nodes.values()]) {
      if (n.wanted) continue;
      if (n.resident) {
        // hidden top-level column: freed only once nothing wanted overlaps it (out of range)
        if (!wantedMesh.some((w) => ChunkManager.overlaps(w, n))) this.recycle(n);
        continue;
      }
      if (n.kind === "info" || n.state !== "ready" || !n.mesh) {
        this.recycle(n);
        continue;
      }
      if (n.fade < 0) continue; // already dissolving
      let covered = true;
      let overlap = false;
      for (const w of wantedMesh) {
        if (!ChunkManager.overlaps(w, n)) continue;
        overlap = true;
        if (w.state !== "ready") {
          covered = false;
          break;
        }
      }
      if (!overlap) this.recycle(n);
      else if (covered) {
        const incoming = wantedMesh.filter((w) => w.awaitFade && ChunkManager.overlaps(w, n));
        if (!this.fadeFactory || !n.mesh.visible || this.loading) {
          this.dropCovered(n);
          for (const w of incoming) this.reveal(w);
          continue;
        }
        this.startFade(n, -1);
        for (const w of incoming) this.startFade(w, 1);
      }
    }
    // replacements whose predecessors went away without a fade: just show them
    for (const w of wantedMesh) {
      if (!w.awaitFade) continue;
      let blocked = false;
      for (const n of this.nodes.values()) {
        if (!n.wanted && n.kind === "mesh" && n.mesh && n.mesh.visible && n.fade >= 0 && ChunkManager.overlaps(n, w)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) this.reveal(w);
    }
  }

  /** A mesh-carrying node that isn't drawn yet because an old mesh still covers its footprint. */
  private hasVisibleOverlap(e: Node): boolean {
    for (const n of this.nodes.values()) {
      if (n !== e && !n.wanted && n.kind === "mesh" && n.mesh && n.mesh.visible && ChunkManager.overlaps(n, e)) return true;
    }
    return false;
  }

  /** An unwanted node whose footprint is drawn by its replacement: freed, or hidden if top-level. */
  private dropCovered(n: Node) {
    if (n.kind === "mesh" && n.lod === this.levels - 1 && n.mesh) {
      if (n.fade !== 0 || n.fadeMat) this.endFade(n);
      n.mesh.visible = false;
      n.awaitFade = true;
      n.resident = true;
    } else this.recycle(n);
  }

  private reveal(w: Node) {
    w.awaitFade = false;
    w.resident = false;
    if (w.mesh) w.mesh.visible = true;
  }

  private startFade(n: Node, dir: number) {
    if (!n.mesh || !this.fadeFactory) return;
    n.awaitFade = false;
    n.resident = false;
    if (!n.fadeMat) n.fadeMat = this.fadePool.pop() ?? this.fadeFactory();
    n.fade = dir;
    n.fadeStart = this.clock;
    n.fadeMat.fade.set(0, dir);
    n.mesh.material = n.fadeMat.material;
    n.mesh.visible = true;
    this.fading.add(n);
  }

  private endFade(n: Node) {
    this.fading.delete(n);
    n.fade = 0;
    if (n.mesh) n.mesh.material = this.material;
    if (n.fadeMat) {
      this.fadePool.push(n.fadeMat);
      n.fadeMat = null;
    }
  }

  private stepFades() {
    for (const n of [...this.fading]) {
      const f = Math.min(1, (this.clock - n.fadeStart) / LOD_FADE_S);
      if (f < 1) {
        n.fadeMat!.fade.x = f;
        continue;
      }
      if (n.fade < 0) this.dropCovered(n);
      else this.endFade(n);
    }
  }

  private recycle(node: Node) {
    if (node.fade !== 0 || node.fadeMat) this.endFade(node);
    node.awaitFade = false;
    node.resident = false;
    this.nodes.delete(node.key);
    if (node.state === "pending") this.byId.delete(node.id);
    node.state = "queued";
    node.removed = null;
    if (node.kind === "info") this.terrain.delete(node.cx, node.cz);
    if (node.mesh) {
      this.lodTris[node.lod] -= (node.mesh.geometry.index?.count ?? 0) / 3;
      node.mesh.geometry.dispose();
      this.group.remove(node.mesh);
      node.mesh.visible = true;
      node.mesh.material = this.material;
      this.meshPool.push(node.mesh);
      node.mesh = null;
    }
  }

  private generateHere(e: Node): MesherResponse {
    const t1 = performance.now();
    let m: ReturnType<typeof generateColumnMesh>;
    if (e.kind === "info") {
      const s = this.field.settings;
      if (!this.base) this.base = createDensityField(this.field.seed, baseTerrain(s));
      const full = generateColumnMesh(this.base, e.cx, e.cz, columnRows(this.base), this.base.settings.floaterMargin, undefined, true);
      m = { ...full, positions: new Float32Array(0), normals: new Float32Array(0), ao: new Float32Array(0), region: new Uint8Array(0), indices: new Uint16Array(0), removed: new Int32Array(0) };
    } else {
      const rows = e.lod === 0 ? this.rows : columnRows(this.field, e.lod);
      m = generateColumnMesh(this.field, e.cx, e.cz, rows, this.field.settings.floaterMargin * (1 << e.lod), undefined, false, undefined, e.lod);
    }
    return { type: e.kind === "info" ? "info" : "column", id: e.id, ...m, ms: performance.now() - t1 };
  }

  private dispatch() {
    if (this.pool.live() === 0) {
      const t0 = performance.now();
      while (this.queue.length && performance.now() - t0 < MAIN_THREAD_BUDGET_MS) {
        const e = this.queue.pop()!;
        if (e.state !== "queued" || this.nodes.get(e.key) !== e) continue;
        e.id = this.nextId++;
        this.byId.set(e.id, e);
        e.state = "pending";
        this.results.push(this.generateHere(e));
      }
      return;
    }
    while (this.pool.free() > 0 && this.queue.length) {
      const e = this.queue.pop()!;
      if (e.state !== "queued" || this.nodes.get(e.key) !== e) continue;
      e.id = this.nextId++;
      e.state = "pending";
      this.byId.set(e.id, e);
      const req: JobRequest = e.kind === "info" ? { type: "info", id: e.id, cx: e.cx, cz: e.cz } : { type: "column", id: e.id, cx: e.cx, cz: e.cz, lod: e.lod };
      this.pool.submit(req);
    }
  }

  private applyResults() {
    const t0 = performance.now();
    const n = this.field.settings.numPointsPerAxis;
    let changed = false;
    while (this.results.length && performance.now() - t0 < UPLOAD_BUDGET_MS) {
      const r = this.results.shift()!;
      const e = this.byId.get(r.id);
      if (r.type === "info") {
        this.infoMsTotal += r.ms;
        this.infoMsCount++;
      }
      if (!e) continue; // recycled while in flight
      if (e.kind === "mesh") {
        this.lodMsTotal[e.lod] += r.ms;
        this.lodMsCount[e.lod]++;
      }
      this.byId.delete(r.id);
      e.state = "ready";
      changed = true;
      if (e.kind === "info") {
        if (r.info) this.terrain.set(r.info);
        continue;
      }
      if (e.lod === 0) {
        this.floaters += r.stats.floaters;
        const removed = new Set<number>();
        for (let q = 0; q < r.removed.length; q += 3) {
          removed.add((r.removed[q + 1] * (n - 1) + r.removed[q + 2]) * (n - 1) + r.removed[q]);
        }
        e.removed = removed;
      }
      if (r.indices.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(r.positions, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(r.normals, 3));
      geo.setAttribute("ao", new THREE.BufferAttribute(r.ao, 1));
      // macro-region weights (regionWeights.ts): 8 normalised bytes → aRegA (4) + aRegB (2)
      const reg = new THREE.InterleavedBuffer(r.region, REGION_STRIDE);
      geo.setAttribute("aRegA", new THREE.InterleavedBufferAttribute(reg, 4, 0, true));
      geo.setAttribute("aRegB", new THREE.InterleavedBufferAttribute(reg, 2, 4, true));
      geo.setIndex(new THREE.BufferAttribute(r.indices, 1));
      // Tight bounds from the actual vertices (worker-computed): full-height column boxes
      // (~240 m tall) let about half of the drawn triangles through the frustum test off-screen.
      const bb = r.bounds;
      geo.boundingBox = new THREE.Box3(new THREE.Vector3(bb[0], bb[1], bb[2]), new THREE.Vector3(bb[3], bb[4], bb[5]));
      geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
      let mesh = this.meshPool.pop();
      if (mesh) mesh.geometry = geo;
      else {
        mesh = new THREE.Mesh(geo, this.material);
        mesh.matrixAutoUpdate = false;
      }
      mesh.name = `column L${e.lod} ${e.cx},${e.cz}`;
      e.mesh = mesh;
      // an old mesh still covers this footprint: stay hidden until the whole
      // replacement is ready, then crossfade (retire)
      if (this.fadeFactory && this.hasVisibleOverlap(e)) {
        mesh.visible = false;
        e.awaitFade = true;
      }
      this.group.add(mesh);
      this.lodTris[e.lod] += r.indices.length / 3;
    }
    if (changed) this.retire();
  }



  stats(): ChunkStats {
    let meshes = 0;
    let pending = 0;
    let active = 0;
    const lodMeshes = new Array(this.levels).fill(0);
    for (const e of this.nodes.values()) {
      if (e.kind !== "mesh") continue;
      active++;
      if (e.mesh) {
        meshes++;
        lodMeshes[e.lod]++;
      }
      if (e.state === "pending") pending++;
    }
    for (const e of this.nodes.values()) if (e.kind === "info" && e.state === "pending") pending++;
    return {
      active,
      meshes,
      queued: this.queue.length,
      pending,
      triangles: this.lodTris.reduce((a, b) => a + b, 0),
      workers: this.pool.live(),
      avgMs: this.lodMsCount[0] ? this.lodMsTotal[0] / this.lodMsCount[0] : 0,
      avgInfoMs: this.infoMsCount ? this.infoMsTotal / this.infoMsCount : 0,
      floaters: this.floaters,
      lodMeshes,
      lodTriangles: [...this.lodTris],
      lodMs: this.lodMsTotal.map((t, i) => (this.lodMsCount[i] ? t / this.lodMsCount[i] : 0)),
    };
  }

  /**
   * True when level-0 lattice point (gi, gj, gk) was removed as floating rock by its
   * (built) column: the collision field (latticeSampler) treats it as water, as the mesh does.
   */
  isRemovedPoint(gi: number, gj: number, gk: number): boolean {
    const n = this.field.settings.numPointsPerAxis;
    const cx = Math.floor(gi / (n - 1)), cz = Math.floor(gk / (n - 1));
    const set = this.nodes.get(meshKey(0, cx, cz))?.removed;
    if (!set || set.size === 0) return false;
    const j = gj - this.rows.gjMin;
    return set.has((j * (n - 1) + (gk - cz * (n - 1))) * (n - 1) + (gi - cx * (n - 1)));
  }

  /** True once every wanted level-0 column within radius is drawn (and the classification columns built). */
  nearReady(viewer: THREE.Vector3, radius: number): boolean {
    const r2 = radius * radius;
    let any = false;
    for (const e of this.nodes.values()) {
      if (!e.wanted) continue;
      if (e.kind === "mesh" && e.lod > 0) continue;
      if (this.sqrDst(viewer, e) > r2) continue;
      any = true;
      if (e.kind === "info" ? e.state !== "ready" : !this.drawn(e)) return false;
    }
    return any;
  }

  /**
   * Points on a `step` grid within viewDistance (XZ) of the viewer whose footprint
   * no drawn column covers (0 = full coverage).
   */
  coverageHoles(viewer: THREE.Vector3, step = 8): number {
    const s = this.field.settings;
    const b = s.boundsSize;
    const r = s.viewDistance;
    const top = this.levels - 1;
    let holes = 0;
    for (let z = Math.ceil((viewer.z - r) / step) * step; z <= viewer.z + r; z += step) {
      for (let x = Math.ceil((viewer.x - r) / step) * step; x <= viewer.x + r; x += step) {
        const dx = x - viewer.x, dz = z - viewer.z;
        if (dx * dx + dz * dz > r * r) continue;
        const gx = Math.floor((x + b / 2) / b), gz = Math.floor((z + b / 2) / b);
        let ok = false;
        for (let l = top; l >= 0 && !ok; l--) ok = this.drawn(this.nodes.get(meshKey(l, gx >> l, gz >> l)));
        if (!ok) holes++;
      }
    }
    return holes;
  }

  /** Mesh column (lod, cx, cz) is on screen. */
  drawnAt(lod: number, cx: number, cz: number): boolean {
    return this.drawn(this.nodes.get(meshKey(lod, cx, cz)));
  }

  /** Every footprint inside the view is drawn (the loading gate). */
  coverageComplete(viewer: THREE.Vector3): boolean {
    return this.coverageHoles(viewer, 16) === 0;
  }

  /** Queued (not yet dispatched) jobs. */
  get queueLength(): number {
    return this.queue.length;
  }

  dispose() {
    this.disposed = true;
    this.pool.dispose();
    for (const e of [...this.nodes.values()]) this.recycle(e);
    this.meshPool.length = 0;
    this.scene.remove(this.group);
  }
}
