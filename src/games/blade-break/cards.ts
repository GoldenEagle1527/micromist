import type {
  CardDef,
  CardId,
  CardTag,
  FusionRecipe,
  PassiveDef,
  PassiveId,
  Rarity,
  SecretFusionRecipe,
  SecretRecipeId,
} from "./types";

export const CARDS: Record<CardId, CardDef> = {
  strike: { id: "strike", cost: 1, damage: 6, rarity: "common", tags: ["attack"] },
  heavy: { id: "heavy", cost: 2, damage: 11, rarity: "common", tags: ["attack"] },
  guard: { id: "guard", cost: 1, block: 5, rarity: "common", tags: ["block"] },
  iron: { id: "iron", cost: 2, block: 9, rarity: "common", tags: ["block"] },
  insight: { id: "insight", cost: 1, draw: 2, rarity: "common", tags: ["draw"] },
  chip: { id: "chip", cost: 1, poise: 5, rarity: "common", tags: ["break"] },
  bash: { id: "bash", cost: 1, damage: 4, poise: 3, rarity: "common", tags: ["attack", "break"] },
  execute: {
    id: "execute",
    cost: 2,
    damage: 18,
    requireBrokenOrHpPct: 0.4,
    bonusIfBroken: 6,
    rarity: "rare",
    tags: ["attack", "break"],
  },
  brace: { id: "brace", cost: 1, block: 4, draw: 1, rarity: "common", tags: ["block", "draw"] },
  venom: { id: "venom", cost: 1, poisonEnemy: 3, rarity: "common", tags: ["poison"] },
  purge: { id: "purge", cost: 0, discardRandom: 1, draw: 2, rarity: "rare", tags: ["draw"] },
  lockpick: { id: "lockpick", cost: 1, draw: 3, rarity: "rare", tags: ["draw"] },
  shatter: {
    id: "shatter",
    cost: 1,
    clearEnemyArmor: true,
    damage: 4,
    rarity: "rare",
    tags: ["attack", "break"],
  },
  riposte: {
    id: "riposte",
    cost: 1,
    block: 6,
    damageIfBroken: 8,
    rarity: "rare",
    tags: ["block", "attack", "break"],
  },
  cleanse: {
    id: "cleanse",
    cost: 1,
    clearPlayerPoison: true,
    block: 5,
    rarity: "common",
    tags: ["block"],
  },
  // Fused cards (via rest forge)
  venomStrike: {
    id: "venomStrike",
    cost: 1,
    damage: 5,
    poisonEnemy: 2,
    rarity: "rare",
    tags: ["attack", "poison"],
    fusionOnly: true,
  },
  crush: {
    id: "crush",
    cost: 1,
    damage: 5,
    poise: 6,
    rarity: "rare",
    tags: ["attack", "break"],
    fusionOnly: true,
  },
  fortress: {
    id: "fortress",
    cost: 1,
    block: 7,
    draw: 1,
    rarity: "rare",
    tags: ["block", "draw"],
    fusionOnly: true,
  },
  cycle: {
    id: "cycle",
    cost: 0,
    discardRandom: 1,
    draw: 3,
    rarity: "rare",
    tags: ["draw"],
    fusionOnly: true,
  },
  // Extra finishers
  flurry: {
    id: "flurry",
    cost: 1,
    damage: 10,
    requireAttacksThisTurn: 2,
    rarity: "rare",
    tags: ["attack"],
  },
  guardBreak: {
    id: "guardBreak",
    cost: 2,
    damage: 12,
    requireBlock: 8,
    clearPlayerBlock: true,
    damageIfEnemyArmor: 14,
    rarity: "epic",
    tags: ["attack", "block"],
  },
  // Secret fusion results (1 per run)
  overbreak: {
    id: "overbreak",
    cost: 2,
    damage: 10,
    poise: 8,
    bonusIfBroken: 8,
    rarity: "epic",
    tags: ["attack", "break"],
    fusionOnly: true,
  },
  toxinWave: {
    id: "toxinWave",
    cost: 1,
    poisonEnemy: 4,
    draw: 1,
    rarity: "epic",
    tags: ["poison", "draw"],
    fusionOnly: true,
  },
  ironPulse: {
    id: "ironPulse",
    cost: 1,
    block: 6,
    poise: 4,
    rarity: "epic",
    tags: ["block", "break"],
    fusionOnly: true,
  },
};

/**
 * Rest-site fusion recipes. Order of inputs does not matter.
 * Consumes both ingredients and adds `result`.
 */
