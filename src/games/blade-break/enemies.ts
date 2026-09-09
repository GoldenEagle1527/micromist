import type { EnemyDef, EnemyId, EnemyVariant, Intent, RuleId } from "./types";

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
    const rest = (Object.keys(ENEMIES) as EnemyId[]).filter((id) => !used.has(id));
    for (const id of rest) {
      if (line.length >= FIGHT_COUNT) break;
      line.push(id);
    }
  }
  return line.slice(0, FIGHT_COUNT);
}

/** normal 50%, others split equally. */
export function rollEnemyVariant(rng: Rng): EnemyVariant {
  const r = rng();
  if (r < 0.5) return "normal";
  if (r < 0.5 + 1 / 6) return "frenzy";
  if (r < 0.5 + 2 / 6) return "armored";
  return "twist";
}

export type ScaledEnemyStats = {
  maxHp: number;
  maxPoise: number;
  startArmor: number;
  startThorns: number;
  intentDamageMul: number;
};

/**
 * Apply variant / elite / rule modifiers to base enemy stats.
 * Random gives PROBLEMS (thinner poise + harder hits, more armor, etc.) — never immunities.
 */
export function scaleEnemyStats(
  enemyId: EnemyId,
  opts: {
    variant: EnemyVariant;
    elite?: boolean;
    ruleId?: RuleId;
  },
): ScaledEnemyStats {
  const def = ENEMIES[enemyId];
  let maxHp = def.maxHp;
  let maxPoise = def.maxPoise;
  let startArmor = 0;
  let startThorns = 0;
  let intentDamageMul = 1;

  switch (opts.variant) {
    case "frenzy":
      maxPoise = Math.max(6, Math.floor(maxPoise * 0.75));
      intentDamageMul *= 1.25;
      maxHp = Math.floor(maxHp * 0.95);
      break;
    case "armored":
      maxHp = Math.max(12, Math.floor(maxHp * 0.85));
      startArmor += 3;
      maxPoise = Math.floor(maxPoise * 1.05);
      break;
    case "twist":
      // Kit-flavored: light stat nudge + starter status below
      if (def.kit === "thorns") startThorns += 2;
      if (def.kit === "armor" || def.kit === "shatter") startArmor += 2;
      if (def.kit === "discard") startArmor += 1;
      if (def.kit === "hex") maxHp = Math.floor(maxHp * 1.08);
      if (def.kit === "windup" || def.kit === "basic") {
        intentDamageMul *= 1.1;
      }
      break;
    case "revenge":
      maxHp = Math.floor(maxHp * 1.2);
      maxPoise = Math.floor(maxPoise * 1.15);
      intentDamageMul *= 1.15;
      startArmor += 1;
      break;
    case "normal":
    default:
      break;
  }

  if (opts.elite) {
    maxHp = Math.floor(maxHp * 1.28);
    maxPoise = Math.floor(maxPoise * 1.2);
    intentDamageMul *= 1.1;
  }

  if (opts.ruleId === "breakSurge") {
    maxPoise = Math.max(6, maxPoise - 2);
    intentDamageMul *= 1.2;
  }
  if (opts.ruleId === "ironCurtain") {
    startArmor += 4;
  }

  return {
    maxHp,
    maxPoise,
    startArmor,
    startThorns,
    intentDamageMul,
  };
}

/** Scale attack-like intent values by multiplier (problems, not immunities). */
export function scaleIntent(intent: Intent, mul: number): Intent {
  if (mul === 1) return intent;
  const scale = (n: number) => Math.max(1, Math.round(n * mul));
  const next: Intent = { ...intent, value: scale(intent.value) };
  if (intent.windupDamage != null) {
    next.windupDamage = scale(intent.windupDamage);
  }
  return next;
}

/**
 * Pick next intent for an enemy kit.
 * patternIndex advances each resolve.
 */
