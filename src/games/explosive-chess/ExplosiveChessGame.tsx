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
/** App-level screen: setup has no board; playing shows only the board HUD. */
type Screen = "setup" | "playing";

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

function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
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
  const roomFromQuery = searchParams.get("room")?.trim().toLowerCase() || "";

  const [screen, setScreen] = useState<Screen>("setup");
  const [settings, setSettings] = useState<Settings>(() => {
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
  const [localSession, setLocalSession] = useState(0);

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
  const settingsRef = useRef(settings);
  const runAiMoveRef = useRef<() => Promise<void>>(async () => undefined);
  const clientRef = useRef<ExplosiveOnlineClient | null>(null);
  const myColorRef = useRef<PlayerColor | null>(null);
  const screenRef = useRef<Screen>(screen);
  const pendingOnlineStartRef = useRef<{
    config: RoomConfig;
    yourColor: HostColor;
  } | null>(null);
  const pendingOnlineStateRef = useRef<{
    fullState: FullState;
    lastMove?: { row: number; col: number };
    animationFrames?: AnimationFrame[];
  } | null>(null);
  settingsRef.current = settings;
  myColorRef.current = myColor;
  screenRef.current = screen;

  const syncHud = useCallback((game: GameInstance) => {
    setTurn(game.currentTurn);
    setStepCount(game.stepCount);
    setCounts(game.getCellCounts());
    setGameOver(game.gameOver);
    setWinner(game.winner);
    setWinReason(game.winReason);
  }, []);

  const updateTip = useCallback((game: GameInstance, mode: OpponentMode) => {
    if (game.gameOver) {
      setTip(`${winnerLabel(game.winner)}${game.winReason ? ` · ${game.winReason}` : ""}`);
      return;
    }
    if (mode === "ai") {
      setTip(game.currentTurn === playerColorRef.current ? "轮到你了，点击落子" : "AI 思考中…");
    } else if (mode === "online") {
      const mine = myColorRef.current;
      setTip(
        mine == null
          ? "联机对局中"
          : game.currentTurn === mine
            ? "轮到你了，点击落子"
            : "等待对手…",
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

  const destroyBoard = useCallback(() => {
    aiRef.current?.destroy();
    aiRef.current = null;
    rendererRef.current?.destroy();
    rendererRef.current = null;
    gameRef.current = null;
  }, []);

  const afterMove = useCallback(
    async (result: MoveResult) => {
      const game = gameRef.current;
      const renderer = rendererRef.current;
      const mode = settingsRef.current.opponent;
      if (!game || !renderer) return;

      const shouldAnimate = mode === "local" || mode === "online" || settingsRef.current.difficulty === "easy";

      if (shouldAnimate && result.animationFrames.length > 0) {
        setBusy(true);
        await playFrames(result.animationFrames, renderer);
      } else {
        renderer.setExplosionHighlight(null);
        renderer.render();
      }

      syncHud(game);
      updateTip(game, mode);

      if (result.gameOver) {
        setBusy(false);
        return;
      }

      if (mode === "ai" && game.currentTurn === aiColorRef.current) {
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

  // Mount local/AI board only on the playing screen.
  useEffect(() => {
    if (screen !== "playing") return;
    if (settings.opponent === "online") return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    destroyBoard();
    saveSettings(settings);

    const winParam = settings.winMode === WIN_MODE_ANNIHILATION ? undefined : settings.winParam;
    const game = createGame({
      boardSize: settings.boardSize,
      winMode: settings.winMode,
      winParam,
    });
    gameRef.current = game;

    if (settings.opponent === "ai") {
      const playerColor: PlayerColor = settings.redOwner === "player" ? COLOR_RED : COLOR_BLUE;
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
    updateTip(game, settings.opponent);
    setBusy(false);
    animatingRef.current = false;
    setGameOver(false);
    setWinner(null);
    setWinReason("");

    const onResize = () => renderer.resize();
    window.addEventListener("resize", onResize);
    const themeObserver = new MutationObserver(() => renderer.resize());
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
  }, [screen, settings, localSession, syncHud, updateTip, destroyBoard]);

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
      updateTip(game, "online");
      setBusy(false);
    },
    [playFrames, syncHud, updateTip],
  );

  const mountOnlineBoard = useCallback(
    (config: RoomConfig, yourColor: HostColor) => {
      const canvas = canvasRef.current;
      const color = seatToPlayerColor(yourColor);
      setMyColor(color);
      myColorRef.current = color;
      if (color != null) playerColorRef.current = color;

      const winParam = config.winMode === WIN_MODE_ANNIHILATION ? undefined : config.winParam;
      const game = createGame({
        boardSize: config.boardSize,
        winMode: config.winMode,
        winParam,
      });

      aiRef.current?.destroy();
      aiRef.current = null;
      rendererRef.current?.destroy();

      gameRef.current = game;
      if (canvas) {
        const renderer = createBoardRenderer(canvas, game);
        rendererRef.current = renderer;
        renderer.resize();
      }
      syncHud(game);
      updateTip(game, "online");
      setBusy(false);
      setGameOver(false);
      setWinner(null);
      setWinReason("");
    },
    [syncHud, updateTip],
  );

  // Mount online board after navigating to playing (canvas must exist).
  useEffect(() => {
    if (screen !== "playing") return;
    if (settings.opponent !== "online") return;
    const pending = pendingOnlineStartRef.current;
    if (!pending) {
      queueMicrotask(() => rendererRef.current?.resize());
      return;
    }
    pendingOnlineStartRef.current = null;
    mountOnlineBoard(pending.config, pending.yourColor);
    const buffered = pendingOnlineStateRef.current;
    pendingOnlineStateRef.current = null;
    if (buffered) {
      void applyServerState(buffered.fullState, buffered.lastMove, buffered.animationFrames);
    }
    queueMicrotask(() => rendererRef.current?.resize());
  }, [screen, settings.opponent, mountOnlineBoard, applyServerState]);

  const disconnectOnline = useCallback(() => {
    clientRef.current?.close();
    clientRef.current = null;
    setOnlinePhase("idle");
    setOnlineStatus("");
    setOnlinePlayers([]);
    setOnlineConfig(null);
    setMyColor(null);
    myColorRef.current = null;
    setShareLink("");
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
      setScreen("setup");
      setSearchParams({ room: trimmed }, { replace: true });
      saveSettings({ ...settingsRef.current, opponent: "online" });
      setSettings((s) => ({ ...s, opponent: "online" }));

      const client = new ExplosiveOnlineClient();
      clientRef.current = client;

      client.connect(trimmed, {
        onOpen: () => {
          client.join({ playerId: getOrCreatePlayerId(), name: "Player" });
          setOnlineStatus("已连接，加入房间…");
        },
        onWelcome: (payload) => {
          setOnlineSeat(payload.seat);
          setOnlineRole(payload.role);
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
          // Stay on setup while lobby; only game_start flips to playing.
          if (payload.phase === "lobby") {
            setScreen("setup");
            setTip("大厅：双方准备后开始。红方永远先手。");
          }
        },
        onGameStart: (payload) => {
          setOnlinePhase("playing");
          setOnlineStatus("对局开始");
          pendingOnlineStartRef.current = {
            config: payload.config,
            yourColor: payload.yourColor,
          };
          setScreen("playing");
        },
        onState: (payload) => {
          if (screenRef.current !== "playing") {
            setScreen("playing");
          }
          if (!gameRef.current) {
            pendingOnlineStateRef.current = {
              fullState: payload.fullState,
              lastMove: payload.lastMove,
              animationFrames: payload.animationFrames,
            };
          } else {
            void applyServerState(payload.fullState, payload.lastMove, payload.animationFrames);
          }
          if (payload.fullState.gameOver) setOnlinePhase("over");
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
        onError: (payload) => setOnlineStatus(`错误：${payload.message}`),
        onPeerLeft: () => {
          setOnlineStatus("对手已断开（可等待重连）");
          setTip("对手已离开房间");
        },
        onClose: () => {
          setOnlinePhase("idle");
          setOnlineStatus("连接关闭");
          if (screenRef.current === "playing" && settingsRef.current.opponent === "online") {
            setScreen("setup");
          }
        },
      });
    },
    [applyServerState, destroyBoard, setSearchParams],
  );

  // Prefill join from ?room= but stay on setup until user/ready flow.
  useEffect(() => {
    if (!roomFromQuery) return;
    setJoinInput(roomFromQuery);
    setRoomCode(roomFromQuery);
    setSettings((s) => ({ ...s, opponent: "online" }));
    setOnlineStatus(`已填入房间码 ${roomFromQuery}，点「进入房间」连接`);
  }, [roomFromQuery]);

  useEffect(() => {
    return () => {
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, []);

  const handlePointer = (clientX: number, clientY: number) => {
    const game = gameRef.current;
    const renderer = rendererRef.current;
    const mode = settingsRef.current.opponent;
    if (!game || !renderer || game.gameOver || busy || animatingRef.current) return;

    if (mode === "ai" && game.currentTurn === aiColorRef.current) return;

    if (mode === "online") {
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

  const startLocalGame = () => {
    saveSettings(settings);
    disconnectOnline();
    setSearchParams({}, { replace: true });
    setScreen("playing");
    setLocalSession((n) => n + 1);
  };

  const backToSetup = () => {
    destroyBoard();
    if (settings.opponent === "online") {
      // Keep socket if still in lobby waiting; leave board only.
      if (onlinePhase === "playing" || onlinePhase === "over") {
        disconnectOnline();
        setSearchParams({}, { replace: true });
        setRoomCode("");
      }
    }
    setScreen("setup");
    setBusy(false);
    setGameOver(false);
    setTip("点击格子落子");
  };

  const createRoom = () => {
    const code = generateRoomCode();
    setSettings((s) => ({ ...s, opponent: "online" }));
    connectToRoom(code);
  };

  const joinRoom = () => {
    setSettings((s) => ({ ...s, opponent: "online" }));
    connectToRoom(joinInput);
  };

  const pushHostConfig = (patch: Partial<RoomConfig>) => {
    if (onlineRole !== "host" || onlinePhase !== "lobby") return;
    // Keep local settings in sync for remounts.
    setSettings((s) => ({
      ...s,
      boardSize: (patch.boardSize as Settings["boardSize"]) ?? s.boardSize,
      winMode: patch.winMode ?? s.winMode,
      winParam: patch.winParam ?? s.winParam,
    }));
    if (patch.boardSize != null || patch.winMode != null || patch.winParam != null || patch.hostColor != null) {
      clientRef.current?.setConfig(patch);
    }
  };

  const showWinParam = settings.winMode === WIN_MODE_STEPS || settings.winMode === WIN_MODE_AREA;
  const connectedLobby = onlinePhase === "lobby" || onlinePhase === "connecting";
  const canReady =
    onlinePhase === "lobby" && (onlineSeat === "red" || onlineSeat === "blue");

  // ——— SETUP LOBBY (no board) ———
  if (screen === "setup") {
    return (
      <div className="explosive-chess explosive-setup">
        <div className="panel">
          <h2>对局设置</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            先选好模式与规则，再进入棋盘。联机需双方准备后才会开始。
          </p>
          <div className="explosive-controls">
            <label>
              模式
              <select
                value={settings.opponent}
                onChange={(e) => {
                  const opponent = e.target.value as OpponentMode;
                  if (opponent !== "online") {
                    disconnectOnline();
                    setSearchParams({}, { replace: true });
                  }
                  setSettings((s) => ({ ...s, opponent }));
                }}
              >
                <option value="ai">本地 vs AI</option>
                <option value="local">本地 vs 本地（热座）</option>
                <option value="online">联机（房间）</option>
              </select>
            </label>

            {settings.opponent !== "online" || onlineRole === "host" || onlinePhase === "idle" ? (
              <>
                <label>
                  棋盘
                  <select
                    value={
                      settings.opponent === "online" && onlineConfig
                        ? onlineConfig.boardSize
                        : settings.boardSize
                    }
                    disabled={settings.opponent === "online" && onlineRole !== "host" && connectedLobby}
                    onChange={(e) => {
                      const boardSize = Number(e.target.value) as 9 | 11 | 13;
                      setSettings((s) => ({ ...s, boardSize }));
                      if (settings.opponent === "online") pushHostConfig({ boardSize });
                    }}
                  >
                    <option value={9}>9×9</option>
                    <option value={11}>11×11</option>
                    <option value={13}>13×13</option>
                  </select>
                </label>
                <label>
                  胜利
                  <select
                    value={
                      settings.opponent === "online" && onlineConfig
                        ? onlineConfig.winMode
                        : settings.winMode
                    }
                    disabled={settings.opponent === "online" && onlineRole !== "host" && connectedLobby}
                    onChange={(e) => {
                      const winMode = e.target.value as WinMode;
                      setSettings((s) => ({ ...s, winMode }));
                      if (settings.opponent === "online") pushHostConfig({ winMode });
                    }}
                  >
                    <option value={WIN_MODE_ANNIHILATION}>鏖战（歼灭）</option>
                    <option value={WIN_MODE_STEPS}>步数制</option>
                    <option value={WIN_MODE_AREA}>面积制</option>
                  </select>
                </label>
                {showWinParam ||
                (onlineConfig && onlineConfig.winMode !== WIN_MODE_ANNIHILATION) ? (
                  <label>
                    {(onlineConfig?.winMode ?? settings.winMode) === WIN_MODE_STEPS
                      ? "步数"
                      : "目标格数"}
                    <input
                      type="number"
                      min={1}
                      value={onlineConfig?.winParam ?? settings.winParam}
                      disabled={settings.opponent === "online" && onlineRole !== "host" && connectedLobby}
                      onChange={(e) => {
                        const winParam = Math.max(1, Number(e.target.value) || 1);
                        setSettings((s) => ({ ...s, winParam }));
                        if (settings.opponent === "online") pushHostConfig({ winParam });
                      }}
                    />
                  </label>
                ) : null}
              </>
            ) : null}

            {settings.opponent === "ai" ? (
              <>
                <label>
                  AI 难度
                  <select
                    value={settings.difficulty}
                    onChange={(e) =>
                      setSettings((s) => ({
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
                    value={settings.redOwner}
                    onChange={(e) =>
                      setSettings((s) => ({
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

            {settings.opponent === "online" && onlineRole === "host" && onlinePhase === "lobby" ? (
              <label>
                我的颜色
                <select
                  value={onlineConfig?.hostColor ?? "red"}
                  onChange={(e) => pushHostConfig({ hostColor: e.target.value as HostColor })}
                >
                  <option value="red">红（先手）</option>
                  <option value="blue">蓝（后手）</option>
                </select>
              </label>
            ) : null}
          </div>

          {settings.opponent !== "online" ? (
            <div className="row">
              <button type="button" className="primary" onClick={startLocalGame}>
                开始游戏
              </button>
            </div>
          ) : null}
        </div>

        {settings.opponent === "online" ? (
          <div className="panel explosive-online-lobby">
            <h2>联机房间</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              {onlineStatus ||
                "创建房间并分享链接，或输入房间码加入。双方准备后进入棋盘。密码暂未启用。"}
            </p>
            <div className="explosive-controls">
              <label>
                房间码
                <input
                  type="text"
                  value={joinInput}
                  onChange={(e) => setJoinInput(e.target.value.toLowerCase())}
                  placeholder="例如 abc123"
                  disabled={onlinePhase === "lobby" || onlinePhase === "connecting"}
                />
              </label>
            </div>
            <div className="row">
              {onlinePhase === "idle" || onlinePhase === "connecting" ? (
                <>
                  <button
                    type="button"
                    className="primary"
                    onClick={createRoom}
                    disabled={onlinePhase === "connecting"}
                  >
                    创建房间
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={joinRoom}
                    disabled={onlinePhase === "connecting"}
                  >
                    进入房间
                  </button>
                </>
              ) : null}
              {connectedLobby ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    disconnectOnline();
                    setSearchParams({}, { replace: true });
                    setRoomCode("");
                    setOnlineStatus("已离开房间");
                  }}
                >
                  离开房间
                </button>
              ) : null}
            </div>

            {roomCode && connectedLobby ? (
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

            {onlineConfig && onlineRole !== "host" && connectedLobby ? (
              <p className="hint">
                配置：{onlineConfig.boardSize}×{onlineConfig.boardSize} · {onlineConfig.winMode}
                {onlineConfig.winMode !== WIN_MODE_ANNIHILATION
                  ? ` (${onlineConfig.winParam})`
                  : ""}{" "}
                · 房主 {onlineConfig.hostColor === "red" ? "红" : "蓝"}
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

            {canReady ? (
              <div className="row">
                <button
                  type="button"
                  className="primary"
                  onClick={() => clientRef.current?.ready()}
                >
                  准备（双方准备后进入棋盘）
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  // ——— PLAYING (board only + thin HUD) ———
  return (
    <div className="explosive-chess explosive-playing">
      <div className="panel explosive-status">
        <div className="row" style={{ marginTop: 0 }}>
          <button type="button" className="ghost" onClick={backToSetup}>
            ← 返回设置
          </button>
          <span>
            回合：<strong>{colorLabel(turn)}</strong>
          </span>
          <span>步数：{stepCount}</span>
          <span className="explosive-count red">红 {counts.red}</span>
          <span className="explosive-count blue">蓝 {counts.blue}</span>
          {settings.opponent === "online" && myColor != null ? (
            <span>你：{colorLabel(myColor)}</span>
          ) : null}
        </div>
        <p className="hint" style={{ marginTop: "0.5rem" }}>
          {gameOver ? `${winnerLabel(winner)}${winReason ? ` · ${winReason}` : ""}` : tip}
        </p>
        <div className="row">
          {settings.opponent !== "online" ? (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setLocalSession((n) => n + 1);
              }}
            >
              重开
            </button>
          ) : null}
          {settings.opponent === "online" && onlinePhase === "playing" ? (
            <button type="button" className="ghost" onClick={() => clientRef.current?.surrender()}>
              投降
            </button>
          ) : null}
          {settings.opponent === "online" && onlinePhase === "over" ? (
            <button
              type="button"
              className="primary"
              onClick={() => {
                clientRef.current?.rematch();
                setScreen("setup");
                destroyBoard();
              }}
            >
              再来一局
            </button>
          ) : null}
        </div>
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
