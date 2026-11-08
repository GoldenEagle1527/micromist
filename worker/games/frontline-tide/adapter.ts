import { normalizePlayerKind, type Seat } from "../../../shared/multiplayer";
import { applyAction, type TideAction, type TideEffect } from "../../../shared/frontline-tide/actions";
import { createGame } from "../../../shared/frontline-tide/engine";
import {
  buildTideObservation,
  type TidePublicState,
  type TideYou,
} from "../../../shared/frontline-tide/observe";
import type { GameState } from "../../../shared/frontline-tide/types";
import type { GameRoomAdapter, RoomHost } from "../../multiplayer/adapter";
import type { PlayerRecord } from "../../multiplayer/types";

type Serialized = {
  seed: number | null;
  configFrozen?: boolean;
  game: GameState | null;
  effects: TideEffect[];
};

function freshSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! >>> 0;
}

function readAction(payload: Record<string, unknown>): TideAction | null {
  const nested = payload.action;
  const body =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : payload;
  if (body.type === "end_phase") return { type: "end_phase" };
  if (body.type === "place" && typeof body.row === "number" && typeof body.col === "number") {
    return { type: "place", row: body.row, col: body.col };
  }
  if (
    body.type === "swap" &&
    typeof body.row === "number" &&
    typeof body.col === "number" &&
    typeof body.row2 === "number" &&
    typeof body.col2 === "number"
  ) {
    return { type: "swap", row: body.row, col: body.col, row2: body.row2, col2: body.col2 };
  }
  return null;
}

