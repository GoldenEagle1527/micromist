import {
  COLOR_BLUE,
  COLOR_RED,
  WIN_MODE_ANNIHILATION,
  WIN_MODE_AREA,
  WIN_MODE_STEPS,
  createGame,
  type FullState,
  type GameConfig,
  type GameInstance,
  type PlayerColor,
  type Winner,
  type WinMode,
} from "../../../shared/explosive-chess/engine";
import {
  buildExplosiveObservation,
  winnerColorName,
  type ExplosiveObservation,
  type ExplosiveYou,
} from "../../../shared/explosive-chess/observe";
import { isSeatedSeat, normalizePlayerKind, type Seat } from "../../../shared/multiplayer";
import type { GameRoomAdapter, RoomHost } from "../../multiplayer/adapter";
import type { PlayerRecord } from "../../multiplayer/types";

type HostColor = "red" | "blue";

type RoomConfig = {
  boardSize: number;
  winMode: WinMode;
  winParam: number;
  hostColor: HostColor;
};

type Serialized = {
  config: RoomConfig;
  fullState: FullState | null;
  configFrozen?: boolean;
};

const DEFAULT_CONFIG: RoomConfig = {
  boardSize: 9,
  winMode: WIN_MODE_ANNIHILATION,
  winParam: 50,
  hostColor: "red",
};

function seatToColor(seat: Seat): PlayerColor | null {
  if (seat === "red") return COLOR_RED;
  if (seat === "blue") return COLOR_BLUE;
  return null;
}

function isWinMode(value: unknown): value is WinMode {
  return (
    value === WIN_MODE_ANNIHILATION ||
    value === WIN_MODE_STEPS ||
    value === WIN_MODE_AREA
  );
}

