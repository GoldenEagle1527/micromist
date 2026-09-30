/**
 * Conserve mode — particle ledger (conserve/particles, conserve/ledger, conserve/world):
 *   - particle kinds and vector helpers;
 *   - genesis: configured totals, lander cargo already in the base, conserved;
 *   - every refused transfer (pool, kind, count, balance) throws a LedgerError and
 *     changes nothing; vector transfers are all-or-nothing;
 *   - 100,000 random operations (valid and invalid): Σ pools = N_k after every step;
 *   - saved state round trip, refusal of non-conserving / malformed state, copies
 *     are isolated, transfer events and unsubscribe.
 * Run: npm run test:ledger
 */
import { GENESIS } from "../src/games/deep-march/conserve/config";
import { LedgerError } from "../src/games/deep-march/conserve/ledger/ledgerError";
import { ParticleLedger, type LedgerState, type TransferEvent } from "../src/games/deep-march/conserve/ledger/particleLedger";
import { POOL_IDS, type PoolId } from "../src/games/deep-march/conserve/ledger/pools";
import { PARTICLE_TYPES, PARTICLE_TYPE_COUNT, isParticleType, particleIndex, type ParticleType } from "../src/games/deep-march/conserve/particles/particleTypes";
import { isCountVector, vectorFromCounts, vectorTotal, zeroVector } from "../src/games/deep-march/conserve/particles/particleVector";
import { createGenesisLedger } from "../src/games/deep-march/conserve/world/genesis";
import { mulberry32 } from "../src/games/deep-march/terrain/noise";
import { createChecker } from "./lib/checks";

const c = createChecker();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function refusal(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof LedgerError ? err.code : `not a LedgerError: ${String(err)}`;
  }
}

function sumsMatch(ledger: ParticleLedger): boolean {
  const s = ledger.toState();
  return PARTICLE_TYPES.every((_t, i) => POOL_IDS.reduce((sum, id) => sum + s.pools[id][i], 0) === s.totals[i]);
}

c.section("particle kinds and vectors");
{
  c.check(PARTICLE_TYPES.join() === "lithic,silica,lumen,ferro,voltite,resonite,abyssal" && PARTICLE_TYPE_COUNT === 7, "7 kinds in the design order");
  c.check(PARTICLE_TYPES.every((t, i) => particleIndex(t) === i) && isParticleType("lumen") && !isParticleType("gold") && !isParticleType(3), "index / type guard");
  const v = vectorFromCounts({ lithic: 5, abyssal: 2 });
  c.check(same(v, [5, 0, 0, 0, 0, 0, 2]) && vectorTotal(v) === 7 && same(zeroVector(), [0, 0, 0, 0, 0, 0, 0]), "vectorFromCounts / total / zero");
  c.check(isCountVector(v) && !isCountVector([1, 2]) && !isCountVector([0, 0, 0, 0, 0, 0, -1]) && !isCountVector([0, 0, 0, 0, 0, 0, 0.5]) && !isCountVector([0, 0, 0, 0, 0, 0, 2 ** 60]), "count vector: length, non-negative, integer, safe");
}

c.section("genesis");
{
  const ledger = createGenesisLedger();
  const totals = vectorFromCounts(GENESIS.totals);
  const cargo = vectorFromCounts(GENESIS.landerCargo);
  c.check(ledger.grandTotal() === 100_000, "N = 100,000 (MVP)", `${ledger.grandTotal()}`);
  c.check(ledger.total("lithic") === 66_000 && ledger.total("lumen") === 17_000 && ledger.total("ferro") === 17_000 && ledger.total("abyssal") === 0, "MVP kinds: lithic 66k, lumen 17k, ferro 17k, others 0");
  c.check(same(ledger.pool("base"), cargo) && same(ledger.pool("world"), totals.map((n, i) => n - cargo[i])), "lander cargo (600 lithic, 80 ferro) in the base, the rest in the world");
  c.check(ledger.poolTotal("player") + ledger.poolTotal("suspended") + ledger.poolTotal("lost") === 0 && ledger.isConserved(), "other pools empty, conserved");
  c.check(refusal(() => ParticleLedger.genesis([1, 2, 3])) === "bad-vector", "genesis refuses a malformed totals vector");
}

