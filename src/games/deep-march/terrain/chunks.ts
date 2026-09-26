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
 *   (no holes while refining / coarsening);
 * - meshes are built by a Web Worker pool (nearest + in-frustum first) and
 *   uploaded under a per-frame budget; main-thread fallback if workers fail.
 *
 * Level-0 columns report which lattice points they removed as floating rock;
 * `isRemoved()` lets collision ignore exactly what the renderer dropped (the diver
 * is always inside the level-0 area).
 *
 * Terrain classification (TerrainInfoStore `terrain`: getEnvAt / getSpawnCandidates)
 * is generated separately for the base-scale columns (world / worldScale, see
 * config.baseTerrain) within infoRadius of the viewer.
 */
import * as THREE from "three";
import { baseTerrain } from "./config";
import { createDensityField, type DensityField } from "./density";
import { columnRows, generateColumnMesh, latticeSpacing, lodCoord, type ColumnRows } from "./mesher";
import type { MesherRequest, MesherResponse } from "./protocol";
import { TerrainInfoStore } from "./terrainInfo";

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
  worker: number;
  /** Level 0 only: removed lattice points owned by this column, keyed (j*(n-1) + k)*(n-1) + i. */
  removed: Set<number> | null;
  /** Still part of the wanted set (else drawn only until its replacement is ready). */
  wanted: boolean;
};

type Slot = { worker: Worker; inFlight: number; alive: boolean };

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

const MAX_IN_FLIGHT_PER_WORKER = 1;
const UPLOAD_BUDGET_MS = 4;
const MAIN_THREAD_BUDGET_MS = 8;

const meshKey = (lod: number, cx: number, cz: number) => `${lod}:${cx}:${cz}`;
const infoKey = (cx: number, cz: number) => `i:${cx}:${cz}`;

export class ChunkManager {
  private readonly nodes = new Map<string, Node>();
  private readonly byId = new Map<number, Node>();
  private readonly results: MesherResponse[] = [];
  private readonly meshPool: THREE.Mesh[] = [];
  private readonly slots: Slot[] = [];
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
  /** Generation-time terrain classification near the viewer (base-scale columns, world-unit queries). */
  readonly terrain: TerrainInfoStore;
  private floaters = 0;
  private disposed = false;

  constructor(scene: THREE.Scene, field: DensityField, seed: number, material: THREE.Material) {
    this.scene = scene;
    this.field = field;
    this.material = material;
    this.rows = columnRows(field);
    const s = field.settings;
    this.levels = Math.max(1, s.lodLevels);
    this.lodTris = new Array(this.levels).fill(0);
    this.lodMsTotal = new Array(this.levels).fill(0);
    this.lodMsCount = new Array(this.levels).fill(0);
    this.terrain = new TerrainInfoStore({ seed, boundsSize: s.boundsSize, numPointsPerAxis: s.numPointsPerAxis, scale: s.worldScale });
    this.yMin = lodCoord(this.rows.gjMin, field, 0);
    this.yMax = lodCoord(this.rows.gjMax, field, 0);
    scene.add(this.group);
    const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
    const count = Math.max(1, Math.min(6, cores - 1));
    for (let i = 0; i < count; i++) {
      try {
        const worker = new Worker(new URL("./mesher.worker.ts", import.meta.url), { type: "module" });
        const slot: Slot = { worker, inFlight: 0, alive: true };
        const index = this.slots.length;
        worker.onmessage = (ev: MessageEvent<MesherResponse>) => {
          slot.inFlight = Math.max(0, slot.inFlight - 1);
          this.results.push(ev.data);
        };
        worker.onerror = (ev) => {
          ev.preventDefault();
          this.killSlot(index);
        };
        const init: MesherRequest = { type: "init", seed, settings: s };
        worker.postMessage(init);
        this.slots.push(slot);
      } catch {
        break;
      }
    }
  }

  private get liveWorkers(): number {
    return this.slots.filter((s) => s.alive).length;
  }

