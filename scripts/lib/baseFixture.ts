/** A genesis world with its base for the base tests: ledger, site table, Base, the world rectangle. */
import { Base } from "../../src/games/deep-march/conserve/base/base";
import type { BaseSave } from "../../src/games/deep-march/conserve/base/baseState";
import type { WorldRect } from "../../src/games/deep-march/conserve/base/placementRules";
import type { ParticleLedger } from "../../src/games/deep-march/conserve/ledger/particleLedger";
import { createGenesisLedger } from "../../src/games/deep-march/conserve/world/genesis";
import type { SiteTable } from "../../src/games/deep-march/conserve/world/siteTable";
import { genesisTable } from "./worldFixture";

/** 10 × 10 sites of 416 m (MACRO.cell 104 × world scale 4), centred on the origin. */
export const RECT: WorldRect = { minX: -2080, maxX: 2080, minZ: -2080, maxZ: 2080 };
/** The site under (0, 0): cell 0 − cx0 (−5) = 5 in x and z. */
export const CENTRE_SITE = 55;

export type BaseRig = { ledger: ParticleLedger; table: SiteTable; base: Base; N: number; counts: { commits: number; dives: number } };

export function baseRig(seed = 42, save: BaseSave | null = null, ledger: ParticleLedger = createGenesisLedger()): BaseRig {
  const table = genesisTable(seed);
  const counts = { commits: 0, dives: 0 };
  const base = new Base({ ledger, save, table, gen: 1, dives: 0, totals: ledger.toState().totals, onCommit: () => counts.commits++, onDive: () => counts.dives++ });
  return { ledger, table, base, N: ledger.grandTotal(), counts };
}

/** Founded at the origin (ground y = −100). */
export function foundedRig(seed = 42): BaseRig {
  const rig = baseRig(seed);
  const r = rig.base.found([0, -100, 0], 0, CENTRE_SITE, RECT);
  if (!r.ok) throw new Error(`fixture: founding failed (${r.reason})`);
  return rig;
}

/** B holds exactly what the base locks (storage + buildings + frozen rock). */
export function lockedMatches(rig: BaseRig): boolean {
  const s = rig.base.toSave();
  if (!s) return true;
  const pool = rig.ledger.pool("base");
  const built = rig.base.view().buildings.reduce((acc, b) => acc.map((n, k) => n + rig.base.info(b.kind).cost[k]), pool.map(() => 0));
  return pool.every((n, k) => n === s.storage[k] + built[k] + s.frozenLocked[k]);
}
