/**
 * Endless chunk grid around the viewer — port of MeshGenerator.InitVisibleChunks:
 * - viewer coord = round(pos / boundsSize), chunks live at coord * boundsSize;
 * - a chunk exists while its AABB is within viewDistance of the viewer;
 * - out-of-range chunks are recycled (Mesh objects pooled, geometry disposed).
 *
 * Unlike the reference (synchronous GPU dispatch + only frustum-visible chunks),
 * meshes are built by a Web Worker pool, prioritised by distance with visible
 * chunks first, and uploaded to the GPU under a small per-frame budget.
 */
import * as THREE from "three";
import type { DensityField } from "./density";
import { chunkIsTrivial, generateChunkMesh } from "./mesher";
import type { MesherRequest, MesherResponse } from "./protocol";

type ChunkState = "queued" | "pending" | "ready";

type ChunkEntry = {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  state: ChunkState;
  id: number;
  mesh: THREE.Mesh | null;
  priority: number;
  worker: number;
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
};

const MAX_IN_FLIGHT_PER_WORKER = 2;
const UPLOAD_BUDGET_MS = 4;
const MAIN_THREAD_BUDGET_MS = 6;

export class ChunkManager {
  private readonly chunks = new Map<string, ChunkEntry>();
  private readonly byId = new Map<number, ChunkEntry>();
  private readonly results: MesherResponse[] = [];
  private readonly meshPool: THREE.Mesh[] = [];
  private readonly slots: Slot[] = [];
  private readonly group = new THREE.Group();
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private readonly box = new THREE.Box3();
  private readonly trivialRows = new Map<number, boolean>();
  private queue: ChunkEntry[] = [];
  private nextId = 1;
  private lastViewerKey = "";
  private resortTimer = 0;
  private triangles = 0;
  private msTotal = 0;
  private msCount = 0;
  private disposed = false;

  private readonly scene: THREE.Scene;
  private readonly field: DensityField;
  private readonly material: THREE.Material;

  constructor(scene: THREE.Scene, field: DensityField, seed: number, material: THREE.Material) {
    this.scene = scene;
    this.field = field;
    this.material = material;
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
    // Re-queue this worker's jobs; the main-thread fallback picks them up if needed.
    for (const entry of this.chunks.values()) {
      if (entry.state === "pending" && entry.worker === index) {
        this.byId.delete(entry.id);
        entry.state = "queued";
        this.queue.push(entry);
      }
    }
  }

  private isTrivialRow(cy: number): boolean {
    let v = this.trivialRows.get(cy);
    if (v === undefined) {
      v = chunkIsTrivial(this.field, cy);
      this.trivialRows.set(cy, v);
    }
    return v;
  }

  private sqrDst(p: THREE.Vector3, cx: number, cy: number, cz: number): number {
    const b = this.field.settings.boundsSize;
    const ox = Math.max(Math.abs(p.x - cx * b) - b / 2, 0);
    const oy = Math.max(Math.abs(p.y - cy * b) - b / 2, 0);
    const oz = Math.max(Math.abs(p.z - cz * b) - b / 2, 0);
    return ox * ox + oy * oy + oz * oz;
  }

  private isVisible(cx: number, cy: number, cz: number): boolean {
    const b = this.field.settings.boundsSize;
    this.box.min.set(cx * b - b / 2, cy * b - b / 2, cz * b - b / 2);
    this.box.max.set(cx * b + b / 2, cy * b + b / 2, cz * b + b / 2);
    return this.frustum.intersectsBox(this.box);
  }

  /** Call once per frame with the viewer (sub) position and render camera. */
  update(viewer: THREE.Vector3, camera: THREE.Camera, dt: number) {
    if (this.disposed) return;
    const s = this.field.settings;
    const b = s.boundsSize;
    camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);

    const vx = Math.round(viewer.x / b);
    const vy = Math.round(viewer.y / b);
    const vz = Math.round(viewer.z / b);
    const viewerKey = `${vx},${vy},${vz}`;
    this.resortTimer -= dt;

    if (viewerKey !== this.lastViewerKey || this.resortTimer <= 0) {
      this.lastViewerKey = viewerKey;
      this.resortTimer = 0.2;
      this.refreshSet(viewer, vx, vy, vz);
    }

