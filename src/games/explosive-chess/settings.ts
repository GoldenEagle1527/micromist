import type { AiDifficulty } from "./ai";
import {
  WIN_MODE_ANNIHILATION,
  type FullState,
  type GameInstance,
  type WinMode,
} from "./engine";
import type { HostColor } from "./online";
import { clearLocalProgress, loadLocalProgress, saveLocalProgress } from "../local-persist";
import { gameStoreGet, gameStoreSet } from "../../lib/game-store";

export type OpponentMode = "ai" | "local" | "online";
export type RedOwner = "player" | "ai";
export type Screen = "setup" | "playing";

export type Settings = {
  opponent: OpponentMode;
  boardSize: 9 | 11 | 13;
  winMode: WinMode;
  winParam: number;
  difficulty: AiDifficulty;
  redOwner: RedOwner;
  /** Online: host seat color chosen before creating the room. */
  hostColor: HostColor;
};

/** @deprecated localStorage key — migrated into IndexedDB on boot. */
export const SETTINGS_KEY = "micromist.explosive-chess.settings";
export const SOLO_PROGRESS_SLUG = "explosive-chess";
export const FRAME_DELAY_MS = 70;

export type SoloPersist = {
  settings: Settings;
  fullState: FullState;
  localSession?: number;
};

export const DEFAULT_SETTINGS: Settings = {
  opponent: "ai",
  boardSize: 9,
  winMode: WIN_MODE_ANNIHILATION,
  winParam: 50,
  difficulty: "medium",
  redOwner: "player",
  hostColor: "red",
};

export function loadSoloPersist(roomFromQuery: string): SoloPersist | null {
  if (roomFromQuery) {
    clearLocalProgress(SOLO_PROGRESS_SLUG);
    return null;
  }
  const data = loadLocalProgress<SoloPersist>(SOLO_PROGRESS_SLUG);
  if (!data?.fullState || !data.settings) return null;
  if (data.settings.opponent === "online" || data.fullState.gameOver) {
    clearLocalProgress(SOLO_PROGRESS_SLUG);
    return null;
  }
  return data;
}

export function persistSoloProgress(
  settings: Settings,
  game: GameInstance,
  localSession: number,
): void {
  if (settings.opponent === "online") return;
  if (game.gameOver) {
    clearLocalProgress(SOLO_PROGRESS_SLUG);
    return;
  }
  saveLocalProgress<SoloPersist>(SOLO_PROGRESS_SLUG, {
    settings,
    fullState: game.getFullState(),
    localSession,
  });
}

export function loadSettings(): Settings {
  try {
    const parsed = gameStoreGet<Partial<Settings>>(SOLO_PROGRESS_SLUG, "settings");
    if (!parsed) return { ...DEFAULT_SETTINGS };
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    if (merged.hostColor !== "red" && merged.hostColor !== "blue") merged.hostColor = "red";
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings) {
  try {
    gameStoreSet(SOLO_PROGRESS_SLUG, "settings", settings);
  } catch {
    /* ignore */
  }
}
