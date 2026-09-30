/**
 * ParticleLedger: the single owner of every particle count (design doc §3.3).
 *
 * Invariant, for every kind k and at all times: Σ_pools count = totals[k].
 * The totals are fixed at genesis; the only mutation is a transfer between two
 * pools, validated in full before anything changes (a refused transfer throws a
 * LedgerError and leaves the ledger untouched). Pure logic: no storage, no rendering.
 */
import { LedgerError } from "./ledgerError";
import { POOL_IDS, isPoolId, type PoolId } from "./pools";
import { PARTICLE_TYPES, isParticleType, particleIndex, type ParticleType } from "../particles/particleTypes";
import { copyVector, isCountVector, isParticleCount, vectorTotal, zeroVector, type ParticleVector, type ReadonlyParticleVector } from "../particles/particleVector";

export type PoolVectors = Record<PoolId, ParticleVector>;

/** Plain, serializable ledger contents. */
export type LedgerState = { totals: ParticleVector; pools: PoolVectors };

export type TransferEvent = { from: PoolId; to: PoolId; type: ParticleType; count: number };
export type TransferListener = (event: TransferEvent) => void;

function emptyPools(): PoolVectors {
  return { world: zeroVector(), player: zeroVector(), base: zeroVector(), suspended: zeroVector(), lost: zeroVector() };
}

function copyPools(pools: Readonly<Record<PoolId, ReadonlyParticleVector>>): PoolVectors {
  return { world: copyVector(pools.world), player: copyVector(pools.player), base: copyVector(pools.base), suspended: copyVector(pools.suspended), lost: copyVector(pools.lost) };
}

function poolSumOf(pools: Readonly<Record<PoolId, ReadonlyParticleVector>>, index: number): number {
  let sum = 0;
  for (const id of POOL_IDS) sum += pools[id][index];
  return sum;
}

/** Every kind's pools add up to its total. */
export function poolsConserve(totals: ReadonlyParticleVector, pools: Readonly<Record<PoolId, ReadonlyParticleVector>>): boolean {
  return totals.every((total, i) => poolSumOf(pools, i) === total);
}

function assertPool(id: unknown): asserts id is PoolId {
  if (!isPoolId(id)) throw new LedgerError("unknown-pool", `unknown pool "${String(id)}"`);
}

function assertType(type: unknown): asserts type is ParticleType {
  if (!isParticleType(type)) throw new LedgerError("unknown-type", `unknown particle type "${String(type)}"`);
}

function assertCount(count: unknown): asserts count is number {
  if (!isParticleCount(count)) throw new LedgerError("bad-count", `particle count must be a non-negative safe integer, got ${String(count)}`);
}

function assertDistinct(from: PoolId, to: PoolId): void {
  if (from === to) throw new LedgerError("same-pool", `transfer from "${from}" to itself`);
}

export class ParticleLedger {
  private readonly totals: ParticleVector;
  private readonly pools: PoolVectors;
  private readonly listeners = new Set<TransferListener>();

  private constructor(totals: ParticleVector, pools: PoolVectors) {
    this.totals = totals;
    this.pools = pools;
  }

  /** A new world: every particle starts condensed in the world pool. */
  static genesis(totals: ReadonlyParticleVector): ParticleLedger {
    if (!isCountVector(totals)) throw new LedgerError("bad-vector", "genesis totals must be a particle count vector");
    const pools = emptyPools();
    pools.world = copyVector(totals);
    return new ParticleLedger(copyVector(totals), pools);
  }

  /** Rebuild from saved contents; refuses anything malformed or not conserved. */
  static fromState(state: LedgerState): ParticleLedger {
    if (!isCountVector(state.totals)) throw new LedgerError("bad-vector", "ledger totals must be a particle count vector");
    for (const id of POOL_IDS) if (!isCountVector(state.pools[id])) throw new LedgerError("bad-vector", `pool "${id}" must be a particle count vector`);
    if (!poolsConserve(state.totals, state.pools)) throw new LedgerError("not-conserved", "pools do not add up to the totals");
    return new ParticleLedger(copyVector(state.totals), copyPools(state.pools));
  }

  total(type: ParticleType): number {
    return this.totals[particleIndex(type)];
  }

  /** All particles of every kind (fixed for the life of the world). */
  grandTotal(): number {
    return vectorTotal(this.totals);
  }

  amount(pool: PoolId, type: ParticleType): number {
    return this.pools[pool][particleIndex(type)];
  }

  /** Copy of one pool's vector. */
  pool(pool: PoolId): ParticleVector {
    return copyVector(this.pools[pool]);
  }

  poolTotal(pool: PoolId): number {
    return vectorTotal(this.pools[pool]);
  }

  /** Move `count` particles of one kind between two pools. */
  transfer(from: PoolId, to: PoolId, type: ParticleType, count: number): void {
    assertPool(from);
    assertPool(to);
    assertDistinct(from, to);
    assertType(type);
    assertCount(count);
    const i = particleIndex(type);
    if (this.pools[from][i] < count) throw new LedgerError("insufficient", `pool "${from}" holds ${this.pools[from][i]} ${type}, cannot move ${count}`);
    if (count === 0) return;
    this.pools[from][i] -= count;
    this.pools[to][i] += count;
    this.emit({ from, to, type, count });
  }

  /** Move a whole vector between two pools, all kinds or none. */
  transferVector(from: PoolId, to: PoolId, counts: ReadonlyParticleVector): void {
    assertPool(from);
    assertPool(to);
    assertDistinct(from, to);
    if (!isCountVector(counts)) throw new LedgerError("bad-vector", "transfer vector must be a particle count vector");
    const short = PARTICLE_TYPES.find((_type, i) => this.pools[from][i] < counts[i]);
    if (short) throw new LedgerError("insufficient", `pool "${from}" holds too little ${short}`);
    PARTICLE_TYPES.forEach((type, i) => this.transfer(from, to, type, counts[i]));
  }

  isConserved(): boolean {
    return poolsConserve(this.totals, this.pools);
  }

  toState(): LedgerState {
    return { totals: copyVector(this.totals), pools: copyPools(this.pools) };
  }

  /** Called after every applied transfer; returns the unsubscribe function. */
  onTransfer(listener: TransferListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: TransferEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