c.section("transfers and refusals");
{
  const ledger = createGenesisLedger();
  const events: TransferEvent[] = [];
  const off = ledger.onTransfer((e) => events.push(e));
  ledger.transfer("world", "player", "lumen", 40);
  c.check(ledger.amount("player", "lumen") === 40 && ledger.amount("world", "lumen") === 17_000 - 40 && ledger.isConserved(), "transfer moves the count, conserved");
  c.check(events.length === 1 && same(events[0], { from: "world", to: "player", type: "lumen", count: 40 }), "transfer event");
  ledger.transfer("player", "base", "lumen", 0);
  c.check(events.length === 1, "zero transfer: allowed, no event");
  const before = ledger.toState();
  const cases: [string, () => void, string][] = [
    ["same pool", () => ledger.transfer("world", "world", "lithic", 1), "same-pool"],
    ["unknown pool", () => ledger.transfer("world", "ocean" as PoolId, "lithic", 1), "unknown-pool"],
    ["unknown kind", () => ledger.transfer("world", "player", "gold" as ParticleType, 1), "unknown-type"],
    ["negative count", () => ledger.transfer("world", "player", "lithic", -1), "bad-count"],
    ["fractional count", () => ledger.transfer("world", "player", "lithic", 0.5), "bad-count"],
    ["NaN count", () => ledger.transfer("world", "player", "lithic", Number.NaN), "bad-count"],
    ["unsafe count", () => ledger.transfer("world", "player", "lithic", 2 ** 60), "bad-count"],
    ["more than held", () => ledger.transfer("player", "base", "lumen", 41), "insufficient"],
    ["vector: malformed", () => ledger.transferVector("world", "base", [1, 2]), "bad-vector"],
    ["vector: one kind short (all-or-nothing)", () => ledger.transferVector("player", "base", vectorFromCounts({ lumen: 10, ferro: 1 })), "insufficient"],
  ];
  for (const [name, fn, code] of cases) c.check(refusal(fn) === code, `refused: ${name}`, code);
  c.check(same(ledger.toState(), before) && events.length === 1, "refused operations change nothing and emit nothing");
  ledger.transferVector("world", "suspended", vectorFromCounts({ lithic: 3, ferro: 2 }));
  c.check(ledger.amount("suspended", "lithic") === 3 && ledger.amount("suspended", "ferro") === 2 && events.length === 3, "vector transfer: one event per non-zero kind");
  off();
  ledger.transfer("world", "lost", "lithic", 1);
  c.check(events.length === 3, "unsubscribed listener no longer called");
}

c.section("100,000 random operations");
{
  const ledger = createGenesisLedger();
  const rnd = mulberry32(2026);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  let applied = 0, refused = 0, brokeInvariant = 0, negative = 0;
  for (let step = 0; step < 100_000; step++) {
    const from = pick(POOL_IDS), to = pick(POOL_IDS), type = pick(PARTICLE_TYPES);
    const held = ledger.amount(from, type);
    const count = rnd() < 0.1 ? held + 1 + Math.floor(rnd() * 5) : Math.floor(rnd() * (held + 1));
    const op = rnd() < 0.8 ? () => ledger.transfer(from, to, type, count) : () => ledger.transferVector(from, to, vectorFromCounts({ [type]: count, lithic: Math.floor(rnd() * 3) }));
    if (refusal(op) === null) applied++;
    else refused++;
    if (!ledger.isConserved() || !sumsMatch(ledger)) brokeInvariant++;
    if (POOL_IDS.some((id) => !isCountVector(ledger.pool(id)))) negative++;
  }
  c.check(brokeInvariant === 0, "Σ pools = N_k after every operation", `${applied} applied, ${refused} refused`);
  c.check(negative === 0, "every pool stays a non-negative integer vector");
  c.check(ledger.grandTotal() === 100_000, "grand total unchanged");
}

c.section("saved state");
{
  const ledger = createGenesisLedger();
  ledger.transfer("world", "lost", "ferro", 12);
  const state = ledger.toState();
  const back = ParticleLedger.fromState(state);
  c.check(same(back.toState(), state) && back.isConserved(), "toState → fromState round trip");
  state.pools.world[0] = 0;
  c.check(ledger.amount("world", "lithic") === 66_000 - 600, "toState returns copies (mutating it leaves the ledger alone)");
  const broken: LedgerState = ledger.toState();
  broken.pools.world[0] += 1;
  c.check(refusal(() => ParticleLedger.fromState(broken)) === "not-conserved", "fromState refuses pools that don't add up");
  const malformed = ledger.toState();
  malformed.pools.player = [1, 2, 3];
  c.check(refusal(() => ParticleLedger.fromState(malformed)) === "bad-vector", "fromState refuses a malformed pool");
  const pool = ledger.pool("world");
  pool[0] = 0;
  c.check(ledger.amount("world", "lithic") !== 0, "pool() returns a copy");
}

c.finish();