  private killSlot(index: number) {
    const slot = this.slots[index];
    if (!slot || !slot.alive) return;
    slot.alive = false;
    slot.worker.terminate();
    for (const node of this.nodes.values()) {
      if (node.state === "pending" && node.worker === index) {
        this.byId.delete(node.id);
        node.state = "queued";
        this.queue.push(node);
      }
    }
  }

  /** Width of a node's footprint (units). */
  private size(n: { kind: "mesh" | "info"; lod: number }): number {
    const b = this.field.settings.boundsSize;
    return n.kind === "info" ? b * this.field.settings.worldScale : b * (1 << n.lod);
  }

  /** Footprint of a node: [x0, z0] (min corner). */
  private origin(kind: "mesh" | "info", lod: number, cx: number, cz: number): [number, number] {
    const b = this.field.settings.boundsSize;
    const size = kind === "info" ? b * this.field.settings.worldScale : b * (1 << lod);
    // lattice origin −b/2 (base columns: −b/2 in base units = −b·S/2 in world)
    const o = kind === "info" ? (-b * this.field.settings.worldScale) / 2 : -b / 2;
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

    const viewerKey = `${Math.round(viewer.x / b)},${Math.round(viewer.z / b)}`;
    this.resortTimer -= dt;
    if (viewerKey !== this.lastViewerKey || this.resortTimer <= 0) {
      this.lastViewerKey = viewerKey;
      this.resortTimer = 0.2;
      this.refreshSet(viewer);
    }
    this.dispatch();
    this.applyResults();
  }

  /** Leaves of the LOD quadtree around the viewer + base info columns in range. */
  private wantedSet(viewer: THREE.Vector3): Map<string, { kind: "mesh" | "info"; lod: number; cx: number; cz: number }> {
    const s = this.field.settings;
    const out = new Map<string, { kind: "mesh" | "info"; lod: number; cx: number; cz: number }>();
    const top = this.levels - 1;
    const topSize = s.boundsSize * (1 << top);
    const view2 = s.viewDistance * s.viewDistance;
    const visit = (lod: number, cx: number, cz: number) => {
      const [x0, z0] = this.origin("mesh", lod, cx, cz);
      const size = s.boundsSize * (1 << lod);
      const d2 = this.sqrDstRect(viewer, x0, z0, size);
      if (d2 > view2) return;
      const split = lod > 0 && d2 < (s.lodNear * (1 << (lod - 1))) ** 2;
      if (!split) {
        out.set(meshKey(lod, cx, cz), { kind: "mesh", lod, cx, cz });
        return;
      }
      for (let dz = 0; dz <= 1; dz++) for (let dx = 0; dx <= 1; dx++) visit(lod - 1, cx * 2 + dx, cz * 2 + dz);
    };
    const h = s.boundsSize / 2;
    const tx0 = Math.floor((viewer.x + h - s.viewDistance) / topSize), tx1 = Math.floor((viewer.x + h + s.viewDistance) / topSize);
    const tz0 = Math.floor((viewer.z + h - s.viewDistance) / topSize), tz1 = Math.floor((viewer.z + h + s.viewDistance) / topSize);
    for (let cz = tz0; cz <= tz1; cz++) for (let cx = tx0; cx <= tx1; cx++) visit(top, cx, cz);
    // base-scale classification columns
    const bs = s.boundsSize * s.worldScale;
    const r = s.infoRadius;
    const ix0 = Math.floor((viewer.x + bs / 2 - r) / bs), ix1 = Math.floor((viewer.x + bs / 2 + r) / bs);
    const iz0 = Math.floor((viewer.z + bs / 2 - r) / bs), iz1 = Math.floor((viewer.z + bs / 2 + r) / bs);
    for (let cz = iz0; cz <= iz1; cz++) for (let cx = ix0; cx <= ix1; cx++) {
      const [x0, z0] = this.origin("info", 0, cx, cz);
      if (this.sqrDstRect(viewer, x0, z0, bs) <= r * r) out.set(infoKey(cx, cz), { kind: "info", lod: 0, cx, cz });
    }
    return out;
  }

