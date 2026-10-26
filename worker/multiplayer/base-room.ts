/**
 * Single Durable Object shell for all micromist multiplayer games.
 *
 * - DO name: `gameSlug:code` (via getByName)
 * - Shared: WS, join/reclaim, peer_left, recycle when no seated player online
 * - Per-game: GameRoomAdapter from registry
 * - Persistence: SQLite storage snapshot so hibernation does not wipe mid-game
 */
import { DurableObject } from "cloudflare:workers";
import {
  isSeatedSeat,
  normalizePlayerKind,
  parseRoomId,
  playerKindFromJoin,
  type Phase,
  type Role,
  type Seat,
  type WireMsg,
} from "../../shared/multiplayer";
import type { GameRoomAdapter, RoomHost } from "./adapter";
import { overlayLiveSockets, replacePlayersFromSnapshot } from "./presence";
import { getGameAdapterFactory } from "./registry";
import { decideClaim, type PlaySeat } from "./seating";
import type { JoinResult, PersistedRoom, PlayerRecord, SessionAttachment } from "./types";

export type { PlayerRecord, SessionAttachment, JoinResult, PersistedRoom };

const STORAGE_KEY = "room_v1";

export class GameRoom extends DurableObject<Env> {
  sessions: Map<WebSocket, SessionAttachment> = new Map();
  players: Map<string, PlayerRecord> = new Map();
  phase: Phase = "lobby";
  hostId: string | null = null;
  gameSlug = "unknown";
  roomCode = "";
  private adapter: GameRoomAdapter | null = null;
  private ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    const name = this.ctx.id.name;
    if (name) {
      const parsed = parseRoomId(name);
      this.gameSlug = parsed.game;
      this.roomCode = parsed.code;
    }

