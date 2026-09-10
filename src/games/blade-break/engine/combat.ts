/** Combat resolution: play cards, intents, turns. */
import { CARDS, getCard, isAttackCard } from "../cards";
import {
  getEnemy,
  isLateEnemy,
  isMidEnemy,
  nextIntent,
  scaleEnemyStats,
} from "../enemies";
import type {
  CombatPhase,
  CombatState,
  EnemyId,
  EnemyVariant,
  Intent,
  NextFightBuff,
  PassiveId,
  PlayResult,
  RunHighlights,
  RunState,
} from "../types";
import {
  type Rng,
  cloneCombat,
  defaultRng,
  passiveBonuses,
  shuffleInPlace,
} from "./helpers";

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

export function startCombat(
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
