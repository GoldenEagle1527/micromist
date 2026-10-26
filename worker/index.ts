import { parseRoomId } from "../shared/multiplayer";
import { handleAgentGuide } from "./agent-guide";
import { ExplosiveChessMcp } from "./explosive-chess-mcp";
import { GameRoom } from "./game-room";

export { GameRoom, ExplosiveChessMcp };

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

    // Public Agent Guide. Must run in the Worker so curl/agents get the protocol
    // body, not the SPA shell. Listed in assets.run_worker_first.
    if (url.pathname === "/agent-guide" || url.pathname.startsWith("/agent-guide/")) {
      const guide = handleAgentGuide(request);
      if (guide) return guide;
    }

    // Former explosive-chess MCP path. The session class stays exported for the
    // existing Durable Object migration, but this host does not serve MCP.
    // Keep the path on run_worker_first so the SPA shell is not returned here.
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return new Response(
        "No MCP server on this host.\nExplosive-chess agents use the official clients linked from /agent-guide/explosive-chess.\n",
        {
          status: 404,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        },
      );
    }

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
