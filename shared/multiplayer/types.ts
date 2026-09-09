/**
 * Shared multiplayer wire types (SPA + Worker).
 * Game-specific payloads (state, config) stay in each game module.
 */

export type Seat = "red" | "blue" | "spectator";
export type Role = "host" | "guest" | "spectator";
export type Phase = "lobby" | "playing" | "over";

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
