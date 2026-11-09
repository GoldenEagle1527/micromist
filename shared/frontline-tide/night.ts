import { cloneBoard } from "./board";
import { frontlineTideConfig, washWidthForDay } from "./config";
import type {
  Cell,
  Enemy,
  FrontDir,
  GameState,
  NightEvent,
  NightStep,
  Phase,
  Pos,
} from "./types";

export function nightEnemyCount(day: number): number {
  const extra = Math.floor(Math.max(0, day - 1) / 3) * frontlineTideConfig.nightEnemiesPerTwoDays;
  return Math.min(frontlineTideConfig.nightEnemyCap, frontlineTideConfig.nightEnemiesDay1 + extra);
}

export function enemyHpForDay(day: number): number {
  const steps = Math.floor(Math.max(0, day - 1) / frontlineTideConfig.enemyHpEveryDays);
  return Math.min(frontlineTideConfig.enemyHpCap, frontlineTideConfig.enemyHp + steps);
}

export function enemyDamageForDay(day: number): number {
  if (day >= 25) return frontlineTideConfig.enemyDamageDay25;
  if (day >= 10) return frontlineTideConfig.enemyDamageDay10;
  return frontlineTideConfig.enemyDamage;
}

/** Rushers step every tick. One from day 10, half from day 25, all but one from day 50. */
export function rusherCount(day: number, total: number): number {
  if (total <= 0 || day < 10) return 0;
  if (day >= 50) return Math.max(0, total - 1);
  if (day >= 25) return Math.ceil(total / 2);
  return 1;
}

export function seaColumn(boardSize: number): number {
  return boardSize - 1;
}

/**
 * The row biters walk. Day 50 flips it to the opposite row so yesterday's
 * groynes stop blocking. 0-indexed.
 */
export function pathRowFor(boardSize: number, day = 1): number {
  const base = Math.min(boardSize - 2, Math.max(1, frontlineTideConfig.pathRow));
  if (day < 50 || boardSize < 3) return base;
  const flipped = boardSize - 1 - base;
  if (flipped !== base && flipped >= 1 && flipped <= boardSize - 2) return flipped;
  return Math.min(boardSize - 2, base + 1);
}

/** Columns this day's tide will scrub. `frontDir` -1 scrubs the shore edge. */
export function washColumnsFor(boardSize: number, frontDir: FrontDir, day: number): number[] {
  const width = Math.min(Math.max(1, washWidthForDay(day)), Math.max(1, boardSize - 1));
  if (frontDir < 0) return Array.from({ length: width }, (_, i) => i);
  return Array.from({ length: width }, (_, i) => boardSize - width + i);
}

/** Tide-road cells with no groyne. Gems and holes both count: biters walk them. */
export function roadGaps(state: Pick<GameState, "board" | "day">): Pos[] {
  const row = pathRowFor(state.board.length, state.day);
  const gaps: Pos[] = [];
  for (let c = 0; c < state.board.length; c++) {
    if (state.board[row]![c]!.kind !== "defense") gaps.push({ r: row, c });
  }
  return gaps;
}

/**
 * `patch` — night is refused until the road is built or the points run out.
 * `warn` — the road is still open but another groyne cannot be paid for.
 */
export type NightGate = "ok" | "patch" | "warn";

export function nightGate(state: Pick<GameState, "board" | "day" | "points">): NightGate {
  if (roadGaps(state).length === 0) return "ok";
  if (state.points >= frontlineTideConfig.t1Cost) return "patch";
  return "warn";
}

/** The push after this night. Direction flips; the wash column follows the new arrow. */
export function nextFront(state: Pick<GameState, "frontDir" | "board">): {
  frontCol: number;
  frontDir: FrontDir;
} {
  const dir: FrontDir = state.frontDir === 1 ? -1 : 1;
  return { frontDir: dir, frontCol: dir < 0 ? 0 : state.board.length - 1 };
}

function defenseAt(board: Cell[][], r: number, c: number): Pos | null {
  if (r < 0 || c < 0 || r >= board.length || c >= board.length) return null;
  return board[r][c].kind === "defense" ? { r, c } : null;
}

function pickTarget(enemies: readonly Enemy[], col: number, wide: boolean): Enemy | undefined {
  let best: Enemy | undefined;
  for (const enemy of enemies) {
    if (enemy.hp <= 0) continue;
    const hit = wide ? enemy.col === col || enemy.col === col + 1 : enemy.col === col;
    if (!hit) continue;
    if (!best || enemy.col < best.col || (enemy.col === best.col && enemy.id < best.id)) best = enemy;
  }
  return best;
}

/**
 * One night tick.
 * Only defenses on the tide road block and shoot. They hit the biter in their
 * column or the one pressing in from the sea, and that biter bites back.
 * Groynes beside the road are merge material: they do not fight.
 * A biter that steps off column 0 takes hearts. Hearts at 0 end the run;
 * an empty wave shifts the front.
 */
