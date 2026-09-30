/**
 * Loading step "world save" (conserve mode only, first in the list): shows what
 * opening the save found. The save is opened before the world is built (the seed
 * comes from it), so the step is settled from the start: done, or error when the
 * save can't be entered (unreadable / annihilated / missing) — then no dive.
 */
import type { DiagEntry, LoadingLabels, LoadingStepDef, StepEval } from "../../ui/loading/steps/types";
import { BIOMES } from "../config";
import { POOL_IDS } from "../ledger/pools";
import { repairedParticles } from "../save/reconcile";
import { isOpened, type BlockedReport, type OpenReport, type OpenedReport } from "../session/openReport";

const groupDigits = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function openedLines(r: OpenedReport, L: LoadingLabels): string[] {
  const W = L.world;
  const head = r.kind === "created" ? W.created(r.seedText) : W.continued(r.seedText, r.gen, r.divesStarted);
  const ledger = r.conserved ? W.ledger(groupDigits(r.totalParticles)) : W.ledgerBroken;
  const moved = repairedParticles(r.repairs);
  const biomes = BIOMES.filter((b) => r.sites.byBiome[b] > 0).length;
  const sites = W.sites(r.sites.sitesX, r.sites.sitesZ, biomes);
  const s = r.wall.sigma;
  const wall = W.wall(Math.round(r.wall.thickness), s >= 1 ? "stable" : s > 0 ? "thinning" : "thinnest");
  return moved > 0 ? [head, ledger, W.repaired(groupDigits(moved)), sites, wall] : [head, ledger, sites, wall];
}

function openedDiag(r: OpenedReport, L: LoadingLabels): DiagEntry[] {
  const D = L.world.diag;
  const diag: DiagEntry[] = [
    { label: D.slot, value: r.slotKey },
    { label: D.format, value: D.formatValue(r.version, r.migratedFrom, (r.bytes / 1024).toFixed(1)) },
    { label: D.pools, value: POOL_IDS.map((id) => groupDigits(r.poolTotals[id])).join(" · ") },
    { label: D.biomes, value: BIOMES.map((b) => `${L.regionNames[b]} ${r.sites.byBiome[b]}`).join(" · ") },
    { label: D.bias, value: `${r.sites.deltaMin.toFixed(2)} … ${r.sites.deltaMax.toFixed(2)}` },
    { label: D.wall, value: `m ${r.wall.m.toFixed(4)} · σ ${r.wall.sigma.toFixed(2)} · ${r.wall.thickness.toFixed(1)} m` },
    { label: D.chaos, value: `${r.chaos.stage} · ${r.chaos.open} · ${r.chaos.scars}` },
  ];
  if (r.repairs.length > 0) diag.push({ label: D.repairs, value: r.repairs.map((x) => `${x.pool}.${x.type} ${x.delta > 0 ? "+" : ""}${x.delta} (${x.cause})`).join(", ") });
  return diag;
}

function blockedEval(r: BlockedReport, L: LoadingLabels): StepEval {
  const W = L.world;
  const line = r.kind === "ended" ? W.ended : r.kind === "missing" ? W.missing : W.unreadable;
  return { state: "error", lines: [line], diag: [{ label: W.diag.slot, value: r.slotKey }, { label: W.diag.reason, value: r.reason }] };
}

export function createWorldSaveStep(report: OpenReport): LoadingStepDef {
  return {
    id: "worldSave",
    weight: 2,
    required: true,
    evaluate(_snap, { L }) {
      if (!isOpened(report)) return blockedEval(report, L);
      return { state: report.conserved ? "done" : "error", lines: openedLines(report, L), diag: openedDiag(report, L) };
    },
  };
}

/** The dive's step list in conserve mode: the world save first, then the shared steps. */
export function withWorldSaveStep(steps: readonly LoadingStepDef[], report: OpenReport): readonly LoadingStepDef[] {
  return [createWorldSaveStep(report), ...steps];
}
