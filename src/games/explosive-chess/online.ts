/**
 * WebSocket client for Explosive Chess online rooms (Durable Object GameRoom).
 * Protocol: JSON `{ type, payload }` — see worker/game-room.ts.
 */

import type { AnimationFrame, FullState, WinMode } from "./engine";

export type Seat = "red" | "blue" | "spectator";
export type Role = "host" | "guest" | "spectator";
export type Phase = "lobby" | "playing" | "over";
export type HostColor = "red" | "blue";

export type RoomConfig = {
  boardSize: number;
  winMode: WinMode;
  winParam: number;
  hostColor: HostColor;
};

export type RoomPlayer = {
  playerId: string;
  name: string;
  seat: Seat;
  role: Role;
  ready: boolean;
  rematch: boolean;
  connected: boolean;
};

export type ServerHandlers = {
  onWelcome?: (payload: { playerId: string; seat: Seat; role: Role }) => void;
  onRoom?: (payload: { players: RoomPlayer[]; config: RoomConfig; phase: Phase }) => void;
  onGameStart?: (payload: { config: RoomConfig; yourColor: HostColor }) => void;
  onState?: (payload: {
    fullState: FullState;
    lastMove?: { row: number; col: number };
    animationFrames?: AnimationFrame[];
  }) => void;
  onGameOver?: (payload: { winner: number | "draw" | null; winReason: string }) => void;
  onError?: (payload: { message: string }) => void;
  onPeerLeft?: (payload: { playerId: string; seat?: Seat }) => void;
  onOpen?: () => void;
  onClose?: (ev: CloseEvent) => void;
};

const PLAYER_ID_KEY = "micromist.explosive-chess.playerId";

export function getOrCreatePlayerId(): string {
  try {
    const existing = localStorage.getItem(PLAYER_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(PLAYER_ID_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function generateRoomCode(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let code = "";
  for (const b of bytes) {
    code += alphabet[b % alphabet.length]!;
  }
  return code;
}

export function roomSocketUrl(roomId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/${encodeURIComponent(roomId)}`;
}

export function shareUrl(roomId: string): string {
  const url = new URL(window.location.href);
  url.pathname = "/play/explosive-chess";
  url.search = `?room=${encodeURIComponent(roomId)}`;
  url.hash = "";
  return url.toString();
}

export class ExplosiveOnlineClient {
  private ws: WebSocket | null = null;
  private handlers: ServerHandlers = {};
  private intentionalClose = false;

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  connect(roomId: string, handlers: ServerHandlers): void {
    this.close();
    this.intentionalClose = false;
    this.handlers = handlers;
    const ws = new WebSocket(roomSocketUrl(roomId));
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.handlers.onOpen?.();
    });

    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      // Auto-response ping/pong may be plain text; ignore non-JSON.
      if (event.data === "pong" || event.data === "ping") return;
      let msg: { type?: string; payload?: unknown };
      try {
        msg = JSON.parse(event.data) as { type?: string; payload?: unknown };
      } catch {
        return;
      }
      if (!msg.type) return;
      const payload = (msg.payload ?? {}) as never;
      switch (msg.type) {
        case "welcome":
          this.handlers.onWelcome?.(payload);
          break;
        case "room":
          this.handlers.onRoom?.(payload);
          break;
        case "game_start":
          this.handlers.onGameStart?.(payload);
          break;
        case "state":
          this.handlers.onState?.(payload);
          break;
        case "game_over":
          this.handlers.onGameOver?.(payload);
          break;
        case "error":
          this.handlers.onError?.(payload);
          break;
        case "peer_left":
          this.handlers.onPeerLeft?.(payload);
          break;
        default:
          break;
      }
    });

    ws.addEventListener("close", (ev) => {
      if (this.ws === ws) this.ws = null;
      if (!this.intentionalClose) this.handlers.onClose?.(ev);
    });

    ws.addEventListener("error", () => {
      /* close handler follows */
    });
  }

  send(type: string, payload: Record<string, unknown> = {}): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type, payload }));
  }

  join(opts: { playerId: string; name?: string; password?: string }): void {
    this.send("join", {
      playerId: opts.playerId,
      name: opts.name ?? "",
      password: opts.password ?? "",
    });
  }

  setConfig(config: Partial<RoomConfig>): void {
    this.send("set_config", { ...config });
  }

  ready(): void {
    this.send("ready");
  }

  move(row: number, col: number): void {
    this.send("move", { row, col });
  }

  surrender(): void {
    this.send("surrender");
  }

  rematch(): void {
    this.send("rematch");
  }

  close(): void {
    this.intentionalClose = true;
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
