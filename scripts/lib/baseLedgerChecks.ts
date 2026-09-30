/**
 * test:ledger — the base's particle moves (plan M5): founding (lander cargo pays
 * the core, frozen rock W → B), building (storage first, then the tank),
 * demolishing (full refund into storage), deposit (P → B, capacity), withdraw
 * (B → P, tank room), 放流 (B → S, any amount: 10⁴ at once), death in the base
 * (the whole tank into storage), lighthouse fuel (B → S). After every step
 * Σ pools = N and B = storage + buildings + frozen.
 */
import { STRUCTURES, TANK } from "../../src/games/deep-march/conserve/config";
import { cloneBase } from "../../src/games/deep-march/conserve/base/baseState";
import { particleIndex } from "../../src/games/deep-march/conserve/particles/particleTypes";
import { mulberry32 } from "../../src/games/deep-march/terrain/noise";
import { baseRig, CENTRE_SITE, foundedRig, lockedMatches, RECT } from "./baseFixture";
import type { Checker } from "./checks";

const ROCK = particleIndex("lithic"), LUMEN = particleIndex("lumen"), FERRO = particleIndex("ferro");

export function baseLedgerChecks(c: Checker): void {
  c.section("base: founding, building, storage, 放流 (conserve/base)");
  {
    const rig = baseRig();
    const w0 = rig.ledger.amount("world", "lithic");
    const r = rig.base.found([0, -100, 0], 0, CENTRE_SITE, RECT);
    const s = rig.base.toSave()!;
    const frozenRock = s.frozenLocked[ROCK];
    c.check(r.ok && rig.ledger.isConserved() && lockedMatches(rig), "founding with the lander cargo: conserved, B = storage + core + frozen");
    c.check(s.storage[ROCK] === 200 && s.storage[FERRO] === 20, "the cargo (600 / 80) pays the core (400 / 60), 200 / 20 left", `${s.storage[ROCK]} / ${s.storage[FERRO]}`);
    c.check(rig.ledger.amount("world", "lithic") === w0 - frozenRock && frozenRock > 0 && s.frozen.length === 9, "frozen 3 × 3: its terrain rock moved W → B", `${frozenRock} rock`);
    c.check(rig.counts.commits === 1, "founding commits the save at once");
  }
  {
    const rig = foundedRig();
    const { ledger, base } = rig;
    ledger.transferVector("world", "player", [150, 0, 60, 60, 0, 0, 0]);
    const tank0 = ledger.poolTotal("player");
    const r = base.build("lighthouse", [20, -100, 0], 0, RECT);
    c.check(r.ok && ledger.isConserved() && lockedMatches(rig), "lighthouse: storage first, the rest from the tank (P → B)");
    c.check(ledger.poolTotal("player") === tank0 - (100 + 60 + 20) && base.toSave()!.storage[ROCK] === 0, "paid 200 rock from storage, 100 rock + 60 lumen + 20 ferro from the tank", `tank ${ledger.poolTotal("player")}`);
    const poor = base.build("storage", [0, -100, 24], 0, RECT);
    c.check(!poor.ok && poor.reason === "cost" && ledger.isConserved() && lockedMatches(rig), "not enough: refused, nothing moves");
    const before = base.toSave()!.storage.slice();
    const d = base.demolish(r.ok ? r.id! : -1);
    const after = base.toSave()!.storage;
    const cost = base.info("lighthouse").cost;
    c.check(d.ok && after.every((n, k) => n === before[k] + cost[k]) && ledger.isConserved() && lockedMatches(rig), "demolish: the full cost back into storage (stays in B)");
    c.check(!base.demolish(1).ok, "the core cannot be demolished");
    const tank1 = ledger.poolTotal("player");
    const dep = base.deposit(null);
    c.check(dep > 0 && ledger.poolTotal("player") === tank1 - dep && ledger.isConserved() && lockedMatches(rig), "deposit: P → B, conserved", `${dep} moved, ${base.view().stored}/${base.view().capacity}`);
  }
  {
    const rig = foundedRig();
    const { ledger, base } = rig;
    ledger.transferVector("world", "player", [TANK.capacity, 0, 0, 0, 0, 0, 0]);
    base.deposit(null);
    ledger.transferVector("world", "player", [TANK.capacity, 0, 0, 0, 0, 0, 0]);
    const moved = base.deposit(null);
    c.check(moved === STRUCTURES.core.storage - 220 - TANK.capacity && base.view().stored === STRUCTURES.core.storage && lockedMatches(rig), "deposit stops at the capacity (core: 500)", `${moved} moved`);
    const room = TANK.capacity - ledger.poolTotal("player");
    const w = base.withdraw(ROCK, 1000);
    c.check(w === room && ledger.poolTotal("player") === TANK.capacity && lockedMatches(rig), "withdraw stops at the tank's room", `${w} moved`);
    const died = base.depositOnDeath();
    c.check(ledger.poolTotal("player") === 0 && base.view().stored > STRUCTURES.core.storage && ledger.isConserved() && lockedMatches(rig), "death in the base: the whole tank into storage, capacity ignored", `${died} moved, ${base.view().stored}/${base.view().capacity}`);
  }
  {
    const rig = foundedRig();
    const { ledger } = rig;
    ledger.transfer("world", "base", "lithic", 10_000);
    const save = cloneBase(rig.base.toSave()!);
    save.storage[ROCK] += 10_000;
    const big = baseRig(42, save, ledger);
    const s0 = ledger.amount("suspended", "lithic");
    const n = big.base.release(ROCK, 10_000);
    c.check(n === 10_000 && ledger.amount("suspended", "lithic") === s0 + 10_000 && ledger.isConserved() && lockedMatches(big), "放流 10⁴ particles at once: B → S, no limit", `${n}`);
    const again = big.base.release(ROCK, 1) + big.base.release(ROCK, 1);
    c.check(again === 2 && lockedMatches(big), "no cooldown: releases right after");
    const left = big.base.toSave()!.storage[ROCK];
    c.check(big.base.release(ROCK, 1e9) === left && big.base.toSave()!.storage[ROCK] === 0 && lockedMatches(big), "releasing more than stored empties the kind");
  }
  {
    const rig = foundedRig();
    const { ledger, base } = rig;
    ledger.transferVector("world", "player", [100, 0, 80, 60, 0, 0, 0]);
    base.build("lighthouse", [20, -100, 0], 0, RECT);
    base.deposit(null);
    const lumen0 = base.toSave()!.storage[LUMEN];
    const s0 = ledger.amount("suspended", "lumen");
    for (let t = 0; t < 600; t++) base.tick(1);
    const burnt = ledger.amount("suspended", "lumen") - s0;
    c.check(burnt === 10 && base.toSave()!.storage[LUMEN] === lumen0 - 10 && lockedMatches(rig) && ledger.isConserved(), "lighthouse fuel: 1 lumen per 60 s of light, storage → S", `${burnt} in 600 s`);
  }
  {
    const rig = foundedRig();
    const { ledger, base } = rig;
    const rnd = mulberry32(5);
    let broke = 0;
    const kinds = ["lighthouse", "energy", "storage"] as const;
    for (let i = 0; i < 5000; i++) {
      const r = rnd();
      if (r < 0.25) ledger.transfer("world", "player", (["lithic", "lumen", "ferro"] as const)[Math.floor(rnd() * 3)], Math.min(Math.floor(rnd() * 40), TANK.capacity - ledger.poolTotal("player")));
      else if (r < 0.4) base.build(kinds[Math.floor(rnd() * 3)], [(rnd() - 0.5) * 90, -100, (rnd() - 0.5) * 90], 0, RECT);
      else if (r < 0.5) base.demolish(1 + Math.floor(rnd() * 12));
      else if (r < 0.65) base.deposit(rnd() < 0.5 ? null : [ROCK, LUMEN, FERRO][Math.floor(rnd() * 3)]);
      else if (r < 0.75) base.withdraw([ROCK, LUMEN, FERRO][Math.floor(rnd() * 3)], Math.floor(rnd() * 60));
      else if (r < 0.85) base.release([ROCK, LUMEN, FERRO][Math.floor(rnd() * 3)], Math.floor(rnd() * 30));
      else if (r < 0.9) base.depositOnDeath();
      else base.tick(rnd() * 90);
      if (!ledger.isConserved() || !lockedMatches(rig) || ledger.poolTotal("player") > TANK.capacity) broke++;
    }
    c.check(broke === 0, "5,000 random build / demolish / deposit / withdraw / 放流 / fuel steps: Σ = N and B = locked", `${base.view().buildings.length} buildings, S ${ledger.poolTotal("suspended")}`);
  }
}
