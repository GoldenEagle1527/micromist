import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useLocale } from "../../i18n";
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
  /** Online: host seat color chosen before creating the room. */
  hostColor: HostColor;
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
  hostColor: "red",
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    if (merged.hostColor !== "red" && merged.hostColor !== "blue") merged.hostColor = "red";
    return merged;
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

type ExplosiveDict = Record<string, string>;

function colorLabel(color: PlayerColor, ex: ExplosiveDict): string {
  return color === COLOR_RED ? ex.seatRed : ex.seatBlue;
}

function seatLabel(seat: Seat, ex: ExplosiveDict): string {
  if (seat === "red") return ex.seatRed;
  if (seat === "blue") return ex.seatBlue;
  return ex.seatSpectator;
}

function winnerLabel(winner: MoveResult["winner"], ex: ExplosiveDict): string {
  if (winner === "draw") return ex.winnerDraw;
  if (winner === COLOR_RED) return ex.winnerRed;
  if (winner === COLOR_BLUE) return ex.winnerBlue;
  return "";
}

function winModeLabel(mode: WinMode, ex: ExplosiveDict): string {
  if (mode === WIN_MODE_ANNIHILATION) return ex.annihilation;
  if (mode === WIN_MODE_STEPS) return ex.steps;
  return ex.area;
}

function youAreLabel(seat: Seat, ex: ExplosiveDict): string {
  if (seat === "red") return ex.youAreRed;
  if (seat === "blue") return ex.youAreBlue;
  return ex.youAreSpectator;
}

function seatToPlayerColor(seat: HostColor | Seat): PlayerColor | null {
  if (seat === "red") return COLOR_RED;
  if (seat === "blue") return COLOR_BLUE;
  return null;
}

function formatWinReason(reason: string, ex: Record<string, string>): string {
  if (!reason) return "";
  if (reason === "歼灭对手所有棋子" || reason === "annihilation") return ex.reasonAnnihilation;
  if (reason === "对手投降" || reason === "surrender") return ex.reasonSurrender;
  if (reason.startsWith("双方玩家均已离开") || reason === "room_recycled") {
    return ex.roomRecycled || reason;
  }
  const area = /^率先占据 (\d+) 格$/.exec(reason);
  if (area) return ex.reasonArea.replace("{n}", area[1]!);
  const stepsMore = /^(\d+) 步后占据更多面积 \((\d+) vs (\d+)\)$/.exec(reason);
  if (stepsMore) {
    return ex.reasonStepsMore
      .replace("{n}", stepsMore[1]!)
      .replace("{a}", stepsMore[2]!)
      .replace("{b}", stepsMore[3]!);
  }
  const stepsDraw = /^(\d+) 步后双方面积相同 \((\d+)\)$/.exec(reason);
  if (stepsDraw) {
    return ex.reasonStepsDraw.replace("{n}", stepsDraw[1]!).replace("{a}", stepsDraw[2]!);
  }
  return reason;
}

