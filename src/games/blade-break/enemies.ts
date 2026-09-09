import type { EnemyDef, EnemyId, Intent } from "./types";

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  scout: { id: "scout", maxHp: 28, maxPoise: 12, kit: "basic" },
  rascal: { id: "rascal", maxHp: 30, maxPoise: 11, kit: "discard" },
  acolyte: { id: "acolyte", maxHp: 26, maxPoise: 10, kit: "hex" },
  brute: { id: "brute", maxHp: 42, maxPoise: 16, kit: "windup" },
  thorn: { id: "thorn", maxHp: 34, maxPoise: 14, kit: "thorns" },
  warden: { id: "warden", maxHp: 40, maxPoise: 15, kit: "shatter" },
  duelist: { id: "duelist", maxHp: 36, maxPoise: 14, kit: "basic" },
  knight: { id: "knight", maxHp: 38, maxPoise: 18, kit: "armor" },
  hexer: { id: "hexer", maxHp: 32, maxPoise: 13, kit: "hex" },
  juggernaut: { id: "juggernaut", maxHp: 48, maxPoise: 20, kit: "windup" },
};

/** How many fights in a short run (progress UI). */
export const FIGHT_COUNT = 7;

/**
 * Difficulty pools for procedural runs.
 * Each run picks without replacement: 2 early + 3 mid + 2 late.
 */
export const ENEMY_POOLS = {
  early: ["scout", "rascal", "acolyte"] as const satisfies readonly EnemyId[],
  mid: ["brute", "thorn", "warden", "duelist"] as const satisfies readonly EnemyId[],
  late: ["knight", "hexer", "juggernaut"] as const satisfies readonly EnemyId[],
};

/** @deprecated Prefer rollEncounterLineup — kept for UI fight count fallbacks. */
export const ENCOUNTER_ORDER: EnemyId[] = [
  "scout",
  "rascal",
  "brute",
  "thorn",
  "warden",
  "knight",
  "hexer",
];

type Rng = () => number;

function pickN<T>(pool: readonly T[], n: number, rng: Rng, used: Set<T>): T[] {
  const avail = pool.filter((id) => !used.has(id));
  // Fisher–Yates partial
  const arr = [...avail];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  const picked = arr.slice(0, Math.min(n, arr.length));
  for (const id of picked) used.add(id);
  return picked;
}

/** Build a fresh 7-enemy lineup from tier pools (varies each run). */
export function rollEncounterLineup(rng: Rng): EnemyId[] {
  const used = new Set<EnemyId>();
  const early = pickN([...ENEMY_POOLS.early], 2, rng, used);
  const mid = pickN([...ENEMY_POOLS.mid], 3, rng, used);
  const late = pickN([...ENEMY_POOLS.late], 2, rng, used);
  const line = [...early, ...mid, ...late];
  if (line.length < FIGHT_COUNT) {
    // Safety fill from any remaining enemies
    const rest = (Object.keys(ENEMIES) as EnemyId[]).filter((id) => !used.has(id));
    for (const id of rest) {
      if (line.length >= FIGHT_COUNT) break;
      line.push(id);
    }
  }
  return line.slice(0, FIGHT_COUNT);
}

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
      if (enemyId === "duelist") {
        const cycle: Intent[] = [
          { kind: "attack", value: 9 },
          { kind: "attack", value: 9 },
          { kind: "defend", value: 4 },
          { kind: "heavyAttack", value: 12 },
        ];
        return cycle[patternIndex % cycle.length]!;
      }
      const cycle: Intent[] = [
        { kind: "attack", value: 7 },
        { kind: "defend", value: 5 },
        { kind: "attack", value: 9 },
        { kind: "windup", value: 14, windupLeft: 1, windupDamage: 14 },
      ];
      return cycle[patternIndex % cycle.length]!;
    }
    case "discard": {
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
      if (enemyId === "juggernaut") {
        const cycle: Intent[] = [
          { kind: "defend", value: 8 },
          { kind: "windup", value: 28, windupLeft: 1, windupDamage: 28 },
          { kind: "attack", value: 10 },
          { kind: "windup", value: 32, windupLeft: 1, windupDamage: 32 },
        ];
        return cycle[patternIndex % cycle.length]!;
      }
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
      if (enemyId === "acolyte") {
        const cycle: Intent[] = [
          { kind: "hex", value: 1 },
          { kind: "attack", value: 6 },
          { kind: "defend", value: 4 },
          { kind: "hex", value: 2 },
          { kind: "attack", value: 8 },
        ];
        return cycle[patternIndex % cycle.length]!;
      }
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
