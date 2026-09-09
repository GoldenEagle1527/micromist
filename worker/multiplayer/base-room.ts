/**
 * Shared Durable Object room shell: WS accept, join/reclaim, peer_left,
 * recycle when no seated player remains, broadcast helpers.
 *
 * Subclass for each game (or one DO that routes by game slug) and override
 * the abstract hooks for config / start / game messages / reclaim sync.
 */
import { DurableObject } from "cloudflare:workers";
import {
  isSeatedSeat,
  parseRoomId,
  type Phase,
  type Role,
  type RoomPlayer,
  type Seat,
  type WireMsg,
} from "../../shared/multiplayer";

export type SessionAttachment = {
  playerId: string;
  seat: Seat;
  role: Role;
  name: string;
};

export type PlayerRecord = RoomPlayer;

export type JoinResult = {
  seat: Seat;
  role: Role;
};

export abstract class BaseGameRoom<E = Env> extends DurableObject<E> {
  sessions: Map<WebSocket, SessionAttachment> = new Map();
  players: Map<string, PlayerRecord> = new Map();
  phase: Phase = "lobby";
  hostId: string | null = null;
  /** From WS path `/ws/game:code` (set on fetch). */
  gameSlug = "unknown";
  roomCode = "";

  constructor(ctx: DurableObjectState, env: E) {
    super(ctx, env);

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
        if (attachment.role === "host") this.hostId = attachment.playerId;
      }
    }

    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** Public config blob embedded in `room` messages. */
  protected abstract getPublicConfig(): Record<string, unknown>;

  /** Reset game-specific fields when the room is recycled. */
  protected abstract onRecycleGame(): void;

  /**
   * After a seated player reclaims mid-game/over, push game_start / state / etc.
   */
  protected abstract onReclaimSync(ws: WebSocket, player: PlayerRecord): void;

  /** Two seated + connected in lobby → start (or no-op). */
  protected abstract tryStartGame(): void;

  /**
   * Handle game-specific message types. Return true if handled.
   * Base already handles: join, and optional set_config via onSetConfig.
   */
  protected abstract onGameMessage(
    ws: WebSocket,
    type: string,
    payload: Record<string, unknown>,
  ): boolean;

  /** Optional lobby config mutation (host only). Return true if applied. */
  protected onSetConfig(
    _ws: WebSocket,
    _session: SessionAttachment,
    _payload: Record<string, unknown>,
  ): boolean {
    return false;
  }

  /** Host's preferred seat when first player joins (default red). */
  protected hostSeat(): Seat {
    return "red";
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/\/ws\/([^/]+)$/);
    if (match?.[1]) {
      const parsed = parseRoomId(match[1]);
      this.gameSlug = parsed.game;
      this.roomCode = parsed.code;
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const empty: SessionAttachment = {
      playerId: "",
      seat: "spectator",
      role: "spectator",
      name: "",
    };
    server.serializeAttachment(empty);
    this.sessions.set(server, { ...empty });
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
    const payload = (
      msg.payload && typeof msg.payload === "object" ? msg.payload : {}
    ) as Record<string, unknown>;

    if (msg.type === "join") {
      this.handleJoin(ws, payload);
      return;
    }
    if (msg.type === "set_config") {
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
      if (!this.onSetConfig(ws, session, payload)) {
        this.send(ws, "error", { message: "Config not supported" });
      }
      return;
    }

    if (this.onGameMessage(ws, msg.type, payload)) return;
    this.send(ws, "error", { message: `Unknown type: ${msg.type}` });
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.handleDisconnect(ws);
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket) {
    this.handleDisconnect(ws);
  }

  protected handleDisconnect(ws: WebSocket) {
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
        if (isSeatedSeat(session.seat) && (this.phase === "playing" || this.phase === "over")) {
          this.broadcastExcept(ws, "peer_left", {
            playerId: session.playerId,
            seat: session.seat,
          });
        }
        if (!this.anySeatedPlayerConnected()) {
          this.recycleRoom();
          return;
        }
        this.broadcastRoom();
      }
    } else if (!this.anySeatedPlayerConnected() && this.players.size > 0) {
      this.recycleRoom();
    }
  }

  protected anySeatedPlayerConnected(): boolean {
    for (const p of this.players.values()) {
      if (isSeatedSeat(p.seat) && p.connected) return true;
    }
    return false;
  }

  protected recycleRoom() {
    const leftover = [...this.sessions.keys()];
    for (const sock of leftover) {
      this.send(sock, "room_closed", { reason: "双方玩家均已离开，房间已回收" });
      try {
        sock.close(4001, "room recycled");
      } catch {
        /* ignore */
      }
    }
    this.sessions.clear();
    this.players.clear();
    this.phase = "lobby";
    this.hostId = null;
    this.onRecycleGame();
  }

  protected handleJoin(ws: WebSocket, payload: Record<string, unknown>) {
    const playerId = typeof payload.playerId === "string" ? payload.playerId.trim() : "";
    if (!playerId) {
      this.send(ws, "error", { message: "playerId required" });
      return;
    }
    const name =
      typeof payload.name === "string" && payload.name.trim()
        ? payload.name.trim().slice(0, 24)
        : "Player";

    // Optional game slug check from client.
    if (typeof payload.game === "string" && payload.game.trim()) {
      const g = payload.game.trim().toLowerCase();
      if (this.gameSlug !== "unknown" && g !== this.gameSlug) {
        this.send(ws, "error", { message: `Room is for ${this.gameSlug}, not ${g}` });
        return;
      }
    }

    const existing = this.players.get(playerId);
    if (existing && isSeatedSeat(existing.seat)) {
      existing.name = name;
      existing.connected = true;
      const role: Role =
        existing.role === "host" || existing.role === "guest" ? existing.role : "guest";
      existing.role = role;
      this.attach(ws, { playerId, seat: existing.seat, role, name });
      this.send(ws, "welcome", { playerId, seat: existing.seat, role });
      this.sendRoom(ws);
      if (this.phase === "playing" || this.phase === "over") {
        this.onReclaimSync(ws, existing);
      }
      this.broadcastRoom();
      if (this.phase === "lobby") this.tryStartGame();
      return;
    }

    const assigned = this.assignNewSeat(playerId);
    this.players.set(playerId, {
      playerId,
      name,
      seat: assigned.seat,
      role: assigned.role,
      ready: false,
      rematch: false,
      connected: true,
    });
    if (assigned.role === "host") this.hostId = playerId;

    this.attach(ws, {
      playerId,
      seat: assigned.seat,
      role: assigned.role,
      name,
    });
    this.send(ws, "welcome", { playerId, seat: assigned.seat, role: assigned.role });
    this.broadcastRoom();
    if (this.phase === "lobby") this.tryStartGame();
  }

  /** Default 2p seating: host gets hostSeat(), guest the opposite, else spectator. */
  protected assignNewSeat(playerId: string): JoinResult {
    const reservedSeats = [...this.players.values()].filter((p) => isSeatedSeat(p.seat));
    const seatedConnected = reservedSeats.filter((p) => p.connected).length;
    const hostPreferred = this.hostSeat();
    const guestSeat: Seat = hostPreferred === "red" ? "blue" : "red";

    if (reservedSeats.length === 0) {
      return { seat: hostPreferred, role: "host" };
    }
    if (reservedSeats.length === 1 && !reservedSeats.some((p) => p.playerId === playerId)) {
      return { seat: guestSeat, role: "guest" };
    }
    if (seatedConnected < 2 && reservedSeats.length < 2) {
      const taken = new Set(reservedSeats.map((p) => p.seat));
      if (!taken.has(hostPreferred)) return { seat: hostPreferred, role: "host" };
      if (!taken.has(guestSeat)) return { seat: guestSeat, role: "guest" };
    }
    return { seat: "spectator", role: "spectator" };
  }

  protected attach(ws: WebSocket, attachment: SessionAttachment) {
    ws.serializeAttachment(attachment);
    this.sessions.set(ws, attachment);
  }

  protected refreshAttachmentSeat(playerId: string, seat: Seat) {
    for (const [ws, session] of this.sessions) {
      if (session.playerId !== playerId) continue;
      const next = { ...session, seat };
      ws.serializeAttachment(next);
      this.sessions.set(ws, next);
      this.send(ws, "welcome", {
        playerId,
        seat,
        role: next.role,
      });
    }
  }

  protected requireJoined(ws: WebSocket): SessionAttachment | null {
    const session = this.sessions.get(ws);
    if (!session?.playerId) {
      this.send(ws, "error", { message: "Join first" });
      return null;
    }
    return session;
  }

  protected seatedPlayers(opts?: { connectedOnly?: boolean }): PlayerRecord[] {
    return [...this.players.values()].filter(
      (p) => isSeatedSeat(p.seat) && (!opts?.connectedOnly || p.connected),
    );
  }

  protected roomPayload() {
    const players = [...this.players.values()]
      .filter((p) => isSeatedSeat(p.seat) || p.connected)
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
      config: this.getPublicConfig(),
      phase: this.phase,
      game: this.gameSlug,
    };
  }

  protected sendRoom(ws: WebSocket) {
    this.send(ws, "room", this.roomPayload());
  }

  protected broadcastRoom() {
    this.broadcast("room", this.roomPayload());
  }

  protected send(ws: WebSocket, type: string, payload: unknown) {
    try {
      ws.send(JSON.stringify({ type, payload }));
    } catch {
      /* closed */
    }
  }

  protected broadcast(type: string, payload: unknown) {
    const raw = JSON.stringify({ type, payload });
    for (const sock of this.sessions.keys()) {
      try {
        sock.send(raw);
      } catch {
        /* closed */
      }
    }
  }

  protected broadcastExcept(except: WebSocket, type: string, payload: unknown) {
    const raw = JSON.stringify({ type, payload });
    for (const sock of this.sessions.keys()) {
      if (sock === except) continue;
      try {
        sock.send(raw);
      } catch {
        /* closed */
      }
    }
  }
}
