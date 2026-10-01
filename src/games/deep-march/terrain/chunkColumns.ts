/**
 * Column meshes of the streaming quadtree (chunks.ts): finished jobs are uploaded
 * under a per-frame budget (UPLOAD_BUDGET_MS) into pooled meshes, hidden while an
 * old mesh still covers their footprint (then crossfaded, chunkRetire.ts), and
 * recycled when their node is dropped. Base-scale info results go to the
 * TerrainInfoStore instead.
 */
import * as THREE from "three";
import type { DensityField } from "./density";
import type { TerrainInfoStore } from "./terrainInfo";
import { UPLOAD_BUDGET_MS, type ChunkNode } from "./chunkNode";
import type { ChunkTree } from "./chunkTree";
import type { ChunkJobs } from "./chunkJobs";
import type { LodFader } from "./chunkFade";
import { dropCovered, hasVisibleOverlap, retire, type SwapHost } from "./chunkRetire";
import { columnGeometry, removedSet } from "./chunkUpload";
import { ChunkCounters } from "./chunkStats";

export class ChunkColumns {
  /** The group holding every column mesh. */
  readonly group = new THREE.Group();
  readonly counters: ChunkCounters;
  readonly swap: SwapHost;
  private readonly meshPool: THREE.Mesh[] = [];
  private readonly nodes: Map<string, ChunkNode>;
  private readonly jobs: ChunkJobs;
  private readonly field: DensityField;
  private readonly material: THREE.Material;
  private readonly fader: LodFader;
  private readonly terrain: TerrainInfoStore;

  constructor(tree: ChunkTree, jobs: ChunkJobs, field: DensityField, material: THREE.Material, fader: LodFader, terrain: TerrainInfoStore, loading: () => boolean) {
    this.nodes = tree.nodes;
    this.jobs = jobs;
    this.field = field;
    this.material = material;
    this.fader = fader;
    this.terrain = terrain;
    this.counters = new ChunkCounters(tree.levels);
    this.swap = { nodes: this.nodes, levels: tree.levels, fader, loading, recycle: (n) => this.recycle(n) };
  }

  /** Advance the crossfades (a finished fade-out drops its column). */
  stepFades() {
    this.fader.step((n) => dropCovered(this.swap, n));
  }

  recycle(node: ChunkNode) {
    if (node.fade !== 0 || node.fadeMat) this.fader.end(node);
    node.awaitFade = false;
    node.resident = false;
    this.nodes.delete(node.key);
    if (node.state === "pending") this.jobs.byId.delete(node.id);
    node.state = "queued";
    node.removed = null;
    if (node.kind === "info") this.terrain.delete(node.cx, node.cz);
    if (node.mesh) {
      this.counters.lodTris[node.lod] -= (node.mesh.geometry.index?.count ?? 0) / 3;
      node.mesh.geometry.dispose();
      this.group.remove(node.mesh);
      node.mesh.visible = true;
      node.mesh.material = this.material;
      this.meshPool.push(node.mesh);
      node.mesh = null;
    }
  }

  applyResults() {
    const t0 = performance.now();
    const n = this.field.settings.numPointsPerAxis;
    const c = this.counters;
    const { results, byId } = this.jobs;
    let changed = false;
    while (results.length && performance.now() - t0 < UPLOAD_BUDGET_MS) {
      const r = results.shift()!;
      const e = byId.get(r.id);
      if (r.type === "info") {
        c.infoMsTotal += r.ms;
        c.infoMsCount++;
      }
      if (!e) continue; // recycled while in flight
      if (e.kind === "mesh") {
        c.lodMsTotal[e.lod] += r.ms;
        c.lodMsCount[e.lod]++;
      }
      byId.delete(r.id);
      e.state = "ready";
      changed = true;
      if (e.kind === "info") {
        if (r.info) this.terrain.set(r.info);
        continue;
      }
      if (e.lod === 0) {
        c.floaters += r.stats.floaters;
        e.removed = removedSet(r, n);
      }
      if (r.indices.length === 0) continue;
      const geo = columnGeometry(r, e.lod, !!this.field.wall);
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
      if (this.fader.enabled && hasVisibleOverlap(this.nodes, e)) {
        mesh.visible = false;
        e.awaitFade = true;
      }
      this.group.add(mesh);
      c.lodTris[e.lod] += r.indices.length / 3;
    }
    if (changed) retire(this.swap);
  }

  dispose() {
    for (const e of [...this.nodes.values()]) this.recycle(e);
    this.meshPool.length = 0;
  }
}
