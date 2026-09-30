/**
 * test:nodes — the expedition's scene rules without a renderer
 * (scene/expedition/interaction.ts, recall.ts, beacon.ts, telemetry.ts) on a
 * real Expedition + ledger and the survival ResourceSystem: aim, hold-to-absorb
 * into the tank (W → P), the full-tank and flat-battery blocks, the battery
 * drain, the recall's timing and its loss (P → L), retrieving the cache
 * (L → P), the beacon's tick timing and gain; Σ pools = N after every step.
 */
import { Expedition } from "../../src/games/deep-march/conserve/expedition/expedition";
import { NodeState } from "../../src/games/deep-march/conserve/nodes/nodeState";
import { buildNodeTable } from "../../src/games/deep-march/conserve/nodes/nodeTable";
import { createGenesisLedger } from "../../src/games/deep-march/conserve/world/genesis";
import { CacheBeacon, cachePhase } from "../../src/games/deep-march/scene/expedition/beacon";
import { ABSORB, BEACON, RECALL } from "../../src/games/deep-march/scene/expedition/config";
import { AbsorbInteraction, type AimItem } from "../../src/games/deep-march/scene/expedition/interaction";
import { RecallSequence } from "../../src/games/deep-march/scene/expedition/recall";
import { nodeKey, cacheKey } from "../../src/games/deep-march/scene/expedition/selection";
import { bearingDeg, relativeDeg } from "../../src/games/deep-march/scene/expedition/telemetry";
import { ResourceSystem, SURVIVAL_TUNING } from "../../src/games/deep-march/survival";
import type { Checker } from "./checks";
import { genesisTable } from "./worldFixture";

const DT = 1 / 30;
const EYE: [number, number, number] = [0, 0, 0];
const FWD: [number, number, number] = [0, 0, -1];

function rig() {
  const ledger = createGenesisLedger();
  const N = ledger.grandTotal();
  const exp = new Expedition({ ledger, nodes: NodeState.fresh(buildNodeTable(genesisTable(42))), caches: [], gen: 1, sitesX: 10, sitesZ: 10 });
  const res = new ResourceSystem();
  res.register({ id: "battery", capacity: 100 });
  const ia = new AbsorbInteraction(exp, res);
  const nodes = Array.from({ length: 100 }, (_, s) => exp.siteNodes(s)).flat();
  const at = (i: number, z: number): AimItem => ({ key: nodeKey(nodes[i].id), kind: "node", id: nodes[i].id, node: nodes[i], x: 0, y: 0, z });
  return { ledger, N, exp, res, ia, nodes, at };
}

