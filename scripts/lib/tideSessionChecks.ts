/**
 * test:tide — the tide through the session (conserve/tide/controller.ts,
 * plan.ts, commit.ts): the plan equals the forecast, the ledger across the
 * tide (W = R', L = 0, extra → S, Σ = N), the lock, the save order and cold
 * starts, the dome's particle-ization, determinism, the frozen 3 × 3 kept.
 */
import { BASE } from "../../src/games/deep-march/conserve/config";
import { createMemoryBackend } from "../../src/games/deep-march/conserve/save/saveBackend";
import type { WorldSave } from "../../src/games/deep-march/conserve/save/schema";
import { openConserveSession } from "../../src/games/deep-march/conserve/session/openSession";
import { seedFromString } from "../../src/games/deep-march/terrain/noise";
import type { Checker } from "./checks";
import { coreXZ, MANUAL_CLOCK, runTide, tideRig } from "./tideFixture";

const NORMAL = { simple: false, lowMemory: false };
const stored = (b: ReturnType<typeof createMemoryBackend>) => b.read("save/main") as WorldSave;
const reopen = (b: ReturnType<typeof createMemoryBackend>) => openConserveSession({ backend: b, intent: { kind: "continue" }, hashSeed: seedFromString, clock: MANUAL_CLOCK });
const strip = (s: WorldSave) => ({ ...s, savedAt: 0, createdAt: 0 });