export const FUSION_RECIPES: FusionRecipe[] = [
  { a: "strike", b: "venom", result: "venomStrike" },
  { a: "bash", b: "chip", result: "crush" },
  { a: "guard", b: "brace", result: "fortress" },
  { a: "insight", b: "purge", result: "cycle" },
];

/** One random secret recipe is active per run (base recipes unchanged). */
export const SECRET_FUSION_RECIPES: SecretFusionRecipe[] = [
  { id: "secret_overbreak", a: "chip", b: "execute", result: "overbreak" },
  { id: "secret_toxinWave", a: "venom", b: "insight", result: "toxinWave" },
  { id: "secret_ironPulse", a: "iron", b: "bash", result: "ironPulse" },
];

/** Starter deck composition (card ids, duplicates allowed). */
export const STARTER_DECK: CardId[] = [
  "strike",
  "strike",
  "strike",
  "strike",
  "guard",
  "guard",
  "guard",
  "bash",
  "chip",
  "insight",
];

/** Cards that can appear as fight rewards (exclude fusion-only results). */
export const REWARD_CARD_POOL: CardId[] = [
  "heavy",
  "iron",
  "insight",
  "chip",
  "bash",
  "execute",
  "brace",
  "venom",
  "purge",
  "lockpick",
  "shatter",
  "riposte",
  "cleanse",
  "flurry",
  "guardBreak",
  "strike",
  "guard",
];

export const PASSIVES: Record<PassiveId, PassiveDef> = {
  vitality: { id: "vitality", maxHpBonus: 8, healOnPick: 8, rarity: "common" },
  ironSkin: { id: "ironSkin", startBlock: 4, rarity: "common" },
  shatterEdge: { id: "shatterEdge", poiseOnHit: 1, rarity: "rare" },
  secondWind: { id: "secondWind", healOnWin: 6, rarity: "common" },
  keenEye: { id: "keenEye", firstTurnDraw: 1, rarity: "rare" },
  toxin: { id: "toxin", attacksApplyPoison: 1, rarity: "rare" },
  ironLiver: { id: "ironLiver", poisonHalf: true, rarity: "common" },
  bulwark: { id: "bulwark", blockRetain: 0.5, rarity: "epic" },
};

export const PASSIVE_POOL: PassiveId[] = [
  "vitality",
  "ironSkin",
  "shatterEdge",
  "secondWind",
  "keenEye",
  "toxin",
  "ironLiver",
  "bulwark",
];

export const RULE_IDS = [
  "breakSurge",
  "ironCurtain",
  "bloodFeud",
  "flurryLaw",
  "breakEcho",
  "adverse",
] as const;

export function getCard(id: CardId): CardDef {
  return CARDS[id];
}

export function getPassive(id: PassiveId): PassiveDef {
  return PASSIVES[id];
}

export function getCardRarity(id: CardId): Rarity {
  return CARDS[id]?.rarity ?? "common";
}

export function getPassiveRarity(id: PassiveId): Rarity {
  return PASSIVES[id]?.rarity ?? "common";
}

export function getSecretRecipe(id: SecretRecipeId): SecretFusionRecipe {
  return SECRET_FUSION_RECIPES.find((r) => r.id === id)!;
}

/** Match two card ids against fusion recipes (order-independent). */
export function findFusionResult(
  a: CardId,
  b: CardId,
  opts?: { secretRecipeId?: SecretRecipeId | null },
): CardId | null {
  for (const r of FUSION_RECIPES) {
    if ((r.a === a && r.b === b) || (r.a === b && r.b === a)) {
      return r.result;
    }
  }
  if (opts?.secretRecipeId) {
    const s = getSecretRecipe(opts.secretRecipeId);
    if ((s.a === a && s.b === b) || (s.a === b && s.b === a)) {
      return s.result;
    }
  }
  return null;
}

/** True if this card counts as an "attack" for flurry tracking. */
export function isAttackCard(def: CardDef): boolean {
  return (
    (def.damage != null && def.damage > 0) ||
    def.damageIfBroken != null ||
    def.damageIfEnemyArmor != null
  );
}

/** Aggregate tag counts from a deck for soft reward bias. */
export function deckTagWeights(deck: { cardId: CardId }[]): Partial<Record<CardTag, number>> {
  const w: Partial<Record<CardTag, number>> = {};
  for (const c of deck) {
    const tags = CARDS[c.cardId]?.tags ?? [];
    for (const t of tags) {
      w[t] = (w[t] ?? 0) + 1;
    }
  }
  return w;
}
