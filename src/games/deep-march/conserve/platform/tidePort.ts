/**
 * The tide as the scene drives it (plan M7): the session's TideController plus
 * what the terrain needs of gen + 1 — its explicit site layout (built from the
 * plan's site table and chaos, terrainLayout.ts) and chaos view (M8) — and,
 * after the commit, the new generation's expedition and base. Type-only import of the terrain.
 */
import type { SiteLayout } from "../../terrain/siteLayout";
import type { BasePort } from "../base/port";
import { chaosViewOf, type ChaosView } from "../chaos/view";
import { wallStateOfChaos } from "../chaos/wallModel";
import type { ExpeditionPort } from "../expedition/port";
import type { ConserveSession } from "../session/conserveSession";
import { phaseStarts, TIDE, type TidePhase } from "../tide/config";
import type { TideControlPort } from "../tide/port";
import { terrainLayoutOf } from "./terrainLayout";

/** When each show phase starts and how long it lasts (s): the particles follow the front's clock. */
export type TideTimeline = { starts: Readonly<Record<TidePhase, number>>; lengths: Readonly<Record<TidePhase, number>>; total: number };

export type TidePort = TideControlPort & {
  readonly timeline: TideTimeline;
  /** navigator.deviceMemory at or below this (GB): the murk from the start. */
  readonly lowMemoryGB: number;
  /** gen + 1's site layout while a tide runs (for the precompute), else null. */
  nextLayout(): SiteLayout | null;
  /** gen + 1's chaos as the scene draws it (M8: its seabed program, effects after the switch), else null. */
  nextChaos(): ChaosView | null;
  /** The generation's expedition and base now (new objects after a commit). */
  ports(): { expedition: ExpeditionPort; base: BasePort };
};

export function tidePortOf(session: ConserveSession): TidePort {
  const tide = session.tide;
  let layout: { plan: object; layout: SiteLayout } | null = null;
  const { starts, total } = phaseStarts();
  return {
    timeline: { starts, lengths: TIDE.phaseS, total },
    lowMemoryGB: TIDE.lowMemoryGB,
    readiness: () => tide.readiness(),
    active: () => tide.active(),
    call: (o) => tide.call(o),
    step: (i) => tide.step(i),
    summary: () => tide.summary(),
    nextLayout: () => {
      const plan = tide.pending;
      if (!plan) return null;
      if (layout?.plan !== plan) layout = { plan, layout: terrainLayoutOf(plan.table, wallStateOfChaos(plan.chaos)) };
      return layout.layout;
    },
    nextChaos: () => {
      const plan = tide.pending;
      return plan ? chaosViewOf(plan.chaos, { sitesX: plan.table.sitesX, sitesZ: plan.table.sitesZ }) : null;
    },
    ports: () => ({ expedition: session.expedition, base: session.base }),
  };
}
