import { cloneBoard, inBounds, refillEmpties } from "./board";
import { frontlineTideConfig } from "./config";
import { pathRowFor } from "./night";
import type { Cell, DefenseCell, DefenseTier, GameState, MergeEvent, PlaceResult, Pos } from "./types";

const DIRS: readonly Pos[] = [
  { r: 1, c: 0 },
  { r: -1, c: 0 },
  { r: 0, c: 1 },
  { r: 0, c: -1 },
];

export function makeDefense(tier: DefenseTier): DefenseCell {
  const hp = frontlineTideConfig.defenseHp[tier];
  return { kind: "defense", tier, hp, maxHp: hp };
}

function keyOf(p: Pos): string {
  return `${p.r},${p.c}`;
}

/**
 * First three cells of a same-tier orthogonal flood, closest to `origin` first.
 * A BFS prefix of a connected component stays connected, so a line of three
 * merges the same way an L of three does.
 */
function closestTriple(board: Cell[][], origin: Pos, tier: DefenseTier): Pos[] | null {
  const n = board.length;
  const seen = new Set<string>();
  const queue: Pos[] = [origin];
  const picked: Pos[] = [];
  while (queue.length > 0 && picked.length < 3) {
    const p = queue.shift()!;
    const key = keyOf(p);
    if (seen.has(key)) continue;
    seen.add(key);
    if (p.r < 0 || p.c < 0 || p.r >= n || p.c >= n) continue;
    const cell = board[p.r][p.c];
    if (cell.kind !== "defense" || cell.tier !== tier) continue;
    picked.push(p);
    for (const d of DIRS) queue.push({ r: p.r + d.r, c: p.c + d.c });
  }
  return picked.length === 3 ? picked : null;
}

export function resolveMerges(board: Cell[][], origin: Pos): MergeEvent[] {
  const events: MergeEvent[] = [];
  const maxTier = frontlineTideConfig.maxTier;
  for (let guard = 0; guard < 4; guard++) {
    const cell = board[origin.r][origin.c];
    if (cell.kind !== "defense" || cell.tier >= maxTier) break;
    const triple = closestTriple(board, origin, cell.tier);
    if (!triple) break;
    const tier = (cell.tier + 1) as DefenseTier;
    for (const p of triple) {
      if (p.r === origin.r && p.c === origin.c) continue;
      board[p.r][p.c] = { kind: "empty" };
    }
    board[origin.r][origin.c] = makeDefense(tier);
    events.push({ at: { ...origin }, tier, consumed: triple.map((p) => ({ ...p })) });
  }
  return events;
}

export function placeDefense(state: GameState, r: number, c: number): PlaceResult {
  if (state.phase !== "day_build") return { ok: false, reason: "phase" };
  const pos = { r, c };
  if (!inBounds(state.board, pos)) return { ok: false, reason: "bounds" };
  if (r !== pathRowFor(state.board.length, state.day)) return { ok: false, reason: "off-road" };
  if (state.board[r][c].kind === "defense") return { ok: false, reason: "occupied" };
  if (state.points < frontlineTideConfig.t1Cost) return { ok: false, reason: "poor" };

  let board = cloneBoard(state.board);
  board[r][c] = makeDefense(1);
  const merges = resolveMerges(board, pos);
  let rng = state.rng;
  if (merges.length > 0) {
    const filled = refillEmpties(board, state.bands, rng);
    board = filled.board;
    rng = filled.rng;
  }
  return {
    ok: true,
    merges,
    state: {
      ...state,
      board,
      rng,
      points: state.points - frontlineTideConfig.t1Cost,
      scrubbedRoad: (state.scrubbedRoad ?? []).filter((col) => col !== c),
    },
  };
}
