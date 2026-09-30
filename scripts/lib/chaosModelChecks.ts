/**
 * Chaos model checks (plan M6): the ring outline agrees with the terrain's, the
 * tunables with the terrain's constants; M counts W, S and L but not P and B;
 * burning base fuel raises the next m; stage and thickness are monotone in m;
 * χ_g; stage 5 needs the abyssal lock.
 */
import { CRACKS, RING } from "../../src/games/deep-march/conserve/chaos/config";
import { chaosIntensity, chaosStage, genesisChaos } from "../../src/games/deep-march/conserve/chaos/model";
import { tideChaosInput } from "../../src/games/deep-march/conserve/chaos/tide";
import { wallThickness } from "../../src/games/deep-march/conserve/chaos/wallModel";
import { WORLD_SIZE } from "../../src/games/deep-march/conserve/config";
import { createGenesisLedger } from "../../src/games/deep-march/conserve/world/genesis";
import { TERRAIN } from "../../src/games/deep-march/terrain/config";
import { MACRO } from "../../src/games/deep-march/terrain/regions";
import { layoutRect } from "../../src/games/deep-march/terrain/siteLayout";
import { WALL_SHAPE } from "../../src/games/deep-march/terrain/wallConfig";
import { WALL_UNIT, createWallShape } from "../../src/games/deep-march/terrain/wallGeometry";
import type { Checker } from "./checks";
import { RING10 } from "./chaosFixture";
import { genesisLayout } from "./worldFixture";

function ringChecks(c: Checker): void {
  c.section("ring outline (chaos/ring.ts ↔ terrain/wallGeometry.ts)");
  c.check(RING.siteMetres === MACRO.cell * TERRAIN.worldScale && RING.cornerRadius === WALL_SHAPE.cornerRadius, "RING = MACRO.cell × worldScale, WALL_SHAPE.cornerRadius", `${RING.siteMetres} m, r ${RING.cornerRadius} m`);
  c.check(CRACKS.throughMargin >= WALL_SHAPE.inset + WALL_SHAPE.relief + WALL_SHAPE.swell, "a through crack's notch clears the inner face's deepest inset", `${CRACKS.throughMargin} ≥ ${WALL_SHAPE.inset + WALL_SHAPE.relief + WALL_SHAPE.swell} m`);
  const shape = createWallShape(layoutRect(genesisLayout(7), MACRO.cell), { thickness: 160, cracks: [] }, 7);
  const out = new Float64Array(4);
  let err = 0;
  for (let s = 0; s < RING10.perimeter * 1.5; s += 37.3) {
    shape.point(s / WALL_UNIT, 0, out);
    const p = RING10.point(s);
    err = Math.max(err, Math.hypot(p.x - out[0] * WALL_UNIT, p.z - out[1] * WALL_UNIT));
  }
  c.check(Math.abs(shape.perimeter * WALL_UNIT - RING10.perimeter) < 1e-6 && err < 1e-6, "same perimeter and the same point at every arc length", `P ${RING10.perimeter.toFixed(1)} m, max error ${err.toExponential(1)} m`);
  const edge = new Set<number>();
  for (let s = 0; s < RING10.perimeter; s += 8) edge.add(RING10.siteAt(s));
  const onEdge = [...edge].every((i) => {
    const x = i % WORLD_SIZE.sitesX, z = Math.floor(i / WORLD_SIZE.sitesX);
    return x === 0 || z === 0 || x === WORLD_SIZE.sitesX - 1 || z === WORLD_SIZE.sitesZ - 1;
  });
  c.check(onEdge && edge.size === 36, "siteAt: the 36 edge sites of the 10 × 10, nothing inside", `${edge.size} sites`);
}

function shareChecks(c: Checker): void {
  c.section("M = Σ (N − P − B): W, S, L count; P, B do not");
  const ledger = createGenesisLedger();
  const m = () => tideChaosInput({ state: ledger.toState(), totals: ledger.toState().totals, seed: 1, gen: 1, size: WORLD_SIZE, center: null, siteHarvest: [] }).m;
  const N = ledger.grandTotal(), m0 = m();
  ledger.transferVector("world", "suspended", [500, 0, 0, 0, 0, 0, 0]);
  ledger.transferVector("world", "lost", [300, 0, 0, 0, 0, 0, 0]);
  c.check(m() === m0, "world → suspended / lost leaves m unchanged");
  ledger.transferVector("world", "player", [200, 0, 0, 0, 0, 0, 0]);
  const mP = m();
  ledger.transferVector("player", "base", [200, 0, 0, 0, 0, 0, 0]);
  const mB = m();
  c.check(Math.abs(m0 - mP - 200 / N) < 1e-12 && mB === mP, "200 carried (P) or locked (B) lower m by 200 / N", `${m0.toFixed(4)} → ${mP.toFixed(4)}`);
  ledger.transferVector("base", "suspended", [60, 0, 0, 0, 0, 0, 0]);
  c.check(m() > mB && Math.abs(m() - mB - 60 / N) < 1e-12, "fuel burnt from the base (B → S) raises the next m");
  const g = genesisChaos(ledger.toState().totals.map((n, k) => n - ledger.toState().pools.base[k] - ledger.toState().pools.player[k]), ledger.toState().totals);
  c.check(g.cracks.length === 0 && g.stage === 0 && g.wallThickness === 160, "genesis chaos: stage 0, T = 160 m, no cracks", `m ${g.m.toFixed(4)}`);
}

function curveChecks(c: Checker): void {
  c.section("stages, thickness, χ_g");
  let mono = true, prevStage = -1, prevT = -1;
  for (let m = 0.7; m <= 1.0000001; m += 0.0005) {
    const st = chaosStage(m, 0), T = wallThickness(m);
    if ((prevStage >= 0 && st > prevStage) || T < prevT) mono = false;
    [prevStage, prevT] = [st, T];
  }
  c.check(mono, "m ↑ → stage never rises, wall never thins (monotone)");
  const cases: [number, number][] = [[0.95, 0], [0.92, 0], [0.919, 1], [0.9, 1], [0.899, 2], [0.87, 2], [0.869, 3], [0.84, 3], [0.839, 4], [0.8, 4], [0.799, 4]];
  c.check(cases.every(([m, s]) => chaosStage(m, 0) === s), "thresholds 0.92 / 0.90 / 0.87 / 0.84 / 0.80", cases.map(([m]) => chaosStage(m, 0)).join(" "));
  c.check(chaosStage(0.79, 199) === 4 && chaosStage(0.79, 200) === 5 && chaosStage(0.81, 1000) === 4, "stage 5 only below 0.80 with ≥ 200 abyssal locked");
  c.check(wallThickness(0.95) === 160 && wallThickness(0.78) === 24 && Math.abs(wallThickness(0.9) - 132.1) < 1, "T: 160 m at m_full, 24 m at m_break, ≈ 132 m at 0.90", `${wallThickness(0.9).toFixed(1)} m`);
  c.check(chaosIntensity(0.93) === 0 && chaosIntensity(0.92) === 0 && Math.abs(chaosIntensity(0.85) - 0.5) < 1e-12 && chaosIntensity(0.7) === 1, "χ_g = clamp((0.92 − m) / 0.14, 0, 1)");
}

export function chaosModelChecks(c: Checker): void {
  ringChecks(c);
  shareChecks(c);
  curveChecks(c);
}