export function createExplosiveChessAdapter(host: RoomHost): GameRoomAdapter {
  let config: RoomConfig = { ...DEFAULT_CONFIG };
  let game: GameInstance | null = null;
  let configFrozen = false;

  const api: GameRoomAdapter = {
    slug: "explosive-chess",

    getPublicConfig: () => ({
      boardSize: config.boardSize,
      winMode: config.winMode,
      winParam: config.winParam,
      hostColor: config.hostColor,
    }),

    hostSeat: () => config.hostColor,

    onRecycle: () => {
      game = null;
      config = { ...DEFAULT_CONFIG };
      configFrozen = false;
    },

    onSeated: (ws, player, info) => {
      host.send(ws, "joined", {
        game: host.gameSlug,
        roomCode: host.roomCode,
        roomId: `${host.gameSlug}:${host.roomCode}`,
        phase: host.phase,
        reclaimed: info.reclaimed,
        you: youFrom(player),
      });
      notifyOpponents(ws, player, info.reclaimed);
    },

    onReclaimSync: (ws, player) => {
      const yourColor = seatToColor(player.seat);
      if (!yourColor || !game) return;
      host.send(ws, "game_start", {
        config: api.getPublicConfig(),
        yourColor: player.seat === "blue" ? "blue" : "red",
      });
      host.send(ws, "state", { fullState: game.getFullState() });
      const observation = observationFor(player);
      host.send(ws, "observation", { observation });
      if (host.phase === "over") {
        host.send(ws, "game_over", gameOverBody(game.winner, game.winReason));
        return;
      }
      if (canMove(player.seat)) {
        host.send(ws, "your_turn", { observation });
      }
    },

    onSetConfig: (ws, _session, payload) => {
      if (configFrozen) {
        host.send(ws, "error", { message: "Config locked after room create" });
        return true;
      }
      const next = { ...config };
      if (typeof payload.boardSize === "number" && [9, 11, 13].includes(payload.boardSize)) {
        next.boardSize = payload.boardSize;
      }
      if (isWinMode(payload.winMode)) next.winMode = payload.winMode;
      if (typeof payload.winParam === "number" && payload.winParam >= 1) {
        next.winParam = Math.floor(payload.winParam);
      }
      if (payload.hostColor === "red" || payload.hostColor === "blue") {
        next.hostColor = payload.hostColor;
      }
      config = next;

      const hostPlayer = host.hostId ? host.players.get(host.hostId) : null;
      const guest = [...host.players.values()].find((p) => p.role === "guest");
      if (hostPlayer && isSeatedSeat(hostPlayer.seat)) {
        hostPlayer.seat = next.hostColor;
        host.refreshAttachmentSeat(hostPlayer.playerId, hostPlayer.seat);
      }
      if (guest && isSeatedSeat(guest.seat)) {
        guest.seat = next.hostColor === "red" ? "blue" : "red";
        host.refreshAttachmentSeat(guest.playerId, guest.seat);
      }
      configFrozen = true;
      host.broadcastRoom();
      void host.persist();
      return true;
    },

    tryStartGame: () => {
      const seated = host.seatedPlayers({ connectedOnly: true });
      if (seated.length < 2) return;

      const winParam =
        config.winMode === WIN_MODE_ANNIHILATION ? undefined : config.winParam;
      const gameConfig: GameConfig = {
        boardSize: config.boardSize,
        winMode: config.winMode,
        winParam,
      };
      game = createGame(gameConfig);
      host.setPhase("playing");
      for (const p of seated) {
        p.ready = false;
        p.rematch = false;
      }

      for (const [ws, session] of host.sessions) {
        if (!isSeatedSeat(session.seat)) continue;
        host.send(ws, "game_start", {
          config: api.getPublicConfig(),
          yourColor: session.seat,
        });
      }

      pushStart();
      host.broadcast("state", { fullState: game.getFullState() });
      pushYourTurn();
      host.broadcastRoom();
      void host.persist();
    },

    onMessage: (ws, type, payload) => {
      switch (type) {
        case "ready":
          host.send(ws, "error", {
            message: "Ready is disabled; game starts with 2 players",
          });
          return true;
        case "move":
          handleMove(ws, payload);
          return true;
        case "act":
          handleAct(ws, payload);
          return true;
        case "observe":
          handleObserve(ws);
          return true;
        case "surrender":
          handleSurrender(ws);
          return true;
        case "rematch":
          handleRematch(ws);
          return true;
        default:
          return false;
      }
    },

    serialize: (): Serialized => ({
      config,
      fullState: game ? game.getFullState() : null,
      configFrozen,
    }),

    hydrate: (blob: unknown) => {
      if (!blob || typeof blob !== "object") {
        config = { ...DEFAULT_CONFIG };
        game = null;
        return;
      }
      const data = blob as Partial<Serialized>;
      if (data.config && typeof data.config === "object") {
        config = { ...DEFAULT_CONFIG, ...data.config };
      }
      configFrozen = Boolean(data.configFrozen);
      if (data.fullState && typeof data.fullState === "object") {
        const winParam =
          config.winMode === WIN_MODE_ANNIHILATION ? undefined : config.winParam;
        game = createGame({
          boardSize: config.boardSize,
          winMode: config.winMode,
          winParam,
        });
        game.loadFullState(data.fullState as FullState);
      } else {
        game = null;
      }
    },
  };

  function handleAct(ws: WebSocket, payload: Record<string, unknown>) {
    const action = actionRecord(payload);
    if (action.type === "move") {
      handleMove(ws, action);
      return;
    }
    if (action.type === "surrender") {
      handleSurrender(ws);
      return;
    }
    host.send(ws, "error", { message: "Unknown action" });
  }

  function handleObserve(ws: WebSocket) {
    const session = host.requireJoined(ws);
    if (!session) return;
    const player = host.players.get(session.playerId);
    if (!player) {
      host.send(ws, "error", { message: "Join first" });
      return;
    }
    host.send(ws, "observation", { observation: observationFor(player) });
  }

  function handleMove(ws: WebSocket, payload: Record<string, unknown>) {
    const session = host.requireJoined(ws);
    if (!session) return;
    const player = host.players.get(session.playerId);
    if (!player) {
      host.send(ws, "error", { message: "Join first" });
      return;
    }
    if (host.phase !== "playing" || !game) {
      host.send(ws, "error", { message: "Game not in progress" });
      return;
    }
    const color = seatToColor(session.seat);
    if (color === null) {
      host.send(ws, "error", { message: "Spectators cannot move" });
      return;
    }
    if (game.currentTurn !== color) {
      host.send(ws, "error", { message: "Not your turn" });
      return;
    }
    const row = payload.row;
    const col = payload.col;
    if (
      typeof row !== "number" ||
      typeof col !== "number" ||
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      !game.isValidMove(row, col, color)
    ) {
      host.send(ws, "error", { message: "Invalid move" });
      return;
    }
    const result = game.makeMove(row, col, color);
    if (!result) {
      host.send(ws, "error", { message: "Move rejected" });
      return;
    }

    if (result.gameOver) host.setPhase("over");
    const view = observationFor(player);
    host.broadcast("state", {
      fullState: game.getFullState(),
      lastMove: { row, col },
      animationFrames: result.animationFrames,
    });
    host.broadcast("move_applied", {
      action: { type: "move", row, col },
      by: view.you,
      publicState: view.publicState,
      gameOver: result.gameOver,
    });

    if (result.gameOver) {
      host.broadcast("game_over", gameOverBody(result.winner, result.winReason));
      host.broadcastRoom();
    } else {
      pushYourTurn();
    }
    void host.persist();
  }

  function handleSurrender(ws: WebSocket) {
    const session = host.requireJoined(ws);
    if (!session) return;
    const player = host.players.get(session.playerId);
    if (!player) {
      host.send(ws, "error", { message: "Join first" });
      return;
    }
    if (host.phase !== "playing" || !game) {
      host.send(ws, "error", { message: "Game not in progress" });
      return;
    }
    const color = seatToColor(session.seat);
    if (color === null) {
      host.send(ws, "error", { message: "Spectators cannot surrender" });
      return;
    }
    const winner: PlayerColor = color === COLOR_RED ? COLOR_BLUE : COLOR_RED;
    game.forceGameOver(winner, "surrender");
    host.setPhase("over");
    const view = observationFor(player);
    host.broadcast("state", { fullState: game.getFullState() });
    host.broadcast("move_applied", {
      action: { type: "surrender" },
      by: view.you,
      publicState: view.publicState,
      gameOver: true,
    });
    host.broadcast("game_over", gameOverBody(winner, "surrender"));
    host.broadcastRoom();
    void host.persist();
  }

  function handleRematch(ws: WebSocket) {
    const session = host.requireJoined(ws);
    if (!session) return;
    if (host.phase !== "over") {
      host.send(ws, "error", { message: "Rematch only after game over" });
      return;
    }
    if (!isSeatedSeat(session.seat)) {
      host.send(ws, "error", { message: "Spectators cannot rematch" });
      return;
    }
    const player = host.players.get(session.playerId);
    if (!player) return;
    player.rematch = true;

    const seated = host.seatedPlayers({ connectedOnly: true });
    if (seated.length >= 2 && seated.every((p) => p.rematch)) {
      for (const p of seated) {
        p.rematch = false;
        p.ready = false;
      }
      game = null;
      host.setPhase("lobby");
      host.broadcastRoom();
      api.tryStartGame();
      return;
    }
    host.broadcastRoom();
    void host.persist();
  }

  function youFrom(player: PlayerRecord): ExplosiveYou {
    const color = player.seat === "red" || player.seat === "blue" ? player.seat : null;
    return {
      playerId: player.playerId,
      name: player.name,
      seat: player.seat,
      role: player.role,
      kind: normalizePlayerKind(player.kind),
      color,
    };
  }

  function observationFor(player: PlayerRecord): ExplosiveObservation {
    return buildExplosiveObservation({
      phase: host.phase,
      you: youFrom(player),
      config,
      game,
    });
  }

  function canMove(seat: Seat): boolean {
    if (host.phase !== "playing" || !game || game.gameOver) return false;
    const turn = game.currentTurn === COLOR_RED ? "red" : "blue";
    return seat === turn;
  }

  function pushStart(): void {
    for (const [ws, session] of host.sessions) {
      if (!session.playerId) continue;
      const yourColor = session.seat === "red" || session.seat === "blue" ? session.seat : null;
      host.send(ws, "start", {
        phase: "playing",
        config: api.getPublicConfig(),
        yourColor,
        firstColor: "red",
      });
    }
  }

  function pushYourTurn(): void {
    for (const [ws, session] of host.sessions) {
      if (!session.playerId || !canMove(session.seat)) continue;
      const player = host.players.get(session.playerId);
      if (!player) continue;
      host.send(ws, "your_turn", { observation: observationFor(player) });
    }
  }

  function gameOverBody(winner: Winner, winReason: string) {
    return {
      winner,
      winnerColor: winnerColorName(winner),
      winReason,
    };
  }

  function notifyOpponents(ws: WebSocket, player: PlayerRecord, reclaimed: boolean): void {
    if (!isSeatedSeat(player.seat)) return;
    const body = {
      playerId: player.playerId,
      name: player.name,
      seat: player.seat,
      role: player.role,
      kind: normalizePlayerKind(player.kind),
      reclaimed,
    };
    for (const [sock, session] of host.sessions) {
      if (sock === ws || !session.playerId || session.playerId === player.playerId) continue;
      host.send(sock, "opponent_joined", body);
    }
  }

  function actionRecord(payload: Record<string, unknown>): Record<string, unknown> {
    const nested = payload.action;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
    return payload;
  }

  return api;
}
