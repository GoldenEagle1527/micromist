/**
 * One explosive-chess seat on the room WebSocket.
 * The MCP process (stdio, or the session Durable Object) holds this socket
 * from join until the session closes. Humans on the website stay on their own sockets.
 * row,col is accepted only when it is already in the server's legalActions.
 * This module does not search the board or choose a move.
 */
import { generateRoomCode } from "../multiplayer";
import { explosiveChessWsUrl } from "./agent-guide";
import {
  boardSizeFromCounts,
  effectsFromAnimationFrames,
  readExplosionEffects,
  type ExplosionEffect,
} from "./observe";

function explosiveChessPlayUrl(origin: string, roomCode: string): string {
  const code = roomCode.trim().toLowerCase();
  return `${new URL(origin).origin}/play/explosive-chess?room=${code}`;
}

export const JOIN_TIMEOUT_MS = 10_000;
export const ACK_TIMEOUT_MS = 8_000;
export const PING_INTERVAL_MS = 20_000;

export type RoomSocket = {
  send(data: string): void;
  close(): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: () => void): void;
};

export type DialRoom = (wsUrl: string) => Promise<RoomSocket>;

export type SeatMemory = {
  v: 1;
  origin: string;
  roomCode: string;
  playerId: string;
  name: string;
  configSent: boolean;
};

export type ToolBody = Record<string, unknown>;

type YouView = {
  playerId: string;
  name: string;
  seat: string;
  role: string;
  kind: string;
  color: string | null;
};

type LegalAction = { type: "move"; row: number; col: number };

type Wire = { type?: string; payload?: unknown };

type SessionOptions = {
  origin: string;
  dial: DialRoom;
  onSeat?: (memory: SeatMemory | null) => void;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readLegalActions(value: unknown): LegalAction[] {
  if (!Array.isArray(value)) return [];
  const out: LegalAction[] = [];
  for (const item of value) {
    const rec = asRecord(item);
    if (!rec || rec.type !== "move") continue;
    if (typeof rec.row !== "number" || typeof rec.col !== "number") continue;
    if (!Number.isInteger(rec.row) || !Number.isInteger(rec.col)) continue;
    out.push({ type: "move", row: rec.row, col: rec.col });
  }
  return out;
}

function readYou(value: Record<string, unknown>): YouView {
  const seat = typeof value.seat === "string" ? value.seat : "spectator";
  const color = value.color === "red" || value.color === "blue" ? value.color : null;
  return {
    playerId: typeof value.playerId === "string" ? value.playerId : "",
    name: typeof value.name === "string" ? value.name : "",
    seat,
    role: typeof value.role === "string" ? value.role : "spectator",
    kind: value.kind === "agent" ? "agent" : "human",
    color,
  };
}

export function parseMatchConfig(input: unknown): ToolBody | string {
  const rec = asRecord(input);
  if (!rec) return "config object required";
  const { boardSize, winMode, winParam, hostColor } = rec;
  if (boardSize !== 9 && boardSize !== 11 && boardSize !== 13) {
    return "boardSize must be 9, 11, or 13";
  }
  if (winMode !== "annihilation" && winMode !== "steps" && winMode !== "area") {
    return "winMode must be annihilation, steps, or area";
  }
  if (typeof winParam !== "number" || !Number.isInteger(winParam) || winParam < 1) {
    return "winParam must be an integer >= 1";
  }
  if (hostColor !== "red" && hostColor !== "blue") return "hostColor must be red or blue";
  return { boardSize, winMode, winParam, hostColor };
}

function nodeProcess(): { versions?: { node?: string } } | undefined {
  return (globalThis as { process?: { versions?: { node?: string } } }).process;
}

/** Node tests and stdio must not stay alive on the ping timer alone. Workers keep it. */
function unrefInNode(timer: ReturnType<typeof setTimeout>): void {
  if (!nodeProcess()?.versions?.node) return;
  const maybe = timer as { unref?: () => void };
  maybe.unref?.();
}

export function bindRoomSocket(ws: {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, handler: (event: { data?: unknown }) => void): void;
}): RoomSocket {
  const pending: string[] = [];
  let handler: ((data: string) => void) | null = null;
  let closeHandler: (() => void) | null = null;
  let closed = false;
  const emit = (data: string): void => {
    if (data === "ping" || data === "pong") return;
    if (handler) handler(data);
    else pending.push(data);
  };
  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string") emit(event.data);
  });
  ws.addEventListener("close", () => {
    closed = true;
    closeHandler?.();
  });
  ws.addEventListener("error", () => {
    if (closed) return;
    closed = true;
    closeHandler?.();
  });
  return {
    send(data) {
      ws.send(data);
    },
    close() {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    },
    onMessage(next) {
      handler = next;
      const queued = pending.splice(0, pending.length);
      for (const item of queued) next(item);
    },
    onClose(next) {
      closeHandler = next;
    },
  };
}

