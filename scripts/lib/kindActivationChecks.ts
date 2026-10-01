/**
 * test:save — kind activation (save v6 / v7, conserve/save/activateKinds.ts): an
 * older world gains every registry kind it never had (voltite 伏晶 at 5 → 6,
 * abyssal 渊核 at 6 → 7) as at genesis — totals, W and this generation's R grow by
 * the genesis total; kinds already in the save never move (even mined out), the
 * chaos stays fixed until the tide, and the step is idempotent.
 */
import { KINDS } from "../../src/games/deep-march/conserve/kinds";
import { SAVE } from "../../src/games/deep-march/conserve/config";
import { poolsConserve } from "../../src/games/deep-march/conserve/ledger/particleLedger";
import { activateKinds } from "../../src/games/deep-march/conserve/save/activateKinds";
import { createWorldSave } from "../../src/games/deep-march/conserve/save/createSave";
import { createMemoryBackend } from "../../src/games/deep-march/conserve/save/saveBackend";
import { readSlot } from "../../src/games/deep-march/conserve/save/saveRepository";
import type { WorldSave } from "../../src/games/deep-march/conserve/save/schema";
import { seedFromString } from "../../src/games/deep-march/terrain/noise";
import type { Checker } from "./checks";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const VOLT = 4, ABYSS = 6;
type Raw = Record<string, unknown> & { totals: number[]; ledger: Record<string, number[]>; generation: { allocInput: number[] } };

/** The current new save as an older version that never had the given kinds. */
function olderSave(v: number, without: readonly number[]): Raw {
  const raw = structuredClone(createWorldSave({ id: SAVE.slotId, seedText: "abyss", seed: seedFromString("abyss"), now: 0 })) as unknown as Raw;
  raw.v = v;
  for (const k of without) raw.totals[k] = raw.ledger.world[k] = raw.generation.allocInput[k] = 0;
  return raw;
}

export function kindActivationChecks(c: Checker): void {
  c.section("kind activation (v5 → v6 voltite, v6 → v7 abyssal)");
  const fresh = olderSave(7, []);
  {
    const v5 = olderSave(5, [VOLT, ABYSS]);
    const read = readSlot(createMemoryBackend({ "save/main": v5 }), "main");
    const s = read.status === "ok" ? read.save : null;
    c.check(read.status === "ok" && read.migratedFrom === 5 && read.save.v === 7 && read.repairs.length === 0, "v5 world (no voltite, no abyssal) reads as v7, no repairs");
    c.check(!!s && s.totals[VOLT] === KINDS.voltite.genesis && s.totals[ABYSS] === KINDS.abyssal.genesis && s.ledger.world[VOLT] === 4_500 && s.ledger.world[ABYSS] === 500, "voltite 4,500 and abyssal 500 created in the world pool W", s ? `${s.totals[VOLT]} / ${s.totals[ABYSS]}` : read.status);
    c.check(!!s && same(s.generation.allocInput, fresh.generation.allocInput) && poolsConserve(s.totals, s.ledger), "this generation's R gains them too (nodes appear at once), conserved");
    c.check(!!s && same(s.chaos, v5.chaos), "the generation's chaos is unchanged (fixed until the tide)");
  }
  {
    const v6 = olderSave(6, [ABYSS]);
    v6.ledger.world[VOLT] -= 1_200;
    v6.ledger.player[VOLT] += 1_200;
    const read = readSlot(createMemoryBackend({ "save/main": v6 }), "main");
    const s = read.status === "ok" ? read.save : null;
    c.check(read.status === "ok" && read.migratedFrom === 6 && read.save.totals[ABYSS] === 500 && read.save.ledger.world[ABYSS] === 500 && read.save.generation.allocInput[ABYSS] === 500, "v6 world: only abyssal is added");
    c.check(!!s && s.totals[VOLT] === 4_500 && s.ledger.world[VOLT] === 3_300 && s.ledger.player[VOLT] === 1_200, "voltite already in the world keeps its pools (nothing re-added)");
  }
  {
    const mined = olderSave(6, [ABYSS]);
    mined.ledger.world[VOLT] = 0;
    mined.ledger.lost[VOLT] = 4_500;
    const out = activateKinds(mined) as Raw;
    c.check(out.totals[VOLT] === 4_500 && out.ledger.world[VOLT] === 0 && out.ledger.lost[VOLT] === 4_500, "a kind with every particle gone from W still counts as present (total > 0)");
  }
  {
    const cur = olderSave(7, []);
    c.check(activateKinds(cur) === cur, "a save with every kind passes through unchanged (idempotent)");
    const junk = { v: 5, totals: "x" };
    c.check(activateKinds(junk) === junk, "a malformed save is left for validation");
  }
}