    this.dispatch();
    this.applyResults();
  }

  private refreshSet(viewer: THREE.Vector3, vx: number, vy: number, vz: number) {
    const s = this.field.settings;
    const view = s.viewDistance;
    const sqrView = view * view;
    const keep = view + s.boundsSize * 0.5; // hysteresis so chunks don't flicker at the edge
    const sqrKeep = keep * keep;

    // Recycle chunks that fell out of range.
    for (const entry of this.chunks.values()) {
      if (this.sqrDst(viewer, entry.cx, entry.cy, entry.cz) > sqrKeep) this.recycle(entry);
    }

    const maxInView = Math.ceil(view / s.boundsSize);
    for (let y = -maxInView; y <= maxInView; y++) {
      const cy = vy + y;
      if (this.isTrivialRow(cy)) continue;
      for (let x = -maxInView; x <= maxInView; x++) {
        for (let z = -maxInView; z <= maxInView; z++) {
          const cx = vx + x;
          const cz = vz + z;
          const key = `${cx},${cy},${cz}`;
          if (this.chunks.has(key)) continue;
          if (this.sqrDst(viewer, cx, cy, cz) > sqrView) continue;
          const entry: ChunkEntry = { key, cx, cy, cz, state: "queued", id: 0, mesh: null, priority: 0, worker: -1 };
          this.chunks.set(key, entry);
          this.queue.push(entry);
        }
      }
    }

    // Nearest first; chunks outside the view frustum wait (reference only builds visible ones).
    this.queue = this.queue.filter((e) => e.state === "queued" && this.chunks.get(e.key) === e);
    for (const e of this.queue) {
      const d = this.sqrDst(viewer, e.cx, e.cy, e.cz);
      e.priority = this.isVisible(e.cx, e.cy, e.cz) ? d : d * 4 + 400;
    }
    this.queue.sort((a, b) => b.priority - a.priority); // pop() takes the best
  }

  private recycle(entry: ChunkEntry) {
    this.chunks.delete(entry.key);
    if (entry.state === "pending") this.byId.delete(entry.id);
    entry.state = "queued";
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
      // Fallback: build on the main thread under a frame budget.
      const t0 = performance.now();
      while (this.queue.length && performance.now() - t0 < MAIN_THREAD_BUDGET_MS) {
        const e = this.queue.pop()!;
        if (e.state !== "queued" || this.chunks.get(e.key) !== e) continue;
        const t1 = performance.now();
        const m = generateChunkMesh(this.field, e.cx, e.cy, e.cz);
        e.id = this.nextId++;
        this.byId.set(e.id, e);
        e.state = "pending";
        this.results.push({ type: "chunk", id: e.id, ...m, ms: performance.now() - t1 });
      }
      return;
    }
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      while (slot.alive && slot.inFlight < MAX_IN_FLIGHT_PER_WORKER && this.queue.length) {
        const e = this.queue.pop()!;
        if (e.state !== "queued" || this.chunks.get(e.key) !== e) continue;
        e.id = this.nextId++;
        e.state = "pending";
        e.worker = i;
        this.byId.set(e.id, e);
        slot.inFlight++;
        const req: MesherRequest = { type: "chunk", id: e.id, cx: e.cx, cy: e.cy, cz: e.cz };
        slot.worker.postMessage(req);
      }
    }
  }

  private applyResults() {
    const t0 = performance.now();
    while (this.results.length && performance.now() - t0 < UPLOAD_BUDGET_MS) {
      const r = this.results.shift()!;
      this.msTotal += r.ms;
      this.msCount++;
      const e = this.byId.get(r.id);
      if (!e) continue; // recycled while in flight
      this.byId.delete(r.id);
      e.state = "ready";
      if (r.indices.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(r.positions, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(r.normals, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(r.colors, 3));
      geo.setIndex(new THREE.BufferAttribute(r.indices, 1));
      const b = this.field.settings.boundsSize;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(e.cx * b, e.cy * b, e.cz * b), b * 0.9);
      geo.boundingBox = new THREE.Box3(
        new THREE.Vector3(e.cx * b - b / 2, e.cy * b - b / 2, e.cz * b - b / 2),
        new THREE.Vector3(e.cx * b + b / 2, e.cy * b + b / 2, e.cz * b + b / 2),
      );
      let mesh = this.meshPool.pop();
      if (mesh) {
        mesh.geometry = geo;
      } else {
        mesh = new THREE.Mesh(geo, this.material);
        mesh.matrixAutoUpdate = false;
      }
      mesh.name = `chunk ${e.key}`;
      e.mesh = mesh;
      this.group.add(mesh);
      this.triangles += r.indices.length / 3;
    }
  }

  stats(): ChunkStats {
    let meshes = 0;
    let pending = 0;
    for (const e of this.chunks.values()) {
      if (e.mesh) meshes++;
      if (e.state === "pending") pending++;
    }
    return {
      active: this.chunks.size,
      meshes,
      queued: this.queue.length,
      pending,
      triangles: this.triangles,
      workers: this.liveWorkers,
      avgMs: this.msCount ? this.msTotal / this.msCount : 0,
    };
  }

  /** True once every chunk near the viewer has been meshed (for the loading overlay). */
  nearReady(viewer: THREE.Vector3, radius: number): boolean {
    const r2 = radius * radius;
    for (const e of this.chunks.values()) {
      if (e.state !== "ready" && this.sqrDst(viewer, e.cx, e.cy, e.cz) <= r2) return false;
    }
    return this.chunks.size > 0;
  }

  dispose() {
    this.disposed = true;
    for (const slot of this.slots) {
      slot.alive = false;
      slot.worker.terminate();
    }
    for (const e of [...this.chunks.values()]) this.recycle(e);
    this.meshPool.length = 0;
    this.scene.remove(this.group);
  }
}
