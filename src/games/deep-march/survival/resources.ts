/**
 * Generic resource system (battery today; oxygen, hull, food… later).
 *
 * - Resources: id, capacity, current value, passive regen with an idle delay, flags.
 * - Consumers: any number of named drains per resource (rate / s); they stack.
 * - One-shot costs: canAfford / consume / add.
 * - Events: "changed" (value moved), "depleted" (hit 0), "restored" (left 0).
 * - serialize / deserialize: plain JSON snapshot for a future save (game-store /
 *   local-persist); nothing is persisted here.
 */

export type ResourceFlag =
  /** Include in save snapshots. */
  | "persist"
  /** Show on the HUD. */
  | "hud";

export type ResourceDef = {
  id: string;
  capacity: number;
  /** Starting value (default: full). */
  initial?: number;
  /** Passive gain per second (only while no consumer has drained for `regenDelay`). */
  regen?: number;
  regenDelay?: number;
  flags?: readonly ResourceFlag[];
};

export type ResourceView = {
  readonly id: string;
  readonly value: number;
  readonly capacity: number;
  readonly ratio: number;
  /** Net rate last tick (regen − drains), per second. */
  readonly rate: number;
  /** Sum of registered drains, per second. */
  readonly drain: number;
  readonly empty: boolean;
  readonly flags: ReadonlySet<ResourceFlag>;
};

export type ResourceEventType = "changed" | "depleted" | "restored";
export type ResourceEvent = { type: ResourceEventType; id: string; value: number; prev: number };
export type ResourceListener = (e: ResourceEvent) => void;

export type ResourceSnapshot = {
  v: 1;
  resources: Record<string, { value: number; capacity: number }>;
};

type Entry = {
  id: string;
  value: number;
  capacity: number;
  regen: number;
  regenDelay: number;
  idle: number;
  rate: number;
  flags: Set<ResourceFlag>;
  drains: Map<string, number>;
};

const EPS = 1e-6;

export class ResourceSystem {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Map<string, Set<ResourceListener>>();

  register(def: ResourceDef): ResourceView {
    if (this.entries.has(def.id)) throw new Error(`resource "${def.id}" already registered`);
    const cap = Math.max(0, def.capacity);
    const e: Entry = {
      id: def.id,
      value: clamp(def.initial ?? cap, 0, cap),
      capacity: cap,
      regen: def.regen ?? 0,
      regenDelay: def.regenDelay ?? 0,
      idle: Infinity,
      rate: 0,
      flags: new Set(def.flags ?? []),
      drains: new Map(),
    };
    this.entries.set(def.id, e);
    return this.view(def.id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  /** Read-only snapshot of one resource. */
  view(id: string): ResourceView {
    const e = this.entry(id);
    let drain = 0;
    for (const r of e.drains.values()) drain += r;
    return {
      id: e.id,
      value: e.value,
      capacity: e.capacity,
      ratio: e.capacity > 0 ? e.value / e.capacity : 0,
      rate: e.rate,
      drain,
      empty: e.value <= EPS,
      flags: e.flags,
    };
  }

  value(id: string): number {
    return this.entry(id).value;
  }

  /** Register / update a continuous consumer (rate ≤ 0 removes it). */
  setDrain(id: string, source: string, ratePerSec: number): void {
    const e = this.entry(id);
    if (ratePerSec > 0) e.drains.set(source, ratePerSec);
    else e.drains.delete(source);
  }

  clearDrain(id: string, source: string): void {
    this.entry(id).drains.delete(source);
  }

  /** Remove a consumer from every resource (e.g. an item was unequipped). */
  clearSource(source: string): void {
    for (const e of this.entries.values()) e.drains.delete(source);
  }

  canAfford(id: string, amount: number): boolean {
    return this.entry(id).value + EPS >= amount;
  }

  /** One-shot cost: all or nothing. */
  consume(id: string, amount: number): boolean {
    const e = this.entry(id);
    if (amount <= 0) return true;
    if (e.value + EPS < amount) return false;
    e.idle = 0;
    this.set(e, e.value - amount);
    return true;
  }

  /** Refill / pickup; returns the amount actually added. */
  add(id: string, amount: number): number {
    const e = this.entry(id);
    const prev = e.value;
    this.set(e, e.value + amount);
    return e.value - prev;
  }

  setCapacity(id: string, capacity: number, keepRatio = false): void {
    const e = this.entry(id);
    const ratio = e.capacity > 0 ? e.value / e.capacity : 1;
    e.capacity = Math.max(0, capacity);
    this.set(e, keepRatio ? ratio * e.capacity : e.value);
  }

  tick(dt: number): void {
    if (dt <= 0) return;
    for (const e of this.entries.values()) {
      let drain = 0;
      for (const r of e.drains.values()) drain += r;
      if (drain > 0) e.idle = 0;
      else e.idle += dt;
      const regen = e.idle >= e.regenDelay ? e.regen : 0;
      e.rate = regen - drain;
      if (e.rate !== 0) this.set(e, e.value + e.rate * dt);
    }
  }

  on(type: ResourceEventType, fn: ResourceListener): () => void;
  on(type: ResourceEventType, id: string, fn: ResourceListener): () => void;
  on(type: ResourceEventType, a: string | ResourceListener, b?: ResourceListener): () => void {
    const id = typeof a === "string" ? a : "*";
    const fn = (typeof a === "string" ? b : a) as ResourceListener;
    const key = `${type}:${id}`;
    let set = this.listeners.get(key);
    if (!set) this.listeners.set(key, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  serialize(): ResourceSnapshot {
    const resources: ResourceSnapshot["resources"] = {};
    for (const e of this.entries.values()) {
      if (e.flags.has("persist")) resources[e.id] = { value: e.value, capacity: e.capacity };
    }
    return { v: 1, resources };
  }

  /** Apply a snapshot to already-registered resources (unknown ids are ignored). */
  deserialize(snap: ResourceSnapshot): void {
    if (!snap || snap.v !== 1) return;
    for (const [id, s] of Object.entries(snap.resources)) {
      const e = this.entries.get(id);
      if (!e || !Number.isFinite(s.value) || !Number.isFinite(s.capacity)) continue;
      e.capacity = Math.max(0, s.capacity);
      this.set(e, s.value);
    }
  }

  dispose(): void {
    this.listeners.clear();
    this.entries.clear();
  }

  private entry(id: string): Entry {
    const e = this.entries.get(id);
    if (!e) throw new Error(`unknown resource "${id}"`);
    return e;
  }

  private set(e: Entry, next: number): void {
    const prev = e.value;
    e.value = clamp(next, 0, e.capacity);
    if (Math.abs(e.value - prev) < 1e-9) return;
    this.emit({ type: "changed", id: e.id, value: e.value, prev });
    if (e.value <= EPS && prev > EPS) this.emit({ type: "depleted", id: e.id, value: e.value, prev });
    else if (prev <= EPS && e.value > EPS) this.emit({ type: "restored", id: e.id, value: e.value, prev });
  }

  private emit(ev: ResourceEvent): void {
    for (const key of [`${ev.type}:${ev.id}`, `${ev.type}:*`]) {
      const set = this.listeners.get(key);
      if (set) for (const fn of [...set]) fn(ev);
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
