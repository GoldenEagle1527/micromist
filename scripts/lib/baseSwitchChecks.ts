/**
 * test:placement — the lighthouse switch (M9, conserve/base/energy.ts) and the
 * tide's energy (numeric review against design doc §6.2 / G3): only consumers
 * switch; a switched-off lighthouse neither drains nor burns fuel and stays off
 * in the save. With only the core producing (+0.25 / s), one lit lighthouse
 * (−0.3 / s) keeps the energy below the tide's 150 for good (brown-out, then
 * restart at 10) — the reason for the switch; switched off, 150 is back within
 * (150 − energy) / 0.25 s.
 */
import { BASE, STRUCTURES } from "../../src/games/deep-march/conserve/config";
import { particleIndex } from "../../src/games/deep-march/conserve/particles/particleTypes";
import { foundedRig, lockedMatches, RECT } from "./baseFixture";
import type { Checker } from "./checks";

const LUMEN = particleIndex("lumen");

export function switchChecks(c: Checker): void {
  c.section("lighthouse switch and the tide's energy (M9)");
  const rig = foundedRig();
  const { ledger, base } = rig;
  ledger.transferVector("world", "player", [600, 0, 200, 200, 0, 0, 0]);
  const tower = base.build("energy", [0, -100, 20], 0, RECT);
  const lit = base.build("lighthouse", [20, -100, 0], 0, RECT);
  base.deposit(null);
  base.recordDeparture();
  const core = base.view().buildings.find((b) => b.kind === "core")!;
  c.check(tower.ok && lit.ok && base.view().energyCap === 300, "fixture: core + energy tower (cap 300) + lighthouse");
  const refused = [base.setOn(core.id, false), base.setOn(tower.id!, false), base.setOn(9999, false)];
  c.check(refused.every((r) => !r.ok) && base.view().buildings.every((b) => b.on), "only consumers switch: the core, the tower and unknown ids are refused");

  const rate = STRUCTURES.core.energy + STRUCTURES.lighthouse.energy;
  let best = 0;
  for (let t = 0; t < 6000; t++) {
    base.tick(1);
    if (t > 2500) best = Math.max(best, base.view().energy);
  }
  c.check(rate < 0 && best <= BASE.restartEnergy + 1 && !base.tide().ready, "a lit lighthouse on the core alone: the energy never gets back to 150 (stuck near the restart energy)", `net ${rate.toFixed(2)} / s, max ${best.toFixed(1)} after 2500 s`);

  const off = base.setOn(lit.id!, false);
  const v = base.view();
  const light = v.buildings.find((b) => b.id === lit.id)!;
  c.check(off.ok && !light.on && !light.working && Math.abs(v.energyRate - STRUCTURES.core.energy) < 1e-9, "switched off: dark, the core's +0.25 / s alone");
  const e0 = v.energy, s0 = ledger.amount("suspended", "lumen");
  let t = 0;
  while (!base.tide().ready && t < 5000) {
    base.tick(1);
    t++;
  }
  const expected = Math.ceil((BASE.tide.energy - e0) / STRUCTURES.core.energy);
  c.check(base.tide().ready && Math.abs(t - expected) <= 2, "then the tide's 150 energy within (150 − e) / 0.25 s", `${t} s from ${e0.toFixed(1)}`);
  c.check(ledger.amount("suspended", "lumen") === s0 && base.toSave()!.storage[LUMEN] > 0, "no lumen burnt while switched off");
  c.check(base.toSave()!.structures.find((s) => s.id === lit.id)!.on === false, "the switch is saved");
  const on = base.setOn(lit.id!, true);
  c.check(on.ok && base.view().buildings.find((b) => b.id === lit.id)!.working && lockedMatches(rig) && ledger.isConserved(), "switched on again: lit; B = lockedOf(base), Σ = N");
}