  /** Node b's footprint contains node a's (both mesh nodes). */
  private static contains(b: Node, a: Node): boolean {
    if (b.lod <= a.lod) return b.lod === a.lod && b.cx === a.cx && b.cz === a.cz;
    const d = b.lod - a.lod;
    return a.cx >> d === b.cx && a.cz >> d === b.cz;
  }

  private refreshSet(viewer: THREE.Vector3) {
    const want = this.wantedSet(viewer);
    for (const n of this.nodes.values()) n.wanted = want.has(n.key);
    for (const [key, w] of want) {
      if (this.nodes.has(key)) continue;
      const node: Node = { key, kind: w.kind, lod: w.lod, cx: w.cx, cz: w.cz, state: "queued", id: 0, mesh: null, priority: 0, worker: -1, removed: null, wanted: true };
      this.nodes.set(key, node);
      this.queue.push(node);
    }
    this.retire();

    this.queue = this.queue.filter((e) => e.state === "queued" && this.nodes.get(e.key) === e);
    for (const e of this.queue) {
      const d = Math.sqrt(this.sqrDst(viewer, e));
      this.setNodeBox(e);
      const inView = this.frustum.intersectsBox(this.box);
      // near first; coarse rings early too (cheap, they give the far silhouettes)
      const p = e.kind === "info" ? d + 6 : d / (1 + 0.6 * e.lod);
      e.priority = inView ? p : p * 3 + 60;
    }
    this.queue.sort((a, b) => b.priority - a.priority);
  }

  /** Drop unwanted nodes once whatever replaces their footprint is ready. */
  private retire() {
    const wantedMesh: Node[] = [];
    for (const n of this.nodes.values()) if (n.wanted && n.kind === "mesh") wantedMesh.push(n);
    for (const n of [...this.nodes.values()]) {
      if (n.wanted) continue;
      if (n.kind === "info" || n.state !== "ready" || !n.mesh) {
        this.recycle(n);
        continue;
      }
      let covered = true;
      let overlap = false;
      for (const w of wantedMesh) {
        if (!ChunkManager.contains(w, n) && !ChunkManager.contains(n, w)) continue;
        overlap = true;
        if (w.state !== "ready") {
          covered = false;
          break;
        }
      }
      if (covered || !overlap) this.recycle(n);
    }
  }

  private recycle(node: Node) {
    this.nodes.delete(node.key);
    if (node.state === "pending") this.byId.delete(node.id);
    node.state = "queued";
    node.removed = null;
    if (node.kind === "info") this.terrain.delete(node.cx, node.cz);
    if (node.mesh) {
      this.lodTris[node.lod] -= (node.mesh.geometry.index?.count ?? 0) / 3;
      node.mesh.geometry.dispose();
      this.group.remove(node.mesh);
      this.meshPool.push(node.mesh);
      node.mesh = null;
    }
  }

  private generateHere(e: Node): MesherResponse {
    const t1 = performance.now();
    let m: ReturnType<typeof generateColumnMesh>;
    if (e.kind === "info") {
      const s = this.field.settings;
      if (!this.base) this.base = s.worldScale === 1 ? this.field : createDensityField(this.field.seed, baseTerrain(s));
      const full = generateColumnMesh(this.base, e.cx, e.cz, columnRows(this.base), this.base.settings.floaterMargin, undefined, true);
      m = { ...full, positions: new Float32Array(0), normals: new Float32Array(0), ao: new Float32Array(0), indices: new Uint16Array(0), removed: new Int32Array(0) };
    } else {
      const rows = e.lod === 0 ? this.rows : columnRows(this.field, e.lod);
      m = generateColumnMesh(this.field, e.cx, e.cz, rows, this.field.settings.floaterMargin * (1 << e.lod), undefined, false, undefined, e.lod);
    }
    return { type: e.kind === "info" ? "info" : "column", id: e.id, ...m, ms: performance.now() - t1 };
  }

