/**
 * Frontline Tide vertical slice: match → build/merge → night → front shift → day 2.
 * Run: npm run test:frontline
 */
import { findMatches, hasMove, resolveSwap, scoreClear } from "../src/games/frontline-tide/board";
import { makeDefense, placeDefense, resolveMerges } from "../src/games/frontline-tide/build";
import { frontlineTideConfig } from "../src/games/frontline-tide/config";
import { completeFrontShift, createGame, enterBuild, enterNight } from "../src/games/frontline-tide/engine";
import { enemyHpForDay, nightEnemyCount, stepNight } from "../src/games/frontline-tide/night";
import type { Cell, GameState, GemColor, Pos } from "../src/games/frontline-tide/types";
import { games, isGameListed } from "../src/games/catalog";
import { createChecker } from "./lib/checks";

const c = createChecker();

function gem(color: GemColor): Cell {
  return { kind: "gem", color };
}

function checkerBoard(): Cell[][] {
  const n = frontlineTideConfig.boardSize;
  return Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, col) => gem(((r + col) % 3) as GemColor)),
  );
}

function withBoard(base: GameState, board: Cell[][]): GameState {
  return { ...base, board };
}

function runNight(state: GameState): { state: GameState; ticks: number; heartsLost: number } {
  let s = state;
  const start = s.hearts;
  let ticks = 0;
  while (s.phase === "night" && ticks < 800) {
    s = stepNight(s).state;
    ticks += 1;
  }
  return { state: s, ticks, heartsLost: start - s.hearts };
}

function greedySwap(state: GameState): GameState | null {
  const n = state.board.length;
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      const a = { r, c: col };
      const neighbors: Pos[] = [
        { r, c: col + 1 },
        { r: r + 1, c: col },
      ];
      for (const b of neighbors) {
        if (b.r >= n || b.c >= n) continue;
        const res = resolveSwap(state, a, b);
        if (res.ok) return res.state;
      }
    }
  }
  return null;
}

c.section("catalog");
{
  const meta = games.find((g) => g.slug === "frontline-tide");
  c.check(meta !== undefined, "slug is registered");
  c.check(meta?.audience === "staging", "audience is staging");
  c.check(meta?.title.zh === "前线潮汐" && meta?.title.en === "Frontline Tide", "titles");
  if (meta) {
    c.check(isGameListed(meta, "staging") && isGameListed(meta, "local"), "listed on staging and local");
    c.check(!isGameListed(meta, "prod"), "hidden on prod");
  }
}