/** Browser/Node WebSocket client. The Worker dials with fetch instead. */
export function connectWebSocketUrl(url: string): Promise<RoomSocket> {
  const Ctor = (
    globalThis as unknown as {
      WebSocket?: new (url: string) => {
        send(data: string): void;
        close(code?: number, reason?: string): void;
        addEventListener(type: string, handler: (event: { data?: unknown }) => void): void;
      };
    }
  ).WebSocket;
  if (!Ctor) return Promise.reject(new Error("global WebSocket is unavailable"));
  return new Promise((resolve, reject) => {
    const ws = new Ctor(url);
    let settled = false;
    ws.addEventListener("open", () => {
      if (settled) return;
      settled = true;
      resolve(bindRoomSocket(ws));
    });
    ws.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      reject(new Error("websocket failed"));
    });
  });
}

export class ExplosiveChessMcpSession {
  private origin: string;
  private readonly dial: DialRoom;
  private readonly onSeat: ((memory: SeatMemory | null) => void) | null;
  private socket: RoomSocket | null = null;
  private socketOpen = false;
  private pingTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly waiters = new Set<() => void>();
  private opChain: Promise<void> = Promise.resolve();
  private memory: SeatMemory | null = null;
  private playerId = "";
  private playerName = "Agent";
  private roomCode = "";
  private you: YouView | null = null;
  private phase = "lobby";
  private reclaimed = false;
  private joined = false;
  private legalActions: LegalAction[] = [];
  private publicStateSnap: Record<string, unknown> | null = null;
  private rules: ToolBody | null = null;
  private pendingEvent: ToolBody | null = null;
  private lastError: string | null = null;
  private lastOpponentMove: LegalAction | null = null;
  private effects: ExplosionEffect[] = [];
  private configSent = false;
  private configAck = false;
  private awaitingConfig = false;
  private ourMoveAck = false;
  private awaitingMove = false;
  private sentRow = -1;
  private sentCol = -1;
  private observeAck = false;
  private roomClosed = false;

  constructor(options: SessionOptions) {
    this.origin = options.origin;
    this.dial = options.dial;
    this.onSeat = options.onSeat ?? null;
  }

  /** Seat saved across a Durable Object wake. Does not open the socket. */
  restore(saved: SeatMemory | null): void {
    if (!saved || saved.v !== 1 || !saved.roomCode || !saved.playerId) return;
    this.memory = saved;
    this.roomCode = saved.roomCode;
    this.playerId = saved.playerId;
    this.playerName = saved.name || "Agent";
    this.configSent = saved.configSent;
    if (saved.origin) this.origin = saved.origin;
  }

  heldSocket(): boolean {
    return this.socketOpen;
  }

  close(): void {
    this.closeSocket();
    this.memory = null;
    this.joined = false;
    this.onSeat?.(null);
  }

  createRoom(args: Record<string, unknown>): Promise<ToolBody> {
    return this.runExclusive(async () => {
      if (this.socketOpen) {
        return this.alreadyConnected();
      }
      if (this.memory) {
        const requested = typeof args.roomCode === "string" ? args.roomCode.trim().toLowerCase() : "";
        if (requested && requested !== this.memory.roomCode) {
          return {
            ok: false,
            event: "error",
            error: `This session is in room ${this.memory.roomCode}.`,
            roomCode: this.memory.roomCode,
          };
        }
        return this.openSeat({
          roomCode: this.memory.roomCode,
          playerId: this.memory.playerId,
          name: this.memory.name,
        });
      }
      const roomCode =
        typeof args.roomCode === "string" && args.roomCode.trim() ? args.roomCode : generateRoomCode(6);
      return this.openSeat({
        roomCode,
        playerId: typeof args.playerId === "string" ? args.playerId : "",
        name: typeof args.name === "string" ? args.name : "Agent",
      });
    });
  }