export function stepNight(state: GameState): NightStep {
  if (state.phase !== "night") return { state, events: [] };

  const cfg = frontlineTideConfig;
  const events: NightEvent[] = [];
  const board = cloneBoard(state.board);
  const pathRow = pathRowFor(board.length, state.day);
  let enemies = state.enemies.map((e) => ({ ...e }));
  let spawnLeft = state.spawnLeft;
  let spawnCooldown = state.spawnCooldown;
  let nextEnemyId = state.nextEnemyId;
  let hearts = state.hearts;

  const spawnBlocked = enemies.some((e) => e.hp > 0 && e.col === seaColumn(board.length));
  if (spawnLeft > 0 && !spawnBlocked) {
    if (spawnCooldown <= 0) {
      const hp = enemyHpForDay(state.day);
      const wave = nightEnemyCount(state.day);
      const index = wave - spawnLeft;
      const rusher = index < rusherCount(state.day, wave);
      const pace = rusher ? 1 : cfg.enemyMoveEvery;
      const enemy: Enemy = {
        id: nextEnemyId,
        col: seaColumn(board.length),
        hp,
        maxHp: hp,
        moveCooldown: rusher ? 1 : cfg.enemyMoveEvery,
        pace,
        rusher,
      };
      nextEnemyId += 1;
      enemies.push(enemy);
      spawnLeft -= 1;
      spawnCooldown = cfg.spawnGapTicks;
      events.push({ type: "spawn", id: enemy.id, col: enemy.col });
    }
    spawnCooldown -= 1;
  }

  const shots: { enemy: Enemy; damage: number }[] = [];
  for (let c = 0; c < board.length; c++) {
    const cell = board[pathRow][c];
    if (!cell || cell.kind !== "defense") continue;
    const target = pickTarget(enemies, c, true);
    if (!target) continue;
    shots.push({ enemy: target, damage: cfg.defenseDamage[cell.tier] });
  }
  for (const shot of shots) {
    shot.enemy.hp -= shot.damage;
    events.push({
      type: "hit",
      id: shot.enemy.id,
      damage: shot.damage,
      col: shot.enemy.col,
    });
  }

  const bites = new Map<string, { r: number; c: number; dmg: number }>();
  for (const enemy of enemies) {
    if (enemy.hp <= 0) continue;
    const here = defenseAt(board, pathRow, enemy.col);
    const ahead = defenseAt(board, pathRow, enemy.col - 1);
    const block = here ?? ahead;
    if (!block) continue;
    const key = `${block.r},${block.c}`;
    const prev = bites.get(key);
    const biteDmg = enemyDamageForDay(state.day);
    if (prev) prev.dmg += biteDmg;
    else bites.set(key, { r: block.r, c: block.c, dmg: biteDmg });
  }
  for (const bite of bites.values()) {
    const cell = board[bite.r][bite.c];
    if (cell.kind !== "defense") continue;
    cell.hp -= bite.dmg;
    events.push({ type: "defense-hit", row: bite.r, col: bite.c, hp: cell.hp });
    if (cell.hp <= 0) {
      board[bite.r][bite.c] = { kind: "empty" };
      events.push({ type: "defense-fell", row: bite.r, col: bite.c });
    }
  }

  const alive: Enemy[] = [];
  for (const enemy of enemies) {
    if (enemy.hp <= 0) events.push({ type: "enemy-died", id: enemy.id, col: enemy.col });
    else alive.push(enemy);
  }
  enemies = alive;

  enemies.sort((a, b) => a.col - b.col || a.id - b.id);
  const occupied = new Set(enemies.map((e) => e.col));
  const kept: Enemy[] = [];
  for (const enemy of enemies) {
    const blocked =
      defenseAt(board, pathRow, enemy.col) !== null ||
      defenseAt(board, pathRow, enemy.col - 1) !== null;
    if (blocked) {
      kept.push(enemy);
      continue;
    }
    if (enemy.moveCooldown > 0) {
      kept.push({ ...enemy, moveCooldown: enemy.moveCooldown - 1 });
      continue;
    }
    const dest = enemy.col - 1;
    if (dest >= 0 && occupied.has(dest)) {
      kept.push(enemy);
      continue;
    }
    occupied.delete(enemy.col);
    if (dest < 0) {
      const damage = cfg.enemyHeartDamage;
      hearts = Math.max(0, hearts - damage);
      events.push({ type: "heart", damage, hearts });
      continue;
    }
    occupied.add(dest);
    kept.push({ ...enemy, col: dest, moveCooldown: enemy.pace <= 1 ? 0 : enemy.pace - 1 });
  }

  let phase: Phase = state.phase;
  if (hearts <= 0) {
    phase = "gameover";
    events.push({ type: "gameover" });
  } else if (spawnLeft === 0 && kept.length === 0) {
    phase = "front_shift";
    events.push({ type: "wave-clear" });
  }

  return {
    events,
    state: {
      ...state,
      phase,
      hearts,
      board,
      enemies: kept,
      spawnLeft,
      spawnCooldown,
      nextEnemyId,
      clock: state.clock + 1,
    },
  };
}
