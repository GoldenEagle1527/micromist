/** Run flow: path, rewards, events, rest. */
import {
  CARDS,
  PASSIVES,
  PASSIVE_POOL,
  REWARD_CARD_POOL,
  RULE_IDS,
  SECRET_FUSION_RECIPES,
  STARTER_DECK,
  deckTagWeights,
  findFusionResult,
  getCardRarity,
  getPassiveRarity,
} from "../cards";
import {
  FIGHT_COUNT,
  rollEncounterLineup,
  rollEnemyVariant,
} from "../enemies";
import type {
  CardId,
  CardTag,
  EnemyId,
  EnemyVariant,
  EventId,
  NextFightBuff,
  PathOption,
  Rarity,
  RestVariant,
  RewardOption,
  RuleId,
  RunNode,
  RunState,
  SecretRecipeId,
} from "../types";
import { mergeHighlights, startCombat } from "./combat";
import {
  type Rng,
  cloneRun,
  defaultRng,
  emptyHighlights,
  healAmount,
  mintCard,
  passiveBonuses,
  pickOne,
  restHealAmount,
  shuffleInPlace,
} from "./helpers";

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
/** Current path options for UI. */
export function currentPathOptions(run: RunState): PathOption[] {
  const node = run.nodes[run.nodeIndex];
  if (!node || node.kind !== "pathChoice") return [];
  return node.options;
}
