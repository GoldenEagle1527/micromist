/**
 * What the streaming quadtree wants and in which order (chunks.ts):
 * - the viewer's smoothed velocity gives a look-ahead point LOOKAHEAD_S ahead; the
 *   split distance and the build order use the min of both distances, so at
 *   swimming speed the fine rings are built ahead of the diver, in-view first;
 * - wanted set (coverage first, progressive refinement): a node splits only when
 *   it is drawn and settled, or its footprint is already drawn finer, and only when
 *   all 4 children (those with terrain) lie within viewDistance; top-level columns
 *   are prefetched PREFETCH_U beyond viewDistance;
 * - build order: uncovered footprints first, then refinements, near first,
 *   weighted towards the camera / swim direction.
 */
import * as THREE from "three";
import { INFO_GRID } from "./config";
import { hasTerrain } from "./terrainExtent";
import type { ChunkTree } from "./chunkTree";
import { LOOKAHEAD_S, PREFETCH_U, SPLIT_HYST, UNCOVERED_BAND, infoKey, meshKey, settled, type ChunkNode, type WantedNode } from "./chunkNode";

/** Smoothed horizontal viewer velocity (units/s) and the look-ahead point it gives. */
export class ViewerMotion {
  readonly vel = new THREE.Vector3();
  readonly ahead = new THREE.Vector3();
  private readonly lastViewer = new THREE.Vector3();
  private hasLast = false;

  /** Teleports / respawns (implausible speeds) are ignored. */
  update(viewer: THREE.Vector3, dt: number) {
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
  }
}

/** The camera's frustum and forward direction (in-view first, facing weight). */
export class CameraView {
  readonly frustum = new THREE.Frustum();
  readonly fwd = new THREE.Vector3(0, 0, -1);
  private readonly projScreen = new THREE.Matrix4();

  update(camera: THREE.Camera) {
    camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    camera.getWorldDirection(this.fwd);
  }
}

/** Distance used for LOD splits and build order: to the viewer or to where it will be shortly. */
function sqrDstAhead(tree: ChunkTree, viewer: THREE.Vector3, ahead: THREE.Vector3, x0: number, z0: number, size: number): number {
  return Math.min(tree.sqrDstRect(viewer, x0, z0, size), tree.sqrDstRect(ahead, x0, z0, size));
}

/** Leaves of the LOD quadtree around the viewer + base info columns in range. */
export function wantedSet(tree: ChunkTree, viewer: THREE.Vector3, ahead: THREE.Vector3): Map<string, WantedNode> {
  const s = tree.field.settings;
  const out = new Map<string, WantedNode>();
  const top = tree.levels - 1;
  const topSize = s.boundsSize * (1 << top);
  const view2 = s.viewDistance * s.viewDistance;
  // Coverage first, progressive refinement: a node splits only when it is drawn
  // and settled, or when its footprint is already drawn finer (keeps an existing
  // fine area). Everything therefore starts from the top level, and every swap
  // replaces a column by its 4 children (or back) in one crossfade — never a
  // hidden fine column waiting behind a big coarse one, never a hole.
  const visit = (lod: number, cx: number, cz: number) => {
    const [x0, z0] = tree.origin("mesh", lod, cx, cz);
    const size = s.boundsSize * (1 << lod);
    const d2 = tree.sqrDstRect(viewer, x0, z0, size);
    if (d2 > (lod === top ? prefetch2 : view2)) return;
    if (!hasTerrain(tree.extent, x0, z0, size)) return;
    const key = meshKey(lod, cx, cz);
    // hysteresis: an area already drawn finer merges back only SPLIT_HYST further out
    const finer = lod > 0 && tree.coveredBelow(lod, cx, cz);
    const near = lod > 0 && d2 <= view2 && sqrDstAhead(tree, viewer, ahead, x0, z0, size) < (s.lodNear * (1 << (lod - 1)) * (finer ? SPLIT_HYST : 1)) ** 2;
    const split = near && tree.childrenInView(viewer, lod, cx, cz) && (finer || settled(tree.nodes.get(key)));
    if (!split) {
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
    const [x0, z0] = tree.origin("info", 0, cx, cz);
    if (!hasTerrain(tree.extent, x0, z0, bs)) continue;
    if (tree.sqrDstRect(viewer, x0, z0, bs) <= r * r) out.set(infoKey(cx, cz), { kind: "info", lod: 0, cx, cz });
  }
  return out;
}

const box = new THREE.Box3();

/**
 * Build priority of every queued node (lower = later: the queue pops from its
 * end after sorting by descending priority). yMin / yMax: the columns' height span.
 */
export function prioritize(
  tree: ChunkTree, queue: ChunkNode[], viewer: THREE.Vector3, motion: ViewerMotion, view: CameraView, yMin: number, yMax: number,
) {
  const { fwd: camFwd, frustum } = view;
  const vel = motion.vel;
  const speed = Math.hypot(vel.x, vel.z);
  const fl = Math.hypot(camFwd.x, camFwd.z) || 1;
  const fx = camFwd.x / fl, fz = camFwd.z / fl;
  for (const e of queue) {
    const [x0, z0] = tree.origin(e.kind, e.lod, e.cx, e.cz);
    const size = tree.size(e);
    const d = Math.sqrt(sqrDstAhead(tree, viewer, motion.ahead, x0, z0, size));
    box.min.set(x0, yMin, z0);
    box.max.set(x0 + size, yMax, z0 + size);
    const inView = frustum.intersectsBox(box);
    // view / swim direction: ×1 straight ahead … ×2.2 behind
    const dx = x0 + size / 2 - viewer.x, dz = z0 + size / 2 - viewer.z;
    const dl = Math.hypot(dx, dz);
    let facing = 1;
    if (dl > size * 0.75) {
      facing = (dx * fx + dz * fz) / dl;
      if (speed > 1) facing = Math.max(facing, (dx * vel.x + dz * vel.z) / (dl * speed));
    }
    // near first; coarse rings early too (cheap, they give the far silhouettes)
    let p = (e.kind === "info" ? d + 6 : d / (1 + 0.3 * e.lod)) * (1.6 - 0.6 * facing);
    if (!inView) p = p * 3 + 60;
    if (e.kind === "mesh" && !tree.coveredAt(e.lod, e.cx, e.cz)) p += UNCOVERED_BAND;
    e.priority = p;
  }
}
