/**
 * Conserve mode — world save (conserve/save, conserve/session):
 *   - new save at genesis: shape, 10 × 10, generation 1, conserved, size budget;
 *   - write → read round trip through a backend; the game-store adapter's key;
 *   - migrations: current version, chained upgrades, future / unknown versions refused;
 *     v1 → v2 (M2): generation.allocInput = N − P − B from the stored ledger;
 *     v2 → v3 (M4): nodes all full (harvested "", partial []), no caches; v1 → v4 chained;
 *     v3 → v4 (M5): no base, generation.dives = dives started (lib/baseSaveChecks.ts);
 *     v5 → v6 → v7: voltite / abyssal join an older world (lib/kindActivationChecks.ts);
 *   - base (M5): shape validation, fitted to pool B on load, saved with the session,
 *     dives counted per departure once the base stands (lib/baseSaveChecks.ts);
 *   - validation: every corrupted field makes the slot unreadable (never guessed);
 *   - reconcile: sanitizing, deficit → suspended, excess taken in the configured
 *     order, result conserves, input untouched;
 *   - throttled writer (fake clock): 30 s interval, flush, dispose;
 *   - sessions: new / continue / repaired / annihilated (read-only) / unreadable /
 *     missing; dive count and ledger changes are written throttled and on close;
 *     blocked opens never touch the stored save;
 *   - generation: the session's site table is built from generation.allocInput, so
 *     it stays fixed while the ledger changes within a generation;
 *   - lost caches (M4): fitted to the lost pool on load (over-stated → cut from the
 *     oldest, unclaimed L → S, only the newest 5 kept), conserved, written back;
 *   - expedition in a session: node state and caches saved with the ledger, a
 *     death written at once, continue restores them;
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
import { baseSaveChecks } from "./lib/baseSaveChecks";
import { kindActivationChecks } from "./lib/kindActivationChecks";

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
  c.check(same(s.generation.allocInput, [65400, 0, 17000, 16920, 4500, 0, 500]), "generation 1 allocation input R = N − P − B");
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
  // v1 → v2: a stored M1 save gains generation.allocInput = N − P − B; an M1 world
  // never had voltite / abyssal, so 5 → 6 → 7 (activateKinds) adds their genesis to W and R
  const v1 = clone(newSave()) as unknown as Record<string, unknown>;
  delete v1.generation;
  v1.v = 1;
  (v1.ledger as Record<string, number[]>).player[2] = 30;
  (v1.ledger as Record<string, number[]>).world[2] -= 30;
  for (const k of [4, 6]) (v1.totals as number[])[k] = (v1.ledger as Record<string, number[]>).world[k] = 0;
  const backend = createMemoryBackend({ "save/main": v1 });
  const read = readSlot(backend, "main");
  c.check(SAVE_VERSION === 7 && read.status === "ok" && read.migratedFrom === 1 && read.save.v === 7, "v1 save (M1) migrates (1 → 2 → … → 7) and reads ok");
  c.check(read.status === "ok" && same(read.save.generation.allocInput, [65400, 0, 16970, 16920, 4500, 0, 500]) && read.repairs.length === 0, "v1 → v2: allocInput = N − P − B (lander cargo in B, 30 lumen carried); v6 / v7 add voltite / abyssal to R");
  const opened = openConserveSession({ backend, intent: { kind: "continue" }, hashSeed: seedFromString });
  c.check(opened.ok && (backend.read("save/main") as WorldSave).v === 7, "a migrated save is written back as v7 at once");
  if (opened.ok) opened.session.close();
  // v2 → v3: a stored M2/M3 save gains the node state and an empty cache list
  const v2 = clone(newSave()) as unknown as Record<string, unknown>;
  delete v2.caches;
  delete v2.base;
  v2.generation = { allocInput: (v2.generation as Record<string, unknown>).allocInput };
  v2.v = 2;
  const read2 = readSlot(createMemoryBackend({ "save/main": v2 }), "main");
  c.check(read2.status === "ok" && read2.migratedFrom === 2 && read2.save.generation.harvested === "" && same(read2.save.generation.partial, []) && same(read2.save.caches, []) && read2.repairs.length === 0, "v2 save (M2/M3) → v3: every node full, no caches, no repairs");
  const v2lost = clone(v2) as Record<string, unknown>;
  (v2lost.ledger as Record<string, number[]>).player[2] = 0;
  (v2lost.ledger as Record<string, number[]>).lost[2] = 12;
  (v2lost.ledger as Record<string, number[]>).world[2] -= 12;
  const read3 = readSlot(createMemoryBackend({ "save/main": v2lost }), "main");
  c.check(read3.status === "ok" && read3.save.ledger.lost[2] === 0 && read3.save.ledger.suspended[2] === 12 && read3.repairs.some((r) => r.cause === "caches" && r.delta === 12), "v2 lost pool with no cache claiming it → suspended (repair \"caches\")");
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
    ["generation", (s) => (s.generation = null)],
    ["generation.allocInput shape", (s) => ((s.generation as Record<string, unknown>).allocInput = [1, 2])],
    ["generation.allocInput above the totals", (s) => ((s.generation as Record<string, number[]>).allocInput[0] = 70_000)],
    ["generation.harvested not base64", (s) => ((s.generation as Record<string, unknown>).harvested = "a$b=")],
    ["generation.harvested bad length", (s) => ((s.generation as Record<string, unknown>).harvested = "QQ")],
    ["generation.partial shape", (s) => ((s.generation as Record<string, unknown>).partial = [[1, 2, 3]])],
    ["generation.partial value", (s) => ((s.generation as Record<string, unknown>).partial = [[1, -2]])],
    ["caches missing", (s) => delete s.caches],
    ["cache shape", (s) => (s.caches = [{ id: 1, pos: [0, 0], gen: 1, contents: [0, 0, 0, 0, 0, 0, 0] }])],
    ["cache id", (s) => (s.caches = [{ id: 0, pos: [0, 0, 0], gen: 1, contents: [0, 0, 0, 0, 0, 0, 0] }])],
    ["cache contents", (s) => (s.caches = [{ id: 1, pos: [0, 0, 0], gen: 1, contents: [1, 2] }])],
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

c.section("lost caches vs the lost pool");
{
  const base = newSave();
  const zero = [0, 0, 0, 0, 0, 0, 0];
  const cache = (id: number, contents: number[]) => ({ id, pos: [id, -10, 2 * id] as [number, number, number], gen: 1, contents });
  // L holds 100 lumen + 20 ferro; caches claim 70 lumen (id 2) + 50 lumen (id 1) + 20 ferro
  const s = clone(base);
  s.ledger.world[2] -= 100;
  s.ledger.world[3] -= 20;
  s.ledger.lost = [0, 0, 100, 20, 0, 0, 0];
  s.caches = [cache(2, [0, 0, 70, 0, 0, 0, 0]), cache(1, [0, 0, 50, 20, 0, 0, 0])];
  const r = readSlot(createMemoryBackend({ "save/main": s }), "main");
  const ok = r.status === "ok";
  const lumen = (id: number) => (ok ? (r.save.caches.find((x) => x.id === id)?.contents[2] ?? -1) : -1);
  c.check(ok && lumen(1) === 30 && lumen(2) === 70 && r.repairs.length === 0, "over-stated kind cut from the oldest cache first (50 → 30), newer untouched", ok ? `${lumen(1)} / ${lumen(2)}` : r.status);
  const sums = (caches: { contents: number[] }[]) => caches.reduce((a, x) => a.map((n, k) => n + x.contents[k]), zero.slice());
  c.check(ok && same(sums(r.save.caches), r.save.ledger.lost) && poolsConserve(r.save.totals, r.save.ledger), "afterwards Σ caches = L, pools conserve");
  // L holds more than the caches claim → the rest to S; 7 caches → only the newest 5 kept
  const t = clone(base);
  t.ledger.world[0] -= 700;
  t.ledger.lost = [700, 0, 0, 0, 0, 0, 0];
  t.caches = [1, 2, 3, 4, 5, 6, 7].map((id) => cache(id, [100, 0, 0, 0, 0, 0, 0]));
  const r2 = readSlot(createMemoryBackend({ "save/main": t }), "main");
  c.check(r2.status === "ok" && same(r2.save.caches.map((x) => x.id), [3, 4, 5, 6, 7]) && r2.save.ledger.lost[0] === 500 && r2.save.ledger.suspended[0] === 200, "7 caches: newest 5 kept, the 2 oldest's 200 lithic L → S");
  c.check(r2.status === "ok" && repairedParticles(r2.repairs) === 200 && poolsConserve(r2.save.totals, r2.save.ledger), "cache repair counted once (200), pools conserve");
  const u = clone(base);
  u.caches = [cache(1, [0, 0, 5, 0, 0, 0, 0])];
  const r3 = readSlot(createMemoryBackend({ "save/main": u }), "main");
  c.check(r3.status === "ok" && r3.save.caches.length === 0 && r3.repairs.length === 0, "a cache the pool cannot back (L empty) is dropped");
}

c.section("expedition in a session");
{
  const backend = createMemoryBackend();
  const clock = fakeClock();
  const opened = openConserveSession({ backend, intent: { kind: "new", seedText: "reef" }, hashSeed: seedFromString, clock });
  if (!opened.ok) throw new Error("new session failed");
  const session = opened.session;
  const exp = session.expedition;
  c.check(exp === session.expedition && exp.tankCapacity === 200 && exp.carried() === 0 && exp.caches().length === 0, "expedition created once: tank 200, empty, no caches");
  const node = session.nodeTable.sites.flatMap((x) => x.nodes).find((n) => n.amount >= 40)!;
  for (let i = 0; i < 30; i++) exp.absorb(node.id, 1 / 30);
  const half = exp.remaining(node.id);
  c.check(half > 0 && half < node.amount && exp.carried() === node.amount - half, "half a node absorbed: partial", `${node.amount - half} of ${node.amount}`);
  session.flush();
  const saved = backend.read("save/main") as WorldSave;
  c.check(same(saved.generation.partial, [[node.id, half]]) && saved.generation.harvested === "" && saved.ledger.player[node.kind] === node.amount - half, "saved: partial [id, left], P holds the particles");
  const cache = exp.loseCarried([12.5, -30, 40]);
  const afterDeath = backend.read("save/main") as WorldSave;
  c.check(!!cache && afterDeath.caches.length === 1 && afterDeath.ledger.lost[node.kind] === node.amount - half && afterDeath.ledger.player[node.kind] === 0, "death written at once: cache saved, P → L");
  session.close();
  const again = openConserveSession({ backend, intent: { kind: "continue" }, hashSeed: seedFromString, clock });
  if (!again.ok) throw new Error("continue failed");
  const e2 = again.session.expedition;
  c.check(e2.remaining(node.id) === half && e2.caches().length === 1 && e2.caches()[0].total === node.amount - half && same(e2.caches()[0].pos, [12.5, -30, 40]), "continue: node state and cache restored");
  again.session.close();
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
  c.check(session.report.totalParticles === 105_000 && session.report.conserved && session.report.poolTotals.base === 680 && session.report.bytes > 0, "report: totals, conserved, base 680, size");
  session.recordDiveStart();
  clock.advance(1000);
  c.check((backend.read("save/main") as WorldSave).stats.divesStarted === 0, "dive count written throttled, not at once");
  clock.advance(30_000);
  c.check((backend.read("save/main") as WorldSave).stats.divesStarted === 1 && (backend.read("save/main") as WorldSave).savedAt === clock.now(), "…written after the interval, savedAt updated");
  const tableBefore = JSON.stringify(session.siteTable);
  c.check(session.siteTable === session.siteTable && session.siteTable.sites.length === 100 && same(session.siteTable.allocInput, session.snapshot().generation.allocInput), "site table: built once, from generation.allocInput");
  session.ledger.transfer("world", "player", "lumen", 25);
  c.check(JSON.stringify(session.siteTable) === tableBefore && same(session.snapshot().generation.allocInput, [65400, 0, 17000, 16920, 4500, 0, 500]), "ledger changes within a generation leave R and the site table unchanged");
  c.check(session.report.sites.sitesX === 10 && Object.values(session.report.sites.byBiome).reduce((a, b) => a + b, 0) === 100, "report: site summary (10 × 10, 100 sites by biome)");
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

baseSaveChecks(c);
kindActivationChecks(c);

c.finish();
