/**
 * Conserve mode — world save (conserve/save, conserve/session):
 *   - new save at genesis: shape, 10 × 10, generation 1, conserved, size budget;
 *   - write → read round trip through a backend; the game-store adapter's key;
 *   - migrations: current version, chained upgrades, future / unknown versions refused;
 *   - validation: every corrupted field makes the slot unreadable (never guessed);
 *   - reconcile: sanitizing, deficit → suspended, excess taken in the configured
 *     order, result conserves, input untouched;
 *   - throttled writer (fake clock): 30 s interval, flush, dispose;
 *   - sessions: new / continue / repaired / annihilated (read-only) / unreadable /
 *     missing; dive count and ledger changes are written throttled and on close;
 *     blocked opens never touch the stored save;
 *   - setup peek of each slot state.
 * Run: npm run test:save
 */
import { gameStoreGet } from "../src/lib/game-store";
import { SAVE } from "../src/games/deep-march/conserve/config";
import { POOL_IDS } from "../src/games/deep-march/conserve/ledger/pools";
import { poolsConserve } from "../src/games/deep-march/conserve/ledger/particleLedger";
import { createWorldSave } from "../src/games/deep-march/conserve/save/createSave";
import { createGameStoreBackend } from "../src/games/deep-march/conserve/platform/gameStoreBackend";
import { migrateSave, type Migration } from "../src/games/deep-march/conserve/save/migrate";
import { reconcilePools, repairedParticles } from "../src/games/deep-march/conserve/save/reconcile";
import { createMemoryBackend } from "../src/games/deep-march/conserve/save/saveBackend";
import { readSlot, saveBytes, slotKey, writeSlot } from "../src/games/deep-march/conserve/save/saveRepository";
import { createSaveWriter, type WriterClock } from "../src/games/deep-march/conserve/save/saveWriter";
import { SAVE_VERSION, type WorldSave } from "../src/games/deep-march/conserve/save/schema";
import { openConserveSession } from "../src/games/deep-march/conserve/session/openSession";
import { peekWorldSlot } from "../src/games/deep-march/conserve/session/peekSlot";
import { DEEP_MARCH_GAME } from "../src/games/deep-march/settings";
import { seedFromString } from "../src/games/deep-march/terrain/noise";
import { createChecker } from "./lib/checks";

const c = createChecker();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = <T>(v: T): T => structuredClone(v);
const T0 = 1_780_000_000_000;

/** Manual clock: timers fire only when advance() passes their due time. */
function fakeClock(start = T0): WriterClock & { advance(ms: number): void; pending(): number } {
  let now = start;
  let nextId = 1;
  const timers = new Map<number, { due: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { due: now + ms, fn });
      return id;
    },
    clearTimeout: (h) => void timers.delete(h as number),
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].due - b[1].due)) {
        if (t.due > now) continue;
        timers.delete(id);
        t.fn();
      }
    },
    pending: () => timers.size,
  };
}

const newSave = (): WorldSave => createWorldSave({ id: SAVE.slotId, seedText: "abyss", seed: seedFromString("abyss"), now: T0 });

c.section("new save");
{
  const s = newSave();
  c.check(s.v === SAVE_VERSION && s.id === "main" && s.gen === 1 && s.createdAt === T0 && s.savedAt === T0, "header: version, slot, generation 1, timestamps");
  c.check(s.seedText === "abyss" && s.seed === seedFromString("abyss") >>> 0, "seed text and terrain seed");
  c.check(s.size.sitesX === 10 && s.size.sitesZ === 10, "10 × 10 sites (D17)");
  c.check(poolsConserve(s.totals, s.ledger) && s.ledger.base[0] === 600 && s.ledger.base[3] === 80, "ledger conserved, lander cargo in the base");
  c.check(s.stats.divesStarted === 0 && same(s.flags, {}), "no dives, no flags");
  c.check(saveBytes(s) < 20 * 1024, "JSON < 20 KB", `${saveBytes(s)} B`);
}

c.section("round trip");
{
  const backend = createMemoryBackend();
  const s = newSave();
  writeSlot(backend, s);
  const read = readSlot(backend, "main");
  c.check(read.status === "ok" && same(read.save, s) && read.repairs.length === 0 && read.migratedFrom === SAVE_VERSION, "write → read gives the same save, no repairs");
  c.check(backend.entries.has(slotKey("main")) && slotKey("main") === "save/main", "stored under save/<slot>");
  c.check(readSlot(backend, "other").status === "empty", "missing slot → empty");
  const store = createGameStoreBackend();
  writeSlot(store, s);
  c.check(same(gameStoreGet(DEEP_MARCH_GAME, "save/main"), s) && readSlot(store, "main").status === "ok", "game-store backend: key deep-march/save/main");
}

