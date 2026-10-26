/**
 * Per-game logic plugged into the single GameRoom Durable Object.
 * Lifecycle (WS, join, recycle) stays in the shell; rules live here.
 */
import type { Phase, Role, Seat } from "../../shared/multiplayer";
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
  refreshAttachmentSeat: (playerId: string, seat: Seat, role?: Role) => void;
  /** Persist shell + adapter blob after a mutating game action. */
  persist: () => Promise<void>;
};

export type GameRoomAdapter = {
  readonly slug: string;
  /**
   * When true, join does not take red or blue. A new playerId is a spectator.
   * `claim_seat` / `sit` fills an empty seat. The same playerId reclaims its seat.
   */
  readonly explicitSeating?: boolean;
  getPublicConfig: () => Record<string, unknown>;
  hostSeat: () => Seat;
  onRecycle: () => void;
  onReclaimSync: (ws: WebSocket, player: PlayerRecord) => void;
  /**
   * After the shell has attached a joined or reclaimed socket, before tryStartGame.
   * Games that speak to agents use this for join pushes. Others may omit it.
   */
  onSeated?: (
    ws: WebSocket,
    player: PlayerRecord,
    info: { reclaimed: boolean },
  ) => void;
  /** After the shell applies claim_seat / sit. `changed` is false when the seat was already theirs. */
  onSeatClaimed?: (
    ws: WebSocket,
    player: PlayerRecord,
    info: { changed: boolean },
  ) => void;
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
