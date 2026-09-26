/**
 * Item catalogue, capacity-based storage and equipment slots.
 * Deliberately small: enough to model gear that gates abilities (night-vision
 * goggles → night-vision light mode) and to grow into loot / crafting later.
 */

export type EquipSlot = "head" | "face" | "body" | "back";

/** Capability tags that gameplay systems query instead of item ids. */
export type ItemTag = "nightVision" | "headLamp" | "battery";

export type ItemDef = {
  id: string;
  /** Storage units one item occupies. */
  size: number;
  /** Max per stack (1 = unique gear). */
  stack: number;
  slot?: EquipSlot;
  tags: readonly ItemTag[];
};

export const ITEMS = {
  "head-lamp": { id: "head-lamp", size: 1, stack: 1, slot: "head", tags: ["headLamp"] },
  "nv-goggles": { id: "nv-goggles", size: 2, stack: 1, slot: "face", tags: ["nightVision"] },
  "battery-cell": { id: "battery-cell", size: 1, stack: 8, tags: ["battery"] },
} as const satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEMS;

export function itemDef(id: ItemId): ItemDef {
  return ITEMS[id];
}

export type ItemStack = { id: ItemId; count: number };

/** Capacity-based inventory (backpack, locker, submarine hold…). */
export interface Storage {
  readonly capacity: number;
  readonly used: number;
  stacks(): readonly ItemStack[];
  count(id: ItemId): number;
  /** How many of `id` would fit right now. */
  room(id: ItemId): number;
  /** Adds as many as fit; returns the number added. */
  add(id: ItemId, count?: number): number;
  /** Removes up to `count`; returns the number removed. */
  remove(id: ItemId, count?: number): number;
  serialize(): ItemStack[];
  deserialize(stacks: readonly ItemStack[]): void;
}

export class CapacityStorage implements Storage {
  private readonly list: ItemStack[] = [];
  readonly capacity: number;
  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get used(): number {
    return this.list.reduce((s, st) => s + ITEMS[st.id].size * st.count, 0);
  }

  stacks(): readonly ItemStack[] {
    return this.list;
  }

  count(id: ItemId): number {
    return this.list.reduce((s, st) => (st.id === id ? s + st.count : s), 0);
  }

  room(id: ItemId): number {
    return Math.floor((this.capacity - this.used) / ITEMS[id].size);
  }

  add(id: ItemId, count = 1): number {
    const n = Math.min(count, this.room(id));
    let left = n;
    const max = ITEMS[id].stack;
    for (const st of this.list) {
      if (left <= 0) break;
      if (st.id !== id || st.count >= max) continue;
      const k = Math.min(left, max - st.count);
      st.count += k;
      left -= k;
    }
    while (left > 0) {
      const k = Math.min(left, max);
      this.list.push({ id, count: k });
      left -= k;
    }
    return n;
  }

  remove(id: ItemId, count = 1): number {
    let left = count;
    for (let i = this.list.length - 1; i >= 0 && left > 0; i--) {
      const st = this.list[i];
      if (st.id !== id) continue;
      const k = Math.min(left, st.count);
      st.count -= k;
      left -= k;
      if (st.count === 0) this.list.splice(i, 1);
    }
    return count - left;
  }

  serialize(): ItemStack[] {
    return this.list.map((s) => ({ ...s }));
  }

  deserialize(stacks: readonly ItemStack[]): void {
    this.list.length = 0;
    for (const s of stacks) if (s.id in ITEMS && s.count > 0) this.add(s.id, s.count);
  }
}

/** Worn gear: one item per slot; equipping moves it out of storage and back. */
export class Equipment {
  private readonly slots = new Map<EquipSlot, ItemId>();
  private readonly listeners = new Set<() => void>();
  private readonly storage: Storage;
  constructor(storage: Storage) {
    this.storage = storage;
  }

  get(slot: EquipSlot): ItemId | undefined {
    return this.slots.get(slot);
  }

  equipped(): ItemId[] {
    return [...this.slots.values()];
  }

  /** True if any equipped item carries the tag. */
  has(tag: ItemTag): boolean {
    for (const id of this.slots.values()) if ((ITEMS[id].tags as readonly ItemTag[]).includes(tag)) return true;
    return false;
  }

  /** Equip from storage (swapping whatever occupied the slot back into storage). */
  equip(id: ItemId): boolean {
    const slot = itemDef(id).slot;
    if (!slot || this.storage.count(id) === 0) return false;
    const cur = this.slots.get(slot);
    this.storage.remove(id, 1);
    if (cur) this.storage.add(cur, 1);
    this.slots.set(slot, id);
    this.emit();
    return true;
  }

  unequip(slot: EquipSlot): boolean {
    const cur = this.slots.get(slot);
    if (!cur || this.storage.room(cur) < 1) return false;
    this.slots.delete(slot);
    this.storage.add(cur, 1);
    this.emit();
    return true;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  serialize(): Partial<Record<EquipSlot, ItemId>> {
    return Object.fromEntries(this.slots) as Partial<Record<EquipSlot, ItemId>>;
  }

  deserialize(data: Partial<Record<EquipSlot, ItemId>>): void {
    this.slots.clear();
    for (const [slot, id] of Object.entries(data)) if (id && id in ITEMS) this.slots.set(slot as EquipSlot, id);
    this.emit();
  }

  private emit() {
    for (const fn of [...this.listeners]) fn();
  }
}
