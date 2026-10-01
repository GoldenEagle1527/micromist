/**
 * Tide / forecast / save checks (plan M6): the forecast is the tide's result bit
 * for bit; within a generation the chaos and the wall never change while the
 * ledger moves, and forecasting moves no particle; save v5 (genesis chaos,
 * v4 → v5, validation, round trip); open cracks reach SiteLayout.wall with the
 * through flag and extent; a through crack's notch runs past the outer face.
 */
import { forecastTide } from "../../src/games/deep-march/conserve/chaos/forecast";
import { genesisChaos, type ChaosState } from "../../src/games/deep-march/conserve/chaos/model";
import { chaosAtTide } from "../../src/games/deep-march/conserve/chaos/tide";
import { terrainLayoutOf } from "../../src/games/deep-march/conserve/platform/terrainLayout";
import { createWorldSave } from "../../src/games/deep-march/conserve/save/createSave";
import { createMemoryBackend } from "../../src/games/deep-march/conserve/save/saveBackend";
import { readSlot, writeSlot } from "../../src/games/deep-march/conserve/save/saveRepository";
import { SAVE_VERSION, type WorldSave } from "../../src/games/deep-march/conserve/save/schema";
import { openConserveSession } from "../../src/games/deep-march/conserve/session/openSession";
import { seedFromString } from "../../src/games/deep-march/terrain/noise";
import { MACRO } from "../../src/games/deep-march/terrain/regions";
import { layoutRect } from "../../src/games/deep-march/terrain/siteLayout";
import { WALL_SHAPE } from "../../src/games/deep-march/terrain/wallConfig";
import { WALL_UNIT, createWallShape } from "../../src/games/deep-march/terrain/wallGeometry";
import type { Checker } from "./checks";
import { tideInput, tideRun } from "./chaosFixture";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function forecastChecks(c: Checker): void {
  c.section("forecast = the tide");
  const now = tideRun([0.905, 0.885, 0.87])[2];
  let exact = true;
  for (const m of [0.95, 0.912, 0.905, 0.889, 0.86, 0.83, 0.79]) {
    const input = tideInput(m, { gen: 5, siteHarvest: Array.from({ length: 100 }, (_, i) => (i % 7) / 7) });
    if (!same(forecastTide(now, input).next, chaosAtTide(now, input))) exact = false;
  }
  c.check(exact, "forecastTide(...).next ≡ chaosAtTide(...) (7 m values, bit for bit)");
  const f = forecastTide(now, tideInput(0.912, { gen: 5 }));
  c.check(f.healing === 2 && f.opening === 0 && f.open === 0 && f.now.m === now.m, "forecast counts: 0.912 heals both open cracks", `${f.healing} healing`);
  const g = forecastTide(now, tideInput(0.85, { gen: 5 }));
  c.check(g.opening === 1 && g.open === 3 && g.healing === 0, "0.85: one more opens, three open after", `${g.opening} opening, ${g.open} open`);
}

function sessionChecks(c: Checker): void {
  c.section("a generation's chaos is fixed; forecasting moves nothing");
  const backend = createMemoryBackend();
  const opened = openConserveSession({ backend, intent: { kind: "new", seedText: "chaos" }, hashSeed: seedFromString });
  if (!opened.ok) return void c.check(false, "session opens");
  const s = opened.session;
  const wall0 = JSON.stringify(s.wall), chaos0 = JSON.stringify(s.chaos);
  const f0 = s.base.forecast();
  s.ledger.transferVector("world", "player", [150, 0, 20, 30, 0, 0, 0]);
  const before = JSON.stringify(s.ledger.toState());
  const f1 = s.base.forecast();
  c.check(JSON.stringify(s.ledger.toState()) === before && s.ledger.isConserved(), "forecast() moves no particle (ledger unchanged, conserved)");
  c.check(JSON.stringify(s.wall) === wall0 && JSON.stringify(s.chaos) === chaos0 && f1.m < f0.m, "absorbing: the wall / chaos stay, only the forecast m drops", `${f0.m.toFixed(4)} → ${f1.m.toFixed(4)}`);
  c.check(f0.now.m === s.chaos.m && f0.now.thickness === s.wall.thickness && f0.stage === 0, "forecast 'now' is this generation's chaos");
  s.close();
}

