import type { LumenDifficulty } from "./i18n";

export type LumenLabels = {
  score: string;
  best: string;
  lives: string;
  nearMiss: string;
  gameOver: string;
  tryAgain: string;
  hint: string;
};

export type LumenGameOptions = {
  difficulty: LumenDifficulty;
  labels: LumenLabels;
  onBestChange?: (best: number) => void;
  onExitRequest?: () => void;
};
