/** Mapping between a save's ledger fields and the ParticleLedger. */
import { ParticleLedger, type LedgerState } from "../ledger/particleLedger";
import type { WorldSave } from "./schema";

export function ledgerStateOf(save: WorldSave): LedgerState {
  return { totals: save.totals, pools: save.ledger };
}

export function ledgerOf(save: WorldSave): ParticleLedger {
  return ParticleLedger.fromState(ledgerStateOf(save));
}

/** The save with the ledger's current contents. */
export function withLedger(save: WorldSave, ledger: ParticleLedger): WorldSave {
  const state = ledger.toState();
  return { ...save, totals: state.totals, ledger: state.pools };
}