c.section("migrations");
{
  c.check(migrateSave(newSave()).ok, "current version passes unchanged");
  c.check(same(migrateSave({ ...newSave(), v: SAVE_VERSION + 1 }), { ok: false, reason: "future-version" }), "newer save refused (future-version)");
  c.check(same(migrateSave({ id: "x" }), { ok: false, reason: "no-version" }) && same(migrateSave(null), { ok: false, reason: "not-an-object" }) && same(migrateSave([1]), { ok: false, reason: "not-an-object" }), "no version / not an object refused");
  const chain: Record<number, Migration> = { 1: (r) => ({ ...r, a: 1 }), 2: (r) => ({ ...r, b: (r.a as number) + 1 }) };
  const up = migrateSave({ v: 1 }, chain, 3);
  c.check(up.ok && same(up.raw, { v: 3, a: 1, b: 2 }) && up.from === 1, "chained migrations 1 → 2 → 3 run in order");
  c.check(same(migrateSave({ v: 0 }, chain, 3), { ok: false, reason: "missing-migration" }), "gap in the chain refused (missing-migration)");
}

c.section("validation");
{
  const corruptions: [string, (s: Record<string, unknown>) => void][] = [
    ["id", (s) => (s.id = "")],
    ["timestamps", (s) => (s.savedAt = -1)],
    ["seed", (s) => (s.seed = "7")],
    ["size", (s) => (s.size = { sitesX: 0, sitesZ: 10 })],
    ["gen", (s) => (s.gen = 0)],
    ["totals", (s) => ((s.totals as number[])[0] = -5)],
    ["ledger", (s) => (s.ledger = null)],
    ["ledger pool shape", (s) => ((s.ledger as Record<string, unknown>).lost = [1, 2])],
    ["ledger pool value", (s) => ((s.ledger as Record<string, number[]>).world[1] = Number.NaN)],
    ["stats", (s) => (s.stats = { divesStarted: 1.5 })],
    ["flags", (s) => (s.flags = { endingA: "opened" })],
  ];
  for (const [name, corrupt] of corruptions) {
    const raw = clone(newSave()) as unknown as Record<string, unknown>;
    corrupt(raw);
    const backend = createMemoryBackend({ "save/main": raw });
    const read = readSlot(backend, "main");
    c.check(read.status === "unreadable", `corrupted ${name} → unreadable`, read.status === "unreadable" ? read.reason : read.status);
  }
}

c.section("reconcile");
{
  const s = newSave();
  const pools = clone(s.ledger);
  pools.world[0] -= 50; // deficit 50 lithic
  pools.player[2] = 30; // excess 30 lumen
  pools.lost[3] = -4; // sanitized back to 0 (was 0)
  pools.base[3] = 80.7; // sanitized back to 80 (was 80)
  const input = clone(pools);
  const { pools: out, repairs } = reconcilePools(s.totals, pools);
  c.check(poolsConserve(s.totals, out), "repaired pools conserve");
  c.check(same(pools, input), "input not mutated");
  c.check(out.suspended[0] === 50 && repairs.some((r) => r.type === "lithic" && r.pool === "suspended" && r.delta === 50 && r.cause === "deficit"), "deficit → added to the suspended pool");
  c.check(out.world[2] === 17_000 - 30 && out.player[2] === 30 && repairs.some((r) => r.type === "lumen" && r.pool === "world" && r.delta === -30 && r.cause === "excess"), "excess taken from the first pool in REPAIR_TAKE_ORDER that holds it (suspended empty → world)");
  c.check(out.lost[3] === 0 && out.base[3] === 80 && repairs.filter((r) => r.cause === "sanitized").length === 2, "negative / fractional values sanitized (and logged)");
  c.check(repairedParticles(repairs) === 50 + 30, "repaired particle count excludes sanitizing", `${repairedParticles(repairs)}`);
  const order = reconcilePools([10, 0, 0, 0, 0, 0, 0], { world: [6, 0, 0, 0, 0, 0, 0], player: [0, 0, 0, 0, 0, 0, 0], base: [5, 0, 0, 0, 0, 0, 0], suspended: [3, 0, 0, 0, 0, 0, 0], lost: [1, 0, 0, 0, 0, 0, 0] });
  c.check(same(order.pools.suspended, [0, 0, 0, 0, 0, 0, 0]) && order.pools.world[0] === 4 && order.pools.base[0] === 5 && order.pools.lost[0] === 1, "excess 5: suspended (3) first, then world (2); lost / base untouched");
}

c.section("throttled writer");
{
  const clock = fakeClock();
  let writes = 0;
  const w = createSaveWriter(() => writes++, 30_000, clock);
  w.markDirty();
  clock.advance(29_999);
  c.check(writes === 0 && w.dirty, "first change waits a full interval after opening");
  clock.advance(1);
  c.check(writes === 1 && !w.dirty, "written at 30 s");
  w.markDirty();
  w.markDirty();
  clock.advance(10_000);
  c.check(writes === 1 && clock.pending() === 1, "changes within the interval: one pending timer, no write yet");
  clock.advance(20_000);
  c.check(writes === 2, "written once the interval since the last write has passed");
  w.markDirty();
  w.flush();
  c.check(writes === 3 && clock.pending() === 0, "flush writes at once and cancels the timer");
  w.flush();
  c.check(writes === 3, "flush with nothing changed does not write");
  w.markDirty();
  w.dispose();
  clock.advance(60_000);
  c.check(writes === 3, "dispose cancels without writing");
}

