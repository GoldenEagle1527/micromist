import type { PlayerKind, Role, RoomPlayer, Seat } from "../../shared/multiplayer";

export type SessionAttachment = {
  playerId: string;
  seat: Seat;
  role: Role;
  name: string;
  /** Hibernated sockets opened before agent seats omit this. */
  kind?: PlayerKind;
};

export type PlayerRecord = RoomPlayer;

export type JoinResult = {
  seat: Seat;
  role: Role;
};

export type PersistedRoom = {
  v: 1;
  gameSlug: string;
  roomCode: string;
  phase: import("../../shared/multiplayer").Phase;
  hostId: string | null;
  players: PlayerRecord[];
  adapter: unknown;
};
