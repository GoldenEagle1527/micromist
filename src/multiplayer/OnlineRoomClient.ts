/**
 * Generic WebSocket room client: connect / reconnect / send / common events.
 * Games wrap this and add typed helpers (move, setConfig, …).
 */
import {
  formatRoomId,
  parseRoomId,
  type Phase,
  type Role,
  type RoomPlayer,
  type Seat,
} from "../../shared/multiplayer";

export type { Phase, Role, RoomPlayer, Seat };

export type CommonHandlers = {
  onWelcome?: (payload: { playerId: string; seat: Seat; role: Role }) => void;
  onRoom?: (payload: {
    players: RoomPlayer[];
    config: Record<string, unknown>;
    phase: Phase;
    game?: string;
  }) => void;
  onError?: (payload: { message: string }) => void;
  onPeerLeft?: (payload: { playerId: string; seat?: Seat }) => void;
  onRoomClosed?: (payload: { reason?: string }) => void;
  onOpen?: () => void;
  onClose?: (ev: CloseEvent) => void;
  /** Any message type not handled above (game_start, state, …). */
  onMessage?: (type: string, payload: Record<string, unknown>) => void;
};

export function roomSocketUrl(roomId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const canonical = parseRoomId(roomId).roomId;
  return `${protocol}//${window.location.host}/ws/${encodeURIComponent(canonical)}`;
}

export function getOrCreatePlayerId(storageKey: string): string {
  try {
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(storageKey, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export class OnlineRoomClient {
  private ws: WebSocket | null = null;
  private handlers: CommonHandlers = {};
  private intentionalClose = false;
  private roomId: string | null = null;
  private generation = 0;
  private gameSlug: string;

  constructor(gameSlug: string) {
    this.gameSlug = gameSlug;
  }

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  get currentRoomId(): string | null {
    return this.roomId;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** `code` may be bare or already `game:code`. */
  connect(codeOrRoomId: string, handlers: CommonHandlers): void {
    this.close();
    const parsed = parseRoomId(
      codeOrRoomId.includes(":") ? codeOrRoomId : formatRoomId(this.gameSlug, codeOrRoomId),
    );
    this.roomId = parsed.roomId;
    this.handlers = handlers;
    this.openSocket();
  }

  reconnect(): boolean {
    if (!this.roomId) return false;
    this.intentionalClose = true;
    this.generation += 1;
    const old = this.ws;
    this.ws = null;
    if (old) {
      try {
        old.close(4000, "reconnect");
      } catch {
        /* ignore */
      }
    }
    this.openSocket();
    return true;
  }

  private openSocket(): void {
    if (!this.roomId) return;
    this.intentionalClose = false;
    const gen = ++this.generation;
    const ws = new WebSocket(roomSocketUrl(this.roomId));
    this.ws = ws;

    ws.addEventListener("open", () => {
      if (this.generation !== gen || this.ws !== ws) return;
      this.handlers.onOpen?.();
    });

    ws.addEventListener("message", (event) => {
      if (this.generation !== gen || this.ws !== ws) return;
      if (typeof event.data !== "string") return;
      if (event.data === "pong" || event.data === "ping") return;
      let msg: { type?: string; payload?: unknown };
      try {
        msg = JSON.parse(event.data) as { type?: string; payload?: unknown };
      } catch {
        return;
      }
      if (!msg.type) return;
      const payload = (msg.payload && typeof msg.payload === "object"
        ? msg.payload
        : {}) as Record<string, unknown>;

      switch (msg.type) {
        case "welcome":
          this.handlers.onWelcome?.(payload as never);
          break;
        case "room":
          this.handlers.onRoom?.(payload as never);
          break;
        case "error":
          this.handlers.onError?.(payload as never);
          break;
        case "peer_left":
          this.handlers.onPeerLeft?.(payload as never);
          break;
        case "room_closed":
          this.handlers.onRoomClosed?.(payload as never);
          break;
        default:
          this.handlers.onMessage?.(msg.type, payload);
          break;
      }
    });

    ws.addEventListener("close", (ev) => {
      if (this.ws === ws) this.ws = null;
      if (this.generation !== gen) return;
      if (!this.intentionalClose) this.handlers.onClose?.(ev);
    });

    ws.addEventListener("error", () => {
      /* close follows */
    });
  }

  send(type: string, payload: Record<string, unknown> = {}): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify({ type, payload }));
      return true;
    } catch {
      return false;
    }
  }

  join(opts: { playerId: string; name?: string; password?: string }): boolean {
    return this.send("join", {
      playerId: opts.playerId,
      name: opts.name ?? "",
      password: opts.password ?? "",
      game: this.gameSlug,
    });
  }

  close(): void {
    this.intentionalClose = true;
    this.generation += 1;
    const ws = this.ws;
    this.ws = null;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try {
        ws.close(1000, "client close");
      } catch {
        /* ignore */
      }
    }
  }
}
