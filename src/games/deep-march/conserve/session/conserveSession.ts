/**
 * A world opened for a dive: the save header, the live ledger, the generation's
 * site table, ring wall, resource nodes and expedition (absorbing, lost caches),
 * and the throttled writer. Every ledger transfer marks the save dirty; a death
 * writes at once; close() writes what is left.
 * No rendering, no DOM (the page lifecycle binding lives in platform/pageLifecycle.ts).
 */
import { SAVE } from "../config";
import type { ParticleLedger } from "../ledger/particleLedger";
import { withLedger } from "../save/saveLedger";
import type { SaveBackend } from "../save/saveBackend";
import { writeSlot } from "../save/saveRepository";
import { createSaveWriter, systemClock, type SaveWriter, type WriterClock } from "../save/saveWriter";
import type { WorldSave } from "../save/schema";
import { buildSiteTable, type SiteTable } from "../world/siteTable";
import { wallStateOf, type WallState } from "../chaos/wallModel";
import { buildNodeTable, type NodeTable } from "../nodes/nodeTable";
import { NodeState } from "../nodes/nodeState";
import { Expedition } from "../expedition/expedition";
import type { OpenedReport } from "./openReport";

export type SessionDeps = { backend: SaveBackend; clock?: WriterClock; throttleMs?: number };

export class ConserveSession {
  readonly report: OpenedReport;
  readonly ledger: ParticleLedger;
  private header: WorldSave;
  private readonly backend: SaveBackend;
  private readonly clock: WriterClock;
  private readonly writer: SaveWriter;
  private readonly unsubscribe: () => void;
  private closed = false;
  private table: SiteTable | null = null;
  private nodes: NodeTable | null = null;
  private exp: Expedition | null = null;

  /** report: built from the site table (so the table is computed once, at open). */
  constructor(save: WorldSave, ledger: ParticleLedger, report: (table: SiteTable) => OpenedReport, deps: SessionDeps) {
    this.header = save;
    this.ledger = ledger;
    this.report = report(this.siteTable);
    this.backend = deps.backend;
    this.clock = deps.clock ?? systemClock;
    this.writer = createSaveWriter(() => this.writeNow(), deps.throttleMs ?? SAVE.throttleMs, this.clock);
    this.unsubscribe = ledger.onTransfer(() => this.writer.markDirty());
  }

  get seedText(): string {
    return this.header.seedText;
  }

  get seed(): number {
    return this.header.seed;
  }

  get gen(): number {
    return this.header.gen;
  }

  /** This generation's site table: (seed, gen, R) → sites; fixed until the next tide. */
  get siteTable(): SiteTable {
    const h = this.header;
    this.table ??= buildSiteTable({ seed: h.seed, gen: h.gen, allocInput: h.generation.allocInput, totals: h.totals, size: h.size });
    return this.table;
  }

  /** This generation's ring wall (thickness from m = Σ R / Σ N; cracks from M6). */
  get wall(): WallState {
    return wallStateOf(this.header.generation.allocInput, this.header.totals);
  }

  /** This generation's resource nodes (from the site table's node shares). */
  get nodeTable(): NodeTable {
    this.nodes ??= buildNodeTable(this.siteTable);
    return this.nodes;
  }

  /** The dive's expedition rules (nodes left, tank, lost caches), created once from the save. */
  get expedition(): Expedition {
    if (!this.exp) {
      const h = this.header;
      const { state } = NodeState.fromSave(this.nodeTable, h.generation);
      this.exp = new Expedition({ ledger: this.ledger, nodes: state, caches: h.caches, gen: h.gen, sitesX: h.size.sitesX, sitesZ: h.size.sitesZ, onLoss: () => this.writer.flush() });
    }
    return this.exp;
  }

  /** The save as it would be written now. */
  snapshot(): WorldSave {
    const save = withLedger(this.header, this.ledger);
    if (!this.exp) return save;
    const { harvested, partial, caches } = this.exp.toSave();
    return { ...save, generation: { ...save.generation, harvested, partial }, caches };
  }

  /** The loading screen finished and the dive began. */
  recordDiveStart(): void {
    this.header = { ...this.header, stats: { ...this.header.stats, divesStarted: this.header.stats.divesStarted + 1 } };
    this.writer.markDirty();
  }

  flush(): void {
    this.writer.flush();
  }

  /** Leaving the dive: write pending changes, stop listening. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.writer.flush();
    this.writer.dispose();
    this.unsubscribe();
  }

  private writeNow(): void {
    this.header = { ...this.header, savedAt: this.clock.now() };
    writeSlot(this.backend, this.snapshot());
  }
}
