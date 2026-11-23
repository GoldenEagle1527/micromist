import type { Dict } from "../../i18n";
import type { PlayChrome, RoomPane, RoomRoster, SeatChip } from "./types";

function occupantName(
  player: RoomRoster["players"][number] | undefined,
  youId: string | undefined,
  t: Dict,
): string | undefined {
  if (!player) return undefined;
  const bits = [player.name];
  if (player.playerId === youId) bits.push(`(${t.roomYou})`);
  if (player.kind === "agent") bits.push(t.roomAgent);
  return bits.join(" ");
}

export function decorateRoom(room: RoomPane, t: Dict): RoomPane {
  const roster = room.roster;
  if (!roster) return room;
  const youId = roster.youId;
  const players = roster.players;
  const seats: SeatChip[] = roster.seats.map((slot) => {
    const player = players.find((p) => p.seat === slot.id);
    const taken = Boolean(player);
    return {
      id: slot.id,
      label: slot.label,
      occupant: occupantName(player, youId, t),
      status: taken ? (player?.connected === false ? t.roomOffline : t.roomOnline) : t.roomSeatEmpty,
      canClaim: Boolean(roster.claimable && !taken),
      isYou: player?.playerId === youId,
      claimLabel: slot.claimLabel,
    };
  });
  return {
    ...room,
    seats,
    spectators: undefined,
  };
}

export function matchFromRoom(room: RoomPane | undefined, t: Dict): PlayChrome["match"] | undefined {
  if (!room) return undefined;
  const seats = room.seats ?? [];
  if (seats.length === 0) return undefined;
  const side = (seat: SeatChip | undefined) => {
    if (!seat) return undefined;
    const vacant = !seat.occupant;
    return { name: seat.occupant || seat.status || t.roomSeatEmpty, vacant };
  };
  const match: NonNullable<PlayChrome["match"]> = {
    left: side(seats[0]),
    right: seats.length > 1 ? side(seats[1]) : undefined,
  };
  if (!match.left) return undefined;
  return match;
}
