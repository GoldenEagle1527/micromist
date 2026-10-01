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
  /** 「减弱灯光起伏」 (accessibility, M8): shallower, slower light changes near cracks. */
  calmLights: boolean;
  /** Dive sound (the staging debug panel's sound switch still turns audio off entirely, whatever this says). */
  sound: SoundSettings;
  /**
   * True fullscreen (browser chrome hidden) when a dive starts; null = automatic
   * (on for touch devices). The dive always fills the browser window either way.
   */
  fullscreen: boolean | null;
  /** One-off explanations already shown once (observation banner, desktop key chip): never again. */
  seenTips: TipId[];
};

/**
 * One-off explanations (ui/useOnce.ts), shown the first time only: the sonar
 * observation banner, the desktop key chip, the click-to-look prompt, how to
 * absorb, the build-mode keys, the base panel's teaching notes, and each
 * new-player hint step (`hint:<step>`).
 */
export type TipId = "observe" | "keys" | "lock" | "absorbHow" | "buildHow" | "baseIntro" | "releaseNote" | "forecastNote" | `hint:${string}`;
const parseTips = (raw: unknown): TipId[] =>
  Array.isArray(raw) ? (raw.filter((t) => typeof t === "string" && t.length <= 32) as TipId[]).slice(0, 64) : [];

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

export function fullscreenEnabled(s: DeepMarchSettings): boolean {
  return s.fullscreen ?? isTouchDevice();
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
    calmLights: raw?.calmLights === true,
    sound: parseSound(raw?.sound),
    fullscreen: typeof raw?.fullscreen === "boolean" ? raw.fullscreen : null,
    seenTips: parseTips(raw?.seenTips),
  };
}

export function saveSettings(s: DeepMarchSettings): void {
  gameStoreSet(DEEP_MARCH_GAME, KEY, {
    mode: parseMode(s.mode),
    seed: s.seed.slice(0, 32),
    panel: s.panel,
    sensitivity: s.sensitivity,
    invertY: s.invertY,
    calmLights: s.calmLights === true,
    sound: parseSound(s.sound),
    fullscreen: typeof s.fullscreen === "boolean" ? s.fullscreen : null,
    seenTips: parseTips(s.seenTips),
  });
}

/** First time for this tip: true once, and it is remembered (the settings in the game-store). */
export function takeTip(id: TipId): boolean {
  const s = loadSettings();
  if (s.seenTips.includes(id)) return false;
  saveSettings({ ...s, seenTips: [...s.seenTips, id] });
  return true;
}

/** Forget the seen tips starting with `prefix` (the new-player hints switched back on start over). */
export function forgetTips(prefix: string): void {
  const s = loadSettings();
  const keep = s.seenTips.filter((t) => !t.startsWith(prefix));
  if (keep.length !== s.seenTips.length) saveSettings({ ...s, seenTips: keep });
}
