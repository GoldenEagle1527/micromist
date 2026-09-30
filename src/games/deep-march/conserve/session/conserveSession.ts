/**
 * A world opened for a dive: the save header, the live ledger, the generation's
 * site table and ring wall, and the throttled writer. Every ledger transfer marks the save dirty;
 * close() writes what is left.
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

  /** The save as it would be written now. */
  snapshot(): WorldSave {
    return withLedger(this.header, this.ledger);
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
