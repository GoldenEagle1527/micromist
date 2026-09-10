/** Pure engine for Blade Break / 破阵之刃 — R1–R4 random layer */
export type { Rng } from "./engine/helpers";
export {
  defaultRng,
  seededRng,
  healAmount,
  restHealAmount,
} from "./engine/helpers";
export {
  canPlayCard,
  playCard,
  endTurn,
  mergeHighlights,
  intentLabelKey,
} from "./engine/combat";
export type { PathChoiceResult, EventChoiceResult, FuseResult } from "./engine/run";
export {
  createRun,
  plunderFor,
  advanceAfterCombatWin,
  advanceAfterCombatLoss,
  pickReward,
  choosePath,
  resolveEvent,
  restHeal,
  restRemoveCard,
  restFuse,
  skipRest,
  currentPathOptions,
} from "./engine/run";

export {
  CARDS,
  PASSIVES,
  STARTER_DECK,
  FUSION_RECIPES,
  SECRET_FUSION_RECIPES,
  RULE_IDS,
  getCard,
  findFusionResult,
} from "./cards";
export { FIGHT_COUNT } from "./enemies";
