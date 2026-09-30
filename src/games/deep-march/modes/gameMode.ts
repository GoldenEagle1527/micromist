/**
 * The two ways to play (D5): the conserved world ("深潜·守恒", conserve/) and the
 * original endless free dive, which stays exactly as it was.
 */
export const GAME_MODES = ["conserve", "free"] as const;

export type GameMode = (typeof GAME_MODES)[number];

/** Default for new players and anything unrecognized: the free dive (existing players keep what they had). */
export const DEFAULT_MODE: GameMode = "free";

export function parseMode(raw: unknown): GameMode {
  return (GAME_MODES as readonly unknown[]).includes(raw) ? (raw as GameMode) : DEFAULT_MODE;
}