export function interactionChecks(c: Checker): void {
  c.section("absorbing, recall, beacon (scene rules, no renderer)");
  {
    const { ledger, N, exp, res, ia, nodes, at } = rig();
    const item = at(0, -2);
    c.check(ia.update(DT, [at(0, 3)], EYE, FWD, true, true) === null && ia.current().target === null, "a node behind the diver is not a target");
    c.check(ia.update(DT, [at(0, -(ABSORB.reach + 1))], EYE, FWD, true, true) === null && ia.current().target === null, "beyond reach: no target");
    ia.update(DT, [item], EYE, FWD, false, true);
    c.check(ia.current().target?.id === nodes[0].id && !ia.current().absorbing, "aimed node is the target (not held: nothing moves)", `${nodes[0].amount} particles`);
    let events: string[] = [];
    let t = 0;
    for (; t < 3 && ia.current().target !== null; t += DT) {
      const ev = ia.update(DT, [item], EYE, FWD, true, true);
      if (ev) events.push(ev);
      res.tick(DT);
      if (!ledger.isConserved() || ledger.grandTotal() !== N) break;
    }
    c.check(exp.remaining(nodes[0].id) === 0 && exp.carried() === nodes[0].amount && ledger.isConserved() && ledger.grandTotal() === N, "hold: the whole node flows into the tank (W → P), Σ = N every frame", `${t.toFixed(2)} s, events ${events.join(",")}`);
    c.check(events[0] === "start" && events.includes("emptied"), "cues: start, emptied");
    const drained = 100 - res.value("battery");
    c.check(Math.abs(drained - SURVIVAL_TUNING.actions.absorb * (t - DT)) < 0.1, "battery drains actions.absorb per second while particles flow", `${drained.toFixed(2)} charge`);
    ia.update(DT, [], EYE, FWD, false, true);
    c.check(res.view("battery").drain === 0, "released: the drain is removed");
    // fill the tank to the brim, then a full-tank block
    let k = 1;
    events = [];
    while (exp.carried() < exp.tankCapacity && k < nodes.length) {
      const it = at(k, -2);
      for (let i = 0; i < 200 && exp.remaining(nodes[k].id) > 0 && exp.carried() < exp.tankCapacity; i++) {
        const ev = ia.update(DT, [it], EYE, FWD, true, true);
        if (ev) events.push(ev);
      }
      k++;
    }
    const full = exp.carried();
    const partial = at(k - 1, -2);
    const ev = exp.remaining(nodes[k - 1].id) > 0 ? ia.update(DT, [partial], EYE, FWD, true, true) : ia.update(DT, [at(k, -2)], EYE, FWD, true, true);
    c.check(full === exp.tankCapacity && exp.carried() === full && (ev === "full" || ia.current().blocked === "full") && res.view("battery").drain === 0, "tank full at capacity: blocked 'full', nothing moves, no drain", `${full}/${exp.tankCapacity}`);
    c.check(ledger.isConserved() && ledger.grandTotal() === N, "Σ = N with a full tank");
    // flat battery
    const r2 = rig();
    r2.res.add("battery", -100);
    const e2 = r2.ia.update(DT, [r2.at(0, -2)], EYE, FWD, true, true);
    c.check(e2 === "battery" && r2.exp.carried() === 0 && r2.ia.current().blocked === "battery", "flat battery: blocked 'battery', nothing moves");
    c.check(r2.ia.update(DT, [r2.at(0, -2)], EYE, FWD, true, false) === null && r2.ia.current().target === null, "disabled (loading / black screen): no target");
    // recall: loss and retrieval
    const lost = exp.loseCarried([5, -3, 2]);
    c.check(!!lost && lost.total === full && exp.carried() === 0 && ledger.poolTotal("lost") === full && ledger.isConserved() && ledger.grandTotal() === N, "recall: the tank becomes a lost cache (P → L), Σ = N", `${lost?.total}`);
    const cItem: AimItem = { key: cacheKey(lost!.id), kind: "cache", id: lost!.id, x: 0, y: 0, z: -2 };
    let secs = 0;
    for (; secs < 10 && exp.caches().length > 0; secs += DT) ia.update(DT, [cItem], EYE, FWD, true, true);
    c.check(exp.caches().length === 0 && exp.carried() === full && ledger.poolTotal("lost") === 0 && ledger.isConserved() && ledger.grandTotal() === N, "hold on the cache: everything back into the tank (L → P), cache gone", `${secs.toFixed(1)} s`);
    ia.dispose();
  }
  {
    const r = new RecallSequence();
    let fired = 0;
    const run = (secs: number, hold: boolean) => {
      for (let t = 0; t < secs - 1e-9; t += DT) r.update(DT, hold, true, () => fired++);
    };
    run(RECALL.holdSeconds - 0.2, true);
    run(0.1, false);
    c.check(r.current() === "idle" && fired === 0, "recall released early: nothing happens");
    run(RECALL.holdSeconds + 0.05, true);
    c.check(r.current() === "out" && fired === 0 && r.busy(), "held for holdSeconds: the screen fades out");
    run(RECALL.fadeOut + 0.05, true);
    c.check(fired === 1 && r.blackout() === 1, "in the dark: the beacon fires once");
    run(RECALL.hold + RECALL.fadeIn + 0.1, true);
    c.check(fired === 1 && (r.current() === "idle" || r.current() === "holding") && r.blackout() === 0, "fades back in; fired exactly once", `${fired}`);
  }
  {
    const b = new CacheBeacon();
    const caches = [
      { id: 0, pos: [0, 0, -10] as const, total: 5 },
      { id: 1, pos: [0, 0, -(BEACON.audible - 20)] as const, total: 5 },
      { id: 2, pos: [0, 0, -(BEACON.audible + 20)] as const, total: 5 },
    ];
    const ticks = new Map<number, number[]>();
    for (let t = 0; t < BEACON.period * 3; t += DT) for (const k of b.update(t, caches, EYE)) ticks.set(k.id, [...(ticks.get(k.id) ?? []), t, k.gain]);
    const t0 = ticks.get(0) ?? [];
    const onBeat = (t: number, id: number) => Math.abs(((t + cachePhase(id)) / BEACON.period) % 1) < DT / BEACON.period + 1e-9;
    // 3 periods from t = 0 (phase 0): beats at 5 and 10 s (the first frame only sets the count)
    c.check(t0.length / 2 === 2 && onBeat(t0[0], 0) && onBeat(t0[2], 0), "a cache ticks once per period, on its shader flash", `${t0.length / 2} ticks at ${t0[0].toFixed(2)}, ${t0[2].toFixed(2)} s`);
    c.check(!ticks.has(2) && (ticks.get(1)?.[1] ?? 1) < t0[1], "silent beyond the audible radius; quieter far away");
  }
  c.check(bearingDeg(0, -1) === 0 && Math.abs(bearingDeg(1, 0) - 90) < 1e-9 && relativeDeg(10, 350) === 20 && relativeDeg(350, 10) === -20, "compass bearings: −z = 0°, +x = 90°, wrapped differences");
}
