/** What opening the world save found — shown by the "world save" loading step. */
import type { PoolId } from "../ledger/pools";
import type { Repair } from "../save/reconcile";
import type { SiteSummary } from "../world/siteSummary";

export type OpenedReport = {
  kind: "created" | "continued";
  slotKey: string;
  version: number;
  /** Version the stored save had before migration (= version when none ran). */
  migratedFrom: number;
  seedText: string;
  gen: number;
  divesStarted: number;
  totalParticles: number;
  poolTotals: Record<PoolId, number>;
  conserved: boolean;
  repairs: Repair[];
  bytes: number;
  /** The generation's site table (biomes, bias range). */
  sites: SiteSummary;
};

export type BlockedReport = {
  /** unreadable: corrupt or from a newer build (kept, not overwritten) · ended: annihilated (read-only) · missing: nothing to continue. */
  kind: "unreadable" | "ended" | "missing";
  slotKey: string;
  reason: string;
};

export type OpenReport = OpenedReport | BlockedReport;

export function isOpened(report: OpenReport): report is OpenedReport {
  return report.kind === "created" || report.kind === "continued";
}
