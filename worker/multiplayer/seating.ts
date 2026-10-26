/**
 * Explicit seating for rooms that do not auto-assign red/blue on join.
 * A new playerId is a spectator. claim_seat / sit takes an empty red or blue seat.
 * The same playerId keeps the seat it already holds, including spectator.
 */
import type { Phase, Role } from "../../shared/multiplayer";
import type { PlayerRecord } from "./types";

export type PlaySeat = "red" | "blue";

export type ClaimDecision =
  | { ok: true; changed: boolean; seat: PlaySeat; role: Role }
  | { ok: false; message: string };

export function decideClaim(input: {
  phase: Phase;
  hostId: string | null;
  player: PlayerRecord;
  seat: PlaySeat;
  players: Iterable<PlayerRecord>;
}): ClaimDecision {
  const { phase, hostId, player, seat, players } = input;
  if (player.seat === seat) {
    return { ok: true, changed: false, seat, role: player.role };
  }
  if (phase !== "lobby") {
    return { ok: false, message: "Cannot change seats after the match starts" };
  }
  for (const other of players) {
    if (other.playerId !== player.playerId && other.seat === seat) {
      return { ok: false, message: "Seat taken" };
    }
  }
  const role: Role = hostId === player.playerId ? "host" : "guest";
  return { ok: true, changed: true, seat, role };
}
