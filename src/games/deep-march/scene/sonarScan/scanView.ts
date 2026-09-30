/**
 * The sonar observation view (声呐观察模式): the scan record drawn on its own dark
 * scene instead of the live world — recorded points only, so stale terrain shows as
 * it was scanned and unscanned places stay empty. Points are grouped in 128 m
 * blocks (4 × 4 record tiles: one draw each); a block's buffers are rebuilt when
 * its tiles changed, nearest first within a per-frame point budget.
 */
import * as THREE from "three";
import { SONAR_TUNING } from "../sonar";
import { SCAN_GRID, tileKey, unpackPoint, type ScanPoint } from "./scanGrid";
import type { ScanRecord, ScanTile } from "./scanRecord";
import { SCAN_FRAG, SCAN_VERT } from "./scanShader";

export const SCAN_VIEW = {
  /** Record tiles per block side. */
  block: 4,
  /** Point footprint (m) and height-contour spacing / half-width (fraction). */
  pointSize: 1.7,
  contour: 4,
  contourWidth: 0.06,
  background: new THREE.Color(0.0, 0.012, 0.024),
  desktop: { radius: 420, maxPx: 10, rebuild: 30_000 },
  phone: { radius: 300, maxPx: 7, rebuild: 10_000 },
};

type Block = { key: number; bx: number; bz: number; tiles: ScanTile[]; sig: number; built: number; points: THREE.Points | null };

export class ScanView {
  readonly scene = new THREE.Scene();
  private readonly material: THREE.ShaderMaterial;
  private readonly blocks = new Map<number, Block>();
  private readonly spec: typeof SCAN_VIEW.desktop;
  private readonly size = new THREE.Vector2();
  private readonly pt: ScanPoint = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
  readonly uniforms = {
    uPointSize: { value: SCAN_VIEW.pointSize },
    uPx: { value: new THREE.Vector3(800, 1.5, 10) },
    uFront: { value: new THREE.Vector4(0, 0, 0, -1) },
    uScan: { value: new THREE.Vector4() },
    uColor: { value: SONAR_TUNING.color.clone() },
  };

  constructor(lowSpec: boolean) {
    this.spec = lowSpec ? SCAN_VIEW.phone : SCAN_VIEW.desktop;
    const r = this.spec.radius;
    this.uniforms.uScan.value.set(SCAN_VIEW.contour, 0.7 * r, r, SCAN_VIEW.contourWidth);
    this.uniforms.uPx.value.z = this.spec.maxPx;
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: SCAN_VERT, fragmentShader: SCAN_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false });
    this.scene.background = SCAN_VIEW.background;
  }

  /** Before rendering: blocks in reach, rebuilt buffers, point scale, the latest wavefront (w < 0: none). */
  update(rec: ScanRecord, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, front: THREE.Vector4): void {
    renderer.getDrawingBufferSize(this.size);
    this.uniforms.uPx.value.x = this.size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.uniforms.uFront.value.copy(front);
    this.gather(rec);
    const cx = camera.position.x, cz = camera.position.z;
    const span = SCAN_GRID.tile * SCAN_VIEW.block;
    const reach = this.spec.radius + span * 0.71;
    const todo: { b: Block; d: number }[] = [];
    for (const b of this.blocks.values()) {
      const d = Math.hypot((b.bx + 0.5) * span - cx, (b.bz + 0.5) * span - cz);
      const near = d <= reach;
      if (near && b.built !== b.sig) todo.push({ b, d });
      if (b.points) b.points.visible = near;
    }
    todo.sort((a, b) => a.d - b.d);
    let budget = this.spec.rebuild;
    for (const { b } of todo) {
      if (budget <= 0) break;
      budget -= this.build(b);
    }
  }

  dispose(): void {
    for (const b of this.blocks.values()) this.release(b);
    this.blocks.clear();
    this.material.dispose();
  }

  /** Tiles → blocks; a block's signature (newest change stamp, tile count) moves whenever one of its tiles changed or left. */
  private gather(rec: ScanRecord): void {
    for (const b of this.blocks.values()) {
      b.tiles.length = 0;
      b.sig = 0;
    }
    const n = SCAN_VIEW.block;
    for (const t of rec.tiles.values()) {
      const bx = Math.floor(t.tx / n), bz = Math.floor(t.tz / n);
      const key = tileKey(bx, bz);
      let b = this.blocks.get(key);
      if (!b) this.blocks.set(key, (b = { key, bx, bz, tiles: [], sig: 0, built: -1, points: null }));
      b.tiles.push(t);
      b.sig = Math.max(b.sig, t.version);
    }
    for (const b of [...this.blocks.values()]) {
      b.sig = b.sig * 64 + b.tiles.length;
      if (b.tiles.length > 0) continue;
      this.release(b);
      this.blocks.delete(b.key);
    }
  }

  /** Rebuild a block's buffers; returns the points written. */
  private build(b: Block): number {
    const count = b.tiles.reduce((s, t) => s + t.pts.size, 0);
    const pos = new Float32Array(count * 3);
    const nrm = new Int8Array(count * 3);
    let o = 0;
    for (const t of b.tiles)
      for (const p of t.pts.values()) {
        const q = unpackPoint(p, t.tx, t.tz, this.pt);
        pos[o] = q.x;
        pos[o + 1] = q.y;
        pos[o + 2] = q.z;
        nrm[o] = Math.round(q.nx * 127);
        nrm[o + 1] = Math.round(q.ny * 127);
        nrm[o + 2] = Math.round(q.nz * 127);
        o += 3;
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3, true));
    geo.computeBoundingSphere();
    if (b.points) {
      b.points.geometry.dispose();
      b.points.geometry = geo;
    } else {
      b.points = new THREE.Points(geo, this.material);
      b.points.matrixAutoUpdate = false;
      this.scene.add(b.points);
    }
    b.built = b.sig;
    return Math.max(1, count);
  }

  private release(b: Block): void {
    if (!b.points) return;
    b.points.geometry.dispose();
    this.scene.remove(b.points);
    b.points = null;
  }
}
