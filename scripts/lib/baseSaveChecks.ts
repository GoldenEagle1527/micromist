/**
 * test:save — the base in the save (plan M5): v3 → v4 migration, shape
 * validation of `base`, reconcileBase (B wins), the session saving the base
 * with the ledger, the frozen sites entering the site table only after the
 * founding generation, and the dive count (lander before the base, departures after).
 */
import { SAVE } from "../../src/games/deep-march/conserve/config";
import { createWorldSave } from "../../src/games/deep-march/conserve/save/createSave";
import { reconcileBase } from "../../src/games/deep-march/conserve/save/reconcileBase";
import { createMemoryBackend } from "../../src/games/deep-march/conserve/save/saveBackend";
import { readSlot } from "../../src/games/deep-march/conserve/save/saveRepository";
import type { WorldSave } from "../../src/games/deep-march/conserve/save/schema";
import { openConserveSession } from "../../src/games/deep-march/conserve/session/openSession";
import { seedFromString } from "../../src/games/deep-march/terrain/noise";
import { CENTRE_SITE, foundedRig, RECT } from "./baseFixture";
import type { Checker } from "./checks";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = <T>(v: T): T => structuredClone(v);
const newSave = (): WorldSave => createWorldSave({ id: SAVE.slotId, seedText: "abyss", seed: seedFromString("abyss"), now: 0 });

/** A v4 save with a founded base (rock and ferro carried, a lighthouse and storage built). */
function foundedSave(): WorldSave {
  const backend = createMemoryBackend();
  const opened = openConserveSession({ backend, intent: { kind: "new", seedText: "abyss" }, hashSeed: seedFromString });
  if (!opened.ok) throw new Error("fixture session");
  const s = opened.session;
  s.base.found([0, -100, 0], 0, CENTRE_SITE, RECT);
  s.ledger.transferVector("world", "player", [180, 0, 0, 20, 0, 0, 0]);
  s.base.build("storage", [22, -100, 0], 0, RECT);
  s.close();
  return backend.read("save/main") as WorldSave;
}

export function baseSaveChecks(c: Checker): void {
  c.section("base in the save (M5)");
  {
    const v3 = clone(newSave()) as unknown as Record<string, unknown>;
    delete v3.base;
    delete (v3.generation as Record<string, unknown>).dives;
    v3.v = 3;
    (v3.stats as Record<string, number>).divesStarted = 4;
    const read = readSlot(createMemoryBackend({ "save/main": v3 }), "main");
    c.check(read.status === "ok" && read.migratedFrom === 3 && read.save.base === null && read.save.generation.dives === 4 && read.repairs.length === 0, "v3 save (M4) → v4: no base, generation.dives = dives started, no repairs");
  }
  {
    const saved = foundedSave();
    const read = readSlot(createMemoryBackend({ "save/main": saved }), "main");
    c.check(read.status === "ok" && read.repairs.length === 0 && same(read.save.base, saved.base) && saved.base!.structures.length === 2, "a founded base round-trips without repairs");
    const corruptions: [string, (b: Record<string, unknown>) => void][] = [
      ["base not an object", (b) => (b.base = 5)],
      ["base missing", (b) => delete b.base],
      ["base.center", (b) => ((b.base as Record<string, unknown>).center = [0, 0])],
      ["base.foundedGen", (b) => ((b.base as Record<string, unknown>).foundedGen = 0)],
      ["base.frozen", (b) => ((b.base as Record<string, unknown>).frozen = [{ i: 1 }])],
      ["base.structures kind", (b) => (((b.base as Record<string, unknown>).structures as Record<string, unknown>[])[1].kind = "tower")],
      ["base.structures no core", (b) => ((b.base as Record<string, unknown>).structures = ((b.base as Record<string, unknown>).structures as Record<string, unknown>[]).slice(1))],
      ["base.structures duplicate id", (b) => (((b.base as Record<string, unknown>).structures as Record<string, unknown>[])[1].id = 1)],
      ["base.storage", (b) => ((b.base as Record<string, unknown>).storage = [1])],
      ["base.energy", (b) => ((b.base as Record<string, unknown>).energy = -1)],
      ["generation.dives", (b) => ((b.generation as Record<string, unknown>).dives = -1)],
    ];
    for (const [name, corrupt] of corruptions) {
      const raw = clone(saved) as unknown as Record<string, unknown>;
      corrupt(raw);
      const r = readSlot(createMemoryBackend({ "save/main": raw }), "main");
      c.check(r.status === "unreadable", `corrupted ${name} → unreadable`, r.status === "unreadable" ? r.reason : r.status);
    }
  }
  {
    const rig = foundedRig();
    const b = rig.base.toSave()!;
    const pool = rig.ledger.pool("base");
    c.check(same(reconcileBase(b, pool).base, b) && reconcileBase(b, pool).repairs.length === 0, "reconcileBase: a matching base is left as it is");
    const more = pool.slice();
    more[0] += 33;
    const up = reconcileBase(b, more);
    c.check(up.base!.storage[0] === b.storage[0] + 33 && up.repairs.some((r) => r.cause === "base" && r.delta === 33), "B holds more: the extra becomes storage (repair \"base\")");
    const less = pool.slice();
    less[0] -= 150;
    const down = reconcileBase(b, less);
    c.check(down.base!.storage[0] === b.storage[0] - 150, "B holds less: storage is cut first");
    const lost = pool.slice();
    lost[0] = 100;
    const gone = reconcileBase(b, lost);
    c.check(gone.base === null, "B cannot even pay for the core: no base (B left as it is)");
  }
  {
    const backend = createMemoryBackend();
    const opened = openConserveSession({ backend, intent: { kind: "new", seedText: "reef" }, hashSeed: seedFromString });
    if (!opened.ok) throw new Error("session");
    const s = opened.session;
    s.recordDiveStart();
    c.check(s.snapshot().generation.dives === 1 && s.snapshot().stats.divesStarted === 1, "no base: a dive counts when the loading screen finishes (from the lander)");
    const tableBefore = JSON.stringify(s.siteTable);
    const r = s.base.found([0, -100, 0], 0, CENTRE_SITE, RECT);
    const stored = backend.read("save/main") as WorldSave;
    c.check(r.ok && stored.base !== null && stored.base.foundedGen === 1 && stored.ledger.base[0] === s.ledger.amount("base", "lithic"), "founding is written at once, with the ledger");
    c.check(JSON.stringify(s.siteTable) === tableBefore && s.siteTable.sites.every((x) => !x.frozen), "the founding generation keeps its site table (frozen sites apply from the next tide)");
    s.recordDiveStart();
    c.check(s.snapshot().generation.dives === 1, "with a base, finishing the loading screen is not a dive");
    s.base.recordDeparture();
    c.check(s.snapshot().generation.dives === 2 && s.snapshot().stats.divesStarted === 2, "leaving the protection radius is one dive");
    s.close();
    const next = clone(backend.read("save/main") as WorldSave);
    next.gen = 2;
    const later = openConserveSession({ backend: createMemoryBackend({ "save/main": next }), intent: { kind: "continue" }, hashSeed: seedFromString });
    const frozen = later.ok ? later.session.siteTable.sites.filter((x) => x.frozen) : [];
    c.check(later.ok && frozen.length === 9 && frozen.every((f) => { const k = next.base!.frozen.find((x) => x.i === f.i)!; return k.jx === f.jx && k.region === f.region && k.delta === f.delta; }), "a later generation's table keeps the 9 frozen sites as saved");
    if (later.ok) later.session.close();
  }
}
