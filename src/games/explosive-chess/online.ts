/**
 * Explosive Chess online — thin wrapper over shared OnlineRoomClient.
 */
import { generateRoomCode as sharedGenerateRoomCode } from "../../../shared/multiplayer";
import {
  OnlineRoomClient,
  getOrCreatePlayerId as sharedGetPlayerId,
  type CommonHandlers,
  type Phase,
  type Role,
  type RoomPlayer,
  type Seat,
} from "../../multiplayer/OnlineRoomClient";
import type { AnimationFrame, FullState, WinMode } from "./engine";

export type { Phase, Role, RoomPlayer, Seat };
export type HostColor = "red" | "blue";

export type RoomConfig = {
  boardSize: number;
  winMode: WinMode;
  winParam: number;
  hostColor: HostColor;
};

export type ServerHandlers = {
  onWelcome?: CommonHandlers["onWelcome"];
  onRoom?: (payload: { players: RoomPlayer[]; config: RoomConfig; phase: Phase }) => void;
  onGameStart?: (payload: { config: RoomConfig; yourColor: HostColor }) => void;
  onState?: (payload: {
    fullState: FullState;
    lastMove?: { row: number; col: number };
    animationFrames?: AnimationFrame[];
  }) => void;
  onGameOver?: (payload: { winner: number | "draw" | null; winReason: string }) => void;
  onError?: CommonHandlers["onError"];
  onPeerLeft?: CommonHandlers["onPeerLeft"];
  onRoomClosed?: CommonHandlers["onRoomClosed"];
  onOpen?: CommonHandlers["onOpen"];
  onClose?: CommonHandlers["onClose"];
};

const PLAYER_ID_KEY = "micromist.explosive-chess.playerId";
const GAME_SLUG = "explosive-chess";

export function getOrCreatePlayerId(): string {
  return sharedGetPlayerId(PLAYER_ID_KEY);
}

export function generateRoomCode(): string {
  return sharedGenerateRoomCode(6);
}

export function shareUrl(roomCode: string): string {
  const url = new URL(window.location.href);
  url.pathname = "/play/explosive-chess";
  // Short code in the link; client namespaces when connecting.
  url.search = `?room=${encodeURIComponent(roomCode.trim().toLowerCase())}`;
  url.hash = "";
  return url.toString();
}

export class ExplosiveOnlineClient {
  private inner = new OnlineRoomClient(GAME_SLUG);

  get readyState(): number {
    return this.inner.readyState;
  }

  get currentRoomId(): string | null {
    return this.inner.currentRoomId;
  }

  get isOpen(): boolean {
    return this.inner.isOpen;
  }

  connect(roomCode: string, handlers: ServerHandlers): void {
    this.inner.connect(roomCode, {
      onWelcome: handlers.onWelcome,
      onRoom: (payload) => {
        handlers.onRoom?.({
          players: payload.players,
          config: payload.config as RoomConfig,
          phase: payload.phase,
        });
      },
      onError: handlers.onError,
      onPeerLeft: handlers.onPeerLeft,
      onRoomClosed: handlers.onRoomClosed,
      onOpen: handlers.onOpen,
      onClose: handlers.onClose,
      onMessage: (type, payload) => {
        if (type === "game_start") handlers.onGameStart?.(payload as never);
        else if (type === "state") handlers.onState?.(payload as never);
        else if (type === "game_over") handlers.onGameOver?.(payload as never);
      },
    });
  }

  reconnect(): boolean {
    return this.inner.reconnect();
  }

  join(opts: { playerId: string; name?: string; password?: string }): boolean {
    return this.inner.join(opts);
  }

  setConfig(config: Partial<RoomConfig>): boolean {
    return this.inner.send("set_config", { ...config });
  }

  ready(): boolean {
    return this.inner.send("ready");
  }

  move(row: number, col: number): boolean {
    return this.inner.send("move", { row, col });
  }

  surrender(): boolean {
    return this.inner.send("surrender");
  }

  rematch(): boolean {
    return this.inner.send("rematch");
  }

  close(): void {
    this.inner.close();
  }
}