  joinRoom(args: Record<string, unknown>): Promise<ToolBody> {
    return this.runExclusive(async () => {
      if (this.socketOpen) return this.alreadyConnected();
      const roomCode = typeof args.roomCode === "string" ? args.roomCode : "";
      if (this.memory && roomCode.trim().toLowerCase() !== this.memory.roomCode) {
        return {
          ok: false,
          event: "error",
          error: `This session is in room ${this.memory.roomCode}.`,
          roomCode: this.memory.roomCode,
        };
      }
      return this.openSeat({
        roomCode,
        playerId:
          typeof args.playerId === "string" && args.playerId.trim()
            ? args.playerId
            : (this.memory?.playerId ?? ""),
        name:
          typeof args.name === "string" && args.name.trim()
            ? args.name
            : (this.memory?.name ?? "Agent"),
      });
    });
  }

  setConfig(args: Record<string, unknown>): Promise<ToolBody> {
    return this.runExclusive(async () => {
      const ready = await this.ensureSeat();
      if (!ready.ok) return ready;
      if (this.you?.role !== "host") {
        return { ok: false, event: "error", error: "Only host can set config", you: this.you };
      }
      if (this.phase !== "lobby") {
        return { ok: false, event: "error", error: "Config locked after start" };
      }
      if (this.configSent) {
        return { ok: false, event: "error", error: "set_config already sent", rules: this.rules };
      }
      const parsed = parseMatchConfig(args);
      if (typeof parsed === "string") return { ok: false, event: "error", error: parsed };
      this.lastError = null;
      this.awaitingConfig = true;
      this.configAck = false;
      this.sendWire({ type: "set_config", payload: parsed });
      await this.waitFor(() => this.configAck || this.lastError !== null, ACK_TIMEOUT_MS);
      this.awaitingConfig = false;
      if (this.lastError && !this.configAck) {
        const error = this.lastError;
        this.lastError = null;
        return { ok: false, event: "error", error };
      }
      if (!this.configAck) {
        return { ok: false, event: "error", error: "timed out waiting for room config" };
      }
      this.configSent = true;
      this.rules = parsed;
      this.persistSeat();
      return {
        ok: true,
        event: "config_set",
        rules: parsed,
        phase: this.phase,
        roomCode: this.roomCode,
        heldSocket: true,
      };
    });
  }

  waitForTurn(timeoutMs: number): Promise<ToolBody> {
    return this.runExclusive(async () => {
      const ready = await this.ensureSeat();
      if (!ready.ok) return ready;
      if (this.you?.seat === "spectator") return this.spectatorBody();
      const pending = this.takePending();
      if (pending) return pending;
      if (this.roomClosed) return this.closedBody();
      await this.waitFor(
        () => this.pendingEvent !== null || this.roomClosed || !this.socketOpen,
        timeoutMs,
      );
      const event = this.takePending();
      if (event) return event;
      if (this.roomClosed) return this.closedBody();
      if (!this.socketOpen) {
        return {
          ok: false,
          event: "error",
          error: "room socket closed",
          roomCode: this.roomCode,
          heldSocket: false,
        };
      }
      return {
        ok: true,
        event: "no_update",
        roomCode: this.roomCode,
        phase: this.phase,
        you: this.you,
        heldSocket: true,
      };
    });
  }

