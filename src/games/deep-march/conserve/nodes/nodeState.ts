/**
 * What is left of this generation's nodes: harvested ids (a bitset in the save)
 * and partly absorbed nodes (id → remaining). Everything else is full. Pure; the
 * particles themselves are only ever moved by the ledger (expedition/).
 */
import { decodeIdSet, encodeIdSet } from "./bitset";
import type { NodeSpec, NodeTable } from "./nodeTable";

export type NodeStateSave = { harvested: string; partial: [number, number][] };

export class NodeState {
  readonly table: NodeTable;
  private readonly harvested: Set<number>;
  private readonly partial: Map<number, number>;

  private constructor(table: NodeTable, harvested: Set<number>, partial: Map<number, number>) {
    this.table = table;
    this.harvested = harvested;
    this.partial = partial;
  }

  static fresh(table: NodeTable): NodeState {
    return new NodeState(table, new Set(), new Map());
  }

  /**
   * From the save: ids that are not nodes of this table, and partial entries that
   * are not 0 < remaining < amount, are dropped (counted in `dropped`).
   */
  static fromSave(table: NodeTable, save: NodeStateSave): { state: NodeState; dropped: number } {
    const ids = decodeIdSet(save.harvested) ?? new Set<number>();
    let dropped = 0;
    const harvested = new Set<number>();
    for (const id of ids) (table.byId.has(id) ? harvested.add(id) : dropped++);
    const partial = new Map<number, number>();
    for (const [id, left] of save.partial) {
      const spec = table.byId.get(id);
      const ok = spec && !harvested.has(id) && Number.isSafeInteger(left) && left > 0 && left < spec.amount && !partial.has(id);
      if (ok) partial.set(id, left);
      else dropped++;
    }
    return { state: new NodeState(table, harvested, partial), dropped };
  }

  spec(id: number): NodeSpec | undefined {
    return this.table.byId.get(id);
  }

  remaining(id: number): number {
    const spec = this.table.byId.get(id);
    if (!spec || this.harvested.has(id)) return 0;
    return this.partial.get(id) ?? spec.amount;
  }

  /** Remove `count` (≤ remaining) particles from node `id`; at 0 it is harvested. */
  take(id: number, count: number): void {
    const left = this.remaining(id);
    if (!(Number.isSafeInteger(count) && count >= 0 && count <= left)) throw new Error(`node ${id}: cannot take ${count} of ${left}`);
    if (count === 0) return;
    if (count === left) {
      this.partial.delete(id);
      this.harvested.add(id);
    } else this.partial.set(id, left - count);
  }

  harvestedCount(): number {
    return this.harvested.size;
  }

  /** Per site of the table (row-major): absorbed / initial node particles, 0 … 1 (0 for a site without nodes). */
  siteHarvest(): number[] {
    return this.table.sites.map((sn) => {
      let total = 0, left = 0;
      for (const n of sn.nodes) {
        total += n.amount;
        left += this.remaining(n.id);
      }
      return total > 0 ? (total - left) / total : 0;
    });
  }

  toSave(): NodeStateSave {
    const partial = [...this.partial.entries()].sort((a, b) => a[0] - b[0]).map(([id, left]): [number, number] => [id, left]);
    return { harvested: encodeIdSet(this.harvested), partial };
  }
}
