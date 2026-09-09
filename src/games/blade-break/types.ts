/** Pure types for Blade Break / 破阵之刃 */

export type CardId =
  | "strike"
  | "heavy"
  | "guard"
  | "iron"
  | "insight"
  | "chip"
  | "bash"
  | "execute"
  | "brace"
  | "venom"
  | "purge"
  | "lockpick"
  | "shatter"
  | "riposte"
  | "cleanse"
  | "venomStrike"
  | "crush"
  | "fortress"
  | "cycle"
  | "flurry"
  | "guardBreak";

export type PassiveId =
  | "vitality"
  | "ironSkin"
  | "shatterEdge"
  | "secondWind"
  | "keenEye"
  | "toxin"
  | "ironLiver"
  | "bulwark";

export type IntentKind =
  | "attack"
  | "defend"
  | "windup"
  | "heavyAttack"
  | "thorns"
  | "armorUp"
  | "hex"
  | "heal"
  | "discard"
  | "shatterBlock";

export type Intent = {
  kind: IntentKind;
  /** Display value (damage, block, etc.) */
  value: number;
  /** Multi-turn windup: turns left before it fires (0 = ready this resolve) */
  windupLeft?: number;
  /** Stored payload when windup completes */
  windupDamage?: number;
};

export type EnemyId =
  | "scout"
  | "rascal"
  | "acolyte"
  | "brute"
  | "thorn"
  | "warden"
  | "duelist"
  | "knight"
  | "hexer"
  | "juggernaut";

export type EnemyDef = {
  id: EnemyId;
  maxHp: number;
  maxPoise: number;
  /** Intent pattern cycling / AI helper tag */
  kit: "basic" | "discard" | "windup" | "thorns" | "shatter" | "armor" | "hex";
};

export type CardDef = {
  id: CardId;
  cost: number;
  /** Damage to enemy HP */
  damage?: number;
  /** Damage to enemy poise */
  poise?: number;
  /** Block gained */
  block?: number;
  /** Draw N cards */
  draw?: number;
  /** Finisher: only playable when Broken or enemy HP% ≤ threshold */
  requireBrokenOrHpPct?: number;
  /** Bonus damage if enemy is Broken */
  bonusIfBroken?: number;
  /** Deal this much damage only if enemy is Broken (e.g. riposte) */
  damageIfBroken?: number;
  /** Apply poison stacks to enemy */
  poisonEnemy?: number;
  /** Discard N random other cards from hand after play */
  discardRandom?: number;
  /** Clear all enemy armor before damage */
  clearEnemyArmor?: boolean;
  /** Remove player poison stacks */
  clearPlayerPoison?: boolean;
  /** Finisher: require ≥ N attack cards played this turn */
  requireAttacksThisTurn?: number;
  /** Finisher: require player block ≥ N */
  requireBlock?: number;
  /** Spend / clear all player block after resolving damage */
  clearPlayerBlock?: boolean;
  /** Override damage when enemy has armor > 0 */
  damageIfEnemyArmor?: number;
};

export type PassiveDef = {
  id: PassiveId;
  /** +max HP at run start / when picked */
  maxHpBonus?: number;
  /** Heal immediately when picked */
  healOnPick?: number;
  /** Block at start of each combat */
  startBlock?: number;
  /** Extra poise damage on every card that deals poise or HP damage */
  poiseOnHit?: number;
  /** Heal this much after winning a fight */
  healOnWin?: number;
  /** Draw +1 on first turn of each fight */
  firstTurnDraw?: number;
  /** Attacks that deal HP damage also apply this much enemy poison */
  attacksApplyPoison?: number;
  /** Player poison tick damage is halved (floor) */
  poisonHalf?: boolean;
  /** Fraction of unspent block kept into next turn (0–1) */
  blockRetain?: number;
};

export type CombatantStatus = {
  /** Enemy: poise broken — skip action, +100% damage taken until after skip */
  broken?: boolean;
  /** Player: next enemy attack deals less (optional future) */
  weak?: number;
  /** Enemy thorns: reflect this much when hit by HP damage */
  thorns?: number;
  /** Enemy armor: reduce incoming HP damage by this flat amount */
  armor?: number;
  /** Poison stacks: player ticks at start of their turn; enemy ticks at end of player turn */
  poison?: number;
  /** After next draw, discard this many random hand cards (rascal discard intent) */
  forcedDiscard?: number;
};

export type CardInstance = {
  /** Unique instance id within a run */
  uid: string;
  cardId: CardId;
};

export type CombatPhase =
  | "player"
  | "enemy"
  | "won"
  | "lost";

export type CombatState = {
  phase: CombatPhase;
  turn: number;
  /** Attack cards played this player turn (for flurry etc.) */
  attacksPlayedThisTurn: number;
  player: {
    hp: number;
    maxHp: number;
    block: number;
    ap: number;
    maxAp: number;
    hand: CardInstance[];
    drawPile: CardInstance[];
    discardPile: CardInstance[];
    statuses: CombatantStatus;
  };
  enemy: {
    id: EnemyId;
    hp: number;
    maxHp: number;
    poise: number;
    maxPoise: number;
    intent: Intent | null;
    statuses: CombatantStatus;
    /** Intent pattern index for kit AI */
    patternIndex: number;
  };
  log: string[];
};

export type RewardOption =
  | { kind: "card"; cardId: CardId }
  | { kind: "passive"; passiveId: PassiveId };

export type RunNode =
  | { kind: "fight"; enemyId: EnemyId; index: number }
  | { kind: "rest"; index: number };

export type RunPhase =
  | "combat"
  | "reward"
  | "rest"
  | "runWon"
  | "runLost";

export type RunState = {
  seed: number;
  nodeIndex: number;
  nodes: RunNode[];
  phase: RunPhase;
  deck: CardInstance[];
  passives: PassiveId[];
  hp: number;
  maxHp: number;
  fightIndex: number; // 0-based among fights won/current
  combat: CombatState | null;
  rewards: RewardOption[];
  /** uid counter */
  nextUid: number;
  /** Last defeated enemy (for plunder bias); cleared when leaving reward */
  lastEnemyId?: EnemyId;
};

export type PlayResult =
  | { ok: true; state: CombatState }
  | { ok: false; reason: "no_ap" | "not_in_hand" | "precondition" | "wrong_phase" | "unknown_card" };

export type FusionRecipe = {
  a: CardId;
  b: CardId;
  result: CardId;
};
