/**
 * Crack checks (plan M6, design doc §4.3): size and the through flag; spots
 * deterministic, ≥ 600 m from the base and ≥ 500 m apart for any base and
 * harvest; biased toward the harvested wall and the base; open / heal with the
 * +0.01 hysteresis, a scar that reopens at the same spot; fixed across tides.
 */
import { BREACH, CRACKS } from "../../src/games/deep-march/conserve/chaos/config";
import { crackCandidates, crackExtent, crackSize, evolveCracks, placeCrack } from "../../src/games/deep-march/conserve/chaos/cracks";
import type { ChaosCrack, ChaosState } from "../../src/games/deep-march/conserve/chaos/model";
import type { Checker } from "./checks";
import { RING10, SITES, crackContext, rng, tideRun } from "./chaosFixture";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const dist = (a: ChaosCrack, b: ChaosCrack) => {
  const p = RING10.point(a.s), q = RING10.point(b.s);
  return Math.hypot(p.x - q.x, p.z - q.z);
};

function sizeChecks(c: Checker): void {
  c.section("crack size");
  const a = crackSize(0.9, 0.9, 100), b = crackSize(0.9, 0.897, 129), d = crackSize(0.9, 0.835, 50), e = crackSize(0.9, 0.836, 50);
  c.check(a.width === 4 && Math.abs(a.depth - 40) < 1e-9 && !a.through, "at the threshold: 4 m wide, 40 % deep, not through");
  c.check(Math.abs(b.width - 5.2) < 1e-9 && Math.abs(b.depth - 0.43 * 129) < 1e-9, "0.003 below: 5.2 m, 43 % (design §8.3: ≈ 5 m at m 0.897)", `${b.width.toFixed(1)} m, ${(b.depth / 129 * 100).toFixed(0)} %`);
  c.check(d.through && d.width >= 30 && d.depth === 50 + CRACKS.throughMargin && !e.through, "first through at m ≈ 0.835 (full depth, ≥ 30 m)", `${d.width.toFixed(1)} m`);
  c.check(crackSize(0.9, 0.5, 30).width === 60 && crackSize(0.9, 0.95, 100).width === 4, "width clamped to [4, 60] m");
  let mono = true;
  for (let m = 0.9; m > 0.78; m -= 0.001) if (crackSize(0.9, m, 100).width < crackSize(0.9, m + 0.001, 100).width || crackSize(0.9, m, 100).depth < crackSize(0.9, m + 0.001, 100).depth) mono = false;
  c.check(mono, "m ↓ → wider and deeper (at a fixed thickness)");
  const br = crackSize(BREACH.mOpen, 0.79, 26, true);
  c.check(br.through && br.width >= 120, "main breach: ≥ 120 m, through", `${br.width} m`);
  c.check(same(crackExtent({ s: 100, width: 30 }), [85, 115]), "extent = [s − w/2, s + w/2]");
}