c.section("match");
{
  const fresh = createGame(7);
  c.check(fresh.phase === "day_match" && fresh.day === 1, "new game is day 1 match");
  c.check(fresh.hearts === frontlineTideConfig.hearts, "starts with configured hearts");
  c.check(fresh.swapsLeft === frontlineTideConfig.dailySwaps, "starts with configured swaps");
  c.check(fresh.board.length === 8 && fresh.board[0]!.length === 8, "8×8");
  c.check(findMatches(fresh.board).length === 0, "opening board has no free match");
  c.check(hasMove(fresh.board), "opening board has a legal swap");
  c.check(createGame(7).board[0]![0]!.kind === createGame(7).board[0]![0]!.kind, "same seed is stable enough to replay");
  const again = createGame(7);
  c.check(JSON.stringify(again.board) === JSON.stringify(fresh.board), "same seed, same board");

  const board = checkerBoard();
  // Swap (5,1) with (5,2) lines up three 1s. Clearing them drops two 0s onto a third.
  board[5]![1] = gem(1);
  board[5]![2] = gem(2);
  board[5]![3] = gem(1);
  board[5]![4] = gem(1);
  board[5]![5] = gem(0);
  board[3]![2] = gem(0);
  board[4]![2] = gem(0);
  board[6]![2] = gem(0);
  board[7]![2] = gem(1);
  const stable = findMatches(board);
  c.check(stable.length === 0, "crafted board is stable", stable.map((p) => `${p.r},${p.c}`).join(" "));

  const armed = withBoard(
    { ...fresh, swapsLeft: 8, points: 0, phase: "day_match", bands: Array.from({ length: 8 }, () => "shoal" as const) },
    board,
  );
  const before = JSON.stringify(armed.board);
  const illegal = resolveSwap(armed, { r: 0, c: 0 }, { r: 0, c: 1 });
  c.check(!illegal.ok && illegal.ok === false && illegal.reason === "no-match", "illegal swap is rejected");
  c.check(JSON.stringify(armed.board) === before && armed.swapsLeft === 8, "illegal swap spends nothing");

  const far = resolveSwap(armed, { r: 0, c: 0 }, { r: 0, c: 2 });
  c.check(!far.ok && far.reason === "not-adjacent", "non-adjacent swap is rejected");

  const legal = resolveSwap(armed, { r: 5, c: 1 }, { r: 5, c: 2 });
  c.check(legal.ok, "legal swap clears");
  if (legal.ok) {
    c.check(legal.steps.length >= 2, "chain is produced", `steps=${legal.steps.length}`);
    c.check(legal.steps[0]!.points >= 3, "first clear pays for the gems");
    const total = legal.steps.reduce((sum, step) => sum + step.points, 0);
    c.check(legal.state.points === total, "points equal the sum of chain steps");
    c.check(legal.state.swapsLeft === 7, "legal swap spends one");
    c.check(legal.steps[1]!.chain === 2, "second step is chain 2");
    c.check(legal.steps[1]!.points === frontlineTideConfig.chainFlatBonus, "later chain steps add a flat bonus");
  }

  const dry = { ...armed, swapsLeft: 0 };
  const blocked = resolveSwap(dry, { r: 5, c: 1 }, { r: 5, c: 2 });
  c.check(!blocked.ok && blocked.reason === "no-swaps", "swap cap is enforced");

  let capped = createGame(3);
  let spent = 0;
  while (spent < 20) {
    const next = greedySwap(capped);
    if (!next) break;
    capped = next;
    spent += 1;
  }
  c.check(spent <= frontlineTideConfig.dailySwaps, "cannot swap more than the daily cap", `spent=${spent}`);
  c.check(capped.swapsLeft === frontlineTideConfig.dailySwaps - spent, "counter matches successful swaps");
  const extra = greedySwap(capped);
  c.check(extra === null, "no further swap once the search stops");
}

c.section("build");
{
  const base = enterBuild({ ...createGame(1), points: 9 });
  const row = frontlineTideConfig.pathRow;
  const a = placeDefense(base, row, 2);
  c.check(a.ok && a.state.points === 6 && a.merges.length === 0, "first T1 spends t1Cost");
  const b = a.ok ? placeDefense(a.state, row, 3) : a;
  const d = b.ok ? placeDefense(b.state, row, 4) : b;
  c.check(d.ok && d.merges.length === 1 && d.merges[0]!.tier === 2, "three in a row merge to T2");
  if (d.ok) {
    const at = d.state.board[row]![4]!;
    c.check(at.kind === "defense" && at.tier === 2, "upgrade stays on the placed cell");
    c.check(d.state.board[row]![2]!.kind === "empty" && d.state.board[row]![3]!.kind === "empty", "the other two cells clear");
    const occupied = placeDefense(d.state, row, 4);
    c.check(!occupied.ok && occupied.reason === "occupied", "cannot stack on a defense");
  }

  const l0 = placeDefense(base, row, 1);
  const l1 = l0.ok ? placeDefense(l0.state, row + 1, 1) : l0;
  c.check(l1.ok && l1.merges.length === 0, "a pair does not merge");
  const l2 = l1.ok ? placeDefense({ ...l1.state, points: l1.state.points + frontlineTideConfig.t1Cost }, row, 2) : l1;
  c.check(l2.ok && l2.merges.some((m) => m.tier === 2), "an L of three merges");

  let tower = enterBuild({ ...createGame(2), points: 30 });
  for (let i = 0; i < 3; i++) {
    const p1 = placeDefense(tower, 1, i);
    const p2 = p1.ok ? placeDefense(p1.state, 1, i + 3) : p1;
    const p3 = p2.ok ? placeDefense(p2.state, 1, i + 6 > 7 ? 0 : i + 6) : p2;
    if (!p3.ok) break;
    tower = p3.state;
  }
  const poor = { ...base, points: frontlineTideConfig.t1Cost - 1 };
  c.check(!placeDefense(poor, row, 1).ok, "cannot place without points");

  let merged = enterBuild({ ...createGame(4), points: 40 });
  const t2Spots: Pos[][] = [
    [
      { r: 6, c: 0 },
      { r: 6, c: 1 },
      { r: 6, c: 2 },
    ],
    [
      { r: 6, c: 4 },
      { r: 5, c: 3 },
      { r: 6, c: 3 },
    ],
    [
      { r: 6, c: 5 },
      { r: 5, c: 4 },
      { r: 6, c: 4 },
    ],
  ];
  let sawT3 = false;
  for (const group of t2Spots) {
    for (const spot of group) {
      const placed = placeDefense(merged, spot.r, spot.c);
      c.check(placed.ok, `place ${spot.r},${spot.c}`);
      if (!placed.ok) continue;
      merged = placed.state;
      if (placed.merges.some((m) => m.tier === 3)) sawT3 = true;
    }
  }
  c.check(sawT3, "three adjacent T2s merge to T3");
  const capped = checkerBoard();
  capped[0]![0] = makeDefense(3);
  capped[0]![1] = makeDefense(3);
  capped[0]![2] = makeDefense(3);
  const stuck = resolveMerges(capped, { r: 0, c: 2 });
  c.check(stuck.length === 0 && capped[0]![2]!.kind === "defense" && capped[0]![2]!.tier === 3, "T3 does not promote");
}

