/**
 * test:placement — base energy (conserve/base/energy.ts via Base.tick): core
 * output and capacity, lighthouse drain, brown-out (lighthouses off first,
 * core keeps producing) and the restart hysteresis, fuel stop when storage has
 * no lumen, energy towers' capacity, and the tide's requirements.
 */
import { BASE, STRUCTURES } from "../../src/games/deep-march/conserve/config";
import { particleIndex } from "../../src/games/deep-march/conserve/particles/particleTypes";
import { foundedRig, lockedMatches, RECT } from "./baseFixture";
import type { Checker } from "./checks";

const LUMEN = particleIndex("lumen");

export function energyChecks(c: Checker): void {
  c.section("base energy");
  {
    const { base } = foundedRig();
    const v = base.view();
    c.check(v.energy === STRUCTURES.core.energyCap && v.energyCap === 100 && Math.abs(v.energyRate - 0.25) < 1e-9, "core alone: starts full (100), +0.25 / s");
    base.tick(100);
    c.check(base.view().energy === 100, "energy never exceeds the capacity");
  }
  {
    const rig = foundedRig();
    const { ledger, base } = rig;
    ledger.transferVector("world", "player", [100, 0, 100, 20, 0, 0, 0]);
    base.build("lighthouse", [20, -100, 0], 0, RECT);
    base.deposit(null);
    const v = base.view();
    const lit = v.buildings.find((b) => b.kind === "lighthouse")!;
    c.check(lit.working && Math.abs(v.energyRate - (0.25 - 0.3)) < 1e-9, "lighthouse lit: net −0.05 / s", `${v.energyRate.toFixed(3)}`);
    let t = 0;
    while (!base.view().brownout && t < 5000) {
      base.tick(1);
      t++;
    }
    const b = base.view();
    c.check(b.brownout && b.energy === 0 && Math.abs(t - 100 / 0.05) <= 2, "runs dry after 100 / 0.05 = 2000 s → brown-out", `${t} s`);
    c.check(!b.buildings.find((x) => x.kind === "lighthouse")!.working && b.buildings.find((x) => x.kind === "core")!.working && Math.abs(b.energyRate - 0.25) < 1e-9, "brown-out order: the lighthouse goes dark first, the core keeps producing");
    const s0 = ledger.amount("suspended", "lumen");
    let back = 0;
    while (base.view().brownout && back < 1000) {
      base.tick(1);
      back++;
    }
    c.check(Math.abs(back - BASE.restartEnergy / 0.25) <= 2 && ledger.amount("suspended", "lumen") === s0, "no fuel burnt while dark; back on above the restart energy (10) after 40 s", `${back} s`);
    const store = base.toSave()!.storage[LUMEN];
    base.release(LUMEN, store);
    for (let i = 0; i < 70; i++) base.tick(1);
    c.check(!base.view().buildings.find((x) => x.kind === "lighthouse")!.working && lockedMatches(rig) && ledger.isConserved(), "no lumen in storage: the lighthouse stops at the end of its fuel minute");
  }
  {
    const rig = foundedRig();
    const { ledger, base } = rig;
    ledger.transferVector("world", "player", [150, 0, 20, 60, 0, 0, 0]);
    base.build("energy", [0, -100, 20], 0, RECT);
    c.check(base.view().energyCap === 300, "an energy tower adds 200 capacity", `${base.view().energyCap}`);
    const tide0 = base.tide();
    c.check(!tide0.ready && tide0.energyNeeded === 150 && tide0.divesNeeded === 1, "the tide: needs 150 energy and one dive this generation");
    base.tick(400);
    base.recordDeparture();
    const tide1 = base.tide();
    c.check(tide1.ready && tide1.energy >= 150 && tide1.dives === 1 && rig.counts.dives === 1, "150+ energy and one departure → ready");
    const f = base.forecast();
    c.check(f.m > 0.9 && f.m < 1 && f.thickness > 100, "forecast: m = Σ (N − P − B) / Σ N and its wall thickness", `m ${f.m.toFixed(4)}, ${f.thickness.toFixed(1)} m`);
    const d = base.demolish(base.view().buildings.find((b) => b.kind === "energy")!.id);
    c.check(d.ok && base.view().energy <= base.view().energyCap && base.view().energyCap === 100, "demolishing the tower clamps the energy to the capacity left");
  }
}
