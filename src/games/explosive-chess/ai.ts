/**
 * 爆炸棋 AI — main-thread shell around the Vite worker
 */

import type { GameInstance, PlayerColor } from "./engine";
import AiWorker from "./aiWorker.js?worker";

export type AiDifficulty = "easy" | "medium" | "hard" | "hell";

export type AiMove = { row: number; col: number };

export type AiInstance = {
  getMove: () => Promise<AiMove | null>;
  destroy: () => void;
  readonly difficulty: AiDifficulty;
  readonly color: PlayerColor;
};

const DIFFICULTY_NAMES: Record<AiDifficulty, string> = {
  easy: "简单",
  medium: "中等",
  hard: "困难",
  hell: "炼狱",
};

type WorkerResultMessage = {
  type: "result";
  move: AiMove | null;
};

export function createAI(
  difficulty: AiDifficulty,
  aiColor: PlayerColor,
  game: GameInstance,
): AiInstance {
  let worker: Worker | null = null;
  let destroyed = false;
  let pendingResolve: ((move: AiMove | null) => void) | null = null;

  function handleWorkerMessage(e: MessageEvent<WorkerResultMessage>): void {
    const data = e.data;
    if (data.type === "result" && pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve(data.move);
    }
  }

  function handleWorkerError(e: ErrorEvent): void {
    console.error("[AI] Worker error:", e.message);
    if (pendingResolve) {
      pendingResolve(null);
      pendingResolve = null;
    }
  }

  worker = new AiWorker();
  worker.onmessage = handleWorkerMessage;
  worker.onerror = handleWorkerError;
  console.log(
    `[AI] created: difficulty=${DIFFICULTY_NAMES[difficulty]}, color=${aiColor === 1 ? "红" : "蓝"}`,
  );

  function getMove(): Promise<AiMove | null> {
    if (destroyed || !worker) return Promise.resolve(null);

    return new Promise((resolve) => {
      pendingResolve = resolve;
      const state = game.getFullState();
      worker!.postMessage({
        type: "compute",
        gameState: {
          counts: state.counts,
          colors: state.colors,
          currentTurn: state.currentTurn,
          stepCount: state.stepCount,
        },
        config: {
          boardSize: game.boardSize,
          winMode: game.config.winMode,
          winParam: game.config.winParam,
        },
        aiColor,
        difficulty,
      });
    });
  }

  function destroy(): void {
    destroyed = true;
    if (worker) {
      worker.terminate();
      worker = null;
    }
    if (pendingResolve) {
      pendingResolve(null);
      pendingResolve = null;
    }
  }

  return {
    getMove,
    destroy,
    get difficulty() {
      return difficulty;
    },
    get color() {
      return aiColor;
    },
  };
}
