import type { EnemyDef, EnemyId, Intent } from "./types";

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  scout: { id: "scout", maxHp: 28, maxPoise: 12, kit: "basic" },
  rascal: { id: "rascal", maxHp: 30, maxPoise: 11, kit: "discard" },
  brute: { id: "brute", maxHp: 42, maxPoise: 16, kit: "windup" },
  thorn: { id: "thorn", maxHp: 34, maxPoise: 14, kit: "thorns" },
  warden: { id: "warden", maxHp: 40, maxPoise: 15, kit: "shatter" },
  knight: { id: "knight", maxHp: 38, maxPoise: 18, kit: "armor" },
  hexer: { id: "hexer", maxHp: 32, maxPoise: 13, kit: "hex" },
};

/** 7-fight encounter order for a short run. */
export const ENCOUNTER_ORDER: EnemyId[] = [
  "scout",
  "rascal",
  "brute",
  "thorn",
  "warden",
  "knight",
  "hexer",
];

/**
 * Pick next intent for an enemy kit.
 * patternIndex advances each resolve.
 * Windup brute: charge for 1 turn then fire lethal-ish hit.
 */
export function nextIntent(
  enemyId: EnemyId,
  patternIndex: number,
  current: Intent | null,
): Intent {
  const def = ENEMIES[enemyId];

  // Continue multi-turn windup countdown
  if (current?.kind === "windup" && (current.windupLeft ?? 0) > 0) {
    return {
      ...current,
      windupLeft: (current.windupLeft ?? 1) - 1,
    };
  }

  switch (def.kit) {
    case "basic": {
      // Attack / Defend / Attack / Windup light
      const cycle: Intent[] = [
        { kind: "attack", value: 7 },
        { kind: "defend", value: 5 },
        { kind: "attack", value: 9 },
        { kind: "windup", value: 14, windupLeft: 1, windupDamage: 14 },
      ];
      return cycle[patternIndex % cycle.length]!;
    }
    case "discard": {
      // Force-discard messes hand; light attacks and defend
      const cycle: Intent[] = [
        { kind: "discard", value: 1 },
        { kind: "attack", value: 6 },
        { kind: "defend", value: 4 },
        { kind: "discard", value: 1 },
        { kind: "attack", value: 8 },
      ];
      return cycle[patternIndex % cycle.length]!;
    }
    case "windup": {
      // Telegraph heavy, then fire; mix in light attacks
      const cycle: Intent[] = [
        { kind: "attack", value: 8 },
        { kind: "windup", value: 22, windupLeft: 1, windupDamage: 22 },
        { kind: "defend", value: 6 },
        { kind: "windup", value: 26, windupLeft: 1, windupDamage: 26 },
      ];
      return cycle[patternIndex % cycle.length]!;
    }
    case "thorns": {
      const cycle: Intent[] = [
        { kind: "thorns", value: 3 },
        { kind: "attack", value: 8 },
        { kind: "defend", value: 4 },
        { kind: "thorns", value: 4 },
        { kind: "attack", value: 10 },
      ];
      return cycle[patternIndex % cycle.length]!;
    }
    case "shatter": {
      // Strip block then hit; punish turtling; armor up between
      const cycle: Intent[] = [
        { kind: "shatterBlock", value: 12 },
        { kind: "armorUp", value: 3 },
        { kind: "heavyAttack", value: 14 },
        { kind: "shatterBlock", value: 10 },
        { kind: "defend", value: 6 },
      ];
      return cycle[patternIndex % cycle.length]!;
    }
    case "armor": {
      const cycle: Intent[] = [
        { kind: "armorUp", value: 3 },
        { kind: "attack", value: 9 },
        { kind: "defend", value: 8 },
        { kind: "armorUp", value: 2 },
        { kind: "heavyAttack", value: 13 },
      ];
      return cycle[patternIndex % cycle.length]!;
    }
    case "hex": {
      const cycle: Intent[] = [
        { kind: "hex", value: 2 },
        { kind: "attack", value: 7 },
        { kind: "heal", value: 5 },
        { kind: "hex", value: 3 },
        { kind: "attack", value: 11 },
      ];
      return cycle[patternIndex % cycle.length]!;
    }
  }
}

export function getEnemy(id: EnemyId): EnemyDef {
  return ENEMIES[id];
}
