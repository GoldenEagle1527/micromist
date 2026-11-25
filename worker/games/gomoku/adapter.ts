import {
  asRules,
  clampCapturesToWin,
  cloneState,
  DEFAULT_CAPTURES_TO_WIN,
  emptyState,
  idx,
  inBounds,
  isOver,
  legalActions,
  parseState,
  play,
  resign,
  type GameState,
  type Player,
  type Rules,
} from "../../../shared/gomoku/engine";
import { isSeatedSeat, normalizePlayerKind, type Seat } from "../../../shared/multiplayer";
import type { GameRoomAdapter, RoomHost } from "../../multiplayer/adapter";
import type { PlayerRecord } from "../../multiplayer/types";

type RoomConfig = {
  rules: Rules;
  capturesToWin: number;
};

type Serialized = {
  state: GameState | null;
  config: RoomConfig;
  configFrozen: boolean;
  history: GameState[];
  undoFrom: string | null;
};

function seatToPlayer(seat: Seat): Player | null {
  if (seat === "red") return 1;
  if (seat === "blue") return 2;
  return null;
}

function defaultConfig(): RoomConfig {
  return { rules: "classic", capturesToWin: DEFAULT_CAPTURES_TO_WIN };
}

export function createGomokuAdapter(host: RoomHost): GameRoomAdapter {
  let state: GameState | null = null;
  let config: RoomConfig = defaultConfig();
  let configFrozen = false;
  let history: GameState[] = [];
  let undoFrom: string | null = null;

  const api: GameRoomAdapter = {
    slug: "gomoku",
    explicitSeating: true,

    getPublicConfig: () => ({
      size: state?.size ?? 15,
      rules: config.rules,
      capturesToWin: config.capturesToWin,
      undoRequest: undoFrom,
    }),

    hostSeat: () => "red",

    onRecycle: () => {
      resetMatch();
      config = defaultConfig();
      configFrozen = false;
    },

    onSeated: (ws, player, info) => {
      const reusedRoom =
        info.reclaimed ||
        configFrozen ||
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
        config: api.getPublicConfig(),
      });
      host.send(ws, "state", { publicState: publicView() });
      if (host.phase === "over" || isOver(state)) {
        host.send(ws, "game_over", gameOverBody());
        return;
      }
      if (undoFrom) {
        host.send(ws, "undo_requested", undoEventBody());
      }
      if (canMove(player.seat)) {
        host.send(ws, "your_turn", {
          observation: observationFor(player),
          publicState: publicView(),
        });
      }
    },

    onSeatClaimed: () => {
      // The shell calls tryStartGame after a changed claim.
    },

    onSetConfig: (ws, _session, payload) => {
      if (configFrozen || host.phase !== "lobby" || state) {
        host.send(ws, "error", { message: "Config locked after the match starts" });
        return true;
      }
      config = {
        rules: asRules(payload.rules),
        capturesToWin: clampCapturesToWin(payload.capturesToWin),
      };
      configFrozen = true;
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

      configFrozen = true;
      resetMatch();
      state = emptyState(config);
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
        case "undo_request":
          handleUndoRequest(ws);
          return true;
        case "undo_respond":
          handleUndoRespond(ws, payload);
          return true;
        default:
          return false;
      }
    },

    serialize: (): Serialized => ({ state, config, configFrozen, history, undoFrom }),

    hydrate: (blob: unknown) => {
      resetMatch();
      config = defaultConfig();
      configFrozen = false;
      if (!blob || typeof blob !== "object") return;
      const data = blob as Partial<Serialized>;
      if (data.config && typeof data.config === "object") {
        config = {
          rules: asRules(data.config.rules),
          capturesToWin: clampCapturesToWin(data.config.capturesToWin),
        };
      }
      if (data.configFrozen === true) configFrozen = true;
      const parsed = parseState(data.state);
      if (parsed) state = parsed;
      if (Array.isArray(data.history)) {
        history = data.history
          .map((entry) => parseState(entry))
          .filter((entry): entry is GameState => entry != null);
      }
      if (typeof data.undoFrom === "string" && data.undoFrom.length > 0) {
        undoFrom = data.undoFrom;
      }
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
    clearUndoRequest("move");
    history.push(cloneState(state));
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
      host.broadcast("game_over", gameOverBody());
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
    clearUndoRequest("cancelled");
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
      resetMatch();
      host.setPhase("lobby");
      host.broadcastRoom();
      api.tryStartGame();
      return;
    }
    host.broadcastRoom();
    void host.persist();
  }

  function handleUndoRequest(ws: WebSocket) {
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
    if (seatToPlayer(session.seat) === null) {
      host.send(ws, "error", { message: "Spectators cannot undo" });
      return;
    }
    if (history.length === 0) {
      host.send(ws, "error", { message: "Nothing to undo" });
      return;
    }
    if (undoFrom === session.playerId) {
      host.send(ws, "error", { message: "Undo already requested" });
      return;
    }
    if (undoFrom) {
      host.send(ws, "error", { message: "Answer the pending undo first" });
      return;
    }
    undoFrom = session.playerId;
    host.broadcast("undo_requested", undoEventBody());
    host.broadcastRoom();
    void host.persist();
  }

  function handleUndoRespond(ws: WebSocket, payload: Record<string, unknown>) {
    const session = host.requireJoined(ws);
    if (!session) return;
    const player = host.players.get(session.playerId);
    if (!player) {
      host.send(ws, "error", { message: "Join first" });
      return;
    }
    if (!undoFrom) {
      host.send(ws, "error", { message: "No pending undo" });
      return;
    }
    if (host.phase !== "playing" || !state || isOver(state)) {
      host.send(ws, "error", { message: "Game not in progress" });
      return;
    }
    if (seatToPlayer(session.seat) === null) {
      host.send(ws, "error", { message: "Spectators cannot undo" });
      return;
    }
    const accept = payload.accept === true;
    if (accept) {
      if (session.playerId === undoFrom) {
        host.send(ws, "error", { message: "Only the opponent can accept undo" });
        return;
      }
      applyUndo(player);
      return;
    }
    if (session.playerId !== undoFrom && session.playerId !== opponentId(undoFrom)) {
      host.send(ws, "error", { message: "Not part of this undo request" });
      return;
    }
    const reason = session.playerId === undoFrom ? "cancelled" : "rejected";
    clearUndoRequest(reason);
    host.broadcastRoom();
    void host.persist();
  }

  function applyUndo(by: PlayerRecord) {
    const prev = history.pop();
    if (!prev) {
      clearUndoRequest("cancelled");
      host.broadcastRoom();
      void host.persist();
      return;
    }
    const from = undoEventBody();
    undoFrom = null;
    state = prev;
    const view = publicView();
    host.broadcast("undo_resolved", {
      accepted: true,
      reason: "accepted",
      ...from,
      by: youFrom(by),
      publicState: view,
    });
    host.broadcast("state", { publicState: view, undoRequest: null });
    pushYourTurn();
    host.broadcastRoom();
    void host.persist();
  }

  function clearUndoRequest(reason: "rejected" | "cancelled" | "move") {
    if (!undoFrom) return;
    const body = { ...undoEventBody(), accepted: false, reason };
    undoFrom = null;
    host.broadcast("undo_resolved", body);
  }

  function undoEventBody() {
    const player = undoFrom ? host.players.get(undoFrom) : undefined;
    return {
      from: player ? youFrom(player) : undoFrom ? { playerId: undoFrom } : null,
    };
  }

  function opponentId(playerId: string): string | null {
    const seated = host.seatedPlayers();
    const other = seated.find((p) => p.playerId !== playerId);
    return other?.playerId ?? null;
  }

  function resetMatch() {
    state = null;
    history = [];
    undoFrom = null;
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

  function observationFor(player: PlayerRecord) {
    const seated = canMove(player.seat);
    return {
      phase: host.phase,
      you: youFrom(player),
      config: api.getPublicConfig(),
      publicState: publicView(),
      legalActions: seated && state ? legalActions(state) : [],
      effects: [],
    };
  }

  function canMove(seat: Seat): boolean {
    if (host.phase !== "playing" || !state || isOver(state)) return false;
    return seatToPlayer(seat) === state.turn;
  }

  function pushYourTurn(): void {
    if (!state) return;
    for (const [ws, session] of host.sessions) {
      if (!session.playerId || !canMove(session.seat)) continue;
      const player = host.players.get(session.playerId);
      if (!player) continue;
      host.send(ws, "your_turn", {
        observation: observationFor(player),
        publicState: publicView(),
      });
    }
  }

  function gameOverBody(reason?: "five" | "draw" | "surrender" | "captures" | "board") {
    const resolved = reason ?? inferReason();
    return {
      winner: state?.winner ?? 0,
      winReason: resolved,
      winLine: state?.winLine ?? null,
    };
  }

  function inferReason(): "five" | "draw" | "captures" | "board" {
    if (!state) return "draw";
    if (state.winner === 3) return "draw";
    if (state.rules === "series") {
      const n = state.winner === 1 || state.winner === 2 ? state.captures[state.winner - 1] : 0;
      return n >= state.capturesToWin ? "captures" : "board";
    }
    return "five";
  }

  return api;
}
