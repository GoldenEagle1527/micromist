/**
 * Seat presence across Durable Object hibernation.
 *
 * Storage keeps the seat and always stores `connected: false` (presence is
 * live-only). On wake, `restore()` reloads that snapshot. Open sockets must be
 * applied after that reload: the constructor's synchronous `getWebSockets()`
 * pass runs before `storage.get` resumes, and `players.clear()` would drop it.
 * A guest join then broadcasts the host as offline and will not start the match.
 */
import { normalizePlayerKind } from "../../shared/multiplayer";
import type { PlayerRecord, SessionAttachment } from "./types";

export type LiveSocket<T> = {
  socket: T;
  attachment: SessionAttachment | null | undefined;
};

/** Replace `players` with a storage snapshot. Every seat comes back offline. */
export function replacePlayersFromSnapshot(
  players: Map<string, PlayerRecord>,
  saved: readonly PlayerRecord[],
): void {
  players.clear();
  for (const p of saved) {
    players.set(p.playerId, {
      ...p,
      connected: false,
      ready: false,
      kind: normalizePlayerKind(p.kind),
    });
  }
}

/**
 * Mark seats that still have an open socket as connected.
 * Returns a host id only when that player was missing from the snapshot
 * (join was attached, then the DO hibernated before persist).
 */
export function overlayLiveSockets<T>(
  players: Map<string, PlayerRecord>,
  sessions: Map<T, SessionAttachment>,
  sockets: Iterable<LiveSocket<T>>,
): string | null {
  let newHostId: string | null = null;
  for (const { socket, attachment } of sockets) {
    if (!attachment?.playerId) continue;
    sessions.set(socket, { ...attachment });
    const existing = players.get(attachment.playerId);
    if (existing) {
      existing.connected = true;
      existing.seat = attachment.seat;
      existing.role = attachment.role;
      existing.name = attachment.name || existing.name;
      existing.kind = normalizePlayerKind(attachment.kind ?? existing.kind);
    } else {
      players.set(attachment.playerId, {
        playerId: attachment.playerId,
        name: attachment.name || "Player",
        seat: attachment.seat,
        role: attachment.role,
        ready: false,
        rematch: false,
        connected: true,
        kind: normalizePlayerKind(attachment.kind),
      });
      if (attachment.role === "host") newHostId = attachment.playerId;
    }
  }
  return newHostId;
}