export function tideSessionChecks(c: Checker): void {
  c.section("the tide through the session: plan, lock, commit");
  {
    const { session: s, backend, N } = tideRig();
    const gen0 = s.gen;
    const energy0 = s.base.view().energy;
    const cache = s.expedition.loseCarried([100, -80, 100]);
    c.check(!!cache && s.ledger.poolTotal("lost") > 0, "setup: a lost cache in the world", `${s.ledger.poolTotal("lost")} particles`);
    const forecast = s.base.forecast();
    c.check(s.tide.call(NORMAL) && s.tide.active() && !s.tide.call(NORMAL), "唤潮 at a ready base starts the warning (once)");
    const plan = s.tide.pending!;
    c.check(plan.chaos.m === forecast.m && plan.chaos.stage === forecast.stage && plan.chaos.wallThickness === forecast.thickness, "the tide's chaos is exactly the forecast card's", `m ${plan.chaos.m.toFixed(4)}, stage ${plan.chaos.stage}, wall ${plan.chaos.wallThickness.toFixed(1)} m`);
    const R0 = plan.allocInput.slice();
    const node = s.siteTable.sites.map((x) => s.expedition.siteNodes(x.i)).find((ns) => ns.length > 0)![0];
    c.check(s.expedition.isLocked && s.expedition.absorb(node.id, 1).moved === 0 && s.expedition.retrieve(cache!.id, 1).moved === 0, "absorbing and retrieving are locked from the call");
    const released = s.base.release(0, 50);
    const warn = runTide(s, { until: (v) => v.events.includes("commit") });
    const cv = warn[warn.length - 1];
    const disk = stored(backend);
    c.check(warn.slice(0, -1).every((v) => v.state === "warning") && cv.state === "show" && disk.gen === gen0 + 1, "gen + 1 is on disk in the step that ends the warning, before the first show frame", `disk gen ${disk.gen}`);
    const L = s.ledger;
    c.check(L.pool("world").every((n, k) => n === R0[k]) && L.poolTotal("lost") === 0 && L.grandTotal() === N && L.isConserved(), "after the commit W = R' exactly, L = 0, Σ = N");
    c.check(released === 50 && L.pool("suspended")[0] === 50 && L.poolTotal("suspended") === 50, "放流 during the warning waits in S for the next tide", `S ${L.poolTotal("suspended")}`);
    c.check(disk.caches.length === 0 && disk.generation.harvested === "" && disk.generation.partial.length === 0 && disk.generation.dives === 0, "caches returned, harvest and departures start fresh");
    c.check(disk.base!.energy === Math.max(0, energy0 - BASE.tide.energy) && JSON.stringify(disk.chaos) === JSON.stringify(plan.chaos) && JSON.stringify(disk.generation.allocInput) === JSON.stringify(R0), "the base paid 150 energy; chaos and R' as planned");
    const t2 = s.siteTable;
    c.check(t2.gen === gen0 + 1 && t2.sites.filter((x) => x.frozen).length === 9 && JSON.stringify(t2.sites) === JSON.stringify(plan.table.sites), "the session plays gen + 1's table, its 9 frozen sites applied (the M5 follow-up)");
    c.check(s.expedition.isLocked && s.expedition.caches().length === 0, "the new generation's expedition stays locked during the show");
    const mid = reopen(backend);
    c.check(mid.ok && mid.session.gen === gen0 + 1 && mid.session.ledger.isConserved(), "closing during the show: a cold start is in gen + 1");
    const rest = runTide(s);
    c.check(rest[rest.length - 1].events.includes("done") && !s.tide.active() && !s.expedition.isLocked, "after the show the tide is idle and absorbing is back");
    c.check(s.tide.summary()?.gen === gen0 + 1 && (s.tide.summary()?.biomes.reduce((a, b) => a + b.sites, 0) ?? 0) === 100, "generation summary: gen, sites per biome", JSON.stringify(s.tide.summary()?.biomes.slice(0, 3)));
  }

  c.section("interruptions, particle-ization, determinism");
  {
    const { session: s, backend } = tideRig();
    const gen0 = s.gen, energy0 = s.base.view().energy;
    s.tide.call(NORMAL);
    runTide(s, { maxS: 30 });
    s.close();
    const r = reopen(backend);
    c.check(r.ok && r.session.gen === gen0 && Math.abs(r.session.base.view().energy - energy0) < 1 && r.session.base.tide().ready, "closed during the warning: still the old generation, energy kept, 唤潮 needed again");
  }
  {
    const { session: s, N } = tideRig();
    s.ledger.transferVector("world", "player", [37, 0, 5, 0, 0, 0, 0]);
    const carried = s.ledger.poolTotal("player");
    const S0 = s.ledger.poolTotal("suspended");
    s.tide.call(NORMAL);
    const core = coreXZ(s);
    const views = runTide(s, { diver: { x: core.x + 400, z: core.z } });
    const hit = views.find((v) => v.dissolved > 0);
    c.check(!!hit && hit.state === "show" && hit.phase === "inhale" && hit.dissolved === carried, "outside the dome when P1 begins: dissolved at once", `${hit?.dissolved} particles`);
    c.check(s.ledger.poolTotal("player") === 0 && s.ledger.poolTotal("suspended") === S0 + carried && s.ledger.poolTotal("lost") === 0 && s.expedition.caches().length === 0 && s.ledger.grandTotal() === N, "the tank joins gen + 1's suspended pool — no lost cache, Σ = N");
    const wake = views.filter((v) => v.wake);
    c.check(wake.length === 1 && wake[0].events.includes("done") && views.some((v) => v.fate === "gone"), "black, then awake once the tide is over");
    const edge = tideRig();
    edge.session.tide.call(NORMAL);
    const e = coreXZ(edge.session);
    const ev = runTide(edge.session, { diver: { x: e.x + BASE.radius - 2, z: e.z } });
    c.check(ev.every((v) => v.dissolved === 0 && v.fate === "free") && ev.some((v) => v.dome?.zone === "edge"), "near the edge but inside: warned, never taken");
  }
  {
    const a = tideRig("determinism"), b = tideRig("determinism");
    a.session.tide.call(NORMAL);
    b.session.tide.call(NORMAL);
    runTide(a.session);
    runTide(b.session);
    c.check(JSON.stringify(strip(stored(a.backend))) === JSON.stringify(strip(stored(b.backend))), "the same world and actions give the same gen + 1, bit for bit");
    c.check(stored(a.backend).gen === 2 && a.session.tide.call(NORMAL) === false, "the next tide needs a departure (and energy) again", JSON.stringify(a.session.base.tide()));
  }
}