  takeTurn(row: unknown, col: unknown): Promise<ToolBody> {
    return this.runExclusive(async () => {
      const ready = await this.ensureSeat();
      if (!ready.ok) return ready;
      if (this.phase === "over" || this.pendingEvent?.event === "game_over") {
        return (
          this.takePending() ?? { ok: false, event: "error", error: "Game not in progress" }
        );
      }
      if (typeof row !== "number" || typeof col !== "number" || !Number.isInteger(row) || !Number.isInteger(col)) {
        return {
          ok: false,
          event: "error",
          error: "row and col must be integers from legalActions",
          legalActions: this.legalActions.map((action) => ({ ...action })),
        };
      }
      if (!this.legalActions.some((action) => action.row === row && action.col === col)) {
        return {
          ok: false,
          event: "error",
          error: "row,col is not in the last legalActions",
          legalActions: this.legalActions.map((action) => ({ ...action })),
        };
      }
      if (this.pendingEvent?.event === "your_turn") this.pendingEvent = null;
      this.lastError = null;
      this.ourMoveAck = false;
      this.awaitingMove = true;
      this.sentRow = row;
      this.sentCol = col;
      this.sendWire({ type: "move", payload: { row, col } });
      await this.waitFor(
        () =>
          this.ourMoveAck ||
          this.lastError !== null ||
          this.pendingEvent?.event === "game_over" ||
          this.roomClosed,
        ACK_TIMEOUT_MS,
      );
      this.awaitingMove = false;
      if (this.lastError && !this.ourMoveAck) {
        const error = this.lastError;
        this.lastError = null;
        return {
          ok: false,
          event: "error",
          error,
          legalActions: this.legalActions.map((action) => ({ ...action })),
          roomCode: this.roomCode,
        };
      }
      if (!this.ourMoveAck && this.pendingEvent?.event !== "game_over") {
        return {
          ok: false,
          event: "error",
          error: "timed out waiting for the move to apply",
          legalActions: this.legalActions.map((action) => ({ ...action })),
        };
      }
      return {
        ok: true,
        event: "move_sent",
        row,
        col,
        roomCode: this.roomCode,
        phase: this.phase,
        heldSocket: this.socketOpen,
        gameOver: this.pendingEvent?.event === "game_over",
      };
    });
  }

  /** Debug snapshot. The play loop is wait_for_turn / take_turn. */
  getState(): Promise<ToolBody> {
    return this.runExclusive(async () => {
      const ready = await this.ensureSeat();
      if (!ready.ok) return ready;
      this.lastError = null;
      this.observeAck = false;
      this.sendWire({ type: "observe", payload: {} });
      await this.waitFor(() => this.observeAck || this.lastError !== null, ACK_TIMEOUT_MS);
      if (this.lastError && !this.observeAck) {
        const error = this.lastError;
        this.lastError = null;
        return { ok: false, event: "error", error, debug: true };
      }
      const body = this.observationBody("state");
      body.debug = true;
      return body;
    });
  }

  private alreadyConnected(): ToolBody {
    return {
      ok: false,
      event: "error",
      error: `Already connected to ${this.roomCode}. This MCP session holds one room socket.`,
      roomCode: this.roomCode,
      you: this.you,
      heldSocket: true,
    };
  }

  private async ensureSeat(): Promise<ToolBody> {
    if (this.socketOpen && this.joined) return { ok: true, event: "joined" };
    if (!this.memory) {
      return { ok: false, event: "error", error: "Not connected. Call create_room or join_room." };
    }
    return this.openSeat({
      roomCode: this.memory.roomCode,
      playerId: this.memory.playerId,
      name: this.memory.name,
    });
  }

  private async openSeat(input: { roomCode: string; playerId: string; name: string }): Promise<ToolBody> {
    const code = input.roomCode.trim().toLowerCase();
    if (!/^[a-z0-9]+$/.test(code)) {
      return { ok: false, event: "error", error: "roomCode must be [a-z0-9]" };
    }
    const playerId = input.playerId.trim() || `agent-${generateRoomCode(8)}`;
    const name = input.name.trim().slice(0, 24) || "Agent";
    this.resetMatchView();
    this.roomCode = code;
    this.playerId = playerId;
    this.playerName = name;
    const url = explosiveChessWsUrl(this.origin, code);
    let socket: RoomSocket;
    try {
      socket = await this.dial(url);
    } catch (err) {
      return {
        ok: false,
        event: "error",
        error: err instanceof Error ? err.message : "websocket failed",
        roomCode: code,
      };
    }
    this.attach(socket);
    this.sendWire({
      type: "join",
      payload: { playerId, name, kind: "agent", game: "explosive-chess" },
    });
    await this.waitFor(() => this.joined || this.lastError !== null || this.roomClosed, JOIN_TIMEOUT_MS);
    if (!this.joined) {
      const error = this.lastError ?? "timed out waiting for joined";
      this.lastError = null;
      this.closeSocket();
      return { ok: false, event: "error", error, roomCode: code };
    }
    this.persistSeat();
    if (this.you?.seat === "spectator") {
      return { ...this.spectatorBody(), reclaimed: this.reclaimed, playUrl: explosiveChessPlayUrl(this.origin, code) };
    }
    return {
      ok: true,
      event: "joined",
      roomCode: code,
      playerId,
      name,
      you: this.you,
      phase: this.phase,
      reclaimed: this.reclaimed,
      playUrl: explosiveChessPlayUrl(this.origin, code),
      heldSocket: true,
      yourTurn: this.legalActions.length > 0,
    };
  }

