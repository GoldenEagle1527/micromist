/** Mode, seed, control and sound preferences, persisted via the platform game-store (IndexedDB). */
import { gameStoreGet, gameStoreSet } from "../../lib/game-store";
import { parseMode, type GameMode } from "./modes/gameMode";

export const DEEP_MARCH_GAME = "deep-march";
const KEY = "settings";

export type DeepMarchSettings = {
  /** Last chosen way to play (conserved world / free dive). */
  mode: GameMode;
  seed: string;
  /** On-screen control panel; null = automatic (on for touch devices). */
  panel: boolean | null;
  /** Look sensitivity multiplier (1 = Minecraft default). */
  sensitivity: number;
  invertY: boolean;
  /** Dive sound (?audio=0 still turns audio off entirely, whatever this says). */
  sound: SoundSettings;
};

export type SoundSettings = {
  muted: boolean;
  /** Master volume 0..1. */
  volume: number;
};

export const DEFAULT_SOUND: SoundSettings = { muted: false, volume: 0.85 };

/** Validate stored sound settings (anything odd → defaults, volume clamped, 2 decimals). */
export function parseSound(raw: unknown): SoundSettings {
  const r = raw && typeof raw === "object" ? (raw as Partial<SoundSettings>) : {};
  const v = typeof r.volume === "number" && Number.isFinite(r.volume) ? Math.round(Math.min(1, Math.max(0, r.volume)) * 100) / 100 : DEFAULT_SOUND.volume;
  return { muted: r.muted === true, volume: v };
}

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
    mode: parseMode(raw?.mode),
    seed: typeof raw?.seed === "string" && raw.seed.trim() ? raw.seed.slice(0, 32) : "1",
    panel: typeof raw?.panel === "boolean" ? raw.panel : null,
    sensitivity: Math.min(3, Math.max(0.2, sens)),
    invertY: raw?.invertY === true,
    sound: parseSound(raw?.sound),
  };
}

export function saveSettings(s: DeepMarchSettings): void {
  gameStoreSet(DEEP_MARCH_GAME, KEY, {
    mode: parseMode(s.mode),
    seed: s.seed.slice(0, 32),
    panel: s.panel,
    sensitivity: s.sensitivity,
    invertY: s.invertY,
    sound: parseSound(s.sound),
  });
}