function saveChecks(c: Checker): void {
  c.section("save v5: chaos");
  const save = createWorldSave({ id: "main", seedText: "x", seed: 5, now: 0 });
  c.check(save.v === SAVE_VERSION && same(save.chaos, genesisChaos(save.generation.allocInput, save.totals)) && save.chaos.stage === 0 && save.chaos.wallThickness === 160, "genesis save: stage 0, T 160 m, no cracks");
  const v4 = structuredClone(save) as unknown as Record<string, unknown>;
  delete v4.chaos;
  v4.v = 4;
  const r4 = readSlot(createMemoryBackend({ "save/main": v4 }), "main");
  c.check(r4.status === "ok" && r4.migratedFrom === 4 && same(r4.save.chaos, save.chaos) && r4.repairs.length === 0, "v4 save (M5) → v5: chaos from allocInput, no cracks, no repairs");
  const cracked: ChaosState = tideRun([0.85])[0];
  const withCracks: WorldSave = { ...save, chaos: cracked };
  const backend = createMemoryBackend();
  writeSlot(backend, withCracks);
  const back = readSlot(backend, "main");
  c.check(back.status === "ok" && same(back.save.chaos, cracked), "cracks round-trip through the slot");
  const bad = (patch: (ch: Record<string, unknown>) => void) => {
    const raw = structuredClone(withCracks) as unknown as Record<string, unknown>;
    patch(raw.chaos as Record<string, unknown>);
    return readSlot(createMemoryBackend({ "save/main": raw }), "main").status === "unreadable";
  };
  const cracksOf = (ch: Record<string, unknown>) => ch.cracks as Record<string, unknown>[];
  c.check(bad((ch) => (ch.stage = 9)) && bad((ch) => (ch.wallThickness = 500)) && bad((ch) => (cracksOf(ch)[0].healed = true)) && bad((ch) => cracksOf(ch).push({ ...cracksOf(ch)[0] })), "malformed chaos refused (stage, thickness, open + healed, duplicate j)");
  const opened = openConserveSession({ backend, intent: { kind: "continue" }, hashSeed: seedFromString });
  if (!opened.ok) return void c.check(false, "cracked save opens");
  const wall = opened.session.wall;
  const layout = terrainLayoutOf(opened.session.siteTable, wall);
  const lc = layout.wall!.cracks;
  c.check(wall.thickness === cracked.wallThickness && lc.length === 3 && lc.every((k, i) => k.s === cracked.cracks[i].s && k.through === false && Math.abs(k.extent![1] - k.extent![0] - k.width) < 1e-9), "SiteLayout.wall: the open cracks with through flag and arc extent", lc.map((k) => `${k.s.toFixed(0)} m / ${k.width.toFixed(1)} m`).join(", "));
  opened.session.close();
}

function geometryChecks(c: Checker): void {
  c.section("crack geometry (terrain/wallGeometry.ts)");
  const deep = tideRun([0.83], { gen: 8 })[0];
  const layout = terrainLayoutOf(openless(), { m: deep.m, sigma: 0, thickness: deep.wallThickness, cracks: deep.cracks.filter((k) => k.open).map((k) => ({ s: k.s, width: k.width, depth: k.depth, through: k.through, extent: [k.s - k.width / 2, k.s + k.width / 2] })) });
  const shape = createWallShape(layoutRect(layout, MACRO.cell), layout.wall!, 3);
  const T = deep.wallThickness / WALL_UNIT;
  const passes = (s0: number, width: number) => {
    // every height in the chaos void's band has a spot in the notch past the outer face
    for (let y = WALL_SHAPE.voidLo; y <= WALL_SHAPE.voidHi; y += 2) {
      let best = -Infinity;
      for (let s = s0 - width; s <= s0 + width; s += 0.25) best = Math.max(best, -shape.face(s / WALL_UNIT, y / WALL_UNIT));
      if (best < T) return false;
    }
    return true;
  };
  const through = deep.cracks.filter((k) => k.through), shallow = deep.cracks.filter((k) => k.open && !k.through);
  c.check(through.length === 1 && through.every((k) => passes(k.s, k.width)), "a through crack opens past the outer face at every height of the band", `${through.length} through of ${deep.cracks.length}`);
  c.check(shallow.length > 0 && shallow.every((k) => !passes(k.s, k.width)), "the others stop inside the wall");
}

/** The genesis site table of a fixed seed (the wall passed separately). */
function openless() {
  const opened = openConserveSession({ backend: createMemoryBackend(), intent: { kind: "new", seedText: "geo" }, hashSeed: seedFromString });
  if (!opened.ok) throw new Error("fixture: session");
  const table = opened.session.siteTable;
  opened.session.close();
  return table;
}

export function chaosTideChecks(c: Checker): void {
  forecastChecks(c);
  sessionChecks(c);
  saveChecks(c);
  geometryChecks(c);
}