  private persistSeat(): void {
    const memory: SeatMemory = {
      v: 1,
      origin: this.origin,
      roomCode: this.roomCode,
      playerId: this.playerId,
      name: this.playerName,
      configSent: this.configSent,
    };
    this.memory = memory;
    this.onSeat?.(memory);
  }

  private resetMatchView(): void {
    this.you = null;
    this.phase = "lobby";
    this.reclaimed = false;
    this.legalActions = [];
    this.publicStateSnap = null;
    this.pendingEvent = null;
    this.lastError = null;
    this.lastOpponentMove = null;
    this.effects = [];
    this.joined = false;
    this.roomClosed = false;
    this.ourMoveAck = false;
    this.observeAck = false;
    this.configAck = false;
    this.awaitingConfig = false;
    this.awaitingMove = false;
  }

  private attach(socket: RoomSocket): void {
    this.socket = socket;
    this.socketOpen = true;
    socket.onMessage((raw) => this.onRaw(raw));
    socket.onClose(() => {
      this.socketOpen = false;
      this.socket = null;
      this.stopPing();
      this.notify();
    });
    this.armPing();
  }

  private armPing(): void {
    this.stopPing();
    const tick = (): void => {
      if (!this.socketOpen || !this.socket) return;
      try {
        this.socket.send("ping");
      } catch {
        /* closed */
      }
      this.pingTimer = setTimeout(tick, PING_INTERVAL_MS);
      unrefInNode(this.pingTimer);
    };
    this.pingTimer = setTimeout(tick, PING_INTERVAL_MS);
    unrefInNode(this.pingTimer);
  }

  private stopPing(): void {
    if (this.pingTimer === null) return;
    clearTimeout(this.pingTimer);
    this.pingTimer = null;
  }

  private closeSocket(): void {
    this.stopPing();
    const socket = this.socket;
    this.socket = null;
    this.socketOpen = false;
    try {
      socket?.close();
    } catch {
      /* already closed */
    }
  }

  private sendWire(msg: unknown): void {
    this.socket?.send(JSON.stringify(msg));
  }

  private onRaw(raw: string): void {
    if (raw === "ping" || raw === "pong") return;
    let msg: Wire;
    try {
      msg = JSON.parse(raw) as Wire;
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== "string") return;
    this.apply(msg.type, asRecord(msg.payload));
    this.notify();
  }

  private apply(type: string, payload: Record<string, unknown> | null): void {
    const body = payload ?? {};
    switch (type) {
      case "joined": {
        const you = asRecord(body.you);
        if (you) this.you = readYou(you);
        if (typeof body.phase === "string") this.phase = body.phase;
        if (typeof body.roomCode === "string" && body.roomCode) this.roomCode = body.roomCode;
        this.reclaimed = body.reclaimed === true;
        this.joined = true;
        break;
      }
      case "room": {
        if (typeof body.phase === "string") this.phase = body.phase;
        const config = asRecord(body.config);
        if (config && Object.keys(config).length > 0) this.rules = config;
        if (this.awaitingConfig) this.configAck = true;
        break;
      }
      case "start": {
        this.phase = typeof body.phase === "string" ? body.phase : "playing";
        const config = asRecord(body.config);
        if (config) this.rules = config;
        break;
      }
      case "your_turn": {
        const observation = asRecord(body.observation);
        if (observation) this.rememberObservation(observation);
        this.pendingEvent = this.observationBody("your_turn");
        break;
      }
      case "observation": {
        const observation = asRecord(body.observation);
        if (observation) this.rememberObservation(observation);
        this.observeAck = true;
        break;
      }
      case "state": {
        if (Array.isArray(body.animationFrames)) {
          const counts = asRecord(body.fullState)?.counts;
          const fromCounts = boardSizeFromCounts(counts);
          const size = fromCounts || this.boardSize();
          this.effects = effectsFromAnimationFrames(body.animationFrames, size);
        }
        break;
      }
      case "move_applied": {
        if ("effects" in body) this.effects = readExplosionEffects(body.effects);
        const by = asRecord(body.by);
        const action = asRecord(body.action);
        const byId = typeof by?.playerId === "string" ? by.playerId : "";
        if (
          byId &&
          byId !== this.playerId &&
          action?.type === "move" &&
          typeof action.row === "number" &&
          typeof action.col === "number"
        ) {
          this.lastOpponentMove = { type: "move", row: action.row, col: action.col };
        }
        const ours =
          byId === this.playerId ||
          (this.awaitingMove && action?.row === this.sentRow && action?.col === this.sentCol);
        if (ours) {
          this.ourMoveAck = true;
          this.legalActions = [];
        }
        const publicState = asRecord(body.publicState);
        if (publicState) this.notePublicState(publicState);
        break;
      }
      case "game_over": {
        this.phase = "over";
        this.legalActions = [];
        const opponent = this.lastOpponentMove;
        this.lastOpponentMove = null;
        this.pendingEvent = {
          ok: true,
          event: "game_over",
          yourTurn: false,
          gameOver: true,
          board: this.publicStateSnap?.board ?? null,
          legalActions: [],
          rules: this.rules,
          publicState: this.publicStateSnap,
          you: this.you,
          phase: this.phase,
          roomCode: this.roomCode,
          winner: body.winner ?? null,
          winnerColor: body.winnerColor ?? null,
          winReason: typeof body.winReason === "string" ? body.winReason : "",
          lastOpponentMove: opponent,
          effects: this.effects,
          heldSocket: this.socketOpen,
        };
        break;
      }
      case "error": {
        this.lastError = typeof body.message === "string" ? body.message : "error";
        break;
      }
      case "room_closed": {
        this.roomClosed = true;
        this.pendingEvent = this.closedBody();
        break;
      }
      default:
        break;
    }
  }

