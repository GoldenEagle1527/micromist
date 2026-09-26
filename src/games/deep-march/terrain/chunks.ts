/**
 * Endless terrain around the viewer — port of MeshGenerator.InitVisibleChunks,
 * reorganised into full-height columns (the world is only ~33 units tall
 * between the hard floor and the hard ceiling):
 * - viewer column = round(pos / boundsSize); a column exists while its XZ
 *   footprint is within viewDistance of the viewer;
 * - out-of-range columns are recycled (Mesh objects pooled, geometry disposed);
 * - meshes are built by a Web Worker pool (nearest + in-frustum first) and
 *   uploaded under a per-frame budget; main-thread fallback if workers fail.
 *
 * Each column also reports which lattice points it removed as floating rock;
 * `isRemoved()` lets collision ignore exactly what the renderer dropped.
 */
import * as THREE from "three";
import type { DensityField } from "./density";
import { columnRows, generateColumnMesh, latticeCoord, latticeSpacing, type ColumnRows } from "./mesher";
import type { MesherRequest, MesherResponse } from "./protocol";

type ColumnState = "queued" | "pending" | "ready";

type ColumnEntry = {
  key: string;
  cx: number;
  cz: number;
  state: ColumnState;
  id: number;
  mesh: THREE.Mesh | null;
  priority: number;
  worker: number;
  /** Removed lattice points owned by this column, keyed (j*(n-1) + k)*(n-1) + i. */
  removed: Set<number> | null;
};

type Slot = { worker: Worker; inFlight: number; alive: boolean };

export type ChunkStats = {
  active: number;
  meshes: number;
  queued: number;
  pending: number;
  triangles: number;
  workers: number;
  avgMs: number;
  floaters: number;
};

const MAX_IN_FLIGHT_PER_WORKER = 1;
const UPLOAD_BUDGET_MS = 4;
const MAIN_THREAD_BUDGET_MS = 8;

export class ChunkManager {
  private readonly columns = new Map<string, ColumnEntry>();
  private readonly byId = new Map<number, ColumnEntry>();
  private readonly results: MesherResponse[] = [];
  private readonly meshPool: THREE.Mesh[] = [];
  private readonly slots: Slot[] = [];
  private readonly group = new THREE.Group();
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private readonly box = new THREE.Box3();
  private readonly scene: THREE.Scene;
  private readonly field: DensityField;
  private readonly material: THREE.Material;
  private readonly rows: ColumnRows;
  private readonly yMin: number;
  private readonly yMax: number;
  private queue: ColumnEntry[] = [];
  private nextId = 1;
  private lastViewerKey = "";
  private resortTimer = 0;
  private triangles = 0;
  private msTotal = 0;
  private msCount = 0;
  private floaters = 0;
  private disposed = false;

  constructor(scene: THREE.Scene, field: DensityField, seed: number, material: THREE.Material) {
    this.scene = scene;
    this.field = field;
    this.material = material;
    this.rows = columnRows(field);
    this.yMin = latticeCoord(this.rows.gjMin, field);
    this.yMax = latticeCoord(this.rows.gjMax, field);
    scene.add(this.group);
    const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
    const count = Math.max(1, Math.min(4, cores - 1));
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
        const init: MesherRequest = { type: "init", seed, settings: field.settings };
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
    for (const entry of this.columns.values()) {
      if (entry.state === "pending" && entry.worker === index) {
        this.byId.delete(entry.id);
        entry.state = "queued";
        this.queue.push(entry);
      }
    }
  }

  /** Squared XZ distance from the viewer to the column footprint. */
  private sqrDst(p: THREE.Vector3, cx: number, cz: number): number {
    const b = this.field.settings.boundsSize;
    const ox = Math.max(Math.abs(p.x - cx * b) - b / 2, 0);
    const oz = Math.max(Math.abs(p.z - cz * b) - b / 2, 0);
    return ox * ox + oz * oz;
  }

  private setColumnBox(cx: number, cz: number) {
    const b = this.field.settings.boundsSize;
    this.box.min.set(cx * b - b / 2, this.yMin, cz * b - b / 2);
    this.box.max.set(cx * b + b / 2, this.yMax, cz * b + b / 2);
  }

  update(viewer: THREE.Vector3, camera: THREE.Camera, dt: number) {
    if (this.disposed) return;
    const b = this.field.settings.boundsSize;
    camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);