function sameAction(a: TideAction, b: TideAction): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createFrontlineTideAdapter(host: RoomHost): GameRoomAdapter {
  let seed: number | null = null;
  let configFrozen = false;
  let game: GameState | null = null;
  let effects: TideEffect[] = [];

  const api: GameRoomAdapter = {
    slug: "frontline-tide",
    explicitSeating: true,
    playSeats: ["player"],

    getPublicConfig: () => ({ seed }),

    hostSeat: () => "player",

    onRecycle: () => {
      game = null;
      seed = null;
      configFrozen = false;
      effects = [];
    },

    onSeated: (ws, player, info) => {
      const reusedRoom =
        info.reclaimed ||
        configFrozen ||
        host.phase !== "lobby" ||
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
      if (!game) return;
      const observation = observationFor(player);
      host.send(ws, "state", { publicState: observation.publicState });
      host.send(ws, "observation", { observation });
      if (host.phase === "over" || game.phase === "gameover") {
        host.send(ws, "game_over", gameOverBody());
        return;
      }
      if (canAct(player.seat)) host.send(ws, "your_turn", { observation });
    },

    onSeatClaimed: () => {
      // The shell calls tryStartGame after a changed claim.
    },

    onSetConfig: (ws, _session, payload) => {
      if (configFrozen || host.phase !== "lobby" || game) {
        host.send(ws, "error", { message: "Config locked after room create" });
        return true;
      }
      if (payload.seed != null) {
        if (typeof payload.seed !== "number" || !Number.isInteger(payload.seed) || payload.seed < 0) {
          host.send(ws, "error", { message: "seed must be a non-negative integer" });
          return true;
        }
        seed = payload.seed >>> 0;
      }
      configFrozen = true;
      host.broadcastRoom();
      void host.persist();
      return true;
    },

    tryStartGame: () => {
      if (host.phase !== "lobby" || game) return;
      const seated = host.seatedPlayers({ connectedOnly: true });
      const player = seated.find((p) => p.seat === "player");
      if (!player) return;
      if (seed == null) seed = freshSeed();
      configFrozen = true;
      game = createGame(seed);
      effects = [];
      host.setPhase("playing");
      for (const p of seated) {
        p.ready = false;
        p.rematch = false;
      }
      host.broadcast("start", { phase: "playing", config: api.getPublicConfig(), yourSeat: "player" });
      host.broadcast("state", { publicState: publicView() });
      pushYourTurn();
      host.broadcastRoom();
      void host.persist();
    },

    onMessage: (ws, type, payload) => {
      if (type === "ready") {
        host.send(ws, "error", { message: "Ready is disabled; the run starts when player sits" });
        return true;
      }
      if (type === "move" || type === "act") {
        handleMove(ws, payload);
        return true;
      }
      if (type === "observe") {
        const session = host.requireJoined(ws);
        if (!session) return true;
        const player = host.players.get(session.playerId);
        if (!player) {
          host.send(ws, "error", { message: "Join first" });
          return true;
        }
        host.send(ws, "observation", { observation: observationFor(player) });
        return true;
      }
      return false;
    },

    serialize: (): Serialized => ({ seed, configFrozen, game, effects }),

    hydrate: (blob: unknown) => {
      game = null;
      seed = null;
      configFrozen = false;
      effects = [];
      if (!blob || typeof blob !== "object") return;
      const data = blob as Partial<Serialized>;
      if (typeof data.seed === "number" && Number.isInteger(data.seed) && data.seed >= 0) seed = data.seed >>> 0;
      configFrozen = Boolean(data.configFrozen);
      if (data.game && typeof data.game === "object" && Array.isArray(data.game.board)) {
        game = data.game;
      }
      if (Array.isArray(data.effects)) effects = data.effects;
    },
  };

  function youFrom(player: PlayerRecord): TideYou {
    return {
      playerId: player.playerId,
      name: player.name,
      seat: player.seat,
      role: player.role,
      kind: normalizePlayerKind(player.kind),
      color: null,
      canConfig: host.hostId === player.playerId,
    };
  }

  function observationFor(player: PlayerRecord) {
    return buildTideObservation({
      phase: host.phase,
      you: youFrom(player),
      game,
      effects,
    });
  }

  function publicView(): TidePublicState {
    return buildTideObservation({
      phase: host.phase,
      you: {
        playerId: "",
        name: "",
        seat: "spectator",
        role: "spectator",
        kind: "human",
        color: null,
      },
      game,
      effects,
    }).publicState;
  }

  function canAct(seat: Seat): boolean {
    return host.phase === "playing" && !!game && game.phase !== "gameover" && seat === "player";
  }

  function pushYourTurn(): void {
    for (const [ws, session] of host.sessions) {
      if (!session.playerId || !canAct(session.seat)) continue;
      const player = host.players.get(session.playerId);
      if (!player) continue;
      host.send(ws, "your_turn", { observation: observationFor(player) });
    }
  }

  function gameOverBody() {
    return {
      winner: null,
      winnerColor: null,
      winReason: "hearts",
      day: game?.day ?? 1,
      hearts: game?.hearts ?? 0,
    };
  }

  function handleMove(ws: WebSocket, payload: Record<string, unknown>): void {
    const session = host.requireJoined(ws);
    if (!session) return;
    const player = host.players.get(session.playerId);
    if (!player) {
      host.send(ws, "error", { message: "Join first" });
      return;
    }
    if (!game || host.phase !== "playing") {
      host.send(ws, "error", { message: "Game not in progress" });
      return;
    }
    if (session.seat !== "player") {
      host.send(ws, "error", { message: "Spectators cannot move" });
      return;
    }
    const action = readAction(payload);
    const legal = observationFor(player).legalActions;
    if (!action || !legal.some((entry) => sameAction(entry, action))) {
      host.send(ws, "error", { message: "Invalid move" });
      return;
    }
    const applied = applyAction(game, action);
    if (!applied.ok) {
      host.send(ws, "error", { message: "Move rejected" });
      return;
    }
    game = applied.state;
    effects = applied.effects;
    const over = game.phase === "gameover";
    if (over) host.setPhase("over");
    const view = publicView();
    const you = youFrom(player);
    host.broadcast("state", { publicState: view });
    host.broadcast("move_applied", {
      action,
      by: you,
      publicState: view,
      effects,
      gameOver: over,
    });
    if (over) host.broadcast("game_over", gameOverBody());
    else pushYourTurn();
    host.broadcastRoom();
    void host.persist();
  }

  return api;
}