    // Snapshot reload marks every seat offline. Overlay hibernated sockets
    // after that await, still inside this gate, so a later guest join sees
    // the host's open socket. Scanning getWebSockets() before restore loses
    // the pass: restore() clears the map and writes connected: false.
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      await this.restore();
      this.attachHibernatedSockets();
      this.ensureAdapter();
    });

    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** Live sockets win over the persisted `connected: false` flag. */
  private attachHibernatedSockets(): void {
    const open = [...this.ctx.getWebSockets()].map((socket) => ({
      socket,
      attachment: socket.deserializeAttachment() as SessionAttachment | undefined,
    }));
    const newHostId = overlayLiveSockets(this.players, this.sessions, open);
    if (newHostId) this.hostId = newHostId;
  }

  private ensureAdapter(): void {
    if (this.adapter) return;
    if (this.gameSlug === "unknown") return;
    const factory = getGameAdapterFactory(this.gameSlug);
    if (!factory) return;
    this.adapter = factory(this.asHost());
  }

  private asHost(): RoomHost {
    const room = this;
    return {
      get phase() {
        return room.phase;
      },
      setPhase(phase) {
        room.phase = phase;
      },
      get players() {
        return room.players;
      },
      get sessions() {
        return room.sessions;
      },
      get hostId() {
        return room.hostId;
      },
      set hostId(v) {
        room.hostId = v;
      },
      get gameSlug() {
        return room.gameSlug;
      },
      get roomCode() {
        return room.roomCode;
      },
      send: (ws, type, payload) => room.send(ws, type, payload),
      broadcast: (type, payload) => room.broadcast(type, payload),
      broadcastRoom: () => room.broadcastRoom(),
      seatedPlayers: (opts) => room.seatedPlayers(opts),
      requireJoined: (ws) => room.requireJoined(ws),
      refreshAttachmentSeat: (id, seat) => room.refreshAttachmentSeat(id, seat),
      persist: () => room.persist(),
    };
  }

  private async restore(): Promise<void> {
    const snap = await this.ctx.storage.get<PersistedRoom>(STORAGE_KEY);
    if (!snap || snap.v !== 1) return;
    if (snap.gameSlug) this.gameSlug = snap.gameSlug;
    if (snap.roomCode) this.roomCode = snap.roomCode;
    this.phase = snap.phase ?? "lobby";
    this.hostId = snap.hostId ?? null;
    // Seats survive hibernation. Presence does not — attachHibernatedSockets()
    // sets connected from sockets that are still open.
    replacePlayersFromSnapshot(this.players, snap.players ?? []);
    this.ensureAdapter();
    this.adapter?.hydrate(snap.adapter);
  }

  async persist(): Promise<void> {
    if (this.gameSlug === "unknown") return;
    const snap: PersistedRoom = {
      v: 1,
      gameSlug: this.gameSlug,
      roomCode: this.roomCode,
      phase: this.phase,
      hostId: this.hostId,
      players: [...this.players.values()].map((p) => ({
        ...p,
        // Persist seat reservation; connected is live-only.
        connected: false,
        ready: false,
      })),
      adapter: this.adapter?.serialize() ?? null,
    };
    await this.ctx.storage.put(STORAGE_KEY, snap);
  }

  private async clearStorage(): Promise<void> {
    await this.ctx.storage.delete(STORAGE_KEY);
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);
    const match = url.pathname.match(/\/ws\/([^/]+)$/);
    if (match?.[1]) {
      const parsed = parseRoomId(match[1]);
      this.gameSlug = parsed.game;
      this.roomCode = parsed.code;
    }
    this.ensureAdapter();
    if (!this.adapter) {
      return Response.json(
        { error: `Unknown game: ${this.gameSlug}` },
        { status: 404 },
      );
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const empty: SessionAttachment = {
      playerId: "",
      seat: "spectator",
      role: "spectator",
      name: "",
      kind: "human",
    };
    server.serializeAttachment(empty);
    this.sessions.set(server, { ...empty });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    await this.ready;
    this.ensureAdapter();
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
    if (!this.adapter) {
      this.send(ws, "error", { message: `Unknown game: ${this.gameSlug}` });
      return;
    }
    if (msg.type === "set_config") {
      const session = this.requireJoined(ws);
      if (!session) return;
      if (this.phase !== "lobby") {
        this.send(ws, "error", { message: "Config locked after start" });
        return;
      }
      if (!this.canConfigure(session)) {
        this.send(ws, "error", { message: "Only host can set config" });
        return;
      }
      if (!this.adapter.onSetConfig(ws, session, payload)) {
        this.send(ws, "error", { message: "Config not supported" });
      }
      return;
    }
    if (
      this.adapter.explicitSeating &&
      (msg.type === "claim_seat" || msg.type === "sit")
    ) {
      this.handleClaimSeat(ws, payload);
      return;
    }

    if (this.adapter.onMessage(ws, msg.type, payload)) return;
    this.send(ws, "error", { message: `Unknown type: ${msg.type}` });
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    await this.ready;
    this.handleDisconnect(ws);
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket) {
    await this.ready;
    this.handleDisconnect(ws);
  }

  private handleDisconnect(ws: WebSocket) {
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
          void this.recycleRoom();
          return;
        }
        this.broadcastRoom();
        void this.persist();
      }
    } else if (!this.anySeatedPlayerConnected() && this.players.size > 0) {
      void this.recycleRoom();
    }
  }

  private anySeatedPlayerConnected(): boolean {
    for (const p of this.players.values()) {
      if (isSeatedSeat(p.seat) && p.connected) return true;
    }
    return false;
  }

  private async recycleRoom() {
    const leftover = [...this.sessions.keys()];
    for (const sock of leftover) {
      this.send(sock, "room_closed", { reason: "room_recycled" });
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
    this.adapter?.onRecycle();
    // Keep adapter instance for same gameSlug; just cleared its state.
    await this.clearStorage();
  }

  private handleJoin(ws: WebSocket, payload: Record<string, unknown>) {
    this.ensureAdapter();
    if (!this.adapter) {
      this.send(ws, "error", { message: `Unknown game: ${this.gameSlug}` });
      return;
    }

    const playerId = typeof payload.playerId === "string" ? payload.playerId.trim() : "";
    if (!playerId) {
      this.send(ws, "error", { message: "playerId required" });
      return;
    }
    const name =
      typeof payload.name === "string" && payload.name.trim()
        ? payload.name.trim().slice(0, 24)
        : "Player";

    if (typeof payload.game === "string" && payload.game.trim()) {
      const g = payload.game.trim().toLowerCase();
      if (this.gameSlug !== "unknown" && g !== this.gameSlug) {
        this.send(ws, "error", { message: `Room is for ${this.gameSlug}, not ${g}` });
        return;
      }
    }

    const existing = this.players.get(playerId);
    const kind = playerKindFromJoin(payload.kind, existing?.kind);
    // Same playerId is the same person: red, blue, or spectator. A new id is not.
    if (existing) {
      existing.name = name;
      existing.connected = true;
      existing.kind = kind;
      const role: Role =
        existing.role === "host" || existing.role === "guest" || existing.role === "spectator"
          ? existing.role
          : "spectator";
      existing.role = role;
      this.attach(ws, { playerId, seat: existing.seat, role, name, kind });
      this.send(ws, "welcome", this.welcomeBody(playerId, existing.seat, role, kind));
      this.adapter.onSeated?.(ws, existing, { reclaimed: true });
      this.sendRoom(ws);
      if (this.phase === "playing" || this.phase === "over") {
        this.adapter.onReclaimSync(ws, existing);
      }
      this.broadcastRoom();
      if (this.phase === "lobby") this.adapter.tryStartGame();
      void this.persist();
      return;
    }

    const assigned = this.adapter.explicitSeating
      ? ({ seat: "spectator", role: "spectator" } as JoinResult)
      : this.assignNewSeat(playerId);
    const player: PlayerRecord = {
      playerId,
      name,
      seat: assigned.seat,
      role: assigned.role,
      ready: false,
      rematch: false,
      connected: true,
      kind,
    };
    this.players.set(playerId, player);
    // First person in the room may set config even while they are still a spectator.
    if (!this.hostId) this.hostId = playerId;

    this.attach(ws, {
      playerId,
      seat: assigned.seat,
      role: assigned.role,
      name,
      kind,
    });
    this.send(ws, "welcome", this.welcomeBody(playerId, assigned.seat, assigned.role, kind));
    this.adapter.onSeated?.(ws, player, { reclaimed: false });
    this.sendRoom(ws);
    if (this.phase === "playing" || this.phase === "over") {
      this.adapter.onReclaimSync(ws, player);
    }
    this.broadcastRoom();
    if (this.phase === "lobby") this.adapter.tryStartGame();
    void this.persist();
  }

  /**
   * Config host is `hostId` (the first connection's playerId), not the red seat
   * and not whoever called create_room. Explosive-chess claim_seat sets role
   * "host" only for that same id, so a blue seat can be the config host and a
   * red seat can be a guest. Claiming a color does not move hostId. The wire
   * field `canConfig` is hostId === playerId. A guest (canConfig false) cannot
   * set config. Phase must still be lobby; the second claimed seat starts the
   * match and locks config for everyone, including the config host.
   */
  private canConfigure(session: SessionAttachment): boolean {
    return session.role === "host" || session.playerId === this.hostId;
  }

  private welcomeBody(playerId: string, seat: Seat, role: Role, kind: SessionAttachment["kind"]) {
    return {
      playerId,
      seat,
      role,
      kind: normalizePlayerKind(kind),
      canConfig: this.hostId === playerId,
    };
  }

  private handleClaimSeat(ws: WebSocket, payload: Record<string, unknown>) {
    const session = this.requireJoined(ws);
    if (!session) return;
    const raw = typeof payload.seat === "string" ? payload.seat.trim().toLowerCase() : "";
    if (raw !== "red" && raw !== "blue") {
      this.send(ws, "error", { message: "seat must be red or blue" });
      return;
    }
    const seat = raw as PlaySeat;
    const player = this.players.get(session.playerId);
    if (!player) {
      this.send(ws, "error", { message: "Join first" });
      return;
    }
    const decision = decideClaim({
      phase: this.phase,
      hostId: this.hostId,
      player,
      seat,
      players: this.players.values(),
    });
    if (!decision.ok) {
      this.send(ws, "error", { message: decision.message });
      return;
    }
    if (decision.changed) {
      player.seat = decision.seat;
      player.role = decision.role;
      player.ready = false;
      player.rematch = false;
    }
    this.refreshAttachmentSeat(player.playerId, player.seat, player.role);
    this.send(ws, "seated", {
      playerId: player.playerId,
      name: player.name,
      seat: player.seat,
      role: player.role,
      kind: normalizePlayerKind(player.kind),
      changed: decision.changed,
      canConfig: this.hostId === player.playerId,
      you: {
        playerId: player.playerId,
        name: player.name,
        seat: player.seat,
        role: player.role,
        kind: normalizePlayerKind(player.kind),
        color: player.seat === "red" || player.seat === "blue" ? player.seat : null,
        canConfig: this.hostId === player.playerId,
      },
    });
    this.adapter?.onSeatClaimed?.(ws, player, { changed: decision.changed });
    this.broadcastRoom();
    if (decision.changed && this.phase === "lobby") this.adapter?.tryStartGame();
    void this.persist();
  }

  private assignNewSeat(playerId: string): JoinResult {
    const hostPreferred = this.adapter?.hostSeat() ?? "red";
    const reservedSeats = [...this.players.values()].filter((p) => isSeatedSeat(p.seat));
    const seatedConnected = reservedSeats.filter((p) => p.connected).length;
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

  private attach(ws: WebSocket, attachment: SessionAttachment) {
    ws.serializeAttachment(attachment);
    this.sessions.set(ws, attachment);
  }

  refreshAttachmentSeat(playerId: string, seat: Seat, role?: Role) {
    for (const [ws, session] of this.sessions) {
      if (session.playerId !== playerId) continue;
      const next = { ...session, seat, role: role ?? session.role };
      ws.serializeAttachment(next);
      this.sessions.set(ws, next);
      this.send(ws, "welcome", this.welcomeBody(playerId, next.seat, next.role, next.kind));
    }
  }

  requireJoined(ws: WebSocket): SessionAttachment | null {
    const session = this.sessions.get(ws);
    if (!session?.playerId) {
      this.send(ws, "error", { message: "Join first" });
      return null;
    }
    return session;
  }

  seatedPlayers(opts?: { connectedOnly?: boolean }): PlayerRecord[] {
    return [...this.players.values()].filter(
      (p) => isSeatedSeat(p.seat) && (!opts?.connectedOnly || p.connected),
    );
  }

  private roomPayload() {
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
        kind: normalizePlayerKind(p.kind),
      }));
    return {
      players,
      config: this.adapter?.getPublicConfig() ?? {},
      phase: this.phase,
      game: this.gameSlug,
    };
  }

  sendRoom(ws: WebSocket) {
    this.send(ws, "room", this.roomPayload());
  }

  broadcastRoom() {
    this.broadcast("room", this.roomPayload());
  }

  send(ws: WebSocket, type: string, payload: unknown) {
    try {
      ws.send(JSON.stringify({ type, payload }));
    } catch {
      /* closed */
    }
  }

  broadcast(type: string, payload: unknown) {
    const raw = JSON.stringify({ type, payload });
    for (const sock of this.sessions.keys()) {
      try {
        sock.send(raw);
      } catch {
        /* closed */
      }
    }
  }

  private broadcastExcept(except: WebSocket, type: string, payload: unknown) {
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
