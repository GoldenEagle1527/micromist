/** Pure engine for Blade Break / 破阵之刃 — R1–R4 random layer */

import {
  CARDS,
  FUSION_RECIPES,
  PASSIVES,
  PASSIVE_POOL,
  REWARD_CARD_POOL,
  RULE_IDS,
  SECRET_FUSION_RECIPES,
  STARTER_DECK,
  deckTagWeights,
  findFusionResult,
  getCard,
  getCardRarity,
  getPassiveRarity,
  isAttackCard,
} from "./cards";
import {
  FIGHT_COUNT,
  getEnemy,
  isLateEnemy,
  isMidEnemy,
  nextIntent,
  rollEncounterLineup,
  rollEnemyVariant,
  scaleEnemyStats,
} from "./enemies";
import type {
  CardId,
  CardInstance,
  CardTag,
  CombatPhase,
  CombatState,
  EnemyId,
  EnemyVariant,
  EventId,
  Intent,
  NextFightBuff,
  PassiveId,
  PathOption,
  PlayResult,
  Rarity,
  RestVariant,
  RewardOption,
  RuleId,
  RunHighlights,
  RunNode,
  RunState,
  SecretRecipeId,
} from "./types";

export type Rng = () => number;

export function defaultRng(): Rng {
  return Math.random;
}

/** Mulberry32 seeded RNG for optional determinism. */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

