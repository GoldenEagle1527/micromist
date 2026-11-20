import {
  emptyState,
  idx,
  inBounds,
  isOver,
  isValidState,
  play,
  resign,
  type GameState,
  type Player,
} from "../../../shared/gomoku/engine";
import { isSeatedSeat, normalizePlayerKind, type Seat } from "../../../shared/multiplayer";
import type { GameRoomAdapter, RoomHost } from "../../multiplayer/adapter";
import type { PlayerRecord } from "../../multiplayer/types";

type Serialized = {
  state: GameState | null;
};

function seatToPlayer(seat: Seat): Player | null {
  if (seat === "red") return 1;
  if (seat === "blue") return 2;
  return null;
}

export function createGomokuAdapter(host: RoomHost): GameRoomAdapter {
  let state: GameState | null = null;

  const api: GameRoomAdapter = {
    slug: "gomoku",
    explicitSeating: true,

    getPublicConfig: () => ({
      size: state?.size ?? 15,
    }),

    hostSeat: () => "red",

    onRecycle: () => {
      state = null;
    },

    onSeated: (ws, player, info) => {
      const reusedRoom =
        info.reclaimed ||
        host.phase !== "lobby" ||
        state != null ||
        [...host.players.values()].some((p) => p.playerId !== player.playerId);
      host.send(ws, "joined", {
        game: host.gameSlug,
        roomCode: host.roomCode,
        roomId: `${host.gameSlug}:${host.roomCode}`,
        phase: host.phase,
        reclaimed: info.reclaimed,
        reusedRoom,
        you: youFrom(player),
      });
    },

    onReclaimSync: (ws, player) => {
      if (!state) return;
      host.send(ws, "start", {
        phase: host.phase,
        yourSeat: player.seat,
      });
      host.send(ws, "state", { publicState: publicView() });
      if (host.phase === "over" || isOver(state)) {
        host.send(ws, "game_over", gameOverBody("five"));
        return;
      }
      if (canMove(player.seat)) {
        host.send(ws, "your_turn", { publicState: publicView() });
      }
    },

    onSeatClaimed: () => {
      // The shell calls tryStartGame after a changed claim.
    },

    onSetConfig: (ws, _session, _payload) => {
      if (host.phase !== "lobby" || state) {
        host.send(ws, "error", { message: "Config locked after the match starts" });
        return true;
      }
      host.broadcastRoom();
      void host.persist();
      return true;
    },

    tryStartGame: () => {
      if (host.phase !== "lobby") return;
      const seated = host.seatedPlayers({ connectedOnly: true });
      const black = seated.find((p) => p.seat === "red");
      const white = seated.find((p) => p.seat === "blue");
      if (!black || !white) return;

      state = emptyState();
      host.setPhase("playing");
      for (const p of seated) {
        p.ready = false;
        p.rematch = false;
      }
      host.broadcast("start", {
        phase: "playing",
        config: api.getPublicConfig(),
      });
      host.broadcast("state", { publicState: publicView() });
      pushYourTurn();
      host.broadcastRoom();
      void host.persist();
    },

    onMessage: (ws, type, payload) => {
      switch (type) {
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

    serialize: (): Serialized => ({ state }),

    hydrate: (blob: unknown) => {
      state = null;
      if (!blob || typeof blob !== "object") return;
      const data = blob as Partial<Serialized>;
      if (isValidState(data.state)) state = data.state;
    },
  };

  function handleMove(ws: WebSocket, payload: Record<string, unknown>) {
    const session = host.requireJoined(ws);
    if (!session) return;
    const player = host.players.get(session.playerId);
    if (!player) {
      host.send(ws, "error", { message: "Join first" });
      return;
    }
    if (host.phase !== "playing" || !state || isOver(state)) {
      host.send(ws, "error", { message: "Game not in progress" });
      return;
    }
    const color = seatToPlayer(session.seat);
    if (color === null) {
      host.send(ws, "error", { message: "Spectators cannot move" });
      return;
    }
    if (state.turn !== color) {
      host.send(ws, "error", { message: "Not your turn" });
      return;
    }
    const size = state.size;
    let index = -1;
    if (typeof payload.index === "number" && Number.isInteger(payload.index)) {
      index = payload.index;
    } else if (
      typeof payload.row === "number" &&
      typeof payload.col === "number" &&
      Number.isInteger(payload.row) &&
      Number.isInteger(payload.col)
    ) {
      if (!inBounds(payload.row, payload.col, size)) {
        host.send(ws, "error", { message: "Invalid move" });
        return;
      }
      index = idx(payload.row, payload.col, size);
    }
    const next = play(state, index);
    if (!next) {
      host.send(ws, "error", { message: "Invalid move" });
      return;
    }
    state = next;
    if (isOver(state)) host.setPhase("over");
    const view = publicView();
    host.broadcast("state", { publicState: view });
    host.broadcast("move_applied", {
      action: { type: "move", index, row: Math.floor(index / size), col: index % size },
      by: youFrom(player),
      publicState: view,
      gameOver: isOver(state),
    });
    if (isOver(state)) {
      host.broadcast("game_over", gameOverBody(state.winner === 3 ? "draw" : "five"));
    } else {
      pushYourTurn();
    }
    host.broadcastRoom();
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
    if (host.phase !== "playing" || !state || isOver(state)) {
      host.send(ws, "error", { message: "Game not in progress" });
      return;
    }
    const color = seatToPlayer(session.seat);
    if (color === null) {
      host.send(ws, "error", { message: "Spectators cannot resign" });
      return;
    }
    state = resign(state, color);
    host.setPhase("over");
    const view = publicView();
    host.broadcast("state", { publicState: view });
    host.broadcast("game_over", gameOverBody("surrender"));
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
      state = null;
      host.setPhase("lobby");
      host.broadcastRoom();
      api.tryStartGame();
      return;
    }
    host.broadcastRoom();
    void host.persist();
  }

  function youFrom(player: PlayerRecord) {
    return {
      playerId: player.playerId,
      name: player.name,
      seat: player.seat,
      role: player.role,
      kind: normalizePlayerKind(player.kind),
      color: seatToPlayer(player.seat),
      canConfig: host.hostId === player.playerId,
    };
  }

  function publicView(): GameState | null {
    return state;
  }

  function canMove(seat: Seat): boolean {
    if (host.phase !== "playing" || !state || isOver(state)) return false;
    return seatToPlayer(seat) === state.turn;
  }

  function pushYourTurn(): void {
    if (!state) return;
    for (const [ws, session] of host.sessions) {
      if (!session.playerId || !canMove(session.seat)) continue;
      host.send(ws, "your_turn", { publicState: publicView() });
    }
  }

  function gameOverBody(reason: "five" | "draw" | "surrender") {
    return {
      winner: state?.winner ?? 0,
      winReason: reason,
      winLine: state?.winLine ?? null,
    };
  }

  return api;
}