    const vx = Math.round(viewer.x / b);
    const vz = Math.round(viewer.z / b);
    const viewerKey = `${vx},${vz}`;
    this.resortTimer -= dt;
    if (viewerKey !== this.lastViewerKey || this.resortTimer <= 0) {
      this.lastViewerKey = viewerKey;
      this.resortTimer = 0.2;
      this.refreshSet(viewer, vx, vz);
    }
    this.dispatch();
    this.applyResults();
  }

  private refreshSet(viewer: THREE.Vector3, vx: number, vz: number) {
    const s = this.field.settings;
    const view = s.viewDistance;
    const sqrView = view * view;
    const keep = view + s.boundsSize * 0.5;
    const sqrKeep = keep * keep;

    for (const entry of this.columns.values()) {
      if (this.sqrDst(viewer, entry.cx, entry.cz) > sqrKeep) this.recycle(entry);
    }

    const maxInView = Math.ceil(view / s.boundsSize);
    for (let x = -maxInView; x <= maxInView; x++) {
      for (let z = -maxInView; z <= maxInView; z++) {
        const cx = vx + x;
        const cz = vz + z;
        const key = `${cx},${cz}`;
        if (this.columns.has(key)) continue;
        if (this.sqrDst(viewer, cx, cz) > sqrView) continue;
        const entry: ColumnEntry = { key, cx, cz, state: "queued", id: 0, mesh: null, priority: 0, worker: -1, removed: null };
        this.columns.set(key, entry);
        this.queue.push(entry);
      }
    }

    this.queue = this.queue.filter((e) => e.state === "queued" && this.columns.get(e.key) === e);
    for (const e of this.queue) {
      const d = this.sqrDst(viewer, e.cx, e.cz);
      this.setColumnBox(e.cx, e.cz);
      e.priority = this.frustum.intersectsBox(this.box) ? d : d * 4 + 400;
    }
    this.queue.sort((a, b) => b.priority - a.priority);
  }

  private recycle(entry: ColumnEntry) {
    this.columns.delete(entry.key);
    if (entry.state === "pending") this.byId.delete(entry.id);
    entry.state = "queued";
    entry.removed = null;
    if (entry.mesh) {
      this.triangles -= (entry.mesh.geometry.index?.count ?? 0) / 3;
      entry.mesh.geometry.dispose();
      this.group.remove(entry.mesh);
      this.meshPool.push(entry.mesh);
      entry.mesh = null;
    }
  }

  private dispatch() {
    if (this.liveWorkers === 0) {
      const t0 = performance.now();
      while (this.queue.length && performance.now() - t0 < MAIN_THREAD_BUDGET_MS) {
        const e = this.queue.pop()!;
        if (e.state !== "queued" || this.columns.get(e.key) !== e) continue;
        const t1 = performance.now();
        const m = generateColumnMesh(this.field, e.cx, e.cz, this.rows, this.field.settings.floaterMargin);
        e.id = this.nextId++;
        this.byId.set(e.id, e);
        e.state = "pending";
        this.results.push({ type: "column", id: e.id, ...m, ms: performance.now() - t1 });
      }
      return;
    }
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      while (slot.alive && slot.inFlight < MAX_IN_FLIGHT_PER_WORKER && this.queue.length) {
        const e = this.queue.pop()!;
        if (e.state !== "queued" || this.columns.get(e.key) !== e) continue;
        e.id = this.nextId++;
        e.state = "pending";
        e.worker = i;
        this.byId.set(e.id, e);
        slot.inFlight++;
        const req: MesherRequest = { type: "column", id: e.id, cx: e.cx, cz: e.cz };
        slot.worker.postMessage(req);
      }
    }
  }

  private applyResults() {
    const t0 = performance.now();
    const n = this.field.settings.numPointsPerAxis;
    while (this.results.length && performance.now() - t0 < UPLOAD_BUDGET_MS) {
      const r = this.results.shift()!;
      this.msTotal += r.ms;
      this.msCount++;
      const e = this.byId.get(r.id);
      if (!e) continue; // recycled while in flight
      this.byId.delete(r.id);
      e.state = "ready";
      this.floaters += r.stats.floaters;
      const removed = new Set<number>();
      for (let q = 0; q < r.removed.length; q += 3) {
        removed.add((r.removed[q + 1] * (n - 1) + r.removed[q + 2]) * (n - 1) + r.removed[q]);
      }
      e.removed = removed;
      if (r.indices.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(r.positions, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(r.normals, 3));
      geo.setAttribute("ao", new THREE.BufferAttribute(r.ao, 1));
      geo.setIndex(new THREE.BufferAttribute(r.indices, 1));
      this.setColumnBox(e.cx, e.cz);
      geo.boundingBox = this.box.clone();
      geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
      let mesh = this.meshPool.pop();
      if (mesh) mesh.geometry = geo;
      else {
        mesh = new THREE.Mesh(geo, this.material);
        mesh.matrixAutoUpdate = false;
      }
      mesh.name = `column ${e.key}`;
      e.mesh = mesh;
      this.group.add(mesh);
      this.triangles += r.indices.length / 3;
    }
  }

  /**
   * True when (x, y, z) lies in a lattice cell touching a removed floating-rock
   * point. Removed components have no kept solid within one lattice step
   * (26-connectivity), so such cells render as open water.
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
        const set = this.columns.get(`${cx},${cz}`)?.removed;
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
    for (const e of this.columns.values()) {
      if (e.mesh) meshes++;
      if (e.state === "pending") pending++;
    }
    return {
      active: this.columns.size,
      meshes,
      queued: this.queue.length,
      pending,
      triangles: this.triangles,
      workers: this.liveWorkers,
      avgMs: this.msCount ? this.msTotal / this.msCount : 0,
      floaters: this.floaters,
    };
  }

  /** True once every column near the viewer has been meshed. */
  nearReady(viewer: THREE.Vector3, radius: number): boolean {
    const r2 = radius * radius;
    for (const e of this.columns.values()) {
      if (e.state !== "ready" && this.sqrDst(viewer, e.cx, e.cz) <= r2) return false;
    }
    return this.columns.size > 0;
  }

  dispose() {
    this.disposed = true;
    for (const slot of this.slots) {
      slot.alive = false;
      slot.worker.terminate();
    }
    for (const e of [...this.columns.values()]) this.recycle(e);
    this.meshPool.length = 0;
    this.scene.remove(this.group);
  }
}
