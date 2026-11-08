import type { RngState } from "./rng";

export type Phase = "day_match" | "day_build" | "night" | "front_shift" | "gameover";

export type GemColor = 0 | 1 | 2;

/** Column band. Shoal is the default line. Reef adds diagonals. Rip is horizontal-only and pays double. */
export type Terrain = "shoal" | "reef" | "rip";

export type DefenseTier = 1 | 2 | 3;

export type Pos = { r: number; c: number };

export type GemCell = { kind: "gem"; color: GemColor };

export type DefenseCell = {
  kind: "defense";
  tier: DefenseTier;
  hp: number;
  maxHp: number;
};

export type EmptyCell = { kind: "empty" };

export type Cell = GemCell | DefenseCell | EmptyCell;

export type FrontDir = 1 | -1;

export type Enemy = {
  id: number;
  col: number;
  hp: number;
  maxHp: number;
  /** Ticks to wait before the next step toward the shore. */
  moveCooldown: number;
  /** Steps wait this many ticks. Rushers use 1; the tide uses `enemyMoveEvery`. */
  pace: number;
  rusher: boolean;
};

export type GameState = {
  phase: Phase;
  day: number;
  hearts: number;
  points: number;
  swapsLeft: number;
  board: Cell[][];
  /** One terrain per column. Scrolls with the tide. */
  bands: Terrain[];
  /**
   * Column the next tide will wash away.
   * Direction -1 washes the shore (column 0). Direction +1 washes the sea edge.
   * Biters always enter from the sea edge.
   */
  frontCol: number;
  frontDir: FrontDir;
  enemies: Enemy[];
  spawnLeft: number;
  spawnCooldown: number;
  nextEnemyId: number;
  /** Increments on every night tick so the view can pace itself. */
  clock: number;
  rng: RngState;
};

export type CascadeStep = {
  /** Board after the swap (chain 1) or after the previous refill, matches still present. */
  boardBeforeClear: Cell[][];
  cleared: Pos[];
  points: number;
  chain: number;
  boardAfter: Cell[][];
};

export type SwapFail = "phase" | "no-swaps" | "not-adjacent" | "not-gem" | "no-match";

export type SwapResult =
  | { ok: false; reason: SwapFail }
  | { ok: true; steps: CascadeStep[]; state: GameState };

export type MergeEvent = {
  at: Pos;
  tier: DefenseTier;
  consumed: Pos[];
};

export type PlaceFail = "phase" | "occupied" | "poor" | "bounds";

export type PlaceResult =
  | { ok: false; reason: PlaceFail }
  | { ok: true; state: GameState; merges: MergeEvent[] };

export type NightEvent =
  | { type: "spawn"; id: number; col: number }
  | { type: "hit"; id: number; damage: number; col: number }
  | { type: "enemy-died"; id: number; col: number }
  | { type: "defense-hit"; row: number; col: number; hp: number }
  | { type: "defense-fell"; row: number; col: number }
  | { type: "heart"; damage: number; hearts: number }
  | { type: "wave-clear" }
  | { type: "gameover" };

export type NightStep = { state: GameState; events: NightEvent[] };
