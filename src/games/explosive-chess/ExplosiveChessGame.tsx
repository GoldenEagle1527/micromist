import { useCallback, useEffect, useRef, useState } from "react";
import { createAI, type AiDifficulty, type AiInstance } from "./ai";
import { createBoardRenderer, type BoardRenderer } from "./boardRenderer";
import {
  COLOR_BLUE,
  COLOR_RED,
  WIN_MODE_ANNIHILATION,
  WIN_MODE_AREA,
  WIN_MODE_STEPS,
  createGame,
  type AnimationFrame,
  type GameInstance,
  type MoveResult,
  type PlayerColor,
  type WinMode,
} from "./engine";

type OpponentMode = "ai" | "local";
type RedOwner = "player" | "ai";

type Settings = {
  opponent: OpponentMode;
  boardSize: 9 | 11 | 13;
  winMode: WinMode;
  winParam: number;
  difficulty: AiDifficulty;
  redOwner: RedOwner;
};

const SETTINGS_KEY = "micromist.explosive-chess.settings";
const FRAME_DELAY_MS = 70;

const DEFAULT_SETTINGS: Settings = {
  opponent: "ai",
  boardSize: 9,
  winMode: WIN_MODE_ANNIHILATION,
  winParam: 50,
  difficulty: "medium",
  redOwner: "player",
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function colorLabel(color: PlayerColor): string {
  return color === COLOR_RED ? "红方" : "蓝方";
}

function winnerLabel(winner: MoveResult["winner"]): string {
  if (winner === "draw") return "平局";
  if (winner === COLOR_RED) return "红方胜";
  if (winner === COLOR_BLUE) return "蓝方胜";
  return "";
}

export function ExplosiveChessGame() {
  const [settingsDraft, setSettingsDraft] = useState<Settings>(() => loadSettings());
  const [activeSettings, setActiveSettings] = useState<Settings>(() => loadSettings());
  const [turn, setTurn] = useState<PlayerColor>(COLOR_RED);
  const [stepCount, setStepCount] = useState(0);
  const [counts, setCounts] = useState({ red: 0, blue: 0 });
  const [gameOver, setGameOver] = useState(false);
  const [winReason, setWinReason] = useState("");
  const [winner, setWinner] = useState<MoveResult["winner"]>(null);
  const [busy, setBusy] = useState(false);
  const [tip, setTip] = useState("点击格子落子");
  const [session, setSession] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<GameInstance | null>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const aiRef = useRef<AiInstance | null>(null);
  const animatingRef = useRef(false);
  const playerColorRef = useRef<PlayerColor>(COLOR_RED);
  const aiColorRef = useRef<PlayerColor>(COLOR_BLUE);
  const settingsRef = useRef(activeSettings);
  const runAiMoveRef = useRef<() => Promise<void>>(async () => undefined);
  settingsRef.current = activeSettings;

  const syncHud = useCallback((game: GameInstance) => {
    setTurn(game.currentTurn);
    setStepCount(game.stepCount);
    setCounts(game.getCellCounts());
    setGameOver(game.gameOver);
    setWinner(game.winner);
    setWinReason(game.winReason);
  }, []);

  const updateTip = useCallback((game: GameInstance, settings: Settings) => {
    if (game.gameOver) {
      setTip(`${winnerLabel(game.winner)}${game.winReason ? ` · ${game.winReason}` : ""}`);
      return;
    }
    if (settings.opponent === "ai") {
      setTip(
        game.currentTurn === playerColorRef.current ? "轮到你了，点击落子" : "AI 思考中…",
      );
    } else {
      setTip(`${colorLabel(game.currentTurn)}落子`);
    }
  }, []);

  const playFrames = useCallback(async (frames: AnimationFrame[], renderer: BoardRenderer) => {
    if (frames.length === 0) {
      renderer.setExplosionHighlight(null);
      renderer.render();
      return;
    }
    animatingRef.current = true;
    for (const frame of frames) {
      renderer.setExplosionHighlight([frame.explodedCell, ...frame.affectedCells]);
      renderer.render();
      await new Promise((r) => setTimeout(r, FRAME_DELAY_MS));
    }
    renderer.setExplosionHighlight(null);
    renderer.render();
    animatingRef.current = false;
  }, []);

  const afterMove = useCallback(
    async (result: MoveResult) => {
      const game = gameRef.current;
      const renderer = rendererRef.current;
      const settings = settingsRef.current;
      if (!game || !renderer) return;

      const shouldAnimate =
        settings.opponent === "local" || settings.difficulty === "easy";

      if (shouldAnimate && result.animationFrames.length > 0) {
        setBusy(true);
        await playFrames(result.animationFrames, renderer);
      } else {
        renderer.setExplosionHighlight(null);
        renderer.render();
      }

      syncHud(game);
      updateTip(game, settings);

      if (result.gameOver) {
        setBusy(false);
        return;
      }

      if (settings.opponent === "ai" && game.currentTurn === aiColorRef.current) {
        await runAiMoveRef.current();
      } else {
        setBusy(false);
      }
    },
    [playFrames, syncHud, updateTip],
  );

  runAiMoveRef.current = async () => {
    const game = gameRef.current;
    const renderer = rendererRef.current;
    const ai = aiRef.current;
    if (!game || !renderer || !ai || game.gameOver) {
      setBusy(false);
      return;
    }

    setBusy(true);
    setTip("AI 思考中…");
    const move = await ai.getMove();
    if (!move || !gameRef.current || gameRef.current.gameOver) {
      setBusy(false);
      return;
    }

    const result = game.makeMove(move.row, move.col, aiColorRef.current);
    if (!result) {
      setBusy(false);
      return;
    }

    renderer.setLastMove(move.row, move.col);
    await afterMove(result);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    aiRef.current?.destroy();
    aiRef.current = null;
    rendererRef.current?.destroy();
    rendererRef.current = null;

    const settings = activeSettings;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore quota */
    }

    const winParam =
      settings.winMode === WIN_MODE_ANNIHILATION ? undefined : settings.winParam;
    const game = createGame({
      boardSize: settings.boardSize,
      winMode: settings.winMode,
      winParam,
    });
    gameRef.current = game;

    if (settings.opponent === "ai") {
      const playerColor: PlayerColor =
        settings.redOwner === "player" ? COLOR_RED : COLOR_BLUE;
      const aiColor: PlayerColor = playerColor === COLOR_RED ? COLOR_BLUE : COLOR_RED;
      playerColorRef.current = playerColor;
      aiColorRef.current = aiColor;
      aiRef.current = createAI(settings.difficulty, aiColor, game);
    } else {
      playerColorRef.current = COLOR_RED;
      aiColorRef.current = COLOR_BLUE;
    }

    const renderer = createBoardRenderer(canvas, game);
    rendererRef.current = renderer;
    renderer.resize();
    syncHud(game);
    updateTip(game, settings);
    setBusy(false);
    animatingRef.current = false;

    const onResize = () => renderer.resize();
    window.addEventListener("resize", onResize);

    const themeObserver = new MutationObserver(() => {
      renderer.resize();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    let cancelled = false;
    if (settings.opponent === "ai" && game.currentTurn === aiColorRef.current) {
      queueMicrotask(() => {
        if (!cancelled) void runAiMoveRef.current();
      });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      themeObserver.disconnect();
      aiRef.current?.destroy();
      aiRef.current = null;
      renderer.destroy();
      rendererRef.current = null;
      gameRef.current = null;
    };
  }, [activeSettings, session, syncHud, updateTip]);

  const handlePointer = (clientX: number, clientY: number) => {
    const game = gameRef.current;
    const renderer = rendererRef.current;
    const settings = settingsRef.current;
    if (!game || !renderer || game.gameOver || busy || animatingRef.current) return;

    if (settings.opponent === "ai" && game.currentTurn === aiColorRef.current) {
      return;
    }

    const cell = renderer.pixelToCell(clientX, clientY);
    if (!cell) return;
    if (!game.isValidMove(cell.row, cell.col, game.currentTurn)) return;

    const result = game.makeMove(cell.row, cell.col, game.currentTurn);
    if (!result) return;

    renderer.setLastMove(cell.row, cell.col);
    void afterMove(result);
  };

  const applyNewGame = () => {
    setActiveSettings({ ...settingsDraft });
    setSession((n) => n + 1);
  };

  const showWinParam =
    settingsDraft.winMode === WIN_MODE_STEPS || settingsDraft.winMode === WIN_MODE_AREA;

  return (
    <div className="explosive-chess">
      <div className="panel">
        <h2>对局设置</h2>
        <div className="row explosive-controls">
          <label>
            模式
            <select
              value={settingsDraft.opponent}
              onChange={(e) =>
                setSettingsDraft((s) => ({
                  ...s,
                  opponent: e.target.value as OpponentMode,
                }))
              }
            >
              <option value="ai">本地 vs AI</option>
              <option value="local">本地 vs 本地（热座）</option>
            </select>
          </label>
          <label>
            棋盘
            <select
              value={settingsDraft.boardSize}
              onChange={(e) =>
                setSettingsDraft((s) => ({
                  ...s,
                  boardSize: Number(e.target.value) as 9 | 11 | 13,
                }))
              }
            >
              <option value={9}>9×9</option>
              <option value={11}>11×11</option>
              <option value={13}>13×13</option>
            </select>
          </label>
          <label>
            胜利
            <select
              value={settingsDraft.winMode}
              onChange={(e) =>
                setSettingsDraft((s) => ({
                  ...s,
                  winMode: e.target.value as WinMode,
                }))
              }
            >
              <option value={WIN_MODE_ANNIHILATION}>鏖战（歼灭）</option>
              <option value={WIN_MODE_STEPS}>步数制</option>
              <option value={WIN_MODE_AREA}>面积制</option>
            </select>
          </label>
          {showWinParam ? (
            <label>
              {settingsDraft.winMode === WIN_MODE_STEPS ? "步数" : "目标格数"}
              <input
                type="number"
                min={1}
                value={settingsDraft.winParam}
                onChange={(e) =>
                  setSettingsDraft((s) => ({
                    ...s,
                    winParam: Math.max(1, Number(e.target.value) || 1),
                  }))
                }
              />
            </label>
          ) : null}
          {settingsDraft.opponent === "ai" ? (
            <>
              <label>
                AI 难度
                <select
                  value={settingsDraft.difficulty}
                  onChange={(e) =>
                    setSettingsDraft((s) => ({
                      ...s,
                      difficulty: e.target.value as AiDifficulty,
                    }))
                  }
                >
                  <option value="easy">简单</option>
                  <option value="medium">中等</option>
                  <option value="hard">困难</option>
                  <option value="hell">炼狱</option>
                </select>
              </label>
              <label>
                红方（先手）
                <select
                  value={settingsDraft.redOwner}
                  onChange={(e) =>
                    setSettingsDraft((s) => ({
                      ...s,
                      redOwner: e.target.value as RedOwner,
                    }))
                  }
                >
                  <option value="player">我方</option>
                  <option value="ai">AI</option>
                </select>
              </label>
            </>
          ) : null}
        </div>
        <div className="row">
          <button type="button" className="primary" onClick={applyNewGame}>
            新游戏
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setSettingsDraft({ ...activeSettings });
              setSession((n) => n + 1);
            }}
          >
            重开当前设置
          </button>
        </div>
      </div>

      <div className="panel explosive-status">
        <div className="row" style={{ marginTop: 0 }}>
          <span>
            回合：<strong>{colorLabel(turn)}</strong>
          </span>
          <span>步数：{stepCount}</span>
          <span className="explosive-count red">红 {counts.red}</span>
          <span className="explosive-count blue">蓝 {counts.blue}</span>
        </div>
        <p className="hint" style={{ marginTop: "0.5rem" }}>
          {gameOver ? `${winnerLabel(winner)}${winReason ? ` · ${winReason}` : ""}` : tip}
        </p>
      </div>

      <div className="explosive-board glass">
        <canvas
          ref={canvasRef}
          onClick={(e) => handlePointer(e.clientX, e.clientY)}
          onMouseMove={(e) => {
            const renderer = rendererRef.current;
            const game = gameRef.current;
            if (!renderer || !game || game.gameOver) {
              renderer?.clearHover();
              return;
            }
            const cell = renderer.pixelToCell(e.clientX, e.clientY);
            if (cell) renderer.setHoverCell(cell.row, cell.col);
            else renderer.clearHover();
          }}
          onMouseLeave={() => rendererRef.current?.clearHover()}
          onTouchStart={(e) => {
            e.preventDefault();
            const touch = e.touches[0];
            if (touch) handlePointer(touch.clientX, touch.clientY);
          }}
        />
      </div>
    </div>
  );
}
