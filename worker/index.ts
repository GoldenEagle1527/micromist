import { GameRoom } from "./game-room";

export { GameRoom };

/**
 * Route WebSocket upgrades to a Durable Object named by room id.
 *
 * Currently every GameRoom runs 爆炸棋 / Explosive Chess. Room ids are opaque
 * strings (short lobby codes from the SPA). A future multi-game platform can
 * namespace as `explosive-chess:<id>` without changing the DO class.
 */
function roomIdFromPath(pathname: string): string | null {
  if (pathname === "/ws" || pathname === "/ws/") {
    return null;
  }
  const match = pathname.match(/^\/ws\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const roomId = roomIdFromPath(url.pathname);

    if (url.pathname === "/ws" || url.pathname === "/ws/" || roomId !== null) {
      if (roomId === null) {
        return Response.json(
          { error: "Missing room id. Upgrade at /ws/:roomId" },
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

      const stub = env.GAME_ROOM.getByName(roomId);
      return stub.fetch(request);
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
