/**
 * The base on top of the ledger (plan M5, design doc §6, §8.1): founding the
 * core (+ the frozen 3 × 3), building and demolishing, storage moves, energy
 * and fuel, departures. Every particle moves through the ledger, and after
 * every step B = lockedOf(base) (before founding: B = the lander cargo).
 * Pure: no rendering, no storage — the session saves `toSave()`.
 */
import { STRUCTURES, STRUCTURE_KINDS, type StructureKind } from "../config";
import type { ParticleLedger } from "../ledger/particleLedger";
import { PARTICLE_TYPES } from "../particles/particleTypes";
import type { ParticleVector, ReadonlyParticleVector } from "../particles/particleVector";
import type { SiteTable } from "../world/siteTable";
import { cloneBase, costOf, structureInfo, energyCapacity, protectionRadius, storageCapacity, type BaseSave, type BaseStructure, type Vec3 } from "./baseState";
import { tickEnergy } from "./energy";
import { viewOf } from "./baseView";
import { freezeArea } from "./frozen";
import { placementReason, shortfall, type WorldRect } from "./placementRules";
import type { BaseAction, BasePort, BaseView, TideForecast, TideReadiness } from "./port";
import * as store from "./storage";
import { tideForecast, tideReadiness } from "./tide";

export type BaseDeps = {
  ledger: ParticleLedger;
  save: BaseSave | null;
  /** This generation's table (the frozen sites are copied from it). */
  table: SiteTable;
  gen: number;
  /** Departures this generation so far. */
  dives: number;
  totals: ReadonlyParticleVector;
  /** A building / storage change: the session writes at once. */
  onCommit?: () => void;
  /** Energy / fuel ticked: the session writes when the throttle allows. */
  onDirty?: () => void;
  /** A dive began (stats.divesStarted). */
  onDive?: () => void;
};

export class Base implements BasePort {
  readonly kinds = STRUCTURE_KINDS;
  readonly info = structureInfo;
  readonly activeKinds: readonly number[];
  private readonly ledger: ParticleLedger;
  private state: BaseSave | null;
  private dives: number;
  private rev = 0;
  private readonly deps: BaseDeps;

  constructor(deps: BaseDeps) {
    this.deps = deps;
    this.ledger = deps.ledger;
    this.dives = deps.dives;
    this.state = deps.save && cloneBase(deps.save);
    this.activeKinds = deps.totals.flatMap((n, k) => (n > 0 ? [k] : []));
  }

  private get structures(): readonly BaseStructure[] {
    return this.state?.structures ?? [];
  }

  /** Free storage: after founding the tracked vector, before it the lander cargo (all of B). */
  private storageNow(): ParticleVector {
    return this.state ? this.state.storage : this.ledger.pool("base");
  }

  view(): BaseView {
    return viewOf(this.state, this.storageNow(), this.ledger.pool("player"), this.dives);
  }

  check(kind: StructureKind, x: number, z: number, rect: WorldRect) {
    return placementReason({ kind, x, z, rect, structures: this.structures, funds: store.fundsOf(this.ledger, this.storageNow()) });
  }

  shortfall(kind: StructureKind): readonly number[] {
    return shortfall(kind, store.fundsOf(this.ledger, this.storageNow()));
  }

  found(pos: readonly [number, number, number], yaw: number, site: number, rect: WorldRect): BaseAction {
    const reason = this.check("core", pos[0], pos[2], rect);
    if (reason !== "ok") return { ok: false, reason };
    if (!this.deps.table.sites[site]) return { ok: false, reason: "unknown" };
    const storage = this.ledger.pool("base");
    if (!store.pay(this.ledger, storage, costOf("core"))) return { ok: false, reason: "cost" };
    const area = freezeArea(this.deps.table, site);
    const world = this.ledger.pool("world");
    const locked = area.locked.map((n, k) => Math.min(n, world[k]));
    this.ledger.transferVector("world", "base", locked);
    const core: BaseStructure = { id: 1, kind: "core", pos: [pos[0], pos[1], pos[2]], yaw, on: true, fuel: 0 };
    this.state = { foundedGen: this.deps.gen, center: [...core.pos] as Vec3, frozen: area.sites, frozenLocked: locked, structures: [core], storage, energy: STRUCTURES.core.energyCap, brownout: false };
    return this.committed({ ok: true, id: core.id });
  }

