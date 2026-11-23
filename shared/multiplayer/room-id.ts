/**
 * Room DO names: `gameSlug:code` so games never collide.
 * WebSocket path and Durable Object name must include both parts.
 */

export type ParsedRoomId = {
  game: string;
  code: string;
  /** Full Durable Object name / WS path segment */
  roomId: string;
};

export function formatRoomId(game: string, code: string): string {
  const g = game.trim().toLowerCase();
  const c = code.trim().toLowerCase();
  return `${g}:${c}`;
}

/** `game:code`. Bare codes are invalid. */
export function parseRoomId(raw: string): ParsedRoomId | null {
  let trimmed = raw.trim();
  try {
    trimmed = decodeURIComponent(trimmed).trim().toLowerCase();
  } catch {
    return null;
  }
  const idx = trimmed.indexOf(":");
  if (idx <= 0) return null;
  const game = trimmed.slice(0, idx).trim();
  const code = trimmed.slice(idx + 1).trim();
  if (!game || !code) return null;
  return { game, code, roomId: formatRoomId(game, code) };
}

export function generateRoomCode(length = 6): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let code = "";
  for (const b of bytes) {
    code += alphabet[b % alphabet.length]!;
  }
  return code;
}
