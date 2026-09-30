/**
 * A world ready for its first tide (plan M7 tests): a new session (memory
 * backend), the core founded on an accepted spot (the frozen-zone check passes),
 * an energy tower, energy ticked past 150, one departure. Plus a stepping helper.
 */
import { BASE } from "../../src/games/deep-march/conserve/config";
import { createMemoryBackend, type SaveBackend } from "../../src/games/deep-march/conserve/save/saveBackend";
import { openConserveSession } from "../../src/games/deep-march/conserve/session/openSession";
import type { ConserveSession } from "../../src/games/deep-march/conserve/session/conserveSession";
import type { TideView } from "../../src/games/deep-march/conserve/tide/port";
import { terrainLayoutOf } from "../../src/games/deep-march/conserve/platform/terrainLayout";
import type { SiteTable } from "../../src/games/deep-march/conserve/world/siteTable";
import { TERRAIN } from "../../src/games/deep-march/terrain/config";
import { checkFrozenZone, frozenCellsAt } from "../../src/games/deep-march/terrain/frozenZone";
import { seedFromString } from "../../src/games/deep-march/terrain/noise";
import { createRegionField, MACRO, scaleRegionField } from "../../src/games/deep-march/terrain/regions";
import { RECT } from "./baseFixture";

const S = TERRAIN.worldScale;
const G = MACRO.cell * S;

/** The accepted core spot nearest the world centre (grid step 104 m), and its site. */
export function acceptedSpot(table: SiteTable): { x: number; z: number; site: number } {
  const regions = scaleRegionField(createRegionField(table.seed, terrainLayoutOf(table)), S);
  const lim = 2080 - BASE.wallClearance - 20;
  let best: { x: number; z: number; site: number } | null = null;
  for (let x = -lim; x <= lim; x += 104) {
    for (let z = -lim; z <= lim; z += 104) {
      if (best && Math.hypot(x, z) >= Math.hypot(best.x, best.z)) continue;
      const frozen = frozenCellsAt(regions, x, z, S);
      if (!checkFrozenZone(regions, { x, z, radius: BASE.radiusMax, frozen, worldScale: S }).ok) continue;
      const ix = Math.floor(x / G) + table.sitesX / 2, iz = Math.floor(z / G) + table.sitesZ / 2;
      best = { x, z, site: iz * table.sitesX + ix };
    }
  }
  if (!best) throw new Error("fixture: no accepted core spot");
  return best;
}

/** No timers: the throttled writer never schedules (tests write through commits, flush and close). */
export const MANUAL_CLOCK = { now: () => 1_000, setTimeout: () => 0, clearTimeout: () => {} };

export type TideRig = { session: ConserveSession; backend: SaveBackend; spot: { x: number; z: number; site: number }; N: number };

export function tideRig(seedText = "abyss", backend: SaveBackend = createMemoryBackend()): TideRig {
  const opened = openConserveSession({ backend, intent: { kind: "new", seedText }, hashSeed: seedFromString, clock: MANUAL_CLOCK });
  if (!opened.ok) throw new Error("fixture session");
  const session = opened.session;
  const spot = acceptedSpot(session.siteTable);
  const base = session.base;
  const founded = base.found([spot.x, -100, spot.z], 0, spot.site, RECT);
  if (!founded.ok) throw new Error(`fixture: founding failed (${founded.reason})`);
  session.ledger.transferVector("world", "player", [400, 0, 60, 120, 0, 0, 0]);
  const tower = base.build("energy", [spot.x + 20, -100, spot.z], 0, RECT);
  if (!tower.ok) throw new Error(`fixture: tower failed (${tower.reason})`);
  base.tick(260);
  base.recordDeparture();
  if (!base.tide().ready) throw new Error("fixture: tide not ready");
  return { session, backend, spot, N: session.ledger.grandTotal() };
}

export type StepOptions = { dt?: number; nextReady?: boolean | ((t: number) => boolean); frameMs?: number; diver?: { x: number; z: number }; contextLost?: boolean };

export function coreXZ(session: ConserveSession): { x: number; z: number } {
  const c = session.base.view().center!;
  return { x: c[0], z: c[2] };
}

/** Step the session's tide until `until(view)` or `maxS` seconds; returns every view. */
export function runTide(session: ConserveSession, o: StepOptions & { until?: (v: TideView) => boolean; maxS?: number } = {}): TideView[] {
  const dt = o.dt ?? 0.25;
  const out: TideView[] = [];
  const at = o.diver ?? coreXZ(session);
  for (let t = 0; t <= (o.maxS ?? 200); t += dt) {
    const ready = typeof o.nextReady === "function" ? o.nextReady(t) : o.nextReady ?? true;
    const v = session.tide.step({ dt, nextReady: ready, frameMs: o.frameMs ?? 16, contextLost: o.contextLost ?? false, diver: at });
    out.push(v);
    if (o.until?.(v) || v.events.includes("done")) break;
  }
  return out;
}