  build(kind: StructureKind, pos: readonly [number, number, number], yaw: number, rect: WorldRect): BaseAction {
    if (kind === "core") return this.found(pos, yaw, -1, rect);
    const reason = this.check(kind, pos[0], pos[2], rect);
    const s = this.state;
    if (reason !== "ok" || !s) return { ok: false, reason: reason === "ok" ? "no-core" : reason };
    if (!store.pay(this.ledger, s.storage, costOf(kind))) return { ok: false, reason: "cost" };
    const id = s.structures.reduce((m, b) => Math.max(m, b.id), 0) + 1;
    s.structures.push({ id, kind, pos: [pos[0], pos[1], pos[2]], yaw, on: true, fuel: 0 });
    return this.committed({ ok: true, id });
  }

  demolish(id: number): BaseAction {
    const s = this.state;
    const b = s?.structures.find((x) => x.id === id);
    if (!s || !b || b.kind === "core") return { ok: false, reason: "unknown" };
    s.structures = s.structures.filter((x) => x !== b);
    store.refund(s.storage, costOf(b.kind));
    s.energy = Math.min(s.energy, energyCapacity(s.structures));
    return this.committed({ ok: true, id });
  }

  deposit(kind: number | null): number {
    return this.moved(this.state ? store.deposit(this.ledger, this.state.storage, storageCapacity(this.state.structures), kind) : 0);
  }

  withdraw(kind: number, count: number): number {
    return this.moved(this.state ? store.withdraw(this.ledger, this.state.storage, kind, count) : 0);
  }

  release(kind: number, count: number): number {
    return this.moved(this.state ? store.release(this.ledger, this.state.storage, kind, count) : 0);
  }

  depositOnDeath(): number {
    return this.moved(this.state ? store.depositAll(this.ledger, this.state.storage) : 0);
  }

  inside(x: number, z: number): boolean {
    const c = this.state?.center;
    return !!c && Math.hypot(x - c[0], z - c[2]) <= protectionRadius(this.structures);
  }

  recordDeparture(): void {
    if (this.state) this.countDive();
  }

  /** A dive began from the lander (the loading screen finished): counts while there is no base. */
  recordLanderDive(): void {
    if (!this.state) this.countDive();
  }

  private countDive(): void {
    this.dives += 1;
    this.deps.onDive?.();
    this.deps.onDirty?.();
  }

  /** Departures this generation (saved as generation.dives). */
  get departures(): number {
    return this.dives;
  }

  tick(dt: number): void {
    const s = this.state;
    if (!s || !(dt > 0)) return;
    const t = tickEnergy(s, s.storage, dt);
    s.energy = t.energy;
    s.brownout = t.brownout;
    for (const b of s.structures) b.fuel = t.fuel.get(b.id) ?? b.fuel;
    for (const [k, n] of t.burnt) {
      this.ledger.transfer("base", "suspended", PARTICLE_TYPES[k], n);
      s.storage[k] -= n;
      this.rev++;
    }
    this.deps.onDirty?.();
  }

  tide(): TideReadiness {
    return tideReadiness(this.state?.energy ?? 0, this.dives);
  }

  forecast(): TideForecast {
    return tideForecast(this.ledger.toState(), this.deps.totals);
  }

  revision(): number {
    return this.rev;
  }

  toSave(): BaseSave | null {
    return this.state && cloneBase(this.state);
  }

  private moved(n: number): number {
    if (n > 0) this.committed({ ok: true });
    return n;
  }

  private committed(a: BaseAction): BaseAction {
    this.rev++;
    this.deps.onCommit?.();
    return a;
  }
}