c.section("night and shift");
{
  let slack = enterNight(enterBuild(createGame(11)));
  const day1 = runNight(slack);
  c.check(day1.state.phase === "front_shift", "an unheld day-1 wave shifts the front", day1.state.phase);
  c.check(day1.state.hearts === frontlineTideConfig.hearts - nightEnemyCount(1), "each leaked biter takes a heart", `hearts=${day1.state.hearts} ticks=${day1.ticks}`);
  const day1Ms = day1.ticks * frontlineTideConfig.nightTickMs;
  c.check(day1Ms >= 18000 && day1Ms <= 40000, "day-1 night lands in the 20–40s window", `${day1Ms}ms / ${day1.ticks} ticks`);

  const day2 = runNight(enterNight(enterBuild(completeFrontShift(day1.state))));
  c.check(day2.state.phase === "gameover", "ignoring the city breaks on day 2", `hearts=${day2.state.hearts} phase=${day2.state.phase}`);
  c.check(day2.state.hearts === 0, "game over is hearts at zero");

  const heldSeed = createGame(5);
  let held = enterBuild({ ...heldSeed, points: 12 });
  const prow = frontlineTideConfig.pathRow;
  const p1 = placeDefense(held, prow, 2);
  const p2 = p1.ok ? placeDefense(p1.state, prow, 3) : p1;
  const p3 = p2.ok ? placeDefense(p2.state, prow, 4) : p2;
  c.check(p3.ok && p3.state.board[prow]![4]!.kind === "defense", "day-1 build reaches a defense");
  if (p3.ok) {
    const cell = p3.state.board[prow]![4]!;
    c.check(cell.kind === "defense" && cell.tier === 2, "that defense is at least T2");
    const night = runNight(enterNight(p3.state));
    c.check(night.state.hearts > 0, "a T2 on the road survives day 1", `lost=${night.heartsLost}`);
    c.check(night.state.phase === "front_shift", "a held night still shifts");
    const shifted = completeFrontShift(night.state);
    c.check(shifted.phase === "day_match" && shifted.day === 2, "shift opens day 2 without a reload");
    c.check(shifted.frontDir === 1 && night.state.frontDir === -1, "the tide flips after the push");
    c.check(shifted.bands[1] === "reef", "bands slide with the board", shifted.bands.join(","));
    c.check(shifted.swapsLeft === frontlineTideConfig.dailySwaps, "the new day refills swaps");
    const nightSwap = resolveSwap(enterNight(p3.state), { r: 0, c: 0 }, { r: 0, c: 1 });
    c.check(!nightSwap.ok && nightSwap.reason === "phase", "night refuses swaps");
  }

  const late = completeFrontShift({ ...createGame(1), day: 49, phase: "front_shift", hearts: 4 });
  c.check(late.day === 50 && late.phase === "day_match" && late.hearts === 4, "day 50 is not an ending");
  const later = completeFrontShift({ ...late, phase: "front_shift" });
  c.check(later.day === 51 && later.phase === "day_match", "play continues past day 50");
  c.check(enemyHpForDay(50) === frontlineTideConfig.enemyHpCap, "hp growth is capped");
  c.check(nightEnemyCount(50) === frontlineTideConfig.nightEnemyCap, "wave size is capped");
  c.check(enemyHpForDay(5) > enemyHpForDay(1), "enemy hp is higher by day 5");
  c.check(nightEnemyCount(15) > nightEnemyCount(1), "the wave is larger by day 15");

  const ripBands = Array.from({ length: 8 }, () => "shoal" as const);
  const ripBoard = checkerBoard();
  ripBoard[0]![0] = gem(0);
  ripBoard[1]![0] = gem(0);
  ripBoard[2]![0] = gem(0);
  ripBands[0] = "rip";
  c.check(findMatches(ripBoard, [...ripBands]).length === 0, "a rip column ignores a vertical three");
  const reefBands = Array.from({ length: 8 }, () => "shoal" as const);
  reefBands[1] = "reef";
  const reefBoard = checkerBoard();
  reefBoard[0]![0] = gem(1);
  reefBoard[1]![1] = gem(1);
  reefBoard[2]![2] = gem(1);
  const reefHits = findMatches(reefBoard, [...reefBands]);
  c.check(reefHits.some((p) => p.r === 1 && p.c === 1), "a diagonal through reef clears");
  c.check(
    scoreClear([...reefBands], reefHits, 1) >= 3,
    "reef clear still pays",
  );
  const ripClear = scoreClear(ripBands, [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }], 1);
  c.check(ripClear === frontlineTideConfig.ripYield + 2, "a rip gem pays double inside a horizontal clear");
}

