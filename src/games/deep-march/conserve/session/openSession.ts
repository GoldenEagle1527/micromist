/**
 * Open the world save for a dive: continue the stored world or create a new one.
 *   continue → read the slot (migrate, validate, reconcile); a repaired or
 *              migrated save is written back at once; an annihilated one is
 *              refused (read-only, D14); an unreadable one is kept untouched.
 *   new      → genesis from the typed seed, written at once (replaces the slot).
 */
import { SAVE } from "../config";
import { POOL_IDS, type PoolId } from "../ledger/pools";
import type { ParticleLedger } from "../ledger/particleLedger";
import { createWorldSave } from "../save/createSave";
import type { Repair } from "../save/reconcile";
import type { SaveBackend } from "../save/saveBackend";
import { ledgerOf } from "../save/saveLedger";
import { readSlot, saveBytes, slotKey, writeSlot } from "../save/saveRepository";
import { systemClock, type WriterClock } from "../save/saveWriter";
import { SAVE_VERSION, isReadOnlySave, type WorldSave } from "../save/schema";
import { ConserveSession } from "./conserveSession";
import type { BlockedReport, OpenedReport } from "./openReport";

export type OpenIntent = { kind: "continue" } | { kind: "new"; seedText: string };

export type OpenOptions = {
  backend: SaveBackend;
  intent: OpenIntent;
  /** Seed text → terrain seed (the game passes terrain/noise seedFromString). */
  hashSeed: (seedText: string) => number;
  slotId?: string;
  clock?: WriterClock;
  throttleMs?: number;
};

export type OpenOutcome = { ok: true; session: ConserveSession } | { ok: false; report: BlockedReport };

function poolTotalsOf(ledger: ParticleLedger): Record<PoolId, number> {
  const out = {} as Record<PoolId, number>;
  for (const id of POOL_IDS) out[id] = ledger.poolTotal(id);
  return out;
}

function openedReport(kind: OpenedReport["kind"], save: WorldSave, ledger: ParticleLedger, repairs: Repair[], migratedFrom: number): OpenedReport {
  return {
    kind,
    slotKey: slotKey(save.id),
    version: SAVE_VERSION,
    migratedFrom,
    seedText: save.seedText,
    gen: save.gen,
    divesStarted: save.stats.divesStarted,
    totalParticles: ledger.grandTotal(),
    poolTotals: poolTotalsOf(ledger),
    conserved: ledger.isConserved(),
    repairs,
    bytes: saveBytes(save),
  };
}

function blocked(kind: BlockedReport["kind"], slotId: string, reason: string): OpenOutcome {
  return { ok: false, report: { kind, slotKey: slotKey(slotId), reason } };
}

function startSession(save: WorldSave, report: (ledger: ParticleLedger) => OpenedReport, opts: OpenOptions): OpenOutcome {
  const ledger = ledgerOf(save);
  const session = new ConserveSession(save, ledger, report(ledger), opts);
  return { ok: true, session };
}

function createNew(seedText: string, slotId: string, opts: OpenOptions): OpenOutcome {
  const now = (opts.clock ?? systemClock).now();
  const save = createWorldSave({ id: slotId, seedText, seed: opts.hashSeed(seedText), now });
  writeSlot(opts.backend, save);
  return startSession(save, (ledger) => openedReport("created", save, ledger, [], SAVE_VERSION), opts);
}

function continueStored(slotId: string, opts: OpenOptions): OpenOutcome {
  const read = readSlot(opts.backend, slotId);
  if (read.status === "empty") return blocked("missing", slotId, "no save in this slot");
  if (read.status === "unreadable") return blocked("unreadable", slotId, read.reason);
  if (isReadOnlySave(read.save)) return blocked("ended", slotId, "annihilated");
  if (read.repairs.length > 0 || read.migratedFrom !== SAVE_VERSION) writeSlot(opts.backend, read.save);
  return startSession(read.save, (ledger) => openedReport("continued", read.save, ledger, read.repairs, read.migratedFrom), opts);
}

export function openConserveSession(opts: OpenOptions): OpenOutcome {
  const slotId = opts.slotId ?? SAVE.slotId;
  return opts.intent.kind === "new" ? createNew(opts.intent.seedText, slotId, opts) : continueStored(slotId, opts);
}