  private dispatch() {
    if (this.liveWorkers === 0) {
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
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      while (slot.alive && slot.inFlight < MAX_IN_FLIGHT_PER_WORKER && this.queue.length) {
        const e = this.queue.pop()!;
        if (e.state !== "queued" || this.nodes.get(e.key) !== e) continue;
        e.id = this.nextId++;
        e.state = "pending";
        e.worker = i;
        this.byId.set(e.id, e);
        slot.inFlight++;
        const req: MesherRequest =
          e.kind === "info" ? { type: "info", id: e.id, cx: e.cx, cz: e.cz } : { type: "column", id: e.id, cx: e.cx, cz: e.cz, lod: e.lod };
        slot.worker.postMessage(req);
      }
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
      geo.setIndex(new THREE.BufferAttribute(r.indices, 1));
      this.setNodeBox(e);
      geo.boundingBox = this.box.clone();
      geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
      let mesh = this.meshPool.pop();
      if (mesh) mesh.geometry = geo;
      else {
        mesh = new THREE.Mesh(geo, this.material);
        mesh.matrixAutoUpdate = false;
      }
      mesh.name = `column L${e.lod} ${e.cx},${e.cz}`;
      e.mesh = mesh;
      this.group.add(mesh);
      this.lodTris[e.lod] += r.indices.length / 3;
    }
    if (changed) this.retire();
  }

  /**
   * True when (x, y, z) lies in a lattice cell touching a removed floating-rock
   * point of a level-0 column. Removed components have no kept solid within one
   * lattice step (26-connectivity), so such cells render as open water.
   */
  isRemoved(x: number, y: number, z: number): boolean {
    const f = this.field;
    const n = f.settings.numPointsPerAxis;
    const sp = latticeSpacing(f);
    const h = f.settings.boundsSize / 2;
    const gi = Math.floor((x + h) / sp);
    const gj = Math.floor((y + h) / sp);
    const gk = Math.floor((z + h) / sp);
    for (let dk = 0; dk <= 1; dk++) {
      for (let di = 0; di <= 1; di++) {
        const ggi = gi + di, ggk = gk + dk;
        const cx = Math.floor(ggi / (n - 1));
        const cz = Math.floor(ggk / (n - 1));
        const set = this.nodes.get(meshKey(0, cx, cz))?.removed;
        if (!set || set.size === 0) continue;
        const li = ggi - cx * (n - 1);
        const lk = ggk - cz * (n - 1);
        for (let dj = 0; dj <= 1; dj++) {
          const j = gj + dj - this.rows.gjMin;
          if (set.has((j * (n - 1) + lk) * (n - 1) + li)) return true;
        }
      }
    }
    return false;
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
      workers: this.liveWorkers,
      avgMs: this.lodMsCount[0] ? this.lodMsTotal[0] / this.lodMsCount[0] : 0,
      avgInfoMs: this.infoMsCount ? this.infoMsTotal / this.infoMsCount : 0,
      floaters: this.floaters,
      lodMeshes,
      lodTriangles: [...this.lodTris],
      lodMs: this.lodMsTotal.map((t, i) => (this.lodMsCount[i] ? t / this.lodMsCount[i] : 0)),
    };
  }

  /** True once every level-0 column near the viewer has been meshed (and its classification built). */
  nearReady(viewer: THREE.Vector3, radius: number): boolean {
    const r2 = radius * radius;
    let any = false;
    for (const e of this.nodes.values()) {
      if (!e.wanted) continue;
      if (e.kind === "mesh" && e.lod > 0) continue;
      any = true;
      if (e.state !== "ready" && this.sqrDst(viewer, e) <= r2) return false;
    }
    return any;
  }

  dispose() {
    this.disposed = true;
    for (const slot of this.slots) {
      slot.alive = false;
      slot.worker.terminate();
    }
    for (const e of [...this.nodes.values()]) this.recycle(e);
    this.meshPool.length = 0;
    this.scene.remove(this.group);
  }
}
