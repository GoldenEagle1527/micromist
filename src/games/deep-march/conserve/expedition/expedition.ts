/**
 * One generation's expedition rules on top of the ledger (plan M4, design doc
 * §7.1, §7.4): absorbing nodes (W → P), the tank limit, death (P → L as a lost
 * cache, the oldest of 6 → S) and retrieval (L → P). Every particle moves through
 * ParticleLedger.transfer, so Σ pools = N after every step. Pure: no rendering,
 * no storage — the session saves `toSave()` with the ledger.
 */
import { CACHES, TANK } from "../config";
import type { ParticleLedger } from "../ledger/particleLedger";
import { PARTICLE_TYPES } from "../particles/particleTypes";
import type { NodeState, NodeStateSave } from "../nodes/nodeState";
import { cacheTotal, evictionFor, nextCacheId, takeFromContents, type LostCache } from "./caches";
import { FlowMeter } from "./flow";
import type { ExpeditionCache, ExpeditionNode, ExpeditionPort, FlowResult } from "./port";

export type ExpeditionSave = NodeStateSave & { caches: LostCache[] };

export type ExpeditionDeps = {
  ledger: ParticleLedger;
  nodes: NodeState;
  caches: readonly LostCache[];
  gen: number;
  sitesX: number;
  sitesZ: number;
  /** Called after a death created a cache (the session writes at once). */
  onLoss?: () => void;
};

const NONE: FlowResult = { moved: 0, left: 0, full: false };

export class Expedition implements ExpeditionPort {
  readonly tankCapacity = TANK.capacity;
  readonly sitesX: number;
  readonly sitesZ: number;
  private readonly ledger: ParticleLedger;
  private readonly nodes: NodeState;
  private list: LostCache[];
  private readonly gen: number;
  private readonly meter = new FlowMeter();
  private readonly onLoss: () => void;
  private rev = 0;

  constructor(deps: ExpeditionDeps) {
    this.ledger = deps.ledger;
    this.nodes = deps.nodes;
    this.list = deps.caches.map((c) => ({ ...c, pos: [...c.pos] as LostCache["pos"], contents: c.contents.slice() }));
    this.gen = deps.gen;
    this.sitesX = deps.sitesX;
    this.sitesZ = deps.sitesZ;
    this.onLoss = deps.onLoss ?? (() => {});
  }

  siteNodes(site: number): readonly ExpeditionNode[] {
    return this.nodes.table.sites[site]?.nodes ?? [];
  }

  remaining(nodeId: number): number {
    return this.nodes.remaining(nodeId);
  }

  carried(): number {
    return this.ledger.poolTotal("player");
  }

  room(): number {
    return Math.max(0, this.tankCapacity - this.carried());
  }

  absorb(nodeId: number, dt: number): FlowResult {
    const spec = this.nodes.spec(nodeId);
    if (!spec) return NONE;
    const type = PARTICLE_TYPES[spec.kind];
    const left = this.nodes.remaining(nodeId);
    const room = this.room();
    if (left > 0 && room === 0) return { moved: 0, left, full: true };
    const limit = Math.min(left, room, this.ledger.amount("world", type));
    const n = this.meter.step(nodeId * 2, spec.amount / TANK.absorbSeconds, dt, limit);
    if (n > 0) {
      this.ledger.transfer("world", "player", type, n);
      this.nodes.take(nodeId, n);
      this.rev++;
    }
    return { moved: n, left: left - n, full: false };
  }

  caches(): readonly ExpeditionCache[] {
    return this.list.map((c) => ({ id: c.id, pos: c.pos, total: cacheTotal(c) }));
  }

  retrieve(cacheId: number, dt: number): FlowResult {
    const cache = this.list.find((c) => c.id === cacheId);
    if (!cache) return NONE;
    const left = cacheTotal(cache);
    const room = this.room();
    if (room === 0) return { moved: 0, left, full: true };
    const n = this.meter.step(cacheId * 2 + 1, TANK.cacheRate, dt, Math.min(left, room));
    if (n > 0) {
      takeFromContents(cache.contents, n).forEach((m, k) => m > 0 && this.ledger.transfer("lost", "player", PARTICLE_TYPES[k], m));
      if (cacheTotal(cache) === 0) this.list = this.list.filter((c) => c !== cache);
      this.rev++;
    }
    return { moved: n, left: left - n, full: false };
  }

  release(): void {
    this.meter.reset();
  }

  loseCarried(pos: readonly [number, number, number]): ExpeditionCache | null {
    const carried = this.ledger.pool("player");
    if (carried.every((n) => n === 0)) return null;
    const oldest = evictionFor(this.list, CACHES.max);
    if (oldest) {
      this.ledger.transferVector("lost", "suspended", oldest.contents);
      this.list = this.list.filter((c) => c !== oldest);
    }
    this.ledger.transferVector("player", "lost", carried);
    const cache: LostCache = { id: nextCacheId(this.list), pos: [pos[0], pos[1], pos[2]], gen: this.gen, contents: carried };
    this.list.push(cache);
    this.meter.reset();
    this.rev++;
    this.onLoss();
    return { id: cache.id, pos: cache.pos, total: cacheTotal(cache) };
  }

  revision(): number {
    return this.rev;
  }

  toSave(): ExpeditionSave {
    return { ...this.nodes.toSave(), caches: this.list.map((c) => ({ ...c, pos: [...c.pos] as LostCache["pos"], contents: c.contents.slice() })) };
  }
}