export function ExplosiveChessGame() {
  const { t } = useLocale();
  const ex = t.explosive;
  const tRef = useRef(t);
  tRef.current = t;

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
  const [, setBusy] = useState(false);
  const [tip, setTip] = useState(ex.tipClick);
  const [localSession, setLocalSession] = useState(0);

  const [roomCode, setRoomCode] = useState(roomFromQuery);
  const [onlinePhase, setOnlinePhase] = useState<Phase | "idle" | "connecting" | "reconnecting">("idle");
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
  const busyRef = useRef(false);
  const moveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionalLeaveRef = useRef(false);
  const onlinePhaseRef = useRef<Phase | "idle" | "connecting" | "reconnecting">("idle");
  const roomCodeRef = useRef(roomCode);
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
  onlinePhaseRef.current = onlinePhase;
  roomCodeRef.current = roomCode;

  const syncHud = useCallback((game: GameInstance) => {
    setTurn(game.currentTurn);
    setStepCount(game.stepCount);
    setCounts(game.getCellCounts());
    setGameOver(game.gameOver);
    setWinner(game.winner);
    setWinReason(game.winReason);
  }, []);

  const updateTip = useCallback((game: GameInstance, mode: OpponentMode) => {
    const dict = tRef.current.explosive;
    if (game.gameOver) {
      setTip(`${winnerLabel(game.winner, dict)}${game.winReason ? ` · ${game.winReason}` : ""}`);
      return;
    }
    if (mode === "ai") {
      setTip(game.currentTurn === playerColorRef.current ? dict.tipYourTurn : dict.tipAiTurn);
    } else if (mode === "online") {
      const mine = myColorRef.current;
      setTip(
        mine == null
          ? dict.tipOnline
          : game.currentTurn === mine
            ? dict.tipYourTurn
            : dict.tipOppTurn,
      );
    } else {
      setTip(game.currentTurn === COLOR_RED ? dict.redToMove : dict.blueToMove);
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
    setTip(tRef.current.explosive.tipAiTurn);
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

  const clearMoveLock = useCallback(() => {
    if (moveTimeoutRef.current) {
      clearTimeout(moveTimeoutRef.current);
      moveTimeoutRef.current = null;
    }
    busyRef.current = false;
    setBusy(false);
  }, []);

  const armMoveLock = useCallback(() => {
    busyRef.current = true;
    setBusy(true);
    if (moveTimeoutRef.current) clearTimeout(moveTimeoutRef.current);
    moveTimeoutRef.current = setTimeout(() => {
      busyRef.current = false;
      setBusy(false);
      const dict = tRef.current.explosive;
      setOnlineStatus(dict.moveTimeout);
      setTip(dict.moveTimeoutTip);
      moveTimeoutRef.current = null;
    }, 6000);
  }, []);

  const applyServerState = useCallback(
    async (
      fullState: FullState,
      lastMove?: { row: number; col: number },
      animationFrames?: AnimationFrame[],
    ) => {
      const game = gameRef.current;
      const renderer = rendererRef.current;
      if (!game || !renderer) {
        clearMoveLock();
        return;
      }

      game.loadFullState(fullState);
      if (lastMove) renderer.setLastMove(lastMove.row, lastMove.col);
      renderer.render();

      if (animationFrames && animationFrames.length > 0) {
        busyRef.current = true;
        setBusy(true);
        await playFrames(animationFrames, renderer);
      }

      syncHud(game);
      updateTip(game, "online");
      clearMoveLock();
    },
    [playFrames, syncHud, updateTip, clearMoveLock],
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
      busyRef.current = false;
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
    intentionalLeaveRef.current = true;
    reconnectAttemptsRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    clearMoveLock();
    clientRef.current?.close();
    clientRef.current = null;
    setOnlinePhase("idle");
    setOnlineStatus("");
    setOnlinePlayers([]);
    setOnlineConfig(null);
    setMyColor(null);
    myColorRef.current = null;
    setShareLink("");
  }, [clearMoveLock]);

  const scheduleReconnect = useCallback(() => {
    const code = roomCodeRef.current.trim().toLowerCase();
    if (!code || intentionalLeaveRef.current) return;
    if (reconnectAttemptsRef.current >= 8) {
      const dict = tRef.current.explosive;
      setOnlinePhase("idle");
      setOnlineStatus(dict.reconnectFail);
      setTip(dict.disconnected);
      clearMoveLock();
      return;
    }
    const attempt = reconnectAttemptsRef.current + 1;
    reconnectAttemptsRef.current = attempt;
    const dict = tRef.current.explosive;
    setOnlinePhase("reconnecting");
    setOnlineStatus(`${dict.connInterrupted} (${attempt}/8)`);
    setTip(dict.connInterrupted);
    clearMoveLock();
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    const delay = Math.min(1000 * attempt, 5000);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      const client = clientRef.current;
      if (!client || intentionalLeaveRef.current) return;
      if (!client.reconnect()) {
        // recreate client if needed
        connectToRoomRef.current(code, { keepPlaying: true });
        return;
      }
      setOnlineStatus(`${tRef.current.explosive.reconnecting} (${attempt}/8)`);
    }, delay);
  }, [clearMoveLock]);

  const connectToRoomRef = useRef<(code: string, opts?: { keepPlaying?: boolean }) => void>(() => undefined);

  const connectToRoom = useCallback(
    (code: string, opts?: { keepPlaying?: boolean }) => {
      const trimmed = code.trim().toLowerCase();
      if (!trimmed) {
        setOnlineStatus(tRef.current.explosive.missingCode);
        return;
      }

      intentionalLeaveRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (!opts?.keepPlaying) {
        reconnectAttemptsRef.current = 0;
        clientRef.current?.close();
        destroyBoard();
        setScreen("setup");
        setGameOver(false);
        setWinner(null);
        setWinReason("");
        setOnlinePlayers([]);
      }

      setRoomCode(trimmed);
      setShareLink(shareUrl(trimmed));
      setOnlinePhase(opts?.keepPlaying ? "reconnecting" : "connecting");
      setOnlineStatus(opts?.keepPlaying ? tRef.current.explosive.reconnectingStatus : tRef.current.explosive.connecting);
      setSearchParams({ room: trimmed }, { replace: true });
      saveSettings({ ...settingsRef.current, opponent: "online" });
      setSettings((s) => ({ ...s, opponent: "online" }));
      clearMoveLock();

      const client = clientRef.current ?? new ExplosiveOnlineClient();
      clientRef.current = client;

      const bindHandlers = (): void => {
        client.connect(trimmed, {
          onOpen: () => {
            client.join({ playerId: getOrCreatePlayerId(), name: "Player" });
            setOnlineStatus(opts?.keepPlaying || screenRef.current === "playing" ? tRef.current.explosive.reconnected : tRef.current.explosive.connectedJoin);
          },
          onWelcome: (payload) => {
            reconnectAttemptsRef.current = 0;
            setOnlineSeat(payload.seat);
            setOnlineRole(payload.role);
            const color = seatToPlayerColor(payload.seat);
            if (color != null) {
              setMyColor(color);
              myColorRef.current = color;
              playerColorRef.current = color;
            }
            setOnlineStatus(`${tRef.current.explosive.seatInfo}${seatLabel(payload.seat, tRef.current.explosive)} (${payload.role})`);
            if (payload.role === "host" && onlinePhaseRef.current !== "playing" && screenRef.current !== "playing") {
              const s = settingsRef.current;
              client.setConfig({
                boardSize: s.boardSize,
                winMode: s.winMode,
                winParam: s.winParam,
                hostColor: s.hostColor,
              });
            }
          },
          onRoom: (payload) => {
            setOnlinePlayers(payload.players);
            setOnlineConfig(payload.config);
            if (payload.phase === "lobby") {
              setOnlinePhase("lobby");
              if (screenRef.current !== "playing") {
                setScreen("setup");
                setTip(tRef.current.explosive.tipWaitJoin);
              }
            } else if (payload.phase === "playing") {
              setOnlinePhase("playing");
              const peerOffline = payload.players.some(
                (p) => (p.seat === "red" || p.seat === "blue") && !p.connected && p.playerId !== getOrCreatePlayerId(),
              );
              if (peerOffline) {
                setOnlineStatus(tRef.current.explosive.peerOffline);
                setTip(tRef.current.explosive.peerWait);
              } else {
                setOnlineStatus(tRef.current.explosive.inProgress);
              }
            } else if (payload.phase === "over") {
              setOnlinePhase("over");
            }
          },
          onGameStart: (payload) => {
            reconnectAttemptsRef.current = 0;
            setOnlinePhase("playing");
            setOnlineStatus(tRef.current.explosive.gameStart);
            pendingOnlineStartRef.current = {
              config: payload.config,
              yourColor: payload.yourColor,
            };
            setScreen("playing");
            clearMoveLock();
          },
          onState: (payload) => {
            reconnectAttemptsRef.current = 0;
            if (screenRef.current !== "playing") {
              setScreen("playing");
            }
            if (onlinePhaseRef.current === "reconnecting" || onlinePhaseRef.current === "connecting") {
              setOnlinePhase(payload.fullState.gameOver ? "over" : "playing");
            }
            if (!gameRef.current) {
              pendingOnlineStateRef.current = {
                fullState: payload.fullState,
                lastMove: payload.lastMove,
                animationFrames: payload.animationFrames,
              };
              clearMoveLock();
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
            {
              const dict = tRef.current.explosive;
              setTip(
                `${winnerLabel(payload.winner as MoveResult["winner"], dict)}${
                  payload.winReason ? ` · ${formatWinReason(payload.winReason, tRef.current.explosive)}` : ""
                }`,
              );
            }
            clearMoveLock();
          },
          onError: (payload) => {
            setOnlineStatus(`${tRef.current.explosive.errorPrefix}${payload.message}`);
            clearMoveLock();
          },
          onPeerLeft: () => {
            setOnlineStatus(tRef.current.explosive.peerWait);
            setTip(tRef.current.explosive.peerTip);
            clearMoveLock();
          },
          onRoomClosed: (payload) => {
            intentionalLeaveRef.current = true;
            reconnectAttemptsRef.current = 0;
            if (reconnectTimerRef.current) {
              clearTimeout(reconnectTimerRef.current);
              reconnectTimerRef.current = null;
            }
            clearMoveLock();
            clientRef.current?.close();
            clientRef.current = null;
            setOnlinePhase("idle");
            setOnlinePlayers([]);
            setOnlineConfig(null);
            setMyColor(null);
            myColorRef.current = null;
            setShareLink("");
            setRoomCode("");
            setSearchParams({}, { replace: true });
            setOnlineStatus(payload.reason || tRef.current.explosive.roomRecycled);
            setTip(tRef.current.explosive.roomClosedTip);
            destroyBoard();
            setScreen("setup");
            setGameOver(false);
          },
          onClose: () => {
            if (intentionalLeaveRef.current) {
              setOnlinePhase("idle");
              setOnlineStatus(tRef.current.explosive.leftRoom);
              clearMoveLock();
              return;
            }
            // Mid-game / mid-lobby drop → auto reconnect, keep board if playing.
            if (
              screenRef.current === "playing" ||
              onlinePhaseRef.current === "playing" ||
              onlinePhaseRef.current === "over" ||
              onlinePhaseRef.current === "lobby" ||
              onlinePhaseRef.current === "reconnecting"
            ) {
              scheduleReconnect();
              return;
            }
            setOnlinePhase("idle");
            setOnlineStatus(tRef.current.explosive.connClosed);
            clearMoveLock();
          },
        });
      };

      // Fresh connect always rebinds handlers via connect().
      // For keepPlaying, reconnect() uses existing handlers — ensure first bind.
      if (opts?.keepPlaying && client.currentRoomId === trimmed && client.isOpen) {
        return;
      }
      bindHandlers();
    },
    [applyServerState, clearMoveLock, destroyBoard, scheduleReconnect, setSearchParams],
  );

  connectToRoomRef.current = connectToRoom;

  // Landing with ?room= selects online mode; user still confirms join (code not editable).
  useEffect(() => {
    if (!roomFromQuery) return;
    setRoomCode(roomFromQuery);
    setSettings((s) => ({ ...s, opponent: "online" }));
    setOnlineStatus(t.explosive.openShare);
  }, [roomFromQuery]);

  useEffect(() => {
    return () => {
      intentionalLeaveRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (moveTimeoutRef.current) clearTimeout(moveTimeoutRef.current);
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, []);

  const handlePointer = (clientX: number, clientY: number) => {
    const game = gameRef.current;
    const renderer = rendererRef.current;
    const mode = settingsRef.current.opponent;
    if (!game || !renderer || game.gameOver || busyRef.current || animatingRef.current) return;

    if (mode === "ai" && game.currentTurn === aiColorRef.current) return;

    if (mode === "online") {
      const mine = myColorRef.current;
      if (mine == null || game.currentTurn !== mine) return;
      if (!clientRef.current?.isOpen) {
        setOnlineStatus(tRef.current.explosive.notConnected);
        scheduleReconnect();
        return;
      }
      const cell = renderer.pixelToCell(clientX, clientY);
      if (!cell) return;
      if (!game.isValidMove(cell.row, cell.col, mine)) return;
      if (busyRef.current) return;
      armMoveLock();
      const sent = clientRef.current.move(cell.row, cell.col);
      if (!sent) {
        clearMoveLock();
        setOnlineStatus(tRef.current.explosive.sendFail);
        scheduleReconnect();
      }
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
      // Leaving play/over ends the online session; lobby can keep waiting.
      if (onlinePhase === "playing" || onlinePhase === "over" || onlinePhase === "reconnecting") {
        disconnectOnline();
        setSearchParams({}, { replace: true });
        setRoomCode("");
      }
    }
    setScreen("setup");
    clearMoveLock();
    setGameOver(false);
    setTip(tRef.current.explosive.tipClick);
  };

  const createRoom = () => {
    const next = { ...settingsRef.current, opponent: "online" as const };
    saveSettings(next);
    setSettings(next);
    const code = generateRoomCode();
    connectToRoom(code);
  };

  const joinRoom = () => {
    const code = roomFromQuery || roomCode;
    if (!code) {
      setOnlineStatus(tRef.current.explosive.needShareLink);
      return;
    }
    setSettings((s) => ({ ...s, opponent: "online" }));
    connectToRoom(code);
  };


  const showWinParam = settings.winMode === WIN_MODE_STEPS || settings.winMode === WIN_MODE_AREA;
  const connectedLobby = onlinePhase === "lobby" || onlinePhase === "connecting";
  /** Online room exists → config is frozen (change requires a new room). */
  const onlineConfigLocked =
    settings.opponent === "online" && onlinePhase !== "idle";

  // ——— SETUP LOBBY (no board) ———
  if (screen === "setup") {
    return (
      <div className="explosive-chess explosive-setup">
        <div className="panel">
          <h2>{ex.setupTitle}</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {ex.setupHint}
          </p>
          <div className="explosive-controls">
            <label>
              {ex.mode}
              <select
                value={settings.opponent === "online" ? "online" : "solo"}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === "online") {
                    setSettings((s) => ({ ...s, opponent: "online" }));
                    return;
                  }
                  disconnectOnline();
                  setSearchParams({}, { replace: true });
                  setSettings((s) => ({
                    ...s,
                    opponent: s.opponent === "local" ? "local" : "ai",
                  }));
                }}
              >
                <option value="solo">{ex.solo}</option>
                <option value="online">{ex.online}</option>
              </select>
            </label>
            {settings.opponent !== "online" ? (
              <label>
                {ex.soloMatch}
                <select
                  value={settings.opponent}
                  onChange={(e) => {
                    const opponent = e.target.value as "ai" | "local";
                    setSettings((s) => ({ ...s, opponent }));
                  }}
                >
                  <option value="ai">{ex.vsAi}</option>
                  <option value="local">{ex.hotseat}</option>
                </select>
              </label>
            ) : null}

            {/* Solo: always editable. Online: editable only before create; after create read-only. */}
            {settings.opponent !== "online" || onlinePhase === "idle" || onlineConfig ? (
              <>
                <label>
                  {ex.board}
                  <select
                    value={
                      settings.opponent === "online" && onlineConfig
                        ? onlineConfig.boardSize
                        : settings.boardSize
                    }
                    disabled={onlineConfigLocked}
                    onChange={(e) => {
                      const boardSize = Number(e.target.value) as 9 | 11 | 13;
                      setSettings((s) => ({ ...s, boardSize }));
                    }}
                  >
                    <option value={9}>9×9</option>
                    <option value={11}>11×11</option>
                    <option value={13}>13×13</option>
                  </select>
                </label>
                <label>
                  {ex.winMode}
                  <select
                    value={
                      settings.opponent === "online" && onlineConfig
                        ? onlineConfig.winMode
                        : settings.winMode
                    }
                    disabled={onlineConfigLocked}
                    onChange={(e) => {
                      const winMode = e.target.value as WinMode;
                      setSettings((s) => ({ ...s, winMode }));
                    }}
                  >
                    <option value={WIN_MODE_ANNIHILATION}>{ex.annihilation}</option>
                    <option value={WIN_MODE_STEPS}>{ex.steps}</option>
                    <option value={WIN_MODE_AREA}>{ex.area}</option>
                  </select>
                </label>
                {showWinParam ||
                (onlineConfig && onlineConfig.winMode !== WIN_MODE_ANNIHILATION) ? (
                  <label>
                    {(onlineConfig?.winMode ?? settings.winMode) === WIN_MODE_STEPS
                      ? ex.stepCount
                      : ex.targetCells}
                    <input
                      type="number"
                      min={1}
                      value={onlineConfig?.winParam ?? settings.winParam}
                      disabled={onlineConfigLocked}
                      onChange={(e) => {
                        const winParam = Math.max(1, Number(e.target.value) || 1);
                        setSettings((s) => ({ ...s, winParam }));
                      }}
                    />
                  </label>
                ) : null}
              </>
            ) : null}

            {settings.opponent === "ai" ? (
              <>
                <label>
                  {ex.aiDifficulty}
                  <select
                    value={settings.difficulty}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        difficulty: e.target.value as AiDifficulty,
                      }))
                    }
                  >
                    <option value="easy">{ex.easy}</option>
                    <option value="medium">{ex.medium}</option>
                    <option value="hard">{ex.hard}</option>
                    <option value="hell">{ex.hell}</option>
                  </select>
                </label>
                <label>
                  {ex.redFirst}
                  <select
                    value={settings.redOwner}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        redOwner: e.target.value as RedOwner,
                      }))
                    }
                  >
                    <option value="player">{ex.me}</option>
                    <option value="ai">{ex.ai}</option>
                  </select>
                </label>
              </>
            ) : null}

            {settings.opponent === "online" && (onlinePhase === "idle" || onlineConfig) && !roomFromQuery ? (
              <label>
                {ex.myColor}
                <select
                  value={onlineConfig?.hostColor ?? settings.hostColor}
                  disabled={onlineConfigLocked}
                  onChange={(e) => {
                    const hostColor = e.target.value as HostColor;
                    setSettings((s) => ({ ...s, hostColor }));
                  }}
                >
                  <option value="red">{ex.redFirstSeat}</option>
                  <option value="blue">{ex.blueSecond}</option>
                </select>
              </label>
            ) : null}
            {settings.opponent === "online" && onlineConfigLocked ? (
              <p className="hint" style={{ margin: 0 }}>
                {ex.onlineConfigLocked}
              </p>
            ) : null}
          </div>

          {settings.opponent !== "online" ? (
            <div className="row">
              <button type="button" className="primary" onClick={startLocalGame}>
                {ex.start}
              </button>
            </div>
          ) : null}
        </div>

        {settings.opponent === "online" ? (
          <div className="panel explosive-online-lobby">
            <h2>{ex.onlineLobby}</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              {onlineStatus || ex.onlineHint}
              {onlinePhase === "lobby" && onlineSeat ? ` ${youAreLabel(onlineSeat, ex)}` : ""}
            </p>
            <div className="row">
              {onlinePhase === "idle" || onlinePhase === "connecting" || onlinePhase === "reconnecting" ? (
                <>
                  {!roomFromQuery && onlinePhase !== "reconnecting" ? (
                    <button
                      type="button"
                      className="primary"
                      onClick={createRoom}
                      disabled={onlinePhase === "connecting"}
                    >
                      {ex.createRoom}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        reconnectAttemptsRef.current = 0;
                        joinRoom();
                      }}
                      disabled={onlinePhase === "connecting" || onlinePhase === "reconnecting"}
                    >
                      {onlinePhase === "reconnecting" ? ex.reconnecting : ex.joinRoom}
                    </button>
                  )}
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
                    setShareLink("");
                    setOnlineStatus(tRef.current.explosive.leftRoom);
                  }}
                >
                  {ex.leaveRoom}
                </button>
              ) : null}
            </div>

            {onlineRole === "host" && roomCode && (onlinePhase === "lobby" || onlinePhase === "connecting") ? (
              <div className="explosive-controls explosive-room-code">
                <label>
                  {ex.roomCode}
                  <input type="text" value={roomCode} readOnly aria-readonly="true" />
                </label>
                {shareLink ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      void navigator.clipboard?.writeText(shareLink);
                      setOnlineStatus(ex.linkCopied);
                    }}
                  >
                    {ex.copyLink}
                  </button>
                ) : null}
              </div>
            ) : null}

            {onlineConfig && onlineRole !== "host" && connectedLobby ? (
              <p className="hint">
                {ex.configLabel}
                {onlineConfig.boardSize}×{onlineConfig.boardSize} · {winModeLabel(onlineConfig.winMode, ex)}
                {onlineConfig.winMode !== WIN_MODE_ANNIHILATION
                  ? ` (${onlineConfig.winParam})`
                  : ""}{" "}
                · {ex.hostLabel}{" "}
                {onlineConfig.hostColor === "red" ? ex.colorRed : ex.colorBlue}
              </p>
            ) : null}

            {onlinePlayers.length > 0 ? (
              <ul className="explosive-player-list">
                {onlinePlayers.map((p) => (
                  <li key={p.playerId}>
                    {p.name} · {seatLabel(p.seat, ex)} · {p.role}
                    {p.rematch ? ` · ${ex.rematchMark}` : ""}
                    {!p.connected ? ` · ${ex.offline}` : ""}
                  </li>
                ))}
              </ul>
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
            {ex.backSetup}
          </button>
          <span>
            {ex.turn}：<strong>{colorLabel(turn, ex)}</strong>
          </span>
          <span>
            {ex.stepsHud}：{stepCount}
          </span>
          <span className="explosive-count red">
            {ex.colorRed} {counts.red}
          </span>
          <span className="explosive-count blue">
            {ex.colorBlue} {counts.blue}
          </span>
          {settings.opponent === "online" && myColor != null ? (
            <span>
              {ex.you}：{colorLabel(myColor, ex)}
            </span>
          ) : null}
        </div>
        <p className="hint" style={{ marginTop: "0.5rem" }}>
          {gameOver ? `${winnerLabel(winner, ex)}${winReason ? ` · ${formatWinReason(winReason, t.explosive)}` : ""}` : tip}
          {settings.opponent === "online" && onlineStatus ? ` · ${onlineStatus}` : ""}
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
              {ex.restart}
            </button>
          ) : null}
          {settings.opponent === "online" &&
          (onlinePhase === "reconnecting" || onlinePhase === "idle") ? (
            <button
              type="button"
              className="primary"
              onClick={() => {
                reconnectAttemptsRef.current = 0;
                const code = roomCodeRef.current || roomFromQuery;
                if (code) connectToRoom(code, { keepPlaying: screen === "playing" });
              }}
            >
              {ex.reconnect}
            </button>
          ) : null}
          {settings.opponent === "online" && onlinePhase === "playing" ? (
            <button type="button" className="ghost" onClick={() => clientRef.current?.surrender()}>
              {ex.surrender}
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
              {ex.rematch}
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
