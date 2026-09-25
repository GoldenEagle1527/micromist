/** Last seed + pitch preference, persisted via the platform game-store (IndexedDB). */
import { gameStoreGet, gameStoreSet } from "../../lib/game-store";

export const DEEP_MARCH_GAME = "deep-march";
const KEY = "settings";

export type DeepMarchSettings = { seed: string; invertPitch: boolean };

export function randomSeed(): string {
  return String(Math.floor(Math.random() * 1_000_000_000));
}

export function loadSettings(): DeepMarchSettings {
  const raw = gameStoreGet<Partial<DeepMarchSettings>>(DEEP_MARCH_GAME, KEY);
  return {
    seed: typeof raw?.seed === "string" && raw.seed.trim() ? raw.seed.slice(0, 32) : "1",
    invertPitch: raw?.invertPitch === true,
  };
}

export function saveSettings(s: DeepMarchSettings): void {
  gameStoreSet(DEEP_MARCH_GAME, KEY, { seed: s.seed.slice(0, 32), invertPitch: s.invertPitch });
}
