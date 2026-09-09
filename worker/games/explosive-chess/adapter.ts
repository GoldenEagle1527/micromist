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
  type WinMode,
} from "../../../shared/explosive-chess/engine";
import { isSeatedSeat, type Seat } from "../../../shared/multiplayer";
import type { GameRoomAdapter, RoomHost } from "../../multiplayer/adapter";

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

    onReclaimSync: (ws, player) => {
      const yourColor = seatToColor(player.seat);
      if (!yourColor || !game) return;
      host.send(ws, "game_start", {
        config: api.getPublicConfig(),
        yourColor: player.seat === "blue" ? "blue" : "red",
      });
      host.send(ws, "state", { fullState: game.getFullState() });
      if (host.phase === "over") {
        host.send(ws, "game_over", {
          winner: game.winner,
          winReason: game.winReason,
        });
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

      host.broadcast("state", { fullState: game.getFullState() });
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

  function handleMove(ws: WebSocket, payload: Record<string, unknown>) {
    const session = host.requireJoined(ws);
    if (!session) return;
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
    const row = typeof payload.row === "number" ? payload.row : -1;
    const col = typeof payload.col === "number" ? payload.col : -1;
    if (!game.isValidMove(row, col, color)) {
      host.send(ws, "error", { message: "Invalid move" });
      return;
    }
    const result = game.makeMove(row, col, color);
    if (!result) {
      host.send(ws, "error", { message: "Move rejected" });
      return;
    }

    host.broadcast("state", {
      fullState: game.getFullState(),
      lastMove: { row, col },
      animationFrames: result.animationFrames,
    });

    if (result.gameOver) {
      host.setPhase("over");
      host.broadcast("game_over", {
        winner: result.winner,
        winReason: result.winReason,
      });
      host.broadcastRoom();
    }
    void host.persist();
  }

  function handleSurrender(ws: WebSocket) {
    const session = host.requireJoined(ws);
    if (!session) return;
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
    host.broadcast("state", { fullState: game.getFullState() });
    host.broadcast("game_over", { winner, winReason: "surrender" });
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

  return api;
}
