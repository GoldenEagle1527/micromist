/**
 * Room DO names: `gameSlug:code` so games never collide.
 * Bare codes (legacy) default to explosive-chess.
 */

export const DEFAULT_GAME_SLUG = "explosive-chess";

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

export function parseRoomId(raw: string): ParsedRoomId {
  const trimmed = decodeURIComponent(raw).trim().toLowerCase();
  const idx = trimmed.indexOf(":");
  if (idx > 0) {
    const game = trimmed.slice(0, idx);
    const code = trimmed.slice(idx + 1);
    return { game, code, roomId: formatRoomId(game, code) };
  }
  return {
    game: DEFAULT_GAME_SLUG,
    code: trimmed,
    roomId: formatRoomId(DEFAULT_GAME_SLUG, trimmed),
  };
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
