/**
 * Nodes and caches near the diver, on screen (plan M4): places sites as the
 * diver moves (placement.ts, time-sliced), keeps the visible set (selection.ts:
 * caches + nearest nodes within the draw radius, ≤ 96) in the one instanced
 * draw (nodeInstances.ts), and exposes it as aim candidates. A node shrinks as
 * it is absorbed and disappears when empty; the set is rebuilt only when
 * something changed (placement, the expedition's revision, the target, or the
 * diver moved a few metres).
 */
import * as THREE from "three";
import type { ExpeditionNode, ExpeditionPort } from "../../conserve";
import type { DensityField } from "../../terrain/density";
import type { SiteLayout } from "../../terrain/siteLayout";
import { cachePhase } from "./beacon";
import { NODE_VIEW } from "./config";
import { NodeInstances, type NodeInstance } from "./nodeInstances";
import { NodePlacement, type PlacedNode } from "./placement";
import { cacheKey, nodeKey, selectVisible, type Candidate } from "./selection";

export type ViewItem = Candidate & { inst: NodeInstance; node?: ExpeditionNode };
export type Highlight = { key: number; absorbing: boolean } | null;

const REBUILD_MOVE = 6;

export class NodeView {
  readonly instances: NodeInstances;
  readonly placement: NodePlacement;
  private readonly port: ExpeditionPort;
  private readonly births = new Map<number, number>();
  private items: ViewItem[] = [];
  private stamp = "";
  private readonly last = new THREE.Vector3(Infinity, 0, 0);

  constructor(field: DensityField, layout: SiteLayout, port: ExpeditionPort, material: THREE.Material) {
    this.port = port;
    this.placement = new NodePlacement(field, layout, port, NODE_VIEW.prefetch);
    this.instances = new NodeInstances(material, NODE_VIEW.maxInstances);
  }

  get mesh(): THREE.InstancedMesh {
    return this.instances.mesh;
  }

  /** The drawn set (aim candidates). */
  visible(): readonly ViewItem[] {
    return this.items;
  }

  update(eye: THREE.Vector3, time: number, highlight: Highlight, budgetMs: number): void {
    this.placement.update(eye.x, eye.z, budgetMs);
    const stamp = `${this.placement.version}|${this.port.revision()}|${highlight?.key ?? -1}|${highlight?.absorbing ? 1 : 0}`;
    if (stamp === this.stamp && eye.distanceTo(this.last) < REBUILD_MOVE) return;
    this.stamp = stamp;
    this.last.copy(eye);
    const all: ViewItem[] = [];
    this.placement.forEach((p) => {
      const left = this.port.remaining(p.node.id);
      if (left > 0) all.push(this.nodeItem(p, left, time, highlight));
    });
    for (const c of this.port.caches()) all.push(this.cacheItem(c.id, c.pos, time, highlight));
    this.items = selectVisible(all, eye.x, eye.y, eye.z, selectRadius(), NODE_VIEW.maxInstances);
    this.instances.set(this.items.map((i) => i.inst));
  }

  private birth(key: number, time: number): number {
    let b = this.births.get(key);
    if (b === undefined) this.births.set(key, (b = time));
    return b;
  }

  private glow(key: number, base: number, h: Highlight): number {
    if (!h || h.key !== key) return base;
    return base * (1 + (h.absorbing ? NODE_VIEW.absorbGlow : NODE_VIEW.targetGlow));
  }

  private nodeItem(p: PlacedNode, left: number, time: number, h: Highlight): ViewItem {
    const { node, anchor: a } = p;
    const key = nodeKey(node.id);
    let ax = a.nx * 0.75, ay = a.ny * 0.75 + 0.25, az = a.nz * 0.75;
    const l = Math.hypot(ax, ay, az) || 1;
    ax /= l;
    ay /= l;
    az /= l;
    const fill = NODE_VIEW.minFill + (1 - NODE_VIEW.minFill) * Math.sqrt(left / node.amount);
    const scale = NODE_VIEW.scale * Math.sqrt(node.amount / 50) * fill;
    const s = NODE_VIEW.sink;
    const inst: NodeInstance = {
      x: a.x - a.nx * s, y: a.y - a.ny * s, z: a.z - a.nz * s, ax, ay, az,
      spin: ((node.hash & 0xffff) / 65536) * Math.PI * 2,
      scale,
      tint: NODE_VIEW.kindTint[node.kind] ?? NODE_VIEW.kindTint[0],
      part: 0,
      glow: this.glow(key, NODE_VIEW.glow, h),
      phase: (((node.hash >>> 16) & 0xff) / 255) * 4,
      birth: this.birth(key, time),
    };
    return { key, kind: "node", id: node.id, node, x: a.x + ax * 0.5 * scale, y: a.y + ay * 0.5 * scale, z: a.z + az * 0.5 * scale, inst };
  }

  private cacheItem(id: number, pos: readonly [number, number, number], time: number, h: Highlight): ViewItem {
    const key = cacheKey(id);
    const inst: NodeInstance = {
      x: pos[0], y: pos[1] - 0.45, z: pos[2], ax: 0, ay: 1, az: 0,
      spin: id * 0.7,
      scale: NODE_VIEW.cacheScale,
      tint: NODE_VIEW.cacheTint,
      part: 1,
      glow: this.glow(key, NODE_VIEW.glow * 1.2, h),
      phase: cachePhase(id),
      birth: this.birth(key, time),
    };
    return { key, kind: "cache", id, x: pos[0], y: pos[1], z: pos[2], inst };
  }

  dispose(): void {
    this.instances.dispose();
  }
}

/**
 * The set is rebuilt at most every REBUILD_MOVE m, and an aim point sits up to
 * ~1.2 m from its instance origin: selecting this far out means a node leaves
 * the set only after the shader has shrunk it to nothing (no popping).
 */
export function selectRadius(): number {
  return NODE_VIEW.radius + REBUILD_MOVE + 2;
}