  private rememberObservation(observation: Record<string, unknown>): void {
    if (typeof observation.phase === "string") this.phase = observation.phase;
    const you = asRecord(observation.you);
    if (you) this.you = readYou(you);
    const publicState = asRecord(observation.publicState);
    if (publicState) this.notePublicState(publicState);
    this.legalActions = readLegalActions(observation.legalActions);
    if ("effects" in observation) this.effects = readExplosionEffects(observation.effects);
  }

  private boardSize(): number {
    const board = this.publicStateSnap?.board;
    if (Array.isArray(board) && board.length > 0) return board.length;
    const full = asRecord(this.publicStateSnap?.fullState);
    return boardSizeFromCounts(full?.counts);
  }

  private notePublicState(publicState: Record<string, unknown>): void {
    this.publicStateSnap = publicState;
    const config = asRecord(publicState.config);
    if (config) this.rules = config;
  }

  private observationBody(event: "your_turn" | "state"): ToolBody {
    const legal = this.legalActions.map((action) => ({ ...action }));
    const opponent = this.lastOpponentMove;
    this.lastOpponentMove = null;
    return {
      ok: true,
      event,
      yourTurn: legal.length > 0,
      gameOver: this.phase === "over",
      board: this.publicStateSnap?.board ?? null,
      legalActions: legal,
      rules: this.rules,
      publicState: this.publicStateSnap,
      you: this.you,
      phase: this.phase,
      roomCode: this.roomCode,
      turn: this.publicStateSnap?.turn ?? null,
      lastOpponentMove: opponent,
      effects: this.effects,
      heldSocket: this.socketOpen,
    };
  }

  private spectatorBody(): ToolBody {
    return {
      ok: true,
      event: "spectator",
      you: this.you,
      phase: this.phase,
      roomCode: this.roomCode,
      legalActions: [],
      yourTurn: false,
      heldSocket: this.socketOpen,
      playUrl: this.roomCode ? explosiveChessPlayUrl(this.origin, this.roomCode) : "",
    };
  }

  private closedBody(): ToolBody {
    return {
      ok: true,
      event: "room_closed",
      roomCode: this.roomCode,
      phase: this.phase,
      heldSocket: false,
    };
  }

  private takePending(): ToolBody | null {
    const event = this.pendingEvent;
    this.pendingEvent = null;
    return event;
  }

  private waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
    if (pred()) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (value: boolean): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.waiters.delete(wake);
        resolve(value);
      };
      const wake = (): void => {
        if (pred()) finish(true);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.waiters.add(wake);
    });
  }

  private notify(): void {
    for (const wake of [...this.waiters]) wake();
  }

  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.opChain.then(fn, fn);
    this.opChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
