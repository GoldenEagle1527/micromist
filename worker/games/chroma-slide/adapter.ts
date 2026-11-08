import { normalizePlayerKind, type Seat } from "../../../shared/multiplayer";
import {
  PRESETS,
  clickMove,
  isLegalClick,
  isWon,
  newPuzzleWithSeed,
  normalizePresetId,
  rcToIndex,
  type PresetId,
  type PuzzleState,
} from "../../../shared/chroma-slide/engine";
import {
  buildChromaObservation,
  buildPublicState,
  type ChromaPublicState,
  type ChromaYou,
} from "../../../shared/chroma-slide/observe";
import type { GameRoomAdapter, RoomHost } from "../../multiplayer/adapter";
import type { PlayerRecord } from "../../multiplayer/types";

type RoomConfig = {
  preset: PresetId;
  /** Present once the puzzle has been dealt, including an explicit set_config seed. */
  seed: number | null;
};

type Serialized = {
  config: RoomConfig;
  configFrozen?: boolean;
  puzzle: PuzzleState | null;
};

const DEFAULT_PRESET: PresetId = "easy";

function freshSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! >>> 0;
}

export function createChromaSlideAdapter(host: RoomHost): GameRoomAdapter {
  let config: RoomConfig = { preset: DEFAULT_PRESET, seed: null };
  let configFrozen = false;
  let puzzle: PuzzleState | null = null;

  const api: GameRoomAdapter = {
    slug: "chroma-slide",
    explicitSeating: true,
    playSeats: ["player"],

    getPublicConfig: () => ({
      preset: config.preset,
      size: PRESETS[config.preset].size,
      colorCount: PRESETS[config.preset].colorCount,
      squareSide: PRESETS[config.preset].squareSide,
      seed: config.seed,
    }),

    hostSeat: () => "player",

    onRecycle: () => {
      puzzle = null;
      config = { preset: DEFAULT_PRESET, seed: null };
      configFrozen = false;
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
      if (!puzzle) return;
      const observation = observationFor(player);
      host.send(ws, "state", { publicState: observation.publicState });
      host.send(ws, "observation", { observation });
      if (host.phase === "over" || observation.publicState.won) {
        host.send(ws, "game_over", gameOverBody());
        return;
      }
      if (canMove(player.seat)) {
        host.send(ws, "your_turn", { observation });
      }
    },

    onSeatClaimed: () => {
      // The shell calls tryStartGame after a changed claim.
    },

    onSetConfig: (ws, _session, payload) => {
      if (configFrozen || host.phase !== "lobby" || puzzle) {
        host.send(ws, "error", { message: "Config locked after room create" });
        return true;
      }
      const next: RoomConfig = { ...config };
      if (payload.preset != null) {
        const preset = normalizePresetId(payload.preset);
        if (!preset) {
          host.send(ws, "error", { message: "preset must be easy, normal, or hard" });
          return true;
        }
        next.preset = preset;
      }
      if (payload.seed != null) {
        if (typeof payload.seed !== "number" || !Number.isInteger(payload.seed) || payload.seed < 0) {
          host.send(ws, "error", { message: "seed must be a non-negative integer" });
          return true;
        }
        next.seed = payload.seed >>> 0;
      }
      config = next;
      configFrozen = true;
      host.broadcastRoom();
      void host.persist();
      return true;
    },

    tryStartGame: () => {
      if (host.phase !== "lobby" || puzzle) return;
      const seated = host.seatedPlayers({ connectedOnly: true });
      const solver = seated.find((p) => p.seat === "player");
      if (!solver) return;

      if (config.seed == null) config.seed = freshSeed();
      configFrozen = true;
      puzzle = newPuzzleWithSeed(config.preset, config.seed);
      host.setPhase("playing");
      for (const p of seated) {
        p.ready = false;
        p.rematch = false;
      }

      const view = publicView();
      host.broadcast("start", {
        phase: "playing",
        config: api.getPublicConfig(),
        yourSeat: "player",
      });
      host.broadcast("state", { publicState: view });
      pushYourTurn();
      host.broadcastRoom();
      void host.persist();
    },

    onMessage: (ws, type, payload) => {
      switch (type) {
        case "ready":
          host.send(ws, "error", { message: "Ready is disabled; the puzzle starts when player sits" });
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
        default:
          return false;
      }
    },

    serialize: (): Serialized => ({
      config,
      configFrozen,
      puzzle,
    }),

    hydrate: (blob: unknown) => {
      puzzle = null;
      config = { preset: DEFAULT_PRESET, seed: null };
      configFrozen = false;
      if (!blob || typeof blob !== "object") return;
      const data = blob as Partial<Serialized>;
      if (data.config && typeof data.config === "object") {
        const preset = normalizePresetId(data.config.preset) ?? DEFAULT_PRESET;
        const seed =
          typeof data.config.seed === "number" && Number.isInteger(data.config.seed) && data.config.seed >= 0
            ? data.config.seed >>> 0
            : null;
        config = { preset, seed };
      }
      configFrozen = Boolean(data.configFrozen);
      const restored = readPuzzle(data.puzzle);
      if (restored) puzzle = restored;
    },
  };

  function handleAct(ws: WebSocket, payload: Record<string, unknown>) {
    const action = actionRecord(payload);
    if (action.type === "move") {
      handleMove(ws, action);
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
    if (host.phase !== "playing" || !puzzle) {
      host.send(ws, "error", { message: "Game not in progress" });
      return;
    }
    if (session.seat !== "player") {
      host.send(ws, "error", { message: "Spectators cannot move" });
      return;
    }
    const row = payload.row;
    const col = payload.col;
    if (
      typeof row !== "number" ||
      typeof col !== "number" ||
      !Number.isInteger(row) ||
      !Number.isInteger(col)
    ) {
      host.send(ws, "error", { message: "Invalid move" });
      return;
    }
    const index = rcToIndex(row, col, puzzle.size);
    if (!isLegalClick(puzzle, index)) {
      host.send(ws, "error", { message: "Invalid move" });
      return;
    }
    const next = clickMove(puzzle, index);
    if (next === puzzle) {
      host.send(ws, "error", { message: "Move rejected" });
      return;
    }
    puzzle = next;
    const solved = isWon(puzzle);
    if (solved) host.setPhase("over");
    const view = publicView();
    const you = youFrom(player);
    host.broadcast("state", { publicState: view });
    host.broadcast("move_applied", {
      action: { type: "move", row, col, index },
      by: you,
      publicState: view,
      effects: [],
      gameOver: solved,
    });
    if (solved) {
      host.broadcast("game_over", gameOverBody());
    } else {
      pushYourTurn();
    }
    host.broadcastRoom();
    void host.persist();
  }

  function youFrom(player: PlayerRecord): ChromaYou {
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
    return buildChromaObservation({
      phase: host.phase,
      you: youFrom(player),
      preset: config.preset,
      seed: config.seed,
      puzzle,
    });
  }

  function publicView(): ChromaPublicState {
    return buildPublicState(config.preset, config.seed, puzzle, host.phase);
  }

  function canMove(seat: Seat): boolean {
    return host.phase === "playing" && !!puzzle && !isWon(puzzle) && seat === "player";
  }

  function pushYourTurn(): void {
    for (const [ws, session] of host.sessions) {
      if (!session.playerId || !canMove(session.seat)) continue;
      const player = host.players.get(session.playerId);
      if (!player) continue;
      host.send(ws, "your_turn", { observation: observationFor(player) });
    }
  }

  function gameOverBody() {
    return {
      winner: "player",
      winnerColor: null,
      winReason: "solved",
      steps: puzzle?.steps ?? 0,
      preset: puzzle?.preset ?? config.preset,
    };
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

function readPuzzle(value: unknown): PuzzleState | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<PuzzleState>;
  const preset = normalizePresetId(data.preset);
  if (!preset) return null;
  const spec = PRESETS[preset];
  if (!Array.isArray(data.board) || data.board.length !== spec.size * spec.size) return null;
  if (typeof data.emptyIndex !== "number" || !Number.isInteger(data.emptyIndex)) return null;
  if (data.emptyIndex < 0 || data.emptyIndex >= data.board.length) return null;
  if (typeof data.steps !== "number" || !Number.isInteger(data.steps) || data.steps < 0) return null;
  const board = data.board.map((cell) => (typeof cell === "number" ? cell : Number.NaN));
  if (board.some((cell) => !Number.isInteger(cell))) return null;
  return {
    preset,
    size: spec.size,
    colorCount: spec.colorCount,
    board,
    emptyIndex: data.emptyIndex,
    steps: data.steps,
  };
}
