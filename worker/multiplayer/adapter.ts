/**
 * Per-game logic plugged into the single GameRoom Durable Object.
 * Lifecycle (WS, join, recycle) stays in the shell; rules live here.
 */
import type { Phase, Seat } from "../../shared/multiplayer";
import type { PlayerRecord, SessionAttachment } from "./types";

/** Narrow API adapters use to talk to the room shell. */
export type RoomHost = {
  readonly phase: Phase;
  setPhase: (phase: Phase) => void;
  readonly players: Map<string, PlayerRecord>;
  readonly sessions: Map<WebSocket, SessionAttachment>;
  hostId: string | null;
  readonly gameSlug: string;
  readonly roomCode: string;
  send: (ws: WebSocket, type: string, payload: unknown) => void;
  broadcast: (type: string, payload: unknown) => void;
  broadcastRoom: () => void;
  seatedPlayers: (opts?: { connectedOnly?: boolean }) => PlayerRecord[];
  requireJoined: (ws: WebSocket) => SessionAttachment | null;
  refreshAttachmentSeat: (playerId: string, seat: Seat) => void;
  /** Persist shell + adapter blob after a mutating game action. */
  persist: () => Promise<void>;
};

export type GameRoomAdapter = {
  readonly slug: string;
  getPublicConfig: () => Record<string, unknown>;
  hostSeat: () => Seat;
  onRecycle: () => void;
  onReclaimSync: (ws: WebSocket, player: PlayerRecord) => void;
  tryStartGame: () => void;
  onSetConfig: (
    ws: WebSocket,
    session: SessionAttachment,
    payload: Record<string, unknown>,
  ) => boolean;
  onMessage: (
    ws: WebSocket,
    type: string,
    payload: Record<string, unknown>,
  ) => boolean;
  serialize: () => unknown;
  hydrate: (blob: unknown) => void;
};

export type AdapterFactory = (host: RoomHost) => GameRoomAdapter;
