/** The hints' progress in the platform game-store (key `deep-march/hints`), next to the settings. */
import { gameStoreGet, gameStoreSet } from "../../../../lib/game-store";
import { DEEP_MARCH_GAME } from "../../settings";
import { parseProgress, type HintProgress } from "./hintModel";

const KEY = "hints";

export function loadHints(): HintProgress {
  return parseProgress(gameStoreGet<unknown>(DEEP_MARCH_GAME, KEY));
}

export function saveHints(p: HintProgress): void {
  gameStoreSet(DEEP_MARCH_GAME, KEY, { done: [...p.done], off: p.off });
}
