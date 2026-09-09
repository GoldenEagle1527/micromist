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
  | "guardBreak"
  | "overbreak"
  | "toxinWave"
  | "ironPulse";

export type PassiveId =
  | "vitality"
  | "ironSkin"
  | "shatterEdge"
  | "secondWind"
  | "keenEye"
  | "toxin"
  | "ironLiver"
  | "bulwark";

export type Rarity = "common" | "rare" | "epic";

/** Soft tags for build-bias reward weighting (never forced). */
export type CardTag = "break" | "poison" | "block" | "draw" | "attack";

export type RuleId =
  | "breakSurge"
  | "ironCurtain"
  | "bloodFeud"
  | "flurryLaw"
  | "breakEcho"
  | "adverse";

export type EnemyVariant = "normal" | "frenzy" | "armored" | "twist" | "revenge";

export type RestVariant = "standard" | "forge" | "medic";

export type EventId =
  | "woundedDuelist"
  | "mysteriousSmith"
  | "brokenAltar"
  | "gambler"
  | "travelingMerchant"
  | "forgottenShrine";

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
  rarity?: Rarity;
  tags?: CardTag[];
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
  /** Secret / fusion-only — not in normal reward pool */
  fusionOnly?: boolean;
};

export type PassiveDef = {
  id: PassiveId;
  rarity?: Rarity;
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
  /** Poise breaks landed this player turn (break chain). Cap ~3. */
  breakChain: number;
  /** Whether any break happened this player turn (for chain reset rules). */
  brokeThisTurn: boolean;
  /** breakEcho rule: +1 AP already granted this combat */
  breakEchoGranted: boolean;
  /** Copied from run for combat resolution */
  ruleId: RuleId;
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
    variant: EnemyVariant;
    elite: boolean;
  };
  log: string[];
  /** Fight-long highlight events (poise_break / poison_kill / hit:N); not wiped per action */
  highlightLog?: string[];
};

export type RewardOption =
  | { kind: "card"; cardId: CardId; rarity?: Rarity }
  | { kind: "passive"; passiveId: PassiveId; rarity?: Rarity };

export type PathOptionKind = "safeFight" | "riskyElite" | "rest" | "event";

export type PathOption = {
  id: string;
  kind: PathOptionKind;
};

export type RunNode =
  | {
      kind: "fight";
      enemyId: EnemyId;
      index: number;
      elite?: boolean;
      variant?: EnemyVariant;
    }
  | { kind: "rest"; index: number; restVariant?: RestVariant }
  | { kind: "pathChoice"; index: number; options: PathOption[]; reservedEnemyId?: EnemyId }
  | { kind: "event"; index: number; eventId: EventId };

export type RunPhase =
  | "combat"
  | "reward"
  | "rest"
  | "pathChoice"
  | "event"
  | "runWon"
  | "runLost";

export type RunHighlights = {
  maxHit: number;
  breakInterrupts: number;
  minHpSeen: number;
  poisonKills: number;
  maxAttacksInTurn: number;
};

export type SecretRecipeId = "secret_overbreak" | "secret_toxinWave" | "secret_ironPulse";

export type NextFightBuff = {
  /** Flat bonus to player start block */
  startBlock?: number;
  /** Extra poise damage on first card that deals poise this fight */
  firstPoiseBonus?: number;
  /** +% enemy damage taken (not used as immunity) — flat bonus dmg on hits */
  hitBonus?: number;
};

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
  /** Run rule of the blade (picked at createRun) */
  ruleId: RuleId;
  highlights: RunHighlights;
  /** One secret fusion recipe active this run */
  secretRecipeId: SecretRecipeId;
  /** Revealed via forge success or event clue */
  secretRevealed: boolean;
  /** Fusion results discovered this run (display only) */
  discoveredRecipes: CardId[];
  /** First mid-fight enemy remembered for late revenge */
  nemesisId?: EnemyId;
  /** True once a mid fight has set nemesis */
  nemesisCaptured?: boolean;
  /** Pending buff applied on next startCombat */
  nextFightBuff?: NextFightBuff;
  /** Force rare+ bias on the upcoming reward roll */
  forceRareReward?: boolean;
  /** Rest site flavor when phase === rest */
  restVariant?: RestVariant;
  /** Event when phase === event */
  eventId?: EventId;
};

export type PlayResult =
  | { ok: true; state: CombatState }
  | { ok: false; reason: "no_ap" | "not_in_hand" | "precondition" | "wrong_phase" | "unknown_card" };

export type FusionRecipe = {
  a: CardId;
  b: CardId;
  result: CardId;
};

export type SecretFusionRecipe = FusionRecipe & {
  id: SecretRecipeId;
};
