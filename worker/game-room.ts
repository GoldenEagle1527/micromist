import { DurableObject } from "cloudflare:workers";
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

type Seat = "red" | "blue" | "spectator";
type Role = "host" | "guest";
type Phase = "lobby" | "playing" | "over";
type HostColor = "red" | "blue";

type SessionAttachment = {
  playerId: string;
  seat: Seat;
  role: Role | "spectator";
  name: string;
};

type PlayerRecord = {
  playerId: string;
  name: string;
  seat: Seat;
  role: Role | "spectator";
  ready: boolean;
  rematch: boolean;
  connected: boolean;
};

type RoomConfig = {
  boardSize: number;
  winMode: WinMode;
  winParam: number;
  hostColor: HostColor;
};

type WireMsg = {
  type: string;
  payload?: Record<string, unknown>;
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

function colorToSeat(color: PlayerColor): Seat {
  return color === COLOR_RED ? "red" : "blue";
}

function isWinMode(value: unknown): value is WinMode {
  return (
    value === WIN_MODE_ANNIHILATION ||
    value === WIN_MODE_STEPS ||
    value === WIN_MODE_AREA
  );
}

/**
 * Explosive Chess room — one Durable Object per room id.
 *
 * All GameRoom instances currently run 爆炸棋. Room coordination stays
 * in memory (no user DB). SQLite class is enabled only for Workers Free.
 */
export class GameRoom extends DurableObject<Env> {
  sessions: Map<WebSocket, SessionAttachment>;
  players: Map<string, PlayerRecord>;
  config: RoomConfig;
  phase: Phase;
  game: GameInstance | null;
  /** Host playerId (first seated joiner). */
  hostId: string | null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sessions = new Map();
    this.players = new Map();
    this.config = { ...DEFAULT_CONFIG };
    this.phase = "lobby";
    this.game = null;
    this.hostId = null;

    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as SessionAttachment | undefined;
      if (!attachment?.playerId) continue;
      this.sessions.set(ws, { ...attachment });
      const existing = this.players.get(attachment.playerId);
      if (existing) {
        existing.connected = true;
        existing.seat = attachment.seat;
        existing.role = attachment.role;
        existing.name = attachment.name || existing.name;
      } else {
        this.players.set(attachment.playerId, {
          playerId: attachment.playerId,
          name: attachment.name || "Player",
          seat: attachment.seat,
          role: attachment.role,
          ready: false,
          rematch: false,
          connected: true,
        });
        if (attachment.role === "host") {
          this.hostId = attachment.playerId;
        }
      }
    }

    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    // Attachment filled on `join`.
    server.serializeAttachment({
      playerId: "",
      seat: "spectator",
      role: "spectator",
      name: "",
    } satisfies SessionAttachment);
    this.sessions.set(server, {
      playerId: "",
      seat: "spectator",
      role: "spectator",
      name: "",
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") {
      this.send(ws, "error", { message: "Expected JSON text frames" });
      return;
    }

    let msg: WireMsg;
    try {
      msg = JSON.parse(message) as WireMsg;
    } catch {
      this.send(ws, "error", { message: "Invalid JSON" });
      return;
    }

    if (!msg || typeof msg.type !== "string") {
      this.send(ws, "error", { message: "Missing type" });
      return;
    }

    const payload = (msg.payload && typeof msg.payload === "object" ? msg.payload : {}) as Record<
      string,
      unknown
    >;

    switch (msg.type) {
      case "join":
        this.handleJoin(ws, payload);
        break;
      case "set_config":
        this.handleSetConfig(ws, payload);
        break;
      case "ready":
        this.handleReady(ws);
        break;
      case "move":
        this.handleMove(ws, payload);
        break;
      case "surrender":
        this.handleSurrender(ws);
        break;
      case "rematch":
        this.handleRematch(ws);
        break;
      default:
        this.send(ws, "error", { message: `Unknown type: ${msg.type}` });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    const session = this.sessions.get(ws);
    this.sessions.delete(ws);

    if (session?.playerId) {
      const stillOpen = [...this.sessions.values()].some((s) => s.playerId === session.playerId);
      if (!stillOpen) {
        const player = this.players.get(session.playerId);
        if (player) {
          player.connected = false;
          player.ready = false;
        }
        if (this.phase === "playing" && (session.seat === "red" || session.seat === "blue")) {
          this.broadcastExcept(ws, "peer_left", {
            playerId: session.playerId,
            seat: session.seat,
          });
        } else if (this.phase === "lobby") {
          this.broadcastRoom();
        }
      }
    }

    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket) {
    this.sessions.delete(ws);
  }

  // --- handlers ---

  private handleJoin(ws: WebSocket, payload: Record<string, unknown>) {
    const playerId = typeof payload.playerId === "string" ? payload.playerId.trim() : "";
    if (!playerId) {
      this.send(ws, "error", { message: "playerId required" });
      return;
    }
    // password is accepted but currently ignored (optional / skipped).
    const name =
      typeof payload.name === "string" && payload.name.trim()
        ? payload.name.trim().slice(0, 24)
        : "Player";

    const existing = this.players.get(playerId);
    if (existing && (existing.seat === "red" || existing.seat === "blue")) {
      // Reclaim seat after hibernation / reconnect.
      existing.name = name;
      existing.connected = true;
      const role = existing.role === "host" || existing.role === "guest" ? existing.role : "guest";
      this.attach(ws, {
        playerId,
        seat: existing.seat,
        role,
        name,
      });
      this.send(ws, "welcome", { playerId, seat: existing.seat, role });
      this.sendRoom(ws);
      if (this.phase === "playing" || this.phase === "over") {
        const yourColor = seatToColor(existing.seat);
        if (yourColor && this.game) {
          this.send(ws, "game_start", {
            config: this.publicConfig(),
            yourColor: colorToSeat(yourColor),
          });
          this.send(ws, "state", {
            fullState: this.game.getFullState(),
          });
          if (this.phase === "over") {
            this.send(ws, "game_over", {
              winner: this.game.winner,
              winReason: this.game.winReason,
            });
          }
        }
      }
      this.broadcastRoom();
      return;
    }

    const seatedCount = [...this.players.values()].filter(
      (p) => (p.seat === "red" || p.seat === "blue") && p.connected,
    ).length;
    // Also count disconnected seated players still holding a seat mid-game.
    const reservedSeats = [...this.players.values()].filter(
      (p) => p.seat === "red" || p.seat === "blue",
    );

    let seat: Seat = "spectator";
    let role: Role | "spectator" = "spectator";

    if (reservedSeats.length === 0) {
      seat = this.config.hostColor;
      role = "host";
      this.hostId = playerId;
    } else if (reservedSeats.length === 1 && !reservedSeats.some((p) => p.playerId === playerId)) {
      const hostSeat = this.config.hostColor;
      seat = hostSeat === "red" ? "blue" : "red";
      role = "guest";
    } else if (seatedCount < 2 && reservedSeats.length < 2) {
      const taken = new Set(reservedSeats.map((p) => p.seat));
      const hostSeat = this.config.hostColor;
      const guestSeat: Seat = hostSeat === "red" ? "blue" : "red";
      if (!taken.has(hostSeat)) {
        seat = hostSeat;
        role = "host";
        this.hostId = playerId;
      } else if (!taken.has(guestSeat)) {
        seat = guestSeat;
        role = "guest";
      }
    }

    this.players.set(playerId, {
      playerId,
      name,
      seat,
      role,
      ready: false,
      rematch: false,
      connected: true,
    });

    this.attach(ws, { playerId, seat, role, name });
    this.send(ws, "welcome", { playerId, seat, role });
    this.broadcastRoom();
  }

  private handleSetConfig(ws: WebSocket, payload: Record<string, unknown>) {
    const session = this.requireJoined(ws);
    if (!session) return;
    if (this.phase !== "lobby") {
      this.send(ws, "error", { message: "Config locked after start" });
      return;
    }
    if (session.role !== "host") {
      this.send(ws, "error", { message: "Only host can set config" });
      return;
    }

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

    // Reassign seated colors when hostColor changes.
    const host = this.hostId ? this.players.get(this.hostId) : null;
    const guest = [...this.players.values()].find((p) => p.role === "guest");
    if (host && (host.seat === "red" || host.seat === "blue")) {
      host.seat = next.hostColor;
      this.refreshAttachmentSeat(host.playerId, host.seat);
    }
    if (guest && (guest.seat === "red" || guest.seat === "blue")) {
      guest.seat = next.hostColor === "red" ? "blue" : "red";
      this.refreshAttachmentSeat(guest.playerId, guest.seat);
    }

    // Clear ready when config changes.
    for (const p of this.players.values()) {
      if (p.seat === "red" || p.seat === "blue") p.ready = false;
    }

    this.broadcastRoom();
  }

  private handleReady(ws: WebSocket) {
    const session = this.requireJoined(ws);
    if (!session) return;
    if (this.phase !== "lobby") {
      this.send(ws, "error", { message: "Not in lobby" });
      return;
    }
    if (session.seat !== "red" && session.seat !== "blue") {
      this.send(ws, "error", { message: "Spectators cannot ready" });
      return;
    }
    const player = this.players.get(session.playerId);
    if (!player) return;
    player.ready = true;
    this.broadcastRoom();
    this.tryStartGame();
  }

  private tryStartGame() {
    const seated = [...this.players.values()].filter(
      (p) => (p.seat === "red" || p.seat === "blue") && p.connected,
    );
    if (seated.length < 2) return;
    if (!seated.every((p) => p.ready)) return;

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
      if (session.seat !== "red" && session.seat !== "blue") continue;
      this.send(ws, "game_start", {
        config: this.publicConfig(),
        yourColor: session.seat,
      });
    }

    this.broadcast("state", {
      fullState: this.game.getFullState(),
    });
    this.broadcastRoom();
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
    if (session.seat !== "red" && session.seat !== "blue") {
      this.send(ws, "error", { message: "Spectators cannot rematch" });
      return;
    }
    const player = this.players.get(session.playerId);
    if (!player) return;
    player.rematch = true;

    const seated = [...this.players.values()].filter(
      (p) => (p.seat === "red" || p.seat === "blue") && p.connected,
    );
    if (seated.length >= 2 && seated.every((p) => p.rematch)) {
      this.phase = "lobby";
      this.game = null;
      for (const p of seated) {
        p.ready = false;
        p.rematch = false;
      }
      this.broadcastRoom();
      return;
    }
    this.broadcastRoom();
  }

  // --- helpers ---

  private attach(ws: WebSocket, attachment: SessionAttachment) {
    ws.serializeAttachment(attachment);
    this.sessions.set(ws, attachment);
  }

  private refreshAttachmentSeat(playerId: string, seat: Seat) {
    for (const [ws, session] of this.sessions) {
      if (session.playerId !== playerId) continue;
      const next = { ...session, seat };
      ws.serializeAttachment(next);
      this.sessions.set(ws, next);
      // Re-welcome so client knows new seat/color.
      this.send(ws, "welcome", {
        playerId,
        seat,
        role: next.role,
      });
    }
  }

  private requireJoined(ws: WebSocket): SessionAttachment | null {
    const session = this.sessions.get(ws);
    if (!session?.playerId) {
      this.send(ws, "error", { message: "Join first" });
      return null;
    }
    return session;
  }

  private publicConfig() {
    return {
      boardSize: this.config.boardSize,
      winMode: this.config.winMode,
      winParam: this.config.winParam,
      hostColor: this.config.hostColor,
    };
  }

  private roomPayload() {
    const players = [...this.players.values()]
      .filter((p) => p.seat === "red" || p.seat === "blue" || p.connected)
      .map((p) => ({
        playerId: p.playerId,
        name: p.name,
        seat: p.seat,
        role: p.role,
        ready: p.ready,
        rematch: p.rematch,
        connected: p.connected,
      }));
    return {
      players,
      config: this.publicConfig(),
      phase: this.phase,
    };
  }

  private sendRoom(ws: WebSocket) {
    this.send(ws, "room", this.roomPayload());
  }

  private broadcastRoom() {
    this.broadcast("room", this.roomPayload());
  }

  private send(ws: WebSocket, type: string, payload: unknown) {
    try {
      ws.send(JSON.stringify({ type, payload }));
    } catch {
      /* closed */
    }
  }

  private broadcast(type: string, payload: unknown) {
    const raw = JSON.stringify({ type, payload });
    for (const ws of this.sessions.keys()) {
      try {
        ws.send(raw);
      } catch {
        /* closed */
      }
    }
  }

  private broadcastExcept(except: WebSocket, type: string, payload: unknown) {
    const raw = JSON.stringify({ type, payload });
    for (const ws of this.sessions.keys()) {
      if (ws === except) continue;
      try {
        ws.send(raw);
      } catch {
        /* closed */
      }
    }
  }
}
