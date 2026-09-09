import type { CardDef, CardId, FusionRecipe, PassiveDef, PassiveId } from "./types";

export const CARDS: Record<CardId, CardDef> = {
  strike: { id: "strike", cost: 1, damage: 6 },
  heavy: { id: "heavy", cost: 2, damage: 11 },
  guard: { id: "guard", cost: 1, block: 5 },
  iron: { id: "iron", cost: 2, block: 9 },
  insight: { id: "insight", cost: 1, draw: 2 },
  chip: { id: "chip", cost: 1, poise: 5 },
  bash: { id: "bash", cost: 1, damage: 4, poise: 3 },
  execute: {
    id: "execute",
    cost: 2,
    damage: 18,
    requireBrokenOrHpPct: 0.4,
    bonusIfBroken: 6,
  },
  brace: { id: "brace", cost: 1, block: 4, draw: 1 },
  venom: { id: "venom", cost: 1, poisonEnemy: 3 },
  purge: { id: "purge", cost: 0, discardRandom: 1, draw: 2 },
  lockpick: { id: "lockpick", cost: 1, draw: 3 },
  shatter: { id: "shatter", cost: 1, clearEnemyArmor: true, damage: 4 },
  riposte: { id: "riposte", cost: 1, block: 6, damageIfBroken: 8 },
  cleanse: { id: "cleanse", cost: 1, clearPlayerPoison: true, block: 5 },
  // Fused cards (via rest forge)
  venomStrike: { id: "venomStrike", cost: 1, damage: 5, poisonEnemy: 2 },
  crush: { id: "crush", cost: 1, damage: 5, poise: 6 },
  fortress: { id: "fortress", cost: 1, block: 7, draw: 1 },
  cycle: { id: "cycle", cost: 0, discardRandom: 1, draw: 3 },
  // Extra finishers
  flurry: { id: "flurry", cost: 1, damage: 10, requireAttacksThisTurn: 2 },
  guardBreak: {
    id: "guardBreak",
    cost: 2,
    damage: 12,
    requireBlock: 8,
    clearPlayerBlock: true,
    damageIfEnemyArmor: 14,
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
  vitality: { id: "vitality", maxHpBonus: 8, healOnPick: 8 },
  ironSkin: { id: "ironSkin", startBlock: 4 },
  shatterEdge: { id: "shatterEdge", poiseOnHit: 1 },
  secondWind: { id: "secondWind", healOnWin: 6 },
  keenEye: { id: "keenEye", firstTurnDraw: 1 },
  toxin: { id: "toxin", attacksApplyPoison: 1 },
  ironLiver: { id: "ironLiver", poisonHalf: true },
  bulwark: { id: "bulwark", blockRetain: 0.5 },
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

export function getCard(id: CardId): CardDef {
  return CARDS[id];
}

export function getPassive(id: PassiveId): PassiveDef {
  return PASSIVES[id];
}

/** Match two card ids against fusion recipes (order-independent). */
export function findFusionResult(a: CardId, b: CardId): CardId | null {
  if (a === b) {
    // Still allow if recipe needs two of same? none do; skip self-pair of same id unless recipe says so
  }
  for (const r of FUSION_RECIPES) {
    if ((r.a === a && r.b === b) || (r.a === b && r.b === a)) {
      return r.result;
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
