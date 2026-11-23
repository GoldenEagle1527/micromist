import {
  formatRoomId,
  generateRoomCode as sharedGenerateRoomCode,
  parseRoomId,
  playUrl,
} from "../../../shared/multiplayer";
import type { GameState, Rules } from "../../../shared/gomoku/engine";
import {
  OnlineRoomClient,
  getOrCreatePlayerIdForGame,
  type CommonHandlers,
  type Phase,
  type RoomPlayer,
  type Seat,
} from "../../multiplayer/OnlineRoomClient";

export type { Phase, RoomPlayer, Seat };

const GAME_SLUG = "gomoku";

export function getOrCreatePlayerId(): string {
  return getOrCreatePlayerIdForGame(GAME_SLUG);
}

export function generateRoomCode(): string {
  return formatRoomId(GAME_SLUG, sharedGenerateRoomCode(6));
}

export function shareUrl(roomCode: string): string {
  const parsed = parseRoomId(roomCode) ?? parseRoomId(formatRoomId(GAME_SLUG, roomCode));
  const href = parsed ? playUrl(window.location.origin, parsed.roomId) : null;
  if (href) return href;
  const url = new URL(window.location.href);
  url.pathname = "/play/gomoku";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export type GomokuHandlers = {
  onWelcome?: CommonHandlers["onWelcome"];
  onRoom?: (payload: { players: RoomPlayer[]; phase: Phase; config: Record<string, unknown> }) => void;
  onStart?: (payload: Record<string, unknown>) => void;
  onState?: (payload: { publicState: GameState }) => void;
  onGameOver?: (payload: { winner: number; winReason?: string; winLine?: number[] | null }) => void;
  onError?: CommonHandlers["onError"];
  onPeerLeft?: CommonHandlers["onPeerLeft"];
  onRoomClosed?: CommonHandlers["onRoomClosed"];
  onOpen?: CommonHandlers["onOpen"];
  onClose?: CommonHandlers["onClose"];
  onSeated?: (payload: { playerId: string; seat: Seat }) => void;
};

export class GomokuOnlineClient {
  private inner = new OnlineRoomClient(GAME_SLUG);

  get isOpen(): boolean {
    return this.inner.isOpen;
  }

  connect(roomCode: string, handlers: GomokuHandlers): void {
    this.inner.connect(roomCode, {
      onWelcome: handlers.onWelcome,
      onRoom: (payload) => {
        handlers.onRoom?.({
          players: payload.players,
          phase: payload.phase,
          config: payload.config ?? {},
        });
      },
      onError: handlers.onError,
      onPeerLeft: handlers.onPeerLeft,
      onRoomClosed: handlers.onRoomClosed,
      onOpen: handlers.onOpen,
      onClose: handlers.onClose,
      onMessage: (type, payload) => {
        if (type === "seated") {
          const seated = payload.you;
          if (seated && typeof seated === "object") {
            const body = seated as { playerId?: unknown; seat?: unknown };
            if (typeof body.playerId === "string" && typeof body.seat === "string") {
              handlers.onSeated?.({ playerId: body.playerId, seat: body.seat as Seat });
            }
          }
        } else if (type === "start") {
          handlers.onStart?.(payload);
        } else if (type === "state" || type === "move_applied" || type === "your_turn") {
          const publicState = payload.publicState;
          if (publicState && typeof publicState === "object") {
            handlers.onState?.({ publicState: publicState as GameState });
          }
        } else if (type === "game_over") {
          handlers.onGameOver?.(payload as never);
        }
      },
    });
  }

  join(opts: { playerId: string; name?: string }): boolean {
    return this.inner.join(opts);
  }

  claimSeat(seat: "red" | "blue"): boolean {
    return this.inner.send("claim_seat", { seat });
  }

  setConfig(config: { rules: Rules; capturesToWin: number }): boolean {
    return this.inner.send("set_config", { ...config });
  }

  move(index: number): boolean {
    return this.inner.send("move", { index });
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