function pickOne<T>(arr: readonly T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function cloneCombat(c: CombatState): CombatState {
  return {
    ...c,
    player: {
      ...c.player,
      hand: c.player.hand.map((x) => ({ ...x })),
      drawPile: c.player.drawPile.map((x) => ({ ...x })),
      discardPile: c.player.discardPile.map((x) => ({ ...x })),
      statuses: { ...c.player.statuses },
    },
    enemy: {
      ...c.enemy,
      intent: c.enemy.intent ? { ...c.enemy.intent } : null,
      statuses: { ...c.enemy.statuses },
    },
    log: [...c.log],
    highlightLog: [...(c.highlightLog ?? [])],
  };
}

function cloneRun(run: RunState): RunState {
  return {
    ...run,
    deck: run.deck.map((c) => ({ ...c })),
    passives: [...run.passives],
    nodes: run.nodes.map((n) => {
      if (n.kind === "pathChoice") {
        return { ...n, options: n.options.map((o) => ({ ...o })) };
      }
      return { ...n };
    }),
    rewards: run.rewards.map((r) => ({ ...r })),
    highlights: { ...run.highlights },
    discoveredRecipes: [...run.discoveredRecipes],
    nextFightBuff: run.nextFightBuff ? { ...run.nextFightBuff } : undefined,
    combat: run.combat ? cloneCombat(run.combat) : null,
  };
}

function mintCard(run: RunState, cardId: CardId): CardInstance {
  const uid = `c${run.nextUid}`;
  run.nextUid += 1;
  return { uid, cardId };
}

function emptyHighlights(maxHp: number): RunHighlights {
  return {
    maxHit: 0,
    breakInterrupts: 0,
    minHpSeen: maxHp,
    poisonKills: 0,
    maxAttacksInTurn: 0,
  };
}

function rollRestVariant(rng: Rng): RestVariant {
  const r = rng();
  if (r < 0.55) return "standard";
  if (r < 0.78) return "forge";
  return "medic";
}

function rollEventId(rng: Rng): EventId {
  const all: EventId[] = [
    "woundedDuelist",
    "mysteriousSmith",
    "brokenAltar",
    "gambler",
    "travelingMerchant",
    "forgottenShrine",
  ];
  return pickOne(all, rng);
}

/**
 * Build run path: ~7 fights, pathChoice after early/mid, rests + events.
 * Layout (indices vary slightly by rolls):
 *   fight, fight, pathChoice(safe|elite), rest, fight,
 *   pathChoice(rest|event), fight, fight, fight
 */
function buildRunNodes(rng: Rng, lineup: EnemyId[]): RunNode[] {
  const nodes: RunNode[] = [];
  let fi = 0;
  let index = 0;

  const pushFight = (elite = false, forceVariant?: EnemyVariant) => {
    const enemyId = lineup[fi] ?? lineup[lineup.length - 1]!;
    fi += 1;
    const variant = forceVariant ?? rollEnemyVariant(rng);
    nodes.push({
      kind: "fight",
      enemyId,
      index,
      elite: elite || undefined,
      variant,
    });
    index += 1;
  };

  // Early: 2 fights
  pushFight();
  pushFight();

  // Path after fight 2: safe fight vs risky elite (consume a lineup slot so 7th isn't wasted)
  const reservedPathEnemy = lineup[fi] ?? lineup[lineup.length - 1]!;
  fi += 1;
  nodes.push({
    kind: "pathChoice",
    index,
    options: [
      { id: "pc_safe", kind: "safeFight" },
      { id: "pc_elite", kind: "riskyElite" },
    ],
    reservedEnemyId: reservedPathEnemy,
  });
  index += 1;

  // Rest
  nodes.push({
    kind: "rest",
    index,
    restVariant: rollRestVariant(rng),
  });
  index += 1;

  // Mid fight
  pushFight();

  // Path after fight 4-ish: rest vs event
  nodes.push({
    kind: "pathChoice",
    index,
    options: [
      { id: "pc_rest", kind: "rest" },
      { id: "pc_event", kind: "event" },
    ],
  });
  index += 1;

  // Pre-place remaining fixed fights (6 total in graph; pathChoice fight is the 7th).
  while (fi < lineup.length) {
    const elite = fi >= 4 && rng() < 0.28;
    pushFight(elite);
  }

  return nodes;
}

/** Consume next unused fight enemy from nodes' reserved sense — from lineup cursor on run via fight nodes only.
 * For path-choice fights we pick from remaining mid/late pools. */
function rollPathFightEnemy(
  run: RunState,
  elite: boolean,
  rng: Rng,
  preferred?: EnemyId,
): { enemyId: EnemyId; variant: EnemyVariant } {
  const used = new Set(
    run.nodes.filter((n) => n.kind === "fight").map((n) => n.enemyId),
  );
  if (run.nemesisId) used.add(run.nemesisId);
  const late: EnemyId[] = ["knight", "hexer", "juggernaut"];
  const midLate: EnemyId[] = [
    "brute",
    "thorn",
    "warden",
    "duelist",
    ...late,
  ];
  let enemyId: EnemyId;
  if (preferred && !used.has(preferred)) {
    enemyId = preferred;
  } else {
    const unusedLate = late.filter((id) => !used.has(id));
    const avail = midLate.filter((id) => !used.has(id));
    const pool =
      unusedLate.length > 0 ? unusedLate : avail.length > 0 ? avail : midLate;
    enemyId = pickOne(pool, rng);
  }
  const variant = elite
    ? rng() < 0.4
      ? "frenzy"
      : rng() < 0.7
        ? "armored"
        : "twist"
    : rollEnemyVariant(rng);
  return { enemyId, variant };
}

function passiveBonuses(passives: PassiveId[]) {
  let maxHpBonus = 0;
  let startBlock = 0;
  let poiseOnHit = 0;
  let healOnWin = 0;
  let firstTurnDraw = 0;
  let attacksApplyPoison = 0;
  let poisonHalf = false;
  let blockRetain = 0;
  for (const id of passives) {
    const p = PASSIVES[id];
    maxHpBonus += p.maxHpBonus ?? 0;
    startBlock += p.startBlock ?? 0;
    poiseOnHit += p.poiseOnHit ?? 0;
    healOnWin += p.healOnWin ?? 0;
    firstTurnDraw += p.firstTurnDraw ?? 0;
    attacksApplyPoison += p.attacksApplyPoison ?? 0;
    if (p.poisonHalf) poisonHalf = true;
    if (p.blockRetain != null) blockRetain = Math.max(blockRetain, p.blockRetain);
  }
  return {
    maxHpBonus,
    startBlock,
    poiseOnHit,
    healOnWin,
    firstTurnDraw,
    attacksApplyPoison,
    poisonHalf,
    blockRetain,
  };
}

export function healAmount(run: RunState, raw: number): number {
  if (raw <= 0) return 0;
  if (run.ruleId === "bloodFeud") return Math.max(1, Math.floor(raw * 0.5));
  return raw;
}

/** Rest-site heal preview (respects forge lock + bloodFeud). */
export function restHealAmount(run: RunState): number {
  const variant = run.restVariant ?? "standard";
  if (variant === "forge") return 0;
  let raw = Math.max(1, Math.floor(run.maxHp * 0.3));
  if (variant === "medic") {
    raw = Math.max(1, Math.floor(run.maxHp * 0.42));
  }
  return healAmount(run, raw);
}

function intentMulFor(combat: CombatState): number {
  return scaleEnemyStats(combat.enemy.id, {
    variant: combat.enemy.variant,
    elite: combat.enemy.elite,
    ruleId: combat.ruleId,
  }).intentDamageMul;
}

function drawCards(combat: CombatState, n: number, rng: Rng): void {
  for (let i = 0; i < n; i++) {
    if (combat.player.drawPile.length === 0) {
      if (combat.player.discardPile.length === 0) break;
      combat.player.drawPile = combat.player.discardPile.splice(0);
      shuffleInPlace(combat.player.drawPile, rng);
    }
    const card = combat.player.drawPile.pop();
    if (card) combat.player.hand.push(card);
  }
}

function discardRandomFromHand(combat: CombatState, n: number, rng: Rng): void {
  for (let i = 0; i < n; i++) {
    if (combat.player.hand.length === 0) break;
    const idx = Math.floor(rng() * combat.player.hand.length);
    const [card] = combat.player.hand.splice(idx, 1);
    if (card) combat.player.discardPile.push(card);
  }
}

function breakDamageMul(combat: CombatState): number {
  return combat.ruleId === "adverse" ? 3 : 2;
}

function dealHpDamage(combat: CombatState, raw: number): number {
  let dmg = raw;
  if (combat.enemy.statuses.broken) {
    dmg = Math.floor(dmg * breakDamageMul(combat));
  }
  const armor = combat.enemy.statuses.armor ?? 0;
  if (armor > 0) dmg = Math.max(0, dmg - armor);
  combat.enemy.hp = Math.max(0, combat.enemy.hp - dmg);
  return dmg;
}


function pushHighlight(combat: CombatState, line: string): void {
  if (!combat.highlightLog) combat.highlightLog = [];
  combat.highlightLog.push(line);
  combat.log.push(line);
}
function onPoiseBreak(combat: CombatState, rng: Rng): void {
  combat.enemy.statuses.broken = true;
  combat.enemy.intent = null;
  combat.brokeThisTurn = true;
  combat.breakChain = Math.min(3, combat.breakChain + 1);
  pushHighlight(combat, "poise_break");
  if (combat.breakChain >= 2) {
    drawCards(combat, 1, rng);
    combat.log.push("break_chain_draw");
  }
  if (combat.breakChain >= 3) {
    combat.player.ap += 2;
    combat.log.push("break_chain_ap");
  }
  if (combat.ruleId === "breakEcho" && !combat.breakEchoGranted) {
    combat.player.ap += 1;
    combat.breakEchoGranted = true;
    combat.log.push("break_echo");
  }
}

function dealPoiseDamage(combat: CombatState, amount: number, rng: Rng): void {
  if (amount <= 0) return;
  if (combat.enemy.statuses.broken) return;
  combat.enemy.poise = Math.max(0, combat.enemy.poise - amount);
  if (combat.enemy.poise <= 0) {
    onPoiseBreak(combat, rng);
  }
}

function applyThorns(combat: CombatState, hpDamageDealt: number): void {
  if (hpDamageDealt <= 0) return;
  const thorns = combat.enemy.statuses.thorns ?? 0;
  if (thorns <= 0) return;
  let dmg = thorns;
  const blocked = Math.min(combat.player.block, dmg);
  combat.player.block -= blocked;
  dmg -= blocked;
  if (dmg > 0) {
    combat.player.hp = Math.max(0, combat.player.hp - dmg);
  }
}

function applyEnemyPoison(combat: CombatState, stacks: number): void {
  if (stacks <= 0) return;
  combat.enemy.statuses.poison = (combat.enemy.statuses.poison ?? 0) + stacks;
}

function tickEnemyPoison(combat: CombatState): void {
  const poison = combat.enemy.statuses.poison ?? 0;
  if (poison <= 0) return;
  combat.enemy.hp = Math.max(0, combat.enemy.hp - poison);
  combat.enemy.statuses.poison = poison - 1;
  if (combat.enemy.statuses.poison <= 0) delete combat.enemy.statuses.poison;
  combat.log.push("enemy_poison");
  if (combat.enemy.hp <= 0) {
    pushHighlight(combat, "poison_kill");
  }
}

function checkCombatEnd(combat: CombatState): void {
  if (combat.enemy.hp <= 0) {
    combat.phase = "won";
    combat.enemy.intent = null;
  } else if (combat.player.hp <= 0) {
    combat.phase = "lost";
  }
}

function afterEnemyAction(combat: CombatState): void {
  combat.enemy.patternIndex += 1;
  combat.enemy.intent = nextIntent(
    combat.enemy.id,
    combat.enemy.patternIndex,
    null,
    intentMulFor(combat),
  );
}

function applyNextFightBuff(
  combat: CombatState,
  buff: NextFightBuff | undefined,
): NextFightBuff | undefined {
  if (!buff) return undefined;
  if (buff.startBlock) {
    combat.player.block += buff.startBlock;
  }
  // firstPoiseBonus / hitBonus consumed on first relevant hit via combat.log flag
  if (buff.firstPoiseBonus || buff.hitBonus) {
    return { ...buff };
  }
  return undefined;
}

function startCombat(
  run: RunState,
  enemyId: EnemyId,
  rng: Rng,
  opts?: { elite?: boolean; variant?: EnemyVariant },
): CombatState {
  let variant = opts?.variant ?? "normal";
  let elite = Boolean(opts?.elite);
  let id = enemyId;

  // Weak nemesis: late fight may become revenge form of remembered mid foe
  if (
    run.nemesisId &&
    run.nemesisCaptured &&
    isLateEnemy(enemyId) &&
    rng() < 0.7
  ) {
    id = run.nemesisId;
    variant = "revenge";
    elite = elite || rng() < 0.35;
  }

  // Capture first mid enemy as nemesis
  if (!run.nemesisCaptured && isMidEnemy(id)) {
    run.nemesisId = id;
    run.nemesisCaptured = true;
  }

  const scaled = scaleEnemyStats(id, {
    variant,
    elite,
    ruleId: run.ruleId,
  });
  const bonuses = passiveBonuses(run.passives);
  const maxHp = run.maxHp;
  const hp = Math.min(run.hp, maxHp);

  const drawPile = run.deck.map((c) => ({ ...c }));
  shuffleInPlace(drawPile, rng);

  const combat: CombatState = {
    phase: "player",
    turn: 1,
    attacksPlayedThisTurn: 0,
    breakChain: 0,
    brokeThisTurn: false,
    breakEchoGranted: false,
    ruleId: run.ruleId,
    player: {
      hp,
      maxHp,
      block: bonuses.startBlock,
      ap: 3,
      maxAp: 3,
      hand: [],
      drawPile,
      discardPile: [],
      statuses: {},
    },
    enemy: {
      id,
      hp: scaled.maxHp,
      maxHp: scaled.maxHp,
      poise: scaled.maxPoise,
      maxPoise: scaled.maxPoise,
      intent: null,
      statuses: {},
      patternIndex: Math.floor(rng() * 4),
      variant,
      elite,
    },
    log: [],
    highlightLog: [],
  };

  if (scaled.startArmor > 0) {
    combat.enemy.statuses.armor = scaled.startArmor;
  }
  if (scaled.startThorns > 0) {
    combat.enemy.statuses.thorns = scaled.startThorns;
  }

  const leftoverBuff = applyNextFightBuff(combat, run.nextFightBuff);
  if (leftoverBuff?.firstPoiseBonus) {
    combat.log.push(`buff_poise:${leftoverBuff.firstPoiseBonus}`);
  }
  if (leftoverBuff?.hitBonus) {
    combat.log.push(`buff_hit:${leftoverBuff.hitBonus}`);
  }

  combat.enemy.intent = nextIntent(id, combat.enemy.patternIndex, null, scaled.intentDamageMul);
  const drawN = 5 + bonuses.firstTurnDraw;
  drawCards(combat, drawN, rng);
  return combat;
}

/** Merge combat-driven highlight stats into the run. */
export function mergeHighlights(run: RunState, combat: CombatState): RunHighlights {
  const h = { ...run.highlights };
  h.minHpSeen = Math.min(h.minHpSeen, combat.player.hp);
  h.maxAttacksInTurn = Math.max(h.maxAttacksInTurn, combat.attacksPlayedThisTurn);
  const lines = combat.highlightLog ?? combat.log;
  for (const line of lines) {
    if (line === "poise_break") h.breakInterrupts += 1;
    if (line === "poison_kill") h.poisonKills += 1;
    if (line.startsWith("hit:")) {
      const n = Number(line.slice(4));
      if (Number.isFinite(n)) h.maxHit = Math.max(h.maxHit, n);
    }
  }
  return h;
}

export function createRun(rng: Rng = defaultRng()): RunState {
  const seed = Math.floor(rng() * 1e9);
  const baseMax = 40;
  const ruleId = pickOne(RULE_IDS, rng) as RuleId;
  const secretRecipeId = pickOne(SECRET_FUSION_RECIPES, rng).id as SecretRecipeId;
  const lineup = rollEncounterLineup(rng);

  const run: RunState = {
    seed,
    nodeIndex: 0,
    nodes: buildRunNodes(rng, lineup),
    phase: "combat",
    deck: [],
    passives: [],
    hp: baseMax,
    maxHp: baseMax,
    fightIndex: 0,
    combat: null,
    rewards: [],
    nextUid: 1,
    ruleId,
    highlights: emptyHighlights(baseMax),
    secretRecipeId,
    secretRevealed: false,
    discoveredRecipes: [],
  };

  for (const id of STARTER_DECK) {
    run.deck.push(mintCard(run, id));
  }

  const first = run.nodes[0]!;
  if (first.kind !== "fight") throw new Error("run must start with fight");
  run.combat = startCombat(run, first.enemyId, rng, {
    elite: first.elite,
    variant: first.variant,
  });
  run.nextFightBuff = undefined;
  run.phase = "combat";
  return run;
}

export function canPlayCard(combat: CombatState, uid: string): PlayResult {
  if (combat.phase !== "player") return { ok: false, reason: "wrong_phase" };
  const inst = combat.player.hand.find((c) => c.uid === uid);
  if (!inst) return { ok: false, reason: "not_in_hand" };
  const def = CARDS[inst.cardId];
  if (!def) return { ok: false, reason: "unknown_card" };
  if (combat.player.ap < def.cost) return { ok: false, reason: "no_ap" };
  if (def.requireBrokenOrHpPct != null) {
    const hpPct = combat.enemy.hp / combat.enemy.maxHp;
    const ok =
      Boolean(combat.enemy.statuses.broken) ||
      hpPct <= def.requireBrokenOrHpPct;
    if (!ok) return { ok: false, reason: "precondition" };
  }
  if (def.requireAttacksThisTurn != null) {
    if (combat.attacksPlayedThisTurn < def.requireAttacksThisTurn) {
      return { ok: false, reason: "precondition" };
    }
  }
  if (def.requireBlock != null) {
    if (combat.player.block < def.requireBlock) {
      return { ok: false, reason: "precondition" };
    }
  }
  return { ok: true, state: combat };
}

function consumeCombatBuff(
  combat: CombatState,
  kind: "poise" | "hit",
): number {
  const prefix = kind === "poise" ? "buff_poise:" : "buff_hit:";
  const idx = combat.log.findIndex((l) => l.startsWith(prefix));
  if (idx < 0) return 0;
  const n = Number(combat.log[idx]!.slice(prefix.length));
  combat.log.splice(idx, 1);
  return Number.isFinite(n) ? n : 0;
}

export function playCard(
  combat: CombatState,
  uid: string,
  rng: Rng = defaultRng(),
  passives: PassiveId[] = [],
): PlayResult {
  const check = canPlayCard(combat, uid);
  if (!check.ok) return check;

  const next = cloneCombat(combat);
  // Preserve buff markers across log clear
  const buffLines = next.log.filter(
    (l) => l.startsWith("buff_poise:") || l.startsWith("buff_hit:"),
  );
  next.log = [...buffLines];
  const idx = next.player.hand.findIndex((c) => c.uid === uid);
  const inst = next.player.hand[idx]!;
  const def = getCard(inst.cardId);
  const bonuses = passiveBonuses(passives);

  next.player.ap -= def.cost;
  next.player.hand.splice(idx, 1);
  next.player.discardPile.push(inst);

  if (def.clearPlayerPoison) {
    delete next.player.statuses.poison;
  }

  if (def.clearEnemyArmor) {
    delete next.enemy.statuses.armor;
  }

  if (def.block) {
    next.player.block += def.block;
  }

  let hpDealt = 0;
  const broken = Boolean(next.enemy.statuses.broken);
  const enemyArmored = (next.enemy.statuses.armor ?? 0) > 0;

  let dmg = def.damage ?? 0;
  if (def.damageIfEnemyArmor != null && enemyArmored) {
    dmg = def.damageIfEnemyArmor;
  }
  if (def.bonusIfBroken && broken) {
    dmg += def.bonusIfBroken;
  }
  if (def.damageIfBroken && broken) {
    dmg += def.damageIfBroken;
  }

  // flurryLaw: 3rd attack card this turn deals +5
  const willBeAttack = isAttackCard(def);
  if (
    willBeAttack &&
    next.ruleId === "flurryLaw" &&
    next.attacksPlayedThisTurn === 2
  ) {
    dmg += 5;
    next.log.push("flurry_law");
  }

  if (dmg > 0) {
    const hitBonus = consumeCombatBuff(next, "hit");
    if (hitBonus > 0) dmg += hitBonus;
  }

  if (dmg > 0 || def.damage) {
    if (dmg > 0) {
      hpDealt = dealHpDamage(next, dmg);
      applyThorns(next, hpDealt);
      if (hpDealt > 0) {
        next.log.push("hit");
        pushHighlight(next, `hit:${hpDealt}`);
      }
    }
  }

  if (def.clearPlayerBlock) {
    next.player.block = 0;
  }

  let poiseAmt = def.poise ?? 0;
  if ((def.damage || def.poise || def.damageIfBroken) && bonuses.poiseOnHit > 0) {
    poiseAmt += bonuses.poiseOnHit;
  }
  if (poiseAmt > 0 || def.poise) {
    const poiseBonus = consumeCombatBuff(next, "poise");
    if (poiseBonus > 0) poiseAmt += poiseBonus;
  }
  if (poiseAmt > 0) dealPoiseDamage(next, poiseAmt, rng);

  if (def.poisonEnemy) {
    applyEnemyPoison(next, def.poisonEnemy);
  }

  if (hpDealt > 0 && bonuses.attacksApplyPoison > 0) {
    applyEnemyPoison(next, bonuses.attacksApplyPoison);
  }

  if (def.discardRandom && def.discardRandom > 0) {
    discardRandomFromHand(next, def.discardRandom, rng);
  }

  if (def.draw) drawCards(next, def.draw, rng);

  if (willBeAttack) {
    next.attacksPlayedThisTurn += 1;
  }

  checkCombatEnd(next);
  return { ok: true, state: next };
}

function hitPlayer(combat: CombatState, amount: number): void {
  let dmg = amount;
  const blocked = Math.min(combat.player.block, dmg);
  combat.player.block -= blocked;
  dmg -= blocked;
  if (dmg > 0) combat.player.hp = Math.max(0, combat.player.hp - dmg);
}

function resolveIntent(combat: CombatState, intent: Intent): void {
  switch (intent.kind) {
    case "attack":
    case "heavyAttack":
      hitPlayer(combat, intent.value);
      break;
    case "defend":
      combat.enemy.statuses.armor =
        (combat.enemy.statuses.armor ?? 0) + Math.ceil(intent.value / 3);
      combat.enemy.poise = Math.min(
        combat.enemy.maxPoise,
        combat.enemy.poise + Math.floor(intent.value / 2),
      );
      break;
    case "windup": {
      const left = intent.windupLeft ?? 0;
      if (left <= 0) {
        hitPlayer(combat, intent.windupDamage ?? intent.value);
      }
      break;
    }
    case "thorns":
      combat.enemy.statuses.thorns =
        (combat.enemy.statuses.thorns ?? 0) + intent.value;
      break;
    case "armorUp":
      combat.enemy.statuses.armor =
        (combat.enemy.statuses.armor ?? 0) + intent.value;
      break;
    case "hex":
      combat.player.statuses.poison =
        (combat.player.statuses.poison ?? 0) + intent.value;
      break;
    case "heal":
      combat.enemy.hp = Math.min(
        combat.enemy.maxHp,
        combat.enemy.hp + intent.value,
      );
      break;
    case "discard":
      combat.player.statuses.forcedDiscard =
        (combat.player.statuses.forcedDiscard ?? 0) + intent.value;
      // twist rascal: gain light armor after discard intent
      if (combat.enemy.variant === "twist" && getEnemy(combat.enemy.id).kit === "discard") {
        combat.enemy.statuses.armor = (combat.enemy.statuses.armor ?? 0) + 2;
      }
      combat.log.push("force_discard");
      break;
    case "shatterBlock":
      combat.player.block = 0;
      hitPlayer(combat, intent.value);
      break;
  }
}

export function endTurn(
  combat: CombatState,
  rng: Rng = defaultRng(),
  passives: PassiveId[] = [],
): CombatState {
  if (combat.phase !== "player") return combat;
  const next = cloneCombat(combat);
  const buffLines = next.log.filter(
    (l) => l.startsWith("buff_poise:") || l.startsWith("buff_hit:"),
  );
  next.log = [...buffLines];

  tickEnemyPoison(next);
  checkCombatEnd(next);
  if ((next.phase as CombatPhase) === "won" || (next.phase as CombatPhase) === "lost") {
    return next;
  }

  next.player.discardPile.push(...next.player.hand);
  next.player.hand = [];
  next.player.ap = 0;

  // Break chain spans turns via consecutive breaks; only reset if no break this turn.
  if (!next.brokeThisTurn) {
    next.breakChain = 0;
  }
  next.brokeThisTurn = false;

  next.phase = "enemy";

  const wasBroken = Boolean(next.enemy.statuses.broken);

  // adverse: regain poise at start of resolve if not broken
  if (next.ruleId === "adverse" && !wasBroken) {
    next.enemy.poise = Math.min(next.enemy.maxPoise, next.enemy.poise + 3);
    next.log.push("adverse_poise");
  }

  if (wasBroken) {
    next.enemy.statuses.broken = false;
    next.enemy.poise = next.enemy.maxPoise;
    next.log.push("enemy_stunned");
  } else if (next.enemy.intent) {
    const intent = next.enemy.intent;
    if (intent.kind === "windup" && (intent.windupLeft ?? 0) > 0) {
      next.enemy.intent = {
        ...intent,
        windupLeft: (intent.windupLeft ?? 1) - 1,
      };
      beginPlayerTurn(next, rng, passives);
      return next;
    }
    resolveIntent(next, intent);
  }

  checkCombatEnd(next);
  if ((next.phase as CombatPhase) === "won" || (next.phase as CombatPhase) === "lost") {
    return next;
  }

  if (!wasBroken) {
    if ((next.enemy.statuses.armor ?? 0) > 0) {
      next.enemy.statuses.armor = Math.max(
        0,
        (next.enemy.statuses.armor ?? 0) - 1,
      );
      if (next.enemy.statuses.armor === 0) delete next.enemy.statuses.armor;
    }
  }

  afterEnemyAction(next);
  beginPlayerTurn(next, rng, passives);
  return next;
}

function beginPlayerTurn(
  combat: CombatState,
  rng: Rng,
  passives: PassiveId[] = [],
): void {
  combat.turn += 1;
  combat.phase = "player";
  combat.attacksPlayedThisTurn = 0;
  const bonuses = passiveBonuses(passives);
  if (bonuses.blockRetain > 0) {
    combat.player.block = Math.floor(combat.player.block * bonuses.blockRetain);
  } else {
    combat.player.block = 0;
  }
  combat.player.ap = combat.player.maxAp;

  const poison = combat.player.statuses.poison ?? 0;
  if (poison > 0) {
    const tickDmg = bonuses.poisonHalf ? Math.floor(poison / 2) : poison;
    if (tickDmg > 0) {
      combat.player.hp = Math.max(0, combat.player.hp - tickDmg);
    }
    combat.player.statuses.poison = poison - 1;
    if (combat.player.statuses.poison <= 0) delete combat.player.statuses.poison;
  }

  drawCards(combat, 5, rng);

  const fd = combat.player.statuses.forcedDiscard ?? 0;
  if (fd > 0) {
    discardRandomFromHand(combat, fd, rng);
    delete combat.player.statuses.forcedDiscard;
  }

  checkCombatEnd(combat);
}

export function plunderFor(enemyId: EnemyId): RewardOption[] {
  switch (enemyId) {
    case "thorn":
      return [
        { kind: "card", cardId: "venom" },
        { kind: "passive", passiveId: "toxin" },
      ];
    case "rascal":
      return [
        { kind: "card", cardId: "purge" },
        { kind: "card", cardId: "lockpick" },
      ];
    case "warden":
      return [{ kind: "card", cardId: "shatter" }];
    case "brute":
      return [{ kind: "card", cardId: "riposte" }];
    case "hexer":
      return [
        { kind: "card", cardId: "cleanse" },
        { kind: "passive", passiveId: "ironLiver" },
      ];
    case "knight":
      return [
        { kind: "card", cardId: "iron" },
        { kind: "passive", passiveId: "bulwark" },
      ];
    case "acolyte":
      return [
        { kind: "card", cardId: "venom" },
        { kind: "card", cardId: "cleanse" },
      ];
    case "duelist":
      return [
        { kind: "card", cardId: "flurry" },
        { kind: "card", cardId: "bash" },
      ];
    case "juggernaut":
      return [
        { kind: "card", cardId: "riposte" },
        { kind: "card", cardId: "chip" },
      ];
    case "scout":
    default:
      return [];
  }
}

function optionKey(o: RewardOption): string {
  return o.kind === "card" ? `card:${o.cardId}` : `passive:${o.passiveId}`;
}

function rarityWeight(r: Rarity, rareBias: boolean): number {
  if (rareBias) {
    if (r === "epic") return 8;
    if (r === "rare") return 14;
    return 4;
  }
  if (r === "epic") return 2;
  if (r === "rare") return 5;
  return 10;
}

function withRarity(o: RewardOption): RewardOption {
  if (o.kind === "card") {
    return { ...o, rarity: getCardRarity(o.cardId) };
  }
  return { ...o, rarity: getPassiveRarity(o.passiveId) };
}

function rollRewards(
  run: RunState,
  rng: Rng,
  enemyId?: EnemyId,
  eliteFight?: boolean,
): RewardOption[] {
  const target =
    run.ruleId === "bloodFeud" ? 4 : 3;
  const rareBias = Boolean(run.forceRareReward || eliteFight);
  const options: RewardOption[] = [];
  const seen = new Set<string>();
  const tags = deckTagWeights(run.deck);

  const pushUnique = (o: RewardOption): boolean => {
    if (o.kind === "passive" && run.passives.includes(o.passiveId)) return false;
    const k = optionKey(o);
    if (seen.has(k)) return false;
    seen.add(k);
    options.push(withRarity(o));
    return true;
  };

  if (enemyId) {
    const plunder = [...plunderFor(enemyId)];
    shuffleInPlace(plunder, rng);
    for (const p of plunder) {
      if (options.length >= Math.min(2, target)) break;
      pushUnique(p);
    }
  }

  // Build soft bias (~25%): prefer cards matching deck tags
  const biasedCards = REWARD_CARD_POOL.filter((cid) => {
    const ct = CARDS[cid]?.tags ?? [];
    return ct.some((t) => (tags[t as CardTag] ?? 0) > 0);
  });
  if (biasedCards.length > 0 && rng() < 0.28) {
    pushUnique({ kind: "card", cardId: pickOne(biasedCards, rng) });
  }

  // Weighted rarity pool
  type Cand = RewardOption & { w: number };
  const cands: Cand[] = [];
  for (const cid of REWARD_CARD_POOL) {
    const r = getCardRarity(cid);
    cands.push({
      kind: "card",
      cardId: cid,
      rarity: r,
      w: rarityWeight(r, rareBias),
    });
  }
  for (const pid of PASSIVE_POOL) {
    if (run.passives.includes(pid)) continue;
    const r = getPassiveRarity(pid);
    cands.push({
      kind: "passive",
      passiveId: pid,
      rarity: r,
      w: rarityWeight(r, rareBias) * 0.85,
    });
  }

  const pickWeighted = (): RewardOption | null => {
    const avail = cands.filter((c) => !seen.has(optionKey(c)));
    if (avail.length === 0) return null;
    const total = avail.reduce((s, c) => s + c.w, 0);
    let roll = rng() * total;
    for (const c of avail) {
      roll -= c.w;
      if (roll <= 0) {
        const { w: _w, ...opt } = c;
        return opt;
      }
    }
    const last = avail[avail.length - 1]!;
    const { w: _w, ...opt } = last;
    return opt;
  };

  while (options.length < target) {
    const o = pickWeighted();
    if (!o) break;
    pushUnique(o);
  }

  while (options.length < target) {
    pushUnique({ kind: "card", cardId: "strike" });
  }

  return options.slice(0, target);
}

export function advanceAfterCombatWin(
  run: RunState,
  rng: Rng = defaultRng(),
): RunState {
  if (!run.combat || run.combat.phase !== "won") return run;
  const defeatedId = run.combat.enemy.id;
  const wasElite = run.combat.enemy.elite;
  const next = cloneRun(run);
  next.highlights = mergeHighlights(next, run.combat);
  const bonuses = passiveBonuses(next.passives);
  const healed = healAmount(next, bonuses.healOnWin);
  next.hp = Math.min(next.maxHp, run.combat.player.hp + healed);
  next.combat = null;
  next.fightIndex += 1;
  next.lastEnemyId = defeatedId;
  next.forceRareReward = wasElite || undefined;

  const remainingFights = next.nodes
    .slice(next.nodeIndex + 1)
    .filter((n) => n.kind === "fight" || n.kind === "pathChoice");
  // Path choices may still yield fights — only end if nothing left that can fight
  const fightLeft = next.nodes
    .slice(next.nodeIndex + 1)
    .some(
      (n) =>
        n.kind === "fight" ||
        (n.kind === "pathChoice" &&
          n.options.some((o) => o.kind === "safeFight" || o.kind === "riskyElite")),
    );
  if (!fightLeft && remainingFights.length === 0) {
    next.phase = "runWon";
    next.rewards = [];
    next.forceRareReward = undefined;
    return next;
  }

  // If next nodes are only rests/events/path without more fights AND we've done all fights
  const fightsDone = next.fightIndex >= FIGHT_COUNT;
  if (fightsDone) {
    next.phase = "runWon";
    next.rewards = [];
    next.forceRareReward = undefined;
    return next;
  }

  next.phase = "reward";
  next.rewards = rollRewards(next, rng, defeatedId, wasElite);
  return next;
}

export function advanceAfterCombatLoss(run: RunState): RunState {
  const next = cloneRun(run);
  if (run.combat) {
    next.highlights = mergeHighlights(next, run.combat);
  }
  next.phase = "runLost";
  next.combat = null;
  next.rewards = [];
  next.hp = 0;
  return next;
}

export function pickReward(
  run: RunState,
  index: number,
  rng: Rng = defaultRng(),
): RunState {
  if (run.phase !== "reward") return run;
  const choice = run.rewards[index];
  if (!choice) return run;

  const next = cloneRun(run);
  next.rewards = [];
  next.lastEnemyId = undefined;
  next.forceRareReward = undefined;

  if (choice.kind === "card") {
    next.deck.push(mintCard(next, choice.cardId));
  } else {
    next.passives.push(choice.passiveId);
    const p = PASSIVES[choice.passiveId];
    if (p.maxHpBonus) {
      next.maxHp += p.maxHpBonus;
    }
    if (p.healOnPick) {
      next.hp = Math.min(next.maxHp, next.hp + healAmount(next, p.healOnPick));
    }
  }

  return goToNextNode(next, rng);
}

function enterRest(run: RunState, variant: RestVariant): RunState {
  run.phase = "rest";
  run.combat = null;
  run.restVariant = variant;
  run.eventId = undefined;
  return run;
}

function enterEvent(run: RunState, eventId: EventId): RunState {
  run.phase = "event";
  run.combat = null;
  run.eventId = eventId;
  run.restVariant = undefined;
  return run;
}

function enterFight(
  run: RunState,
  enemyId: EnemyId,
  rng: Rng,
  opts?: { elite?: boolean; variant?: EnemyVariant },
): RunState {
  run.phase = "combat";
  run.combat = startCombat(run, enemyId, rng, opts);
  run.nextFightBuff = undefined;
  run.restVariant = undefined;
  run.eventId = undefined;
  return run;
}

function goToNextNode(run: RunState, rng: Rng): RunState {
  const nextIndex = run.nodeIndex + 1;
  if (nextIndex >= run.nodes.length) {
    return { ...run, phase: "runWon", nodeIndex: nextIndex, combat: null };
  }
  if (run.fightIndex >= FIGHT_COUNT) {
    return { ...run, phase: "runWon", nodeIndex: nextIndex, combat: null };
  }

  const node = run.nodes[nextIndex]!;
  const next = cloneRun(run);
  next.nodeIndex = nextIndex;

  if (node.kind === "rest") {
    return enterRest(next, node.restVariant ?? "standard");
  }
  if (node.kind === "event") {
    return enterEvent(next, node.eventId);
  }
  if (node.kind === "pathChoice") {
    next.phase = "pathChoice";
    next.combat = null;
    next.restVariant = undefined;
    next.eventId = undefined;
    return next;
  }
  // fight
  return enterFight(next, node.enemyId, rng, {
    elite: node.elite,
    variant: node.variant,
  });
}

export type PathChoiceResult =
  | { ok: true; state: RunState }
  | { ok: false; reason: "wrong_phase" | "bad_choice" };

export function choosePath(
  run: RunState,
  optionId: string,
  rng: Rng = defaultRng(),
): PathChoiceResult {
  if (run.phase !== "pathChoice") return { ok: false, reason: "wrong_phase" };
  const node = run.nodes[run.nodeIndex];
  if (!node || node.kind !== "pathChoice") {
    return { ok: false, reason: "wrong_phase" };
  }
  const opt = node.options.find((o) => o.id === optionId);
  if (!opt) return { ok: false, reason: "bad_choice" };

  const next = cloneRun(run);
  const preferred = node.reservedEnemyId;

  switch (opt.kind) {
    case "safeFight": {
      const { enemyId, variant } = rollPathFightEnemy(
        next,
        false,
        rng,
        preferred,
      );
      return {
        ok: true,
        state: enterFight(next, enemyId, rng, { elite: false, variant }),
      };
    }
    case "riskyElite": {
      const { enemyId, variant } = rollPathFightEnemy(
        next,
        true,
        rng,
        preferred,
      );
      next.forceRareReward = true;
      return {
        ok: true,
        state: enterFight(next, enemyId, rng, { elite: true, variant }),
      };
    }
    case "rest":
      return { ok: true, state: enterRest(next, rollRestVariant(rng)) };
    case "event":
      return { ok: true, state: enterEvent(next, rollEventId(rng)) };
    default:
      return { ok: false, reason: "bad_choice" };
  }
}

export type EventChoiceResult =
  | { ok: true; state: RunState; toast?: string }
  | { ok: false; reason: "wrong_phase" | "bad_choice" };

/**
 * Resolve an event choice (0-based). Each event has 2–3 options.
 * choice semantics are fixed per EventId (see i18n labels).
 */
export function resolveEvent(
  run: RunState,
  choice: number,
  rng: Rng = defaultRng(),
): EventChoiceResult {
  if (run.phase !== "event" || !run.eventId) {
    return { ok: false, reason: "wrong_phase" };
  }
  const next = cloneRun(run);
  const eid = run.eventId;
  let toast: string | undefined;

  const leave = () => {
    next.eventId = undefined;
    return goToNextNode(next, rng);
  };

  const applyBuff = (buff: NextFightBuff) => {
    next.nextFightBuff = { ...(next.nextFightBuff ?? {}), ...buff };
  };

  switch (eid) {
    case "woundedDuelist": {
      // 0 help: -6 hp, gain bash; 1 ignore; 2 finish: +4 hp, next hit +2
      if (choice === 0) {
        next.hp = Math.max(1, next.hp - 6);
        next.deck.push(mintCard(next, "bash"));
        toast = "event_help";
      } else if (choice === 1) {
        toast = "event_ignore";
      } else if (choice === 2) {
        next.hp = Math.min(next.maxHp, next.hp + healAmount(next, 4));
        applyBuff({ hitBonus: 2 });
        toast = "event_finish";
      } else return { ok: false, reason: "bad_choice" };
      return { ok: true, state: leave(), toast };
    }
    case "mysteriousSmith": {
      // 0 pay 5 hp → rare chip/execute; 1 clue (reveal secret); 2 leave
      if (choice === 0) {
        next.hp = Math.max(1, next.hp - 5);
        next.deck.push(mintCard(next, rng() < 0.5 ? "execute" : "shatter"));
        toast = "event_smith_trade";
      } else if (choice === 1) {
        next.secretRevealed = true;
        toast = "event_smith_clue";
      } else if (choice === 2) {
        toast = "event_leave";
      } else return { ok: false, reason: "bad_choice" };
      return { ok: true, state: leave(), toast };
    }
    case "brokenAltar": {
      // 0 remove random card, +start block 4; 1 take 8 dmg, firstPoise +4; 2 leave
      if (choice === 0) {
        if (next.deck.length > 5) {
          const i = Math.floor(rng() * next.deck.length);
          next.deck.splice(i, 1);
        }
        applyBuff({ startBlock: 4 });
        toast = "event_altar_offer";
      } else if (choice === 1) {
        next.hp = Math.max(1, next.hp - 8);
        applyBuff({ firstPoiseBonus: 4 });
        toast = "event_altar_blood";
      } else if (choice === 2) {
        toast = "event_leave";
      } else return { ok: false, reason: "bad_choice" };
      return { ok: true, state: leave(), toast };
    }
    case "gambler": {
      // 0 coin: 50% +10 heal / -8 hp; 1 high: 40% gain flurry else -5; 2 leave
      if (choice === 0) {
        if (rng() < 0.5) {
          next.hp = Math.min(next.maxHp, next.hp + healAmount(next, 10));
          toast = "event_gamble_win";
        } else {
          next.hp = Math.max(1, next.hp - 8);
          toast = "event_gamble_lose";
        }
      } else if (choice === 1) {
        if (rng() < 0.4) {
          next.deck.push(mintCard(next, "flurry"));
          toast = "event_gamble_card";
        } else {
          next.hp = Math.max(1, next.hp - 5);
          toast = "event_gamble_lose";
        }
      } else if (choice === 2) {
        toast = "event_leave";
      } else return { ok: false, reason: "bad_choice" };
      return { ok: true, state: leave(), toast };
    }
    case "travelingMerchant": {
      // 0 buy: -7 hp gain iron; 1 sell: remove card +heal 8; 2 leave
      if (choice === 0) {
        next.hp = Math.max(1, next.hp - 7);
        next.deck.push(mintCard(next, "iron"));
        toast = "event_buy";
      } else if (choice === 1) {
        if (next.deck.length > 5) {
          const i = Math.floor(rng() * next.deck.length);
          next.deck.splice(i, 1);
          next.hp = Math.min(next.maxHp, next.hp + healAmount(next, 8));
        }
        toast = "event_sell";
      } else if (choice === 2) {
        toast = "event_leave";
      } else return { ok: false, reason: "bad_choice" };
      return { ok: true, state: leave(), toast };
    }
    case "forgottenShrine": {
      // 0 pray: heal 12 + startBlock 2; 1 offer strike→insight if have strike; 2 leave
      if (choice === 0) {
        next.hp = Math.min(next.maxHp, next.hp + healAmount(next, 12));
        applyBuff({ startBlock: 2 });
        toast = "event_pray";
      } else if (choice === 1) {
        const si = next.deck.findIndex((c) => c.cardId === "strike");
        if (si >= 0) {
          next.deck.splice(si, 1);
          next.deck.push(mintCard(next, "insight"));
          toast = "event_offer";
        } else {
          next.hp = Math.min(next.maxHp, next.hp + healAmount(next, 4));
          toast = "event_offer_fail";
        }
      } else if (choice === 2) {
        toast = "event_leave";
      } else return { ok: false, reason: "bad_choice" };
      return { ok: true, state: leave(), toast };
    }
    default:
      return { ok: false, reason: "bad_choice" };
  }
}

export function restHeal(run: RunState, rng: Rng = defaultRng()): RunState {
  if (run.phase !== "rest") return run;
  const healed = restHealAmount(run);
  if (healed <= 0) return run; // forge: heal disabled
  const next = cloneRun(run);
  next.hp = Math.min(run.maxHp, run.hp + healed);
  next.restVariant = undefined;
  return goToNextNode(next, rng);
}

export function restRemoveCard(
  run: RunState,
  uid: string,
  rng: Rng = defaultRng(),
): RunState {
  if (run.phase !== "rest") return run;
  if (run.deck.length <= 5) return run;
  const idx = run.deck.findIndex((c) => c.uid === uid);
  if (idx < 0) return run;
  const next = cloneRun(run);
  next.deck.splice(idx, 1);
  next.restVariant = undefined;
  return goToNextNode(next, rng);
}

export type FuseResult =
  | { ok: true; state: RunState; resultId: CardId; secret?: boolean }
  | { ok: false; reason: "wrong_phase" | "not_found" | "same_card" | "no_recipe" };

export function restFuse(
  run: RunState,
  uidA: string,
  uidB: string,
  rng: Rng = defaultRng(),
): FuseResult {
  if (run.phase !== "rest") return { ok: false, reason: "wrong_phase" };
  if (run.deck.length <= 5) return { ok: false, reason: "wrong_phase" };
  if (uidA === uidB) return { ok: false, reason: "same_card" };
  const idxA = run.deck.findIndex((c) => c.uid === uidA);
  const idxB = run.deck.findIndex((c) => c.uid === uidB);
  if (idxA < 0 || idxB < 0) return { ok: false, reason: "not_found" };
  const cardA = run.deck[idxA]!;
  const cardB = run.deck[idxB]!;
  const resultId = findFusionResult(cardA.cardId, cardB.cardId, {
    secretRecipeId: run.secretRecipeId,
  });
  if (!resultId) return { ok: false, reason: "no_recipe" };

  const next = cloneRun(run);
  const [hi, lo] = idxA > idxB ? [idxA, idxB] : [idxB, idxA];
  next.deck.splice(hi, 1);
  next.deck.splice(lo, 1);
  next.deck.push(mintCard(next, resultId));

  const secretResult = SECRET_FUSION_RECIPES.some(
    (r) => r.id === run.secretRecipeId && r.result === resultId,
  );
  if (secretResult) {
    next.secretRevealed = true;
    if (!next.discoveredRecipes.includes(resultId)) {
      next.discoveredRecipes.push(resultId);
    }
  } else if (!next.discoveredRecipes.includes(resultId)) {
    next.discoveredRecipes.push(resultId);
  }

  next.restVariant = undefined;
  return {
    ok: true,
    state: goToNextNode(next, rng),
    resultId,
    secret: secretResult,
  };
}

export function skipRest(run: RunState, rng: Rng = defaultRng()): RunState {
  if (run.phase !== "rest") return run;
  const next = cloneRun(run);
  next.restVariant = undefined;
  return goToNextNode(next, rng);
}

/** Intent label key for i18n (UI maps these). */
export function intentLabelKey(intent: Intent | null): string {
  if (!intent) return "intentNone";
  switch (intent.kind) {
    case "attack":
      return "intentAttack";
    case "heavyAttack":
      return "intentHeavy";
    case "defend":
      return "intentDefend";
    case "windup":
      return (intent.windupLeft ?? 0) > 0 ? "intentWindup" : "intentStrike";
    case "thorns":
      return "intentThorns";
    case "armorUp":
      return "intentArmor";
    case "hex":
      return "intentHex";
    case "heal":
      return "intentHeal";
    case "discard":
      return "intentDiscard";
    case "shatterBlock":
      return "intentShatterBlock";
  }
}

/** Current path options for UI. */
export function currentPathOptions(run: RunState): PathOption[] {
  const node = run.nodes[run.nodeIndex];
  if (!node || node.kind !== "pathChoice") return [];
  return node.options;
}

export {
  CARDS,
  PASSIVES,
  STARTER_DECK,
  FUSION_RECIPES,
  SECRET_FUSION_RECIPES,
  RULE_IDS,
  getCard,
  findFusionResult,
  FIGHT_COUNT,
};
