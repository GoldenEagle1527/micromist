/**
 * Shared multiplayer wire types (SPA + Worker).
 * Game-specific payloads (state, config) stay in each game module.
 */

export type Seat = "red" | "blue" | "spectator";
export type Role = "host" | "guest" | "spectator";
export type Phase = "lobby" | "playing" | "over";

/** Who drives a seat. Rules ignore this; clients may show it. */
export type PlayerKind = "human" | "agent";

export function normalizePlayerKind(value: unknown): PlayerKind {
  return value === "agent" ? "agent" : "human";
}

/**
 * Join payload: explicit "agent" or "human" wins.
 * An omitted kind on reclaim keeps the stored kind (browser reconnects do not send one).
 */
export function playerKindFromJoin(value: unknown, previous?: PlayerKind): PlayerKind {
  if (value === "agent" || value === "human") return value;
  return normalizePlayerKind(previous);
}

/** Default 2p seats; spectators are never "seated" for recycle. */
export const SEATED_SEATS: readonly Seat[] = ["red", "blue"];

export function isSeatedSeat(seat: Seat): boolean {
  return seat === "red" || seat === "blue";
}

export type RoomPlayer = {
  playerId: string;
  name: string;
  seat: Seat;
  role: Role;
  ready: boolean;
  rematch: boolean;
  connected: boolean;
  /** Omitted on snapshots from before agent seats. Treat missing as human. */
  kind?: PlayerKind;
};

export type WireMsg = {
  type: string;
  payload?: Record<string, unknown>;
};

/** Common server → client envelope types (game may add more). */
export type CommonServerType =
  | "welcome"
  | "room"
  | "error"
  | "peer_left"
  | "room_closed";
