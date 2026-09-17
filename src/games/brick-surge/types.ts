export type BrickKind = "normal" | "multi" | "deflect" | "explode";

export type BrickSurgeLabels = {
  score: string;
  best: string;
  lives: string;
  wave: string;
  mult: string;
  pause: string;
  resume: string;
  gameOver: (score: number) => string;
  clickStart: string;
};

export type BrickSurgeGameOptions = {
  labels: BrickSurgeLabels;
  /** Optional difficulty multiplier on ball/wave speed. Default 1. */
  speed?: number;
  onBestChange?: (best: number) => void;
  onGameOver?: (score: number, best: number) => void;
};

export type BrickSurgeHandle = {
  destroy: (removeCanvas?: boolean) => void;
  pause: () => void;
  resume: () => void;
  isPlaying: () => boolean;
};