export function nextIntent(
  enemyId: EnemyId,
  patternIndex: number,
  current: Intent | null,
  intentDamageMul = 1,
): Intent {
  const def = ENEMIES[enemyId];

  if (current?.kind === "windup" && (current.windupLeft ?? 0) > 0) {
    return {
      ...current,
      windupLeft: (current.windupLeft ?? 1) - 1,
    };
  }

  let raw: Intent;
  switch (def.kit) {
    case "basic": {
      if (enemyId === "duelist") {
        const cycle: Intent[] = [
          { kind: "attack", value: 9 },
          { kind: "attack", value: 9 },
          { kind: "defend", value: 4 },
          { kind: "heavyAttack", value: 12 },
        ];
        raw = cycle[patternIndex % cycle.length]!;
        break;
      }
      const cycle: Intent[] = [
        { kind: "attack", value: 7 },
        { kind: "defend", value: 5 },
        { kind: "attack", value: 9 },
        { kind: "windup", value: 14, windupLeft: 1, windupDamage: 14 },
      ];
      raw = cycle[patternIndex % cycle.length]!;
      break;
    }
    case "discard": {
      const cycle: Intent[] = [
        { kind: "discard", value: 1 },
        { kind: "attack", value: 6 },
        { kind: "defend", value: 4 },
        { kind: "discard", value: 1 },
        { kind: "attack", value: 8 },
      ];
      raw = cycle[patternIndex % cycle.length]!;
      break;
    }
    case "windup": {
      if (enemyId === "juggernaut") {
        const cycle: Intent[] = [
          { kind: "defend", value: 8 },
          { kind: "windup", value: 28, windupLeft: 1, windupDamage: 28 },
          { kind: "attack", value: 10 },
          { kind: "windup", value: 32, windupLeft: 1, windupDamage: 32 },
        ];
        raw = cycle[patternIndex % cycle.length]!;
        break;
      }
      const cycle: Intent[] = [
        { kind: "attack", value: 8 },
        { kind: "windup", value: 22, windupLeft: 1, windupDamage: 22 },
        { kind: "defend", value: 6 },
        { kind: "windup", value: 26, windupLeft: 1, windupDamage: 26 },
      ];
      raw = cycle[patternIndex % cycle.length]!;
      break;
    }
    case "thorns": {
      const cycle: Intent[] = [
        { kind: "thorns", value: 3 },
        { kind: "attack", value: 8 },
        { kind: "defend", value: 4 },
        { kind: "thorns", value: 4 },
        { kind: "attack", value: 10 },
      ];
      raw = cycle[patternIndex % cycle.length]!;
      break;
    }
    case "shatter": {
      const cycle: Intent[] = [
        { kind: "shatterBlock", value: 12 },
        { kind: "armorUp", value: 3 },
        { kind: "heavyAttack", value: 14 },
        { kind: "shatterBlock", value: 10 },
        { kind: "defend", value: 6 },
      ];
      raw = cycle[patternIndex % cycle.length]!;
      break;
    }
    case "armor": {
      const cycle: Intent[] = [
        { kind: "armorUp", value: 3 },
        { kind: "attack", value: 9 },
        { kind: "defend", value: 8 },
        { kind: "armorUp", value: 2 },
        { kind: "heavyAttack", value: 13 },
      ];
      raw = cycle[patternIndex % cycle.length]!;
      break;
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
        raw = cycle[patternIndex % cycle.length]!;
        break;
      }
      const cycle: Intent[] = [
        { kind: "hex", value: 2 },
        { kind: "attack", value: 7 },
        { kind: "heal", value: 5 },
        { kind: "hex", value: 3 },
        { kind: "attack", value: 11 },
      ];
      raw = cycle[patternIndex % cycle.length]!;
      break;
    }
  }

  const attackLike =
    raw.kind === "attack" ||
    raw.kind === "heavyAttack" ||
    raw.kind === "windup" ||
    raw.kind === "shatterBlock";
  return attackLike ? scaleIntent(raw, intentDamageMul) : raw;
}

export function getEnemy(id: EnemyId): EnemyDef {
  return ENEMIES[id];
}

export function isMidEnemy(id: EnemyId): boolean {
  return (ENEMY_POOLS.mid as readonly EnemyId[]).includes(id);
}

export function isLateEnemy(id: EnemyId): boolean {
  return (ENEMY_POOLS.late as readonly EnemyId[]).includes(id);
}