function playSerious(seed: number, days: number): { brokeOn: number; heartsByDay: number[] } {
  let state = createGame(seed);
  const heartsByDay: number[] = [];
  let brokeOn = 0;
  for (let day = 1; day <= days && state.phase !== "gameover"; day++) {
    let swaps = 0;
    while (state.phase === "day_match" && state.swapsLeft > 0 && swaps < 12) {
      const next = greedySwap(state);
      if (!next) break;
      state = next;
      swaps += 1;
    }
    state = enterBuild(state);
    let placed = 0;
    while (state.points >= frontlineTideConfig.t1Cost && placed < 16) {
      let best: GameState | null = null;
      let bestScore = -1;
      const n = state.board.length;
      for (let r = 0; r < n; r++) {
        for (let col = 0; col < n; col++) {
          const res = placeDefense(state, r, col);
          if (!res.ok) continue;
          const cell = res.state.board[r]![col]!;
          const tier = cell.kind === "defense" ? cell.tier : 1;
          const onRoad = r === frontlineTideConfig.pathRow && col >= 2 && col <= 5 ? 80 : 0;
          const score = tier * 30 + onRoad - col;
          if (score > bestScore) {
            bestScore = score;
            best = res.state;
          }
        }
      }
      if (!best) break;
      state = best;
      placed += 1;
    }
    state = enterNight(state);
    const night = runNight(state);
    state = night.state;
    heartsByDay.push(state.hearts);
    if (state.phase === "gameover") {
      brokeOn = day;
      break;
    }
    state = completeFrontShift(state);
  }
  return { brokeOn, heartsByDay };
}

c.section("pacing");
{
  const seeds = [21, 4, 9, 15, 28];
  let survivedFirst = 0;
  let reachedDay5 = 0;
  let pressuredOn5 = 0;
  for (const seed of seeds) {
    const run = playSerious(seed, 20);
    const day1 = run.heartsByDay[0] ?? 0;
    const day15 = run.heartsByDay[14];
    if (day1 > 0) survivedFirst += 1;
    if (day15 !== undefined && day15 > 0) reachedDay5 += 1;
    if (day15 !== undefined && day15 < frontlineTideConfig.hearts) pressuredOn5 += 1;
    console.log(`  seed ${seed} broke=${run.brokeOn || "-"} hearts=${run.heartsByDay.join(",")}`);
  }
  c.check(survivedFirst === seeds.length, "builders survive day 1", `${survivedFirst}/${seeds.length}`);
  c.check(reachedDay5 >= 3, "most builders are alive on day 15", `${reachedDay5}/${seeds.length}`);
  c.check(pressuredOn5 >= 1, "day 15 has cost someone hearts", `${pressuredOn5}/${seeds.length}`);
}

c.finish();
