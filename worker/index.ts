import { parseRoomId } from "../shared/multiplayer";
import { GameRoom } from "./game-room";

export { GameRoom };

/**
 * Route WebSocket upgrades to a Durable Object named `gameSlug:code`.
 * Bare codes are treated as explosive-chess (legacy share links).
 */
function roomIdFromPath(pathname: string): string | null {
  if (pathname === "/ws" || pathname === "/ws/") {
    return null;
  }
  const match = pathname.match(/^\/ws\/([^/]+)$/);
  if (!match?.[1]) return null;
  return parseRoomId(match[1]).roomId;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const roomId = roomIdFromPath(url.pathname);

    if (url.pathname === "/ws" || url.pathname === "/ws/" || roomId !== null) {
      if (roomId === null) {
        return Response.json(
          { error: "Missing room id. Upgrade at /ws/:roomId (game:code)" },
          { status: 400 },
        );
      }

      const upgrade = request.headers.get("Upgrade");
      if (!upgrade || upgrade.toLowerCase() !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }
      if (request.method !== "GET") {
        return new Response("Expected GET", { status: 400 });
      }

      // Rewrite path so the DO sees the canonical namespaced id.
      const canonical = new URL(request.url);
      canonical.pathname = `/ws/${encodeURIComponent(roomId)}`;
      const stub = env.GAME_ROOM.getByName(roomId);
      return stub.fetch(new Request(canonical, request));
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
