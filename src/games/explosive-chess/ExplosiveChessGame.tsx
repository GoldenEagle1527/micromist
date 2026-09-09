import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
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
  type FullState,
  type GameInstance,
  type MoveResult,
  type PlayerColor,
  type WinMode,
} from "./engine";
import {
  ExplosiveOnlineClient,
  generateRoomCode,
  getOrCreatePlayerId,
  shareUrl,
  type HostColor,
  type Phase,
  type Role,
  type RoomConfig,
  type RoomPlayer,
  type Seat,
} from "./online";

type OpponentMode = "ai" | "local" | "online";
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

function seatLabel(seat: Seat): string {
  if (seat === "red") return "红方";
  if (seat === "blue") return "蓝方";
  return "旁观";
}

function winnerLabel(winner: MoveResult["winner"]): string {
  if (winner === "draw") return "平局";
  if (winner === COLOR_RED) return "红方胜";
  if (winner === COLOR_BLUE) return "蓝方胜";
  return "";
}

function seatToPlayerColor(seat: HostColor | Seat): PlayerColor | null {
  if (seat === "red") return COLOR_RED;
  if (seat === "blue") return COLOR_BLUE;
  return null;
}

export function ExplosiveChessGame() {
  const [searchParams, setSearchParams] = useSearchParams();
  const roomFromQuery = searchParams.get("room")?.trim() || "";

  const [settingsDraft, setSettingsDraft] = useState<Settings>(() => {
    const base = loadSettings();
    if (roomFromQuery) return { ...base, opponent: "online" };
    return base;
  });
  const [activeSettings, setActiveSettings] = useState<Settings>(() => {
    const base = loadSettings();
    if (roomFromQuery) return { ...base, opponent: "online" };
    return base;
  });
  const [turn, setTurn] = useState<PlayerColor>(COLOR_RED);
  const [stepCount, setStepCount] = useState(0);
  const [counts, setCounts] = useState({ red: 0, blue: 0 });
  const [gameOver, setGameOver] = useState(false);
  const [winReason, setWinReason] = useState("");
  const [winner, setWinner] = useState<MoveResult["winner"]>(null);
  const [busy, setBusy] = useState(false);
  const [tip, setTip] = useState("点击格子落子");
  const [session, setSession] = useState(0);

  // Online lobby / connection
  const [roomCode, setRoomCode] = useState(roomFromQuery);
  const [joinInput, setJoinInput] = useState(roomFromQuery);
  const [onlinePhase, setOnlinePhase] = useState<Phase | "idle" | "connecting">("idle");
  const [onlineSeat, setOnlineSeat] = useState<Seat>("spectator");
  const [onlineRole, setOnlineRole] = useState<Role>("spectator");
  const [onlinePlayers, setOnlinePlayers] = useState<RoomPlayer[]>([]);
  const [onlineConfig, setOnlineConfig] = useState<RoomConfig | null>(null);
  const [onlineStatus, setOnlineStatus] = useState("");
  const [myColor, setMyColor] = useState<PlayerColor | null>(null);
  const [shareLink, setShareLink] = useState("");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<GameInstance | null>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const aiRef = useRef<AiInstance | null>(null);
  const animatingRef = useRef(false);
  const playerColorRef = useRef<PlayerColor>(COLOR_RED);
  const aiColorRef = useRef<PlayerColor>(COLOR_BLUE);
  const settingsRef = useRef(activeSettings);
  const runAiMoveRef = useRef<() => Promise<void>>(async () => undefined);
  const clientRef = useRef<ExplosiveOnlineClient | null>(null);
  const onlineSeatRef = useRef<Seat>("spectator");
  const myColorRef = useRef<PlayerColor | null>(null);
  settingsRef.current = activeSettings;
  onlineSeatRef.current = onlineSeat;
  myColorRef.current = myColor;

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
    } else if (settings.opponent === "online") {
      const mine = myColorRef.current;
      if (mine == null) {
        setTip("联机对局中");
      } else {
        setTip(game.currentTurn === mine ? "轮到你了，点击落子" : "等待对手…");
      }
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

  const destroyBoard = useCallback(() => {
    aiRef.current?.destroy();
    aiRef.current = null;
    rendererRef.current?.destroy();
    rendererRef.current = null;
    gameRef.current = null;
  }, []);

  const mountBoard = useCallback(
    (game: GameInstance) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      rendererRef.current?.destroy();
      const renderer = createBoardRenderer(canvas, game);
      rendererRef.current = renderer;
      renderer.resize();
      gameRef.current = game;
      syncHud(game);
    },
    [syncHud],
  );

  const afterMove = useCallback(
    async (result: MoveResult) => {
      const game = gameRef.current;
      const renderer = rendererRef.current;
      const settings = settingsRef.current;
      if (!game || !renderer) return;

      const shouldAnimate =
        settings.opponent === "local" ||
        settings.opponent === "online" ||
        settings.difficulty === "easy";

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

  // Local / AI game bootstrap
  useEffect(() => {
    if (activeSettings.opponent === "online") {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    destroyBoard();

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
  }, [activeSettings, session, syncHud, updateTip, destroyBoard]);

  const applyServerState = useCallback(
    async (
      fullState: FullState,
      lastMove?: { row: number; col: number },
      animationFrames?: AnimationFrame[],
    ) => {
      const game = gameRef.current;
      const renderer = rendererRef.current;
      if (!game || !renderer) return;

      game.loadFullState(fullState);
      if (lastMove) renderer.setLastMove(lastMove.row, lastMove.col);
      renderer.render();

      if (animationFrames && animationFrames.length > 0) {
        setBusy(true);
        await playFrames(animationFrames, renderer);
      }

      syncHud(game);
      updateTip(game, settingsRef.current);
      setBusy(false);
    },
    [playFrames, syncHud, updateTip],
  );

  const disconnectOnline = useCallback(() => {
    clientRef.current?.close();
    clientRef.current = null;
    setOnlinePhase("idle");
    setOnlineStatus("已断开");
    setMyColor(null);
    myColorRef.current = null;
  }, []);

  const connectToRoom = useCallback(
    (code: string) => {
      const trimmed = code.trim().toLowerCase();
      if (!trimmed) {
        setOnlineStatus("请输入房间码");
        return;
      }

      clientRef.current?.close();
      destroyBoard();
      setRoomCode(trimmed);
      setJoinInput(trimmed);
      setShareLink(shareUrl(trimmed));
      setOnlinePhase("connecting");
      setOnlineStatus("连接中…");
      setOnlinePlayers([]);
      setGameOver(false);
      setWinner(null);
      setWinReason("");
      setSearchParams({ room: trimmed }, { replace: true });

      const client = new ExplosiveOnlineClient();
      clientRef.current = client;

      client.connect(trimmed, {
        onOpen: () => {
          const playerId = getOrCreatePlayerId();
          client.join({ playerId, name: "Player" });
          setOnlineStatus("已连接，加入房间…");
        },
        onWelcome: (payload) => {
          setOnlineSeat(payload.seat);
          setOnlineRole(payload.role);
          onlineSeatRef.current = payload.seat;
          const color = seatToPlayerColor(payload.seat);
          if (color != null) {
            setMyColor(color);
            myColorRef.current = color;
            playerColorRef.current = color;
          }
          setOnlineStatus(`座位：${seatLabel(payload.seat)}（${payload.role}）`);
          if (payload.role === "host") {
            const s = settingsRef.current;
            client.setConfig({
              boardSize: s.boardSize,
              winMode: s.winMode,
              winParam: s.winParam,
              hostColor: "red",
            });
          }
        },
        onRoom: (payload) => {
          setOnlinePlayers(payload.players);
          setOnlineConfig(payload.config);
          setOnlinePhase(payload.phase);
          if (payload.phase === "lobby") {
            setTip("大厅：双方准备后开始。红方永远先手。");
          }
        },
        onGameStart: (payload) => {
          const color = seatToPlayerColor(payload.yourColor);
          setMyColor(color);
          myColorRef.current = color;
          if (color != null) playerColorRef.current = color;
          setOnlinePhase("playing");
          setOnlineStatus("对局开始");
          setGameOver(false);
          setWinner(null);
          setWinReason("");

          const winParam =
            payload.config.winMode === WIN_MODE_ANNIHILATION
              ? undefined
              : payload.config.winParam;
          const game = createGame({
            boardSize: payload.config.boardSize,
            winMode: payload.config.winMode,
            winParam,
          });
          mountBoard(game);
          updateTip(game, settingsRef.current);
        },
        onState: (payload) => {
          void applyServerState(
            payload.fullState,
            payload.lastMove,
            payload.animationFrames,
          );
          if (payload.fullState.gameOver) {
            setOnlinePhase("over");
          }
        },
        onGameOver: (payload) => {
          setOnlinePhase("over");
          setGameOver(true);
          setWinner(payload.winner as MoveResult["winner"]);
          setWinReason(payload.winReason);
          setTip(
            `${winnerLabel(payload.winner as MoveResult["winner"])}${
              payload.winReason ? ` · ${payload.winReason}` : ""
            }`,
          );
          setBusy(false);
        },
        onError: (payload) => {
          setOnlineStatus(`错误：${payload.message}`);
        },
        onPeerLeft: () => {
          setOnlineStatus("对手已断开（可等待重连）");
          setTip("对手已离开房间");
        },
        onClose: () => {
          setOnlinePhase("idle");
          setOnlineStatus("连接关闭");
        },
      });
    },
    [applyServerState, destroyBoard, mountBoard, setSearchParams, updateTip],
  );

  useEffect(() => {
    if (onlinePhase === "playing" || onlinePhase === "over") {
      queueMicrotask(() => rendererRef.current?.resize());
    }
  }, [onlinePhase]);

  // Auto-join from ?room=
  useEffect(() => {
    if (activeSettings.opponent !== "online") return;
    if (!roomFromQuery) return;
    if (clientRef.current) return;
    connectToRoom(roomFromQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- join once on mount / mode switch
  }, [activeSettings.opponent, roomFromQuery]);

  // Cleanup online client on unmount / leave online mode
  useEffect(() => {
    return () => {
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (activeSettings.opponent !== "online") {
      disconnectOnline();
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSettings.opponent]);

  const handlePointer = (clientX: number, clientY: number) => {
    const game = gameRef.current;
    const renderer = rendererRef.current;
    const settings = settingsRef.current;
    if (!game || !renderer || game.gameOver || busy || animatingRef.current) return;

    if (settings.opponent === "ai" && game.currentTurn === aiColorRef.current) {
      return;
    }

    if (settings.opponent === "online") {
      const mine = myColorRef.current;
      if (mine == null || game.currentTurn !== mine) return;
      const cell = renderer.pixelToCell(clientX, clientY);
      if (!cell) return;
      if (!game.isValidMove(cell.row, cell.col, mine)) return;
      setBusy(true);
      clientRef.current?.move(cell.row, cell.col);
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
    const next = { ...settingsDraft };
    setActiveSettings(next);
    setSession((n) => n + 1);
    if (next.opponent === "online" && !clientRef.current && !roomFromQuery) {
      setOnlinePhase("idle");
      setOnlineStatus("创建或加入房间开始联机");
    }
  };

  const createRoom = () => {
    const code = generateRoomCode();
    setSettingsDraft((s) => ({ ...s, opponent: "online" }));
    setActiveSettings((s) => ({ ...s, opponent: "online" }));
    connectToRoom(code);
  };

  const joinRoom = () => {
    setSettingsDraft((s) => ({ ...s, opponent: "online" }));
    setActiveSettings((s) => ({ ...s, opponent: "online" }));
    connectToRoom(joinInput);
  };

  const pushHostConfig = (patch: Partial<RoomConfig>) => {
    if (onlineRole !== "host" || onlinePhase !== "lobby") return;
    clientRef.current?.setConfig(patch);
  };

  const showWinParam =
    settingsDraft.winMode === WIN_MODE_STEPS || settingsDraft.winMode === WIN_MODE_AREA;

  const isOnline = activeSettings.opponent === "online";
  const inOnlineLobby = isOnline && (onlinePhase === "lobby" || onlinePhase === "connecting");
  const showBoard = !isOnline || onlinePhase === "playing" || onlinePhase === "over";

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
              <option value="online">联机（房间）</option>
            </select>
          </label>
          {settingsDraft.opponent !== "online" ? (
            <>
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
            </>
          ) : null}
        </div>
        {settingsDraft.opponent !== "online" ? (
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
        ) : (
          <div className="row">
            <button
              type="button"
              className="primary"
              onClick={() => {
                setActiveSettings({ ...settingsDraft });
              }}
            >
              进入联机
            </button>
          </div>
        )}
      </div>

      {isOnline ? (
        <div className="panel explosive-online-lobby">
          <h2>联机大厅</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {onlineStatus || "创建房间后分享链接；或输入房间码加入。密码暂未启用。"}
          </p>
          <div className="row explosive-controls">
            <label>
              房间码
              <input
                type="text"
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value.toLowerCase())}
                placeholder="例如 abc123"
                disabled={onlinePhase === "playing"}
              />
            </label>
          </div>
          <div className="row">
            <button
              type="button"
              className="primary"
              onClick={createRoom}
              disabled={onlinePhase === "playing"}
            >
              创建房间
            </button>
            <button
              type="button"
              className="ghost"
              onClick={joinRoom}
              disabled={onlinePhase === "playing"}
            >
              加入房间
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                disconnectOnline();
                destroyBoard();
                setSearchParams({}, { replace: true });
              }}
            >
              断开
            </button>
          </div>
          {roomCode ? (
            <p className="hint explosive-share">
              房间 <code>{roomCode}</code>
              {shareLink ? (
                <>
                  {" · "}
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => {
                      void navigator.clipboard?.writeText(shareLink);
                      setOnlineStatus("分享链接已复制");
                    }}
                  >
                    复制分享链接
                  </button>
                </>
              ) : null}
            </p>
          ) : null}

          {onlineConfig && inOnlineLobby && onlineRole === "host" ? (
            <div className="row explosive-controls" style={{ marginTop: "0.75rem" }}>
              <label>
                棋盘
                <select
                  value={onlineConfig.boardSize}
                  onChange={(e) =>
                    pushHostConfig({ boardSize: Number(e.target.value) })
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
                  value={onlineConfig.winMode}
                  onChange={(e) =>
                    pushHostConfig({ winMode: e.target.value as WinMode })
                  }
                >
                  <option value={WIN_MODE_ANNIHILATION}>鏖战（歼灭）</option>
                  <option value={WIN_MODE_STEPS}>步数制</option>
                  <option value={WIN_MODE_AREA}>面积制</option>
                </select>
              </label>
              {onlineConfig.winMode !== WIN_MODE_ANNIHILATION ? (
                <label>
                  {onlineConfig.winMode === WIN_MODE_STEPS ? "步数" : "目标格数"}
                  <input
                    type="number"
                    min={1}
                    value={onlineConfig.winParam}
                    onChange={(e) =>
                      pushHostConfig({
                        winParam: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                  />
                </label>
              ) : null}
              <label>
                我的颜色
                <select
                  value={onlineConfig.hostColor}
                  onChange={(e) =>
                    pushHostConfig({ hostColor: e.target.value as HostColor })
                  }
                >
                  <option value="red">红（先手）</option>
                  <option value="blue">蓝（后手）</option>
                </select>
              </label>
            </div>
          ) : null}

          {onlineConfig && inOnlineLobby && onlineRole !== "host" ? (
            <p className="hint">
              配置：{onlineConfig.boardSize}×{onlineConfig.boardSize} · {onlineConfig.winMode}
              {onlineConfig.winMode !== WIN_MODE_ANNIHILATION
                ? ` (${onlineConfig.winParam})`
                : ""}{" "}
              · 房主颜色 {onlineConfig.hostColor === "red" ? "红" : "蓝"}
            </p>
          ) : null}

          {onlinePlayers.length > 0 ? (
            <ul className="explosive-player-list">
              {onlinePlayers.map((p) => (
                <li key={p.playerId}>
                  {p.name} · {seatLabel(p.seat)} · {p.role}
                  {p.ready ? " · 已准备" : ""}
                  {p.rematch ? " · 再来一局" : ""}
                  {!p.connected ? " · 离线" : ""}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="row">
            {onlinePhase === "lobby" && (onlineSeat === "red" || onlineSeat === "blue") ? (
              <button
                type="button"
                className="primary"
                onClick={() => clientRef.current?.ready()}
              >
                准备
              </button>
            ) : null}
            {onlinePhase === "playing" && (onlineSeat === "red" || onlineSeat === "blue") ? (
              <button
                type="button"
                className="ghost"
                onClick={() => clientRef.current?.surrender()}
              >
                投降
              </button>
            ) : null}
            {onlinePhase === "over" && (onlineSeat === "red" || onlineSeat === "blue") ? (
              <button
                type="button"
                className="primary"
                onClick={() => clientRef.current?.rematch()}
              >
                再来一局
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="panel explosive-status">
        <div className="row" style={{ marginTop: 0 }}>
          <span>
            回合：<strong>{colorLabel(turn)}</strong>
          </span>
          <span>步数：{stepCount}</span>
          <span className="explosive-count red">红 {counts.red}</span>
          <span className="explosive-count blue">蓝 {counts.blue}</span>
          {isOnline && myColor != null ? (
            <span>你：{colorLabel(myColor)}</span>
          ) : null}
        </div>
        <p className="hint" style={{ marginTop: "0.5rem" }}>
          {gameOver ? `${winnerLabel(winner)}${winReason ? ` · ${winReason}` : ""}` : tip}
        </p>
      </div>

      {!showBoard ? (
        <div className="panel hint">等待双方准备后显示棋盘…</div>
      ) : null}
      <div
        className="explosive-board glass"
        style={showBoard ? undefined : { position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}
        aria-hidden={!showBoard}
      >
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
            if (
              settingsRef.current.opponent === "online" &&
              myColorRef.current != null &&
              game.currentTurn !== myColorRef.current
            ) {
              renderer.clearHover();
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
