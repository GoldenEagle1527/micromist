/** Seed + control preferences, persisted via the platform game-store (IndexedDB). */
import { gameStoreGet, gameStoreSet } from "../../lib/game-store";

export const DEEP_MARCH_GAME = "deep-march";
const KEY = "settings";

export type DeepMarchSettings = {
  seed: string;
  /** On-screen control panel; null = automatic (on for touch devices). */
  panel: boolean | null;
  /** Look sensitivity multiplier (1 = Minecraft default). */
  sensitivity: number;
  invertY: boolean;
};

export function randomSeed(): string {
  return String(Math.floor(Math.random() * 1_000_000_000));
}

export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return coarse || (navigator.maxTouchPoints > 0 && !matchMedia("(pointer: fine)").matches);
}

export function panelEnabled(s: DeepMarchSettings): boolean {
  return s.panel ?? isTouchDevice();
}

export function loadSettings(): DeepMarchSettings {
  const raw = gameStoreGet<Partial<DeepMarchSettings>>(DEEP_MARCH_GAME, KEY);
  const sens = typeof raw?.sensitivity === "number" && Number.isFinite(raw.sensitivity) ? raw.sensitivity : 1;
  return {
    seed: typeof raw?.seed === "string" && raw.seed.trim() ? raw.seed.slice(0, 32) : "1",
    panel: typeof raw?.panel === "boolean" ? raw.panel : null,
    sensitivity: Math.min(3, Math.max(0.2, sens)),
    invertY: raw?.invertY === true,
  };
}

export function saveSettings(s: DeepMarchSettings): void {
  gameStoreSet(DEEP_MARCH_GAME, KEY, {
    seed: s.seed.slice(0, 32),
    panel: s.panel,
    sensitivity: s.sensitivity,
    invertY: s.invertY,
  });
}
