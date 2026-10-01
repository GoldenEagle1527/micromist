/**
 * A world opened for a dive: the save header, the live ledger, the generation's
 * site table, ring wall, resource nodes, expedition (absorbing, lost caches) and
 * base (buildings, storage, energy), the tide, the gaze (stage 5) and the throttled writer. Every ledger transfer
 * marks the save dirty; a death writes at once; close() writes what is left; after 湮灭 nothing is written again.
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
import { wallStateOfChaos, type WallState } from "../chaos/wallModel";
import type { ChaosState } from "../chaos/model";
import { buildNodeTable, type NodeTable } from "../nodes/nodeTable";
import { NodeState } from "../nodes/nodeState";
import { Expedition } from "../expedition/expedition";
import { Base } from "../base/base";
import { TideController } from "../tide/controller";
import { GazeController } from "../gaze/controller";
import { annihilatedSave } from "../gaze/annihilate";
import { gazeHostOf, tideHostOf } from "./sessionHosts";
import type { OpenedReport } from "./openReport";

/** rehearsal: the debug panel's 结局演练 sandbox (an in-memory backend, session/rehearsal.ts). */
export type SessionDeps = { backend: SaveBackend; clock?: WriterClock; throttleMs?: number; rehearsal?: boolean };

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
  private home: Base | null = null;
  private tides: TideController | null = null;
  private gazes: GazeController | null = null;
  private expeditionLocked = false;
  private ended = false;
  private readonly rehearsal: boolean;

  /** report: built from the site table (so the table is computed once, at open). */
  constructor(save: WorldSave, ledger: ParticleLedger, report: (table: SiteTable) => OpenedReport, deps: SessionDeps) {
    this.header = save;
    this.ledger = ledger;
    this.report = report(this.siteTable);
    this.backend = deps.backend;
    this.clock = deps.clock ?? systemClock;
    this.rehearsal = deps.rehearsal ?? false;
    this.writer = createSaveWriter(() => this.writeNow(), deps.throttleMs ?? SAVE.throttleMs, this.clock);
    this.unsubscribe = ledger.onTransfer(() => this.writer.markDirty());
  }

  get seedText(): string { return this.header.seedText; }

  /** Slot id and creation time: with the seed, what names this world (e.g. its sonar scan record). */
  get identity(): { id: string; createdAt: number; seed: number } {
    return { id: this.header.id, createdAt: this.header.createdAt, seed: this.header.seed };
  }

  get seed(): number { return this.header.seed; }

  get gen(): number { return this.header.gen; }

  /**
   * This generation's site table: (seed, gen, R, frozen) → sites; fixed until the
   * next tide. The base's frozen sites count from the generation after its
   * founding (the founding one keeps the table it was played with, D2).
   */
  get siteTable(): SiteTable {
    const h = this.header;
    const frozen = h.base && h.base.foundedGen < h.gen ? h.base.frozen : undefined;
    this.table ??= buildSiteTable({ seed: h.seed, gen: h.gen, allocInput: h.generation.allocInput, totals: h.totals, size: h.size, frozen });
    return this.table;
  }

  /** This generation's chaos (m, stage, wall thickness, cracks): set at the tide, fixed until the next. */
  get chaos(): ChaosState { return this.header.chaos; }

  /** This generation's ring wall, from its chaos (thickness, open cracks). */
  get wall(): WallState { return wallStateOfChaos(this.header.chaos); }

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
      this.exp.lock(this.expeditionLocked);
    }
    return this.exp;
  }

  /** The base (built or not yet), created once from the save. */
  get base(): Base {
    if (!this.home) {
      const h = this.header;
      this.home = new Base({
        ledger: this.ledger, save: h.base, table: this.siteTable, gen: h.gen, dives: h.generation.dives, totals: h.totals,
        chaos: { now: () => this.header.chaos, seed: h.seed, size: h.size, siteHarvest: () => this.expedition.siteHarvest() },
        onCommit: () => this.writer.flush(),
        onDirty: () => this.writer.markDirty(),
        onDive: () => this.countDive(),
        gaze: { seal: () => this.gaze.sealState(), damage: (id) => this.gaze.damage(id) },
      });
    }
    return this.home;
  }

  /** The tide (M7): created once; it replaces this session's generation at its commit (advance). */
  get tide(): TideController {
    this.tides ??= new TideController(tideHostOf(this, (on) => this.lockExpedition(on), (next) => this.advance(next)));
    return this.tides;
  }

  private lockExpedition(on: boolean): void { this.expeditionLocked = on; this.exp?.lock(on); }

  /** Stage 5 (直视): the gaze's sequence, created once (idle while the generation has no gaze). */
  get gaze(): GazeController {
    this.gazes ??= new GazeController(gazeHostOf({ ledger: this.ledger, header: () => this.header, base: () => this.base, markDirty: () => this.writer.markDirty(), flush: () => this.writer.flush(), annihilate: () => this.annihilate(), rehearsal: this.rehearsal }));
    return this.gazes;
  }

  /** 湮灭: the final save (gen + 1, everything back in the world, read-only), written once; the session is over. */
  private annihilate(): void {
    if (this.ended) return;
    writeSlot(this.backend, { ...annihilatedSave(this.snapshot()), savedAt: this.clock.now() });
    this.ended = true;
  }

  /**
   * The tide's commit: gen + 1 becomes the save; the site table, nodes, expedition
   * and base are rebuilt from it on next use (the old objects must not be used
   * again); written at once, before the show.
   */
  private advance(next: WorldSave): void {
    this.header = { ...next, savedAt: this.clock.now() };
    this.table = this.nodes = null;
    this.exp = null;
    this.home = null;
    writeSlot(this.backend, this.snapshot());
  }

  /** The save as it would be written now. */
  snapshot(): WorldSave {
    const save = withLedger(this.header, this.ledger);
    const generation = { ...save.generation, dives: this.base.departures };
    if (!this.exp) return { ...save, generation, base: this.base.toSave() };
    const { harvested, partial, caches } = this.exp.toSave();
    return { ...save, generation: { ...generation, harvested, partial }, caches, base: this.base.toSave() };
  }

  /**
   * The loading screen finished and the dive began: a dive from the lander
   * while there is no base; with one, a dive starts when the diver leaves the
   * protection radius (BasePort.recordDeparture).
   */
  recordDiveStart(): void {
    this.base.recordLanderDive();
  }

  private countDive(): void {
    this.header = { ...this.header, stats: { ...this.header.stats, divesStarted: this.header.stats.divesStarted + 1 } };
    this.writer.markDirty();
  }

  flush(): void { this.writer.flush(); }

  /** Leaving the dive: write pending changes, stop listening. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.writer.flush();
    this.writer.dispose();
    this.unsubscribe();
  }

  private writeNow(): void {
    if (this.ended) return;
    this.header = { ...this.header, savedAt: this.clock.now() };
    writeSlot(this.backend, this.snapshot());
  }
}
