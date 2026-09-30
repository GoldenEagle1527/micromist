/**
 * The dive's active-sonar record and observation view, wired together:
 *  - ping(): a ScanSweep over the terrain surfaces built right now (the column
 *    meshes' own vertex arrays, skirts excluded), capped at the terrain's reach;
 *  - frame(): advances the sweep with the wavefront (vertex budget per frame), keeps
 *    the record in its memory budget (LRU), writes a conserve save's record when it
 *    changed (throttled; also on page hide and at the end of the dive), and picks
 *    what to render: the live scene, or — in observation mode — the record.
 */
import * as THREE from "three";
import { SONAR_TUNING } from "../sonar";
import type { ScanRecord } from "./scanRecord";
import type { ScanStore } from "./scanStore";
import { ScanSweep, type ScanSource } from "./scanSweep";
import { ScanView } from "./scanView";

export const SCAN_TUNING = {
  /** Recorded point budget (~7 B each in a save, ~70 B in memory). */
  cap: { desktop: 150_000, phone: 90_000 },
  /** Terrain vertices scanned per frame. */
  budget: { desktop: 24_000, phone: 8_000 },
  /** Metres inside the terrain's view distance a ping records (the columns there are built). */
  reachPad: 24,
  /** Least time between two save writes of the record (ms). */
  writeEveryMs: 20_000,
};

type FrameInput = { time: number; nowMs: number; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; allowed: boolean };

export class SonarScanner {
  readonly record: ScanRecord;
  readonly view: ScanView;
  observing = false;
  private readonly store: ScanStore;
  private readonly budget: number;
  private readonly radius: number;
  private sweep: { s: ScanSweep; t0: number } | null = null;
  private readonly front = new THREE.Vector4(0, 0, 0, -1);
  private last: { x: number; y: number; z: number; t0: number } | null = null;
  private dirty = false;
  private lastWrite = 0;
  private readonly onHide = () => {
    if (document.visibilityState === "hidden") this.flush();
  };

  /** reach: the terrain's view distance (m). */
  constructor(store: ScanStore, lowSpec: boolean, reach: number) {
    this.store = store;
    this.record = store.open(lowSpec ? SCAN_TUNING.cap.phone : SCAN_TUNING.cap.desktop);
    this.budget = lowSpec ? SCAN_TUNING.budget.phone : SCAN_TUNING.budget.desktop;
    this.radius = Math.min(SONAR_TUNING.range, reach - SCAN_TUNING.reachPad);
    this.view = new ScanView(lowSpec);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onHide);
  }

  /** A ping from `origin` at `time` (s): scans the column meshes under `terrain` as its front passes. */
  ping(time: number, origin: THREE.Vector3, terrain: THREE.Object3D): void {
    this.sweep?.s.finish();
    const ping = this.record.begin(origin.x, origin.y, origin.z, this.radius);
    this.sweep = { s: new ScanSweep(ping, sourcesOf(terrain)), t0: time };
    this.last = { x: origin.x, y: origin.y, z: origin.z, t0: time };
  }

  /** Observation mode on / off (refused while not `allowed`); returns the new state. */
  setObserve(on: boolean, allowed = true): boolean {
    this.observing = on && allowed;
    return this.observing;
  }

  /** Per frame; returns the scene to render (null = the live one). */
  frame(i: FrameInput): THREE.Scene | null {
    const sw = this.sweep;
    if (sw) {
      const front = (i.time - sw.t0) * SONAR_TUNING.speed;
      if (front >= this.radius) sw.s.finish();
      else sw.s.step(front, this.budget);
      if (sw.s.done) {
        this.sweep = null;
        this.record.evict(this.record.now);
        this.dirty = true;
      }
    }
    if (this.dirty && this.store.persistent && i.nowMs - this.lastWrite >= SCAN_TUNING.writeEveryMs) this.write(i.nowMs);
    if (this.observing && !i.allowed) this.observing = false;
    if (!this.observing) return null;
    const l = this.last;
    const r = l ? (i.time - l.t0) * SONAR_TUNING.speed : -1;
    if (l && r <= SONAR_TUNING.range) this.front.set(l.x, l.y, l.z, r);
    else this.front.w = -1;
    this.view.update(this.record, i.camera, i.renderer, this.front);
    return this.view.scene;
  }

  /** Forget every recorded point (debug): the view empties, the saved record too. */
  forget(): void {
    this.sweep = null;
    this.record.clear();
    this.dirty = true;
    if (this.store.persistent) this.write(performance.now());
  }

  /** Finish the running sweep and write a changed record (page hide, dive end). */
  flush(): void {
    if (this.sweep) {
      this.sweep.s.finish();
      this.sweep = null;
      this.record.evict(this.record.now);
      this.dirty = true;
    }
    if (this.dirty && this.store.persistent) this.write(performance.now());
  }

  dispose(): void {
    this.flush();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onHide);
    this.view.dispose();
  }

  private write(nowMs: number): void {
    this.store.save(this.record);
    this.dirty = false;
    this.lastWrite = nowMs;
  }
}

/** The column meshes' surfaces (chunks.ts tags each geometry with its surface vertex count). */
export function sourcesOf(terrain: THREE.Object3D): ScanSource[] {
  const out: ScanSource[] = [];
  for (const o of terrain.children) {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    const n = g?.userData.surfaceVerts;
    const pos = g?.getAttribute("position"), nrm = g?.getAttribute("normal"), bb = g?.boundingBox;
    if (typeof n !== "number" || !pos || !nrm || !bb) continue;
    out.push({ positions: pos.array, normals: nrm.array, count: n, box: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z] });
  }
  return out;
}
