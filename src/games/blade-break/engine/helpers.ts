/** RNG, cloning, and shared Blade Break engine helpers. */
import { PASSIVES } from "../cards";
import type {
  CardId,
  CardInstance,
  CombatState,
  PassiveId,
  RunHighlights,
  RunState,
} from "../types";

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

export function shuffleInPlace<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

export function pickOne<T>(arr: readonly T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

export function cloneCombat(c: CombatState): CombatState {
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

export function cloneRun(run: RunState): RunState {
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

export function mintCard(run: RunState, cardId: CardId): CardInstance {
  const uid = `c${run.nextUid}`;
  run.nextUid += 1;
  return { uid, cardId };
}

export function emptyHighlights(maxHp: number): RunHighlights {
  return {
    maxHit: 0,
    breakInterrupts: 0,
    minHpSeen: maxHp,
    poisonKills: 0,
    maxAttacksInTurn: 0,
  };
}
export function passiveBonuses(passives: PassiveId[]) {
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