function placementChecks(c: Checker): void {
  c.section("crack spots");
  c.check(crackCandidates(RING10).length === Math.round(RING10.perimeter / 32), "a candidate every 32 m of the ring", `${crackCandidates(RING10).length}`);
  const r = rng(9);
  let worstBase = Infinity, worstGap = Infinity, placedAll = true, determ = true;
  for (let t = 0; t < 60; t++) {
    const harvest = Array.from({ length: SITES }, () => (r() < 0.3 ? r() : 0));
    const base = { x: (r() - 0.5) * 2600, z: (r() - 0.5) * 2600 };
    const ctx = crackContext(0.79, { seed: 1000 + t, base, siteHarvest: harvest, thickness: 30 });
    const cracks = evolveCracks([], ctx);
    if (cracks.length !== 6) placedAll = false;
    if (!same(cracks, evolveCracks([], ctx))) determ = false;
    for (const k of cracks) {
      const p = RING10.point(k.s);
      worstBase = Math.min(worstBase, Math.hypot(p.x - base.x, p.z - base.z));
      for (const o of cracks) if (o !== k) worstGap = Math.min(worstGap, dist(k, o));
    }
  }
  c.check(placedAll, "60 random worlds at m 0.79: all six cracks placed");
  c.check(worstBase >= CRACKS.minBaseDistance, "every crack ≥ 600 m from the base core", `closest ${worstBase.toFixed(0)} m`);
  c.check(worstGap >= CRACKS.minSpacing, "cracks ≥ 500 m apart", `closest ${worstGap.toFixed(0)} m`);
  c.check(determ, "same inputs → the same spots (deterministic)");
  // the harvested wall site draws the first crack (0.35 weight beats the rest's spread)
  let hits = 0;
  for (let t = 0; t < 30; t++) {
    const site = [0, 9, 90, 99, 4, 40, 49, 94][t % 8];
    const harvest = new Array(SITES).fill(0);
    harvest[site] = 1;
    const s = placeCrack(0, crackContext(0.89, { seed: 77 + t, base: null, siteHarvest: harvest }), []);
    if (s !== null && RING10.siteAt(s) === site) hits++;
  }
  c.check(hits >= 27, "a fully harvested wall site draws the first crack", `${hits}/30`);
  // toward the base: the chosen spot is nearer the base than the average candidate
  let nearer = 0;
  for (let t = 0; t < 40; t++) {
    const base = { x: (t % 2 ? 1 : -1) * 1300, z: (t % 3) * 500 - 500 };
    const s = placeCrack(0, crackContext(0.89, { seed: 500 + t, base }), [])!;
    const p = RING10.point(s);
    const d = Math.hypot(p.x - base.x, p.z - base.z);
    const mean = crackCandidates(RING10).reduce((a, q) => a + Math.hypot(RING10.point(q).x - base.x, RING10.point(q).z - base.z), 0) / crackCandidates(RING10).length;
    if (d < mean) nearer++;
  }
  c.check(nearer >= 30, "no harvest: the first crack leans toward the base (the eye's gaze)", `${nearer}/40 nearer than the mean spot`);
}

function tideChecks(c: Checker): void {
  c.section("open, heal, scar, reopen");
  const run = tideRun([0.905, 0.899, 0.885, 0.9, 0.909, 0.91, 0.905, 0.895, 0.85]);
  const first = (st: ChaosState) => st.cracks.find((k) => k.j === 0);
  c.check(run[0].cracks.length === 0 && first(run[1])?.open === true && first(run[1])?.bornGen === 3, "crack 0 opens at the first tide below 0.90 (born gen 3)");
  const s0 = first(run[1])!.s;
  c.check(run.slice(1).every((st) => first(st)?.s === s0 && first(st)?.bornGen === 3), "its spot and birth never change afterwards");
  c.check(first(run[3])!.open && first(run[4])!.open && first(run[3])!.width === 4, "0.900 and 0.909: still open (inside the +0.01 band), 4 m");
  const scar = first(run[5])!;
  c.check(!scar.open && scar.healed && !scar.through && scar.width === 4, "0.910: healed — a scar keeping its last size", `${scar.width} m`);
  c.check(!first(run[6])!.open && first(run[6])!.healed, "0.905: stays a scar (hysteresis)");
  c.check(first(run[7])!.open && !first(run[7])!.healed && first(run[7])!.s === s0, "0.895: reopens at the same spot");
  const deep = run[8].cracks;
  c.check(deep.length === 3 && deep.every((k) => k.open) && deep.map((k) => k.j).join() === "0,1,2", "0.85: cracks 0, 1, 2 open (thresholds 0.90 / 0.875 / 0.855)");
  const frozen = structuredClone(run[7]);
  evolveCracks(run[7].cracks, crackContext(0.7, { gaze: true }));
  c.check(same(frozen, run[7]), "evolving never touches the previous state");
  const gaze = tideRun([0.79], { abyssalLocked: 250 })[0], noGaze = tideRun([0.79])[0];
  c.check(gaze.stage === 5 && gaze.cracks.some((k) => k.j === BREACH.j && k.open && k.through) && noGaze.stage === 4 && !noGaze.cracks.some((k) => k.j === BREACH.j), "the main breach opens only with the gaze (stage 5)");
  c.check(tideRun([0.79, 0.95]).at(-1)!.cracks.every((k) => !k.open && k.healed), "a full backfill heals every crack (all scars)");
}

export function chaosCrackChecks(c: Checker): void {
  sizeChecks(c);
  placementChecks(c);
  tideChecks(c);
}
