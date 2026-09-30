/**
 * The sonar observation view (声呐观察模式): the scan record's surfaces drawn on
 * their own dark scene instead of the live world, in the old sonar light mode's look
 * (scanShader.ts) — so stale terrain shows as it was scanned and unscanned places
 * stay black. Tiles are grouped in 128 m blocks (4 × 4 record tiles: one draw each);
 * a block's buffers are rebuilt when its tiles changed, nearest first within a
 * per-frame vertex budget (the old buffers stay up until the new ones are ready).
 */
import * as THREE from "three";
import { SONAR_TUNING } from "../sonar";
import { SCAN_GRID, decodeNormal, dequantXZ, dequantY, tileKey } from "./scanGrid";
import type { ScanRecord, ScanTile } from "./scanRecord";
import { SCAN_FRAG, SCAN_VERT } from "./scanShader";
import { meshVerts } from "./tileMesh";

export const SCAN_VIEW = {
  /** Record tiles per block side. */
  block: 4,
  /** Steady level of the recorded look (the old mode's trail right after a pulse was 1). */
  level: 0.9,
  background: new THREE.Color(0.0, 0.012, 0.024),
  /** Drawn radius (m, faded over its last 15 %) and vertices rebuilt per frame. */
  desktop: { radius: 420, rebuild: 60_000 },
  phone: { radius: 300, rebuild: 20_000 },
};

type Block = { key: number; bx: number; bz: number; tiles: ScanTile[]; sig: number; built: number; mesh: THREE.Mesh | null };

export class ScanView {
  readonly scene = new THREE.Scene();
  readonly material: THREE.ShaderMaterial;
  private readonly blocks = new Map<number, Block>();
  private readonly spec: typeof SCAN_VIEW.desktop;
  readonly uniforms = {
    uColor: { value: SONAR_TUNING.color.clone() },
    uLine: { value: new THREE.Vector3(SONAR_TUNING.contour, SONAR_TUNING.lineWidth, SONAR_TUNING.minPx) },
    uFront: { value: new THREE.Vector4(0, 0, 0, -1) },
    /** x / y: distance fade start / end, z: level, w: front half-width. */
    uLook: { value: new THREE.Vector4() },
  };

  constructor(lowSpec: boolean) {
    this.spec = lowSpec ? SCAN_VIEW.phone : SCAN_VIEW.desktop;
    const r = this.spec.radius;
    this.uniforms.uLook.value.set(0.85 * r, r, SCAN_VIEW.level, SONAR_TUNING.front);
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: SCAN_VERT, fragmentShader: SCAN_FRAG });
    this.scene.background = SCAN_VIEW.background;
  }

  /** Before rendering: blocks in reach, rebuilt buffers, the latest wavefront (w < 0: none). */
  update(rec: ScanRecord, camera: THREE.Camera, front: THREE.Vector4): void {
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
      if (b.mesh) b.mesh.visible = near;
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
      if (!b) this.blocks.set(key, (b = { key, bx, bz, tiles: [], sig: 0, built: -1, mesh: null }));
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

  /** Rebuild a block's buffers from its tiles' meshes; returns the vertices written. */
  private build(b: Block): number {
    const nv = b.tiles.reduce((s, t) => s + meshVerts(t.mesh), 0);
    const ni = b.tiles.reduce((s, t) => s + t.mesh.idx.length, 0);
    const pos = new Float32Array(nv * 3), nrm = new Int8Array(nv * 3), un = [0, 0, 0];
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let v = 0, i = 0;
    for (const { mesh: m, tx, tz } of b.tiles) {
      const base = v;
      for (let k = 0; k < m.pos.length / 3; k++, v++) {
        pos[v * 3] = dequantXZ(m.pos[k * 3], tx);
        pos[v * 3 + 1] = dequantY(m.pos[k * 3 + 1]);
        pos[v * 3 + 2] = dequantXZ(m.pos[k * 3 + 2], tz);
        decodeNormal(m.nrm[k * 2], m.nrm[k * 2 + 1], un, 0);
        for (let c = 0; c < 3; c++) nrm[v * 3 + c] = Math.round(un[c] * 127);
      }
      for (let k = 0; k < m.idx.length; k++) idx[i++] = base + m.idx[k];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3, true));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    if (b.mesh) {
      b.mesh.geometry.dispose();
      b.mesh.geometry = geo;
    } else {
      b.mesh = new THREE.Mesh(geo, this.material);
      b.mesh.matrixAutoUpdate = false;
      this.scene.add(b.mesh);
    }
    b.built = b.sig;
    return Math.max(1, nv);
  }

  private release(b: Block): void {
    if (!b.mesh) return;
    b.mesh.geometry.dispose();
    this.scene.remove(b.mesh);
    b.mesh = null;
  }
}
