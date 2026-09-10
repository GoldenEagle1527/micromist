import {
  loadLocalProgress,
  saveLocalProgress,
} from "../local-persist";
import { ENEMIES } from "./enemies";
import type { RunState } from "./types";

export const OLD_SESSION_KEY = "micromist.blade-break.run";
export const SLUG = "blade-break";

export function normalizeRun(parsed: RunState): RunState {
  if (parsed.combat) {
    if (parsed.combat.attacksPlayedThisTurn == null) {
      parsed.combat.attacksPlayedThisTurn = 0;
    }
    if (parsed.combat.breakChain == null) parsed.combat.breakChain = 0;
    if (parsed.combat.brokeThisTurn == null) parsed.combat.brokeThisTurn = false;
    if (parsed.combat.breakEchoGranted == null) {
      parsed.combat.breakEchoGranted = false;
    }
    if (parsed.combat.ruleId == null) {
      parsed.combat.ruleId = parsed.ruleId ?? "breakSurge";
    }
    if (parsed.combat.enemy && parsed.combat.enemy.variant == null) {
      parsed.combat.enemy.variant = "normal";
    }
    if (parsed.combat.enemy && parsed.combat.enemy.elite == null) {
      parsed.combat.enemy.elite = false;
    }
    if (!parsed.combat.highlightLog) parsed.combat.highlightLog = [];
    if (
      parsed.combat.enemy &&
      (parsed.combat.enemy.id == null || !(parsed.combat.enemy.id in ENEMIES))
    ) {
      parsed.combat = null;
      parsed.phase = "runLost";
    }
  }
  if (parsed.ruleId == null) parsed.ruleId = "breakSurge";
  {
    const h = parsed.highlights ?? ({} as RunState["highlights"]);
    parsed.highlights = {
      maxHit: h.maxHit ?? 0,
      breakInterrupts: h.breakInterrupts ?? 0,
      minHpSeen: h.minHpSeen ?? parsed.maxHp ?? 40,
      poisonKills: h.poisonKills ?? 0,
      maxAttacksInTurn: h.maxAttacksInTurn ?? 0,
    };
  }
  if (parsed.secretRecipeId == null) {
    parsed.secretRecipeId = "secret_overbreak";
  }
  if (parsed.secretRevealed == null) parsed.secretRevealed = false;
  if (!parsed.discoveredRecipes) parsed.discoveredRecipes = [];
  // Soft-recover corrupt mid-run phases so hydrate can clear to setup
  if (parsed.phase === "event" && !parsed.eventId) {
    parsed.phase = "runLost";
    parsed.combat = null;
  }
  if (parsed.phase === "combat" && !parsed.combat) {
    parsed.phase = "runLost";
  }
  return parsed;
}

let bladeBreakMigrated = false;

export function migrateBladeBreakSessionOnce(): void {
  if (bladeBreakMigrated) return;
  bladeBreakMigrated = true;
  try {
    if (loadLocalProgress<RunState>(SLUG) != null) {
      sessionStorage.removeItem(OLD_SESSION_KEY);
      return;
    }
    const raw = sessionStorage.getItem(OLD_SESSION_KEY);
    if (!raw) return;
    sessionStorage.removeItem(OLD_SESSION_KEY);
    const parsed = normalizeRun(JSON.parse(raw) as RunState);
    if (parsed.phase !== "runWon" && parsed.phase !== "runLost") {
      saveLocalProgress(SLUG, parsed);
    }
  } catch {
    /* ignore */
  }
}