c.section("sessions");
{
  const hashSeed = seedFromString;
  // new world
  const backend = createMemoryBackend();
  const clock = fakeClock();
  const opened = openConserveSession({ backend, intent: { kind: "new", seedText: "reef" }, hashSeed, clock });
  c.check(opened.ok && opened.session.report.kind === "created" && backend.entries.has("save/main"), "new: created and written at once");
  if (!opened.ok) throw new Error("new session failed");
  const session = opened.session;
  c.check(session.seedText === "reef" && session.seed === hashSeed("reef") >>> 0 && session.gen === 1, "session seed / generation");
  c.check(session.report.totalParticles === 100_000 && session.report.conserved && session.report.poolTotals.base === 680 && session.report.bytes > 0, "report: totals, conserved, base 680, size");
  session.recordDiveStart();
  clock.advance(1000);
  c.check((backend.read("save/main") as WorldSave).stats.divesStarted === 0, "dive count written throttled, not at once");
  clock.advance(30_000);
  c.check((backend.read("save/main") as WorldSave).stats.divesStarted === 1 && (backend.read("save/main") as WorldSave).savedAt === clock.now(), "…written after the interval, savedAt updated");
  session.ledger.transfer("world", "player", "lumen", 25);
  session.close();
  const afterClose = backend.read("save/main") as WorldSave;
  c.check(afterClose.ledger.player[2] === 25 && poolsConserve(afterClose.totals, afterClose.ledger), "ledger change marks dirty; close() writes it");
  session.close();
  c.check(same(backend.read("save/main"), afterClose), "close is idempotent");

  // continue
  const again = openConserveSession({ backend, intent: { kind: "continue" }, hashSeed, clock });
  c.check(again.ok && again.session.report.kind === "continued" && again.session.report.divesStarted === 1 && again.session.ledger.amount("player", "lumen") === 25, "continue: same world, counts kept");
  if (again.ok) again.session.close();

  // repaired on load → written back at once
  const tampered = clone(afterClose);
  tampered.ledger.world[0] -= 7;
  const repairBackend = createMemoryBackend({ "save/main": tampered });
  const repaired = openConserveSession({ backend: repairBackend, intent: { kind: "continue" }, hashSeed, clock });
  const stored = repairBackend.read("save/main") as WorldSave;
  c.check(repaired.ok && repairedParticles(repaired.session.report.repairs) === 7 && repaired.session.report.conserved, "tampered save: repaired (7 into suspended), conserved");
  c.check(poolsConserve(stored.totals, stored.ledger) && stored.ledger.suspended[0] === tampered.ledger.suspended[0] + 7, "repaired save written back at once");

  // annihilated → read-only
  const ended = clone(afterClose);
  ended.flags.endingA = "annihilated";
  const endedBackend = createMemoryBackend({ "save/main": ended });
  const refusedEnded = openConserveSession({ backend: endedBackend, intent: { kind: "continue" }, hashSeed, clock });
  c.check(!refusedEnded.ok && refusedEnded.report.kind === "ended" && same(endedBackend.read("save/main"), ended), "annihilated world: refused (read-only, D14), save untouched");

  // unreadable → kept
  const garbage = { v: 99, junk: true };
  const badBackend = createMemoryBackend({ "save/main": garbage });
  const refusedBad = openConserveSession({ backend: badBackend, intent: { kind: "continue" }, hashSeed, clock });
  c.check(!refusedBad.ok && refusedBad.report.kind === "unreadable" && refusedBad.report.reason === "future-version" && same(badBackend.read("save/main"), garbage), "unreadable save: refused, kept as it is");

  // missing
  const refusedMissing = openConserveSession({ backend: createMemoryBackend(), intent: { kind: "continue" }, hashSeed, clock });
  c.check(!refusedMissing.ok && refusedMissing.report.kind === "missing", "continue with an empty slot: refused (missing)");

  // new replaces whatever was there
  const replaced = openConserveSession({ backend: badBackend, intent: { kind: "new", seedText: "trench" }, hashSeed, clock });
  c.check(replaced.ok && (badBackend.read("save/main") as WorldSave).seedText === "trench", "new world replaces the stored slot");
  if (replaced.ok) replaced.session.close();
  c.check(POOL_IDS.length === 5, "five pools in the report");
}

c.section("setup peek");
{
  const s = newSave();
  c.check(peekWorldSlot(createMemoryBackend()).state === "empty", "empty");
  const ready = peekWorldSlot(createMemoryBackend({ "save/main": s }));
  c.check(ready.state === "ready" && ready.seedText === "abyss" && ready.gen === 1 && ready.divesStarted === 0, "ready: seed, generation, dives");
  c.check(peekWorldSlot(createMemoryBackend({ "save/main": { ...s, flags: { endingA: "annihilated" } } })).state === "ended", "ended");
  c.check(peekWorldSlot(createMemoryBackend({ "save/main": { v: 1 } })).state === "unreadable", "unreadable");
}

c.finish();
