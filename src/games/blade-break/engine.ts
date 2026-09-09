/** Pure engine for Blade Break / 破阵之刃 */

import {
  CARDS,
  FUSION_RECIPES,
  PASSIVES,
  PASSIVE_POOL,
  REWARD_CARD_POOL,
  STARTER_DECK,
  findFusionResult,
  getCard,
  isAttackCard,
} from "./cards";
import { FIGHT_COUNT, getEnemy, nextIntent, rollEncounterLineup } from "./enemies";
import type {
  CardId,
  CardInstance,
  CombatPhase,
  CombatState,
  EnemyId,
  Intent,
  PassiveId,
  PlayResult,
  RewardOption,
  RunNode,
  RunState,
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
  };
}

function mintCard(run: RunState, cardId: CardId): CardInstance {
  const uid = `c${run.nextUid}`;
  run.nextUid += 1;
  return { uid, cardId };
}

function buildRunNodes(rng: Rng): RunNode[] {
  // fight, fight, rest, fight, fight, rest, fight, fight, fight → N fights + 2 rests
  const fights = rollEncounterLineup(rng);
  const nodes: RunNode[] = [];
  let fi = 0;
  const plan: Array<"fight" | "rest"> = [
    "fight",
    "fight",
    "rest",
    "fight",
    "fight",
    "rest",
    "fight",
    "fight",
    "fight",
  ];
  for (let i = 0; i < plan.length; i++) {
    if (plan[i] === "fight") {
      nodes.push({ kind: "fight", enemyId: fights[fi]!, index: i });
      fi += 1;
    } else {
      nodes.push({ kind: "rest", index: i });
    }
  }
  return nodes;
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

function dealHpDamage(combat: CombatState, raw: number): number {
  let dmg = raw;
  if (combat.enemy.statuses.broken) dmg = Math.floor(dmg * 2);
  const armor = combat.enemy.statuses.armor ?? 0;
  if (armor > 0) dmg = Math.max(0, dmg - armor);
  combat.enemy.hp = Math.max(0, combat.enemy.hp - dmg);
  return dmg;
}

function dealPoiseDamage(combat: CombatState, amount: number): void {
  if (amount <= 0) return;
  if (combat.enemy.statuses.broken) return; // already broken this cycle
  combat.enemy.poise = Math.max(0, combat.enemy.poise - amount);
  if (combat.enemy.poise <= 0) {
    combat.enemy.statuses.broken = true;
    combat.enemy.intent = null; // cancel current intent
    combat.log.push("poise_break");
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
}

function checkCombatEnd(combat: CombatState): void {
  if (combat.enemy.hp <= 0) {
    combat.phase = "won";
    combat.enemy.intent = null;
  } else if (combat.player.hp <= 0) {
    combat.phase = "lost";
  }
}

/**
 * After enemy action (or skip), advance pattern and pick next telegraph.
 */
function afterEnemyAction(combat: CombatState): void {
  combat.enemy.patternIndex += 1;
  combat.enemy.intent = nextIntent(
    combat.enemy.id,
    combat.enemy.patternIndex,
    null,
  );
}

function startCombat(
  run: RunState,
  enemyId: EnemyId,
  rng: Rng,
): CombatState {
  const def = getEnemy(enemyId);
  const bonuses = passiveBonuses(run.passives);
  const maxHp = run.maxHp;
  const hp = Math.min(run.hp, maxHp);

  const drawPile = run.deck.map((c) => ({ ...c }));
  shuffleInPlace(drawPile, rng);

  const combat: CombatState = {
    phase: "player",
    turn: 1,
    attacksPlayedThisTurn: 0,
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
      id: enemyId,
      hp: def.maxHp,
      maxHp: def.maxHp,
      poise: def.maxPoise,
      maxPoise: def.maxPoise,
      intent: null,
      statuses: {},
      patternIndex: Math.floor(rng() * 4),
    },
    log: [],
  };

  combat.enemy.intent = nextIntent(enemyId, 0, null);
  const drawN = 5 + bonuses.firstTurnDraw;
  drawCards(combat, drawN, rng);
  return combat;
}

export function createRun(rng: Rng = defaultRng()): RunState {
  const seed = Math.floor(rng() * 1e9);
  const baseMax = 40;
  const run: RunState = {
    seed,
    nodeIndex: 0,
    nodes: buildRunNodes(rng),
    phase: "combat",
    deck: [],
    passives: [],
    hp: baseMax,
    maxHp: baseMax,
    fightIndex: 0,
    combat: null,
    rewards: [],
    nextUid: 1,
  };
  for (const id of STARTER_DECK) {
    run.deck.push(mintCard(run, id));
  }

  const first = run.nodes[0]!;
  if (first.kind !== "fight") throw new Error("run must start with fight");
  run.combat = startCombat(run, first.enemyId, rng);
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

export function playCard(
  combat: CombatState,
  uid: string,
  rng: Rng = defaultRng(),
  passives: PassiveId[] = [],
): PlayResult {
  const check = canPlayCard(combat, uid);
  if (!check.ok) return check;

  const next = cloneCombat(combat);
  next.log = [];
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
  if (dmg > 0 || def.damage) {
    if (dmg > 0) {
      hpDealt = dealHpDamage(next, dmg);
      applyThorns(next, hpDealt);
      if (hpDealt > 0) next.log.push("hit");
    }
  }

  if (def.clearPlayerBlock) {
    next.player.block = 0;
  }

  let poiseAmt = def.poise ?? 0;
  if ((def.damage || def.poise || def.damageIfBroken) && bonuses.poiseOnHit > 0) {
    poiseAmt += bonuses.poiseOnHit;
  }
  if (poiseAmt > 0) dealPoiseDamage(next, poiseAmt);

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

  if (isAttackCard(def)) {
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
      combat.log.push("force_discard");
      break;
    case "shatterBlock":
      combat.player.block = 0;
      hitPlayer(combat, intent.value);
      break;
  }
}

/**
 * End player turn → resolve enemy (unless broken) → queue next intent → draw.
 */
export function endTurn(
  combat: CombatState,
  rng: Rng = defaultRng(),
  passives: PassiveId[] = [],
): CombatState {
  if (combat.phase !== "player") return combat;
  const next = cloneCombat(combat);
  next.log = [];

  tickEnemyPoison(next);
  checkCombatEnd(next);
  if ((next.phase as CombatPhase) === "won" || (next.phase as CombatPhase) === "lost") {
    return next;
  }

  next.player.discardPile.push(...next.player.hand);
  next.player.hand = [];
  next.player.ap = 0;

  next.phase = "enemy";

  const wasBroken = Boolean(next.enemy.statuses.broken);

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

/**
 * Plunder-biased reward options tied to the defeated enemy.
 */
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

function rollRewards(
  run: RunState,
  rng: Rng,
  enemyId?: EnemyId,
): RewardOption[] {
  const options: RewardOption[] = [];
  const seen = new Set<string>();

  const pushUnique = (o: RewardOption): boolean => {
    if (o.kind === "passive" && run.passives.includes(o.passiveId)) return false;
    const k = optionKey(o);
    if (seen.has(k)) return false;
    seen.add(k);
    options.push(o);
    return true;
  };

  if (enemyId) {
    const plunder = [...plunderFor(enemyId)];
    shuffleInPlace(plunder, rng);
    for (const p of plunder) {
      if (options.length >= 2) break;
      pushUnique(p);
    }
  }

  const cardPool = [...REWARD_CARD_POOL];
  shuffleInPlace(cardPool, rng);
  const passivePool = PASSIVE_POOL.filter((p) => !run.passives.includes(p));
  shuffleInPlace(passivePool, rng);

  for (const cid of cardPool) {
    if (options.length >= 3) break;
    pushUnique({ kind: "card", cardId: cid });
  }
  if (options.length < 3 && passivePool[0] && rng() < 0.55) {
    pushUnique({ kind: "passive", passiveId: passivePool[0] });
  }
  for (const cid of cardPool) {
    if (options.length >= 3) break;
    pushUnique({ kind: "card", cardId: cid });
  }
  while (options.length < 3) {
    const pid = passivePool.find(
      (p) => !options.some((o) => o.kind === "passive" && o.passiveId === p),
    );
    if (pid && pushUnique({ kind: "passive", passiveId: pid })) continue;
    const c = cardPool[options.length % Math.max(1, cardPool.length)]!;
    if (!pushUnique({ kind: "card", cardId: c })) {
      options.push({ kind: "card", cardId: "strike" });
      break;
    }
  }
  return options.slice(0, 3);
}

/** Sync HP from combat into run and open reward / next node. */
export function advanceAfterCombatWin(
  run: RunState,
  rng: Rng = defaultRng(),
): RunState {
  if (!run.combat || run.combat.phase !== "won") return run;
  const defeatedId = run.combat.enemy.id;
  const next: RunState = {
    ...run,
    deck: run.deck.map((c) => ({ ...c })),
    passives: [...run.passives],
    nodes: [...run.nodes],
  };
  const bonuses = passiveBonuses(next.passives);
  next.hp = Math.min(
    next.maxHp,
    run.combat.player.hp + bonuses.healOnWin,
  );
  next.combat = null;
  next.fightIndex += 1;
  next.lastEnemyId = defeatedId;

  const remainingFights = next.nodes
    .slice(next.nodeIndex + 1)
    .filter((n) => n.kind === "fight");
  if (remainingFights.length === 0) {
    next.phase = "runWon";
    next.rewards = [];
    return next;
  }

  next.phase = "reward";
  next.rewards = rollRewards(next, rng, defeatedId);
  return next;
}

export function advanceAfterCombatLoss(run: RunState): RunState {
  return {
    ...run,
    phase: "runLost",
    combat: null,
    rewards: [],
    hp: 0,
  };
}

export function pickReward(
  run: RunState,
  index: number,
  rng: Rng = defaultRng(),
): RunState {
  if (run.phase !== "reward") return run;
  const choice = run.rewards[index];
  if (!choice) return run;

  const next: RunState = {
    ...run,
    deck: run.deck.map((c) => ({ ...c })),
    passives: [...run.passives],
    nodes: [...run.nodes],
    rewards: [],
    lastEnemyId: undefined,
  };

  if (choice.kind === "card") {
    next.deck.push(mintCard(next, choice.cardId));
  } else {
    next.passives.push(choice.passiveId);
    const p = PASSIVES[choice.passiveId];
    if (p.maxHpBonus) {
      next.maxHp += p.maxHpBonus;
    }
    if (p.healOnPick) {
      next.hp = Math.min(next.maxHp, next.hp + p.healOnPick);
    }
  }

  return goToNextNode(next, rng);
}

function goToNextNode(run: RunState, rng: Rng): RunState {
  const nextIndex = run.nodeIndex + 1;
  if (nextIndex >= run.nodes.length) {
    return { ...run, phase: "runWon", nodeIndex: nextIndex, combat: null };
  }
  const node = run.nodes[nextIndex]!;
  const next: RunState = { ...run, nodeIndex: nextIndex };
  if (node.kind === "rest") {
    next.phase = "rest";
    next.combat = null;
    return next;
  }
  next.phase = "combat";
  next.combat = startCombat(next, node.enemyId, rng);
  return next;
}

export function restHeal(run: RunState, rng: Rng = defaultRng()): RunState {
  if (run.phase !== "rest") return run;
  const heal = Math.max(1, Math.floor(run.maxHp * 0.3));
  const next: RunState = {
    ...run,
    hp: Math.min(run.maxHp, run.hp + heal),
    deck: run.deck.map((c) => ({ ...c })),
    passives: [...run.passives],
    nodes: [...run.nodes],
  };
  return goToNextNode(next, rng);
}

export function restRemoveCard(
  run: RunState,
  uid: string,
  rng: Rng = defaultRng(),
): RunState {
  if (run.phase !== "rest") return run;
  if (run.deck.length <= 5) return run; // keep a minimum deck
  const idx = run.deck.findIndex((c) => c.uid === uid);
  if (idx < 0) return run;
  const next: RunState = {
    ...run,
    deck: run.deck.map((c) => ({ ...c })),
    passives: [...run.passives],
    nodes: [...run.nodes],
  };
  next.deck.splice(idx, 1);
  return goToNextNode(next, rng);
}

export type FuseResult =
  | { ok: true; state: RunState; resultId: CardId }
  | { ok: false; reason: "wrong_phase" | "not_found" | "same_card" | "no_recipe" };

/**
 * Forge two deck cards into one fused card, then leave the rest site.
 * One successful fusion ends the rest visit (same as heal / remove).
 */
export function restFuse(
  run: RunState,
  uidA: string,
  uidB: string,
  rng: Rng = defaultRng(),
): FuseResult {
  if (run.phase !== "rest") return { ok: false, reason: "wrong_phase" };
  if (uidA === uidB) return { ok: false, reason: "same_card" };
  const idxA = run.deck.findIndex((c) => c.uid === uidA);
  const idxB = run.deck.findIndex((c) => c.uid === uidB);
  if (idxA < 0 || idxB < 0) return { ok: false, reason: "not_found" };
  const cardA = run.deck[idxA]!;
  const cardB = run.deck[idxB]!;
  const resultId = findFusionResult(cardA.cardId, cardB.cardId);
  if (!resultId) return { ok: false, reason: "no_recipe" };

  const next: RunState = {
    ...run,
    deck: run.deck.map((c) => ({ ...c })),
    passives: [...run.passives],
    nodes: [...run.nodes],
  };
  // Remove higher index first so indices stay valid
  const [hi, lo] = idxA > idxB ? [idxA, idxB] : [idxB, idxA];
  next.deck.splice(hi, 1);
  next.deck.splice(lo, 1);
  next.deck.push(mintCard(next, resultId));
  return { ok: true, state: goToNextNode(next, rng), resultId };
}

export function skipRest(run: RunState, rng: Rng = defaultRng()): RunState {
  if (run.phase !== "rest") return run;
  return goToNextNode(
    {
      ...run,
      deck: run.deck.map((c) => ({ ...c })),
      passives: [...run.passives],
      nodes: [...run.nodes],
    },
    rng,
  );
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

export {
  CARDS,
  PASSIVES,
  STARTER_DECK,
  FUSION_RECIPES,
  getCard,
  findFusionResult,
  FIGHT_COUNT,
};
