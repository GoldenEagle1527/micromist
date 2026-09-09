/**
 * Explosive Chess room — extends shared BaseGameRoom.
 * Game rules / config / moves live here; join / recycle / peer_left stay in the base.
 */
import {
  COLOR_BLUE,
  COLOR_RED,
  WIN_MODE_ANNIHILATION,
  WIN_MODE_AREA,
  WIN_MODE_STEPS,
  createGame,
  type GameConfig,
  type GameInstance,
  type PlayerColor,
  type WinMode,
} from "../shared/explosive-chess/engine";
import { isSeatedSeat, type Seat } from "../shared/multiplayer";
import {
  BaseGameRoom,
  type PlayerRecord,
  type SessionAttachment,
} from "./multiplayer/base-room";

type HostColor = "red" | "blue";

type RoomConfig = {
  boardSize: number;
  winMode: WinMode;
  winParam: number;
  hostColor: HostColor;
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

export class GameRoom extends BaseGameRoom<Env> {
  config: RoomConfig = { ...DEFAULT_CONFIG };
  game: GameInstance | null = null;

  protected getPublicConfig(): Record<string, unknown> {
    return {
      boardSize: this.config.boardSize,
      winMode: this.config.winMode,
      winParam: this.config.winParam,
      hostColor: this.config.hostColor,
    };
  }

  protected hostSeat(): Seat {
    return this.config.hostColor;
  }

  protected onRecycleGame(): void {
    this.game = null;
    this.config = { ...DEFAULT_CONFIG };
  }

  protected onReclaimSync(ws: WebSocket, player: PlayerRecord): void {
    const yourColor = seatToColor(player.seat);
    if (!yourColor || !this.game) return;
    this.send(ws, "game_start", {
      config: this.getPublicConfig(),
      yourColor: player.seat === "blue" ? "blue" : "red",
    });
    this.send(ws, "state", { fullState: this.game.getFullState() });
    if (this.phase === "over") {
      this.send(ws, "game_over", {
        winner: this.game.winner,
        winReason: this.game.winReason,
      });
    }
  }

  protected onSetConfig(
    _ws: WebSocket,
    _session: SessionAttachment,
    payload: Record<string, unknown>,
  ): boolean {
    const next = { ...this.config };
    if (typeof payload.boardSize === "number" && [9, 11, 13].includes(payload.boardSize)) {
      next.boardSize = payload.boardSize;
    }
    if (isWinMode(payload.winMode)) {
      next.winMode = payload.winMode;
    }
    if (typeof payload.winParam === "number" && payload.winParam >= 1) {
      next.winParam = Math.floor(payload.winParam);
    }
    if (payload.hostColor === "red" || payload.hostColor === "blue") {
      next.hostColor = payload.hostColor;
    }
    this.config = next;

    const host = this.hostId ? this.players.get(this.hostId) : null;
    const guest = [...this.players.values()].find((p) => p.role === "guest");
    if (host && isSeatedSeat(host.seat)) {
      host.seat = next.hostColor;
      this.refreshAttachmentSeat(host.playerId, host.seat);
    }
    if (guest && isSeatedSeat(guest.seat)) {
      guest.seat = next.hostColor === "red" ? "blue" : "red";
      this.refreshAttachmentSeat(guest.playerId, guest.seat);
    }
    this.broadcastRoom();
    return true;
  }

  protected tryStartGame(): void {
    const seated = this.seatedPlayers({ connectedOnly: true });
    if (seated.length < 2) return;

    const winParam =
      this.config.winMode === WIN_MODE_ANNIHILATION ? undefined : this.config.winParam;
    const gameConfig: GameConfig = {
      boardSize: this.config.boardSize,
      winMode: this.config.winMode,
      winParam,
    };
    this.game = createGame(gameConfig);
    this.phase = "playing";
    for (const p of seated) {
      p.ready = false;
      p.rematch = false;
    }

    for (const [ws, session] of this.sessions) {
      if (!isSeatedSeat(session.seat)) continue;
      this.send(ws, "game_start", {
        config: this.getPublicConfig(),
        yourColor: session.seat,
      });
    }

    this.broadcast("state", { fullState: this.game.getFullState() });
    this.broadcastRoom();
  }

  protected onGameMessage(
    ws: WebSocket,
    type: string,
    payload: Record<string, unknown>,
  ): boolean {
    switch (type) {
      case "ready":
        this.send(ws, "error", { message: "Ready is disabled; game starts with 2 players" });
        return true;
      case "move":
        this.handleMove(ws, payload);
        return true;
      case "surrender":
        this.handleSurrender(ws);
        return true;
      case "rematch":
        this.handleRematch(ws);
        return true;
      default:
        return false;
    }
  }

  private handleMove(ws: WebSocket, payload: Record<string, unknown>) {
    const session = this.requireJoined(ws);
    if (!session) return;
    if (this.phase !== "playing" || !this.game) {
      this.send(ws, "error", { message: "Game not in progress" });
      return;
    }
    const color = seatToColor(session.seat);
    if (color === null) {
      this.send(ws, "error", { message: "Spectators cannot move" });
      return;
    }
    if (this.game.currentTurn !== color) {
      this.send(ws, "error", { message: "Not your turn" });
      return;
    }
    const row = typeof payload.row === "number" ? payload.row : -1;
    const col = typeof payload.col === "number" ? payload.col : -1;
    if (!this.game.isValidMove(row, col, color)) {
      this.send(ws, "error", { message: "Invalid move" });
      return;
    }
    const result = this.game.makeMove(row, col, color);
    if (!result) {
      this.send(ws, "error", { message: "Move rejected" });
      return;
    }

    this.broadcast("state", {
      fullState: this.game.getFullState(),
      lastMove: { row, col },
      animationFrames: result.animationFrames,
    });

    if (result.gameOver) {
      this.phase = "over";
      this.broadcast("game_over", {
        winner: result.winner,
        winReason: result.winReason,
      });
      this.broadcastRoom();
    }
  }

  private handleSurrender(ws: WebSocket) {
    const session = this.requireJoined(ws);
    if (!session) return;
    if (this.phase !== "playing" || !this.game) {
      this.send(ws, "error", { message: "Game not in progress" });
      return;
    }
    const color = seatToColor(session.seat);
    if (color === null) {
      this.send(ws, "error", { message: "Spectators cannot surrender" });
      return;
    }
    const winner: PlayerColor = color === COLOR_RED ? COLOR_BLUE : COLOR_RED;
    this.game.forceGameOver(winner, "对手投降");
    this.phase = "over";
    this.broadcast("state", { fullState: this.game.getFullState() });
    this.broadcast("game_over", {
      winner,
      winReason: "对手投降",
    });
    this.broadcastRoom();
  }

  private handleRematch(ws: WebSocket) {
    const session = this.requireJoined(ws);
    if (!session) return;
    if (this.phase !== "over") {
      this.send(ws, "error", { message: "Rematch only after game over" });
      return;
    }
    if (!isSeatedSeat(session.seat)) {
      this.send(ws, "error", { message: "Spectators cannot rematch" });
      return;
    }
    const player = this.players.get(session.playerId);
    if (!player) return;
    player.rematch = true;

    const seated = this.seatedPlayers({ connectedOnly: true });
    if (seated.length >= 2 && seated.every((p) => p.rematch)) {
      for (const p of seated) {
        p.rematch = false;
        p.ready = false;
      }
      this.game = null;
      this.phase = "lobby";
      this.broadcastRoom();
      this.tryStartGame();
      return;
    }
    this.broadcastRoom();
  }
}
