import { DurableObject } from "cloudflare:workers";

type Session = {
  id: string;
};

/**
 * One instance per game room. Hibernation WebSocket skeleton.
 *
 * Room coordination stays in memory so it dies when the isolate is evicted
 * and when the last client leaves. SQLite is enabled only because Workers
 * Free requires `new_sqlite_classes` — this stub does not write a user DB.
 */
export class GameRoom extends DurableObject<Env> {
  sessions: Map<WebSocket, Session>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sessions = new Map();

    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Session | undefined;
      if (attachment) {
        this.sessions.set(ws, { ...attachment });
      }
    }

    // Application-level ping/pong does not wake a hibernating object.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    const id = crypto.randomUUID();
    server.serializeAttachment({ id });
    this.sessions.set(server, { id });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const session = this.sessions.get(ws);
    const payload = typeof message === "string" ? message : `[binary ${message.byteLength}b]`;

    ws.send(
      JSON.stringify({
        type: "echo",
        room: "in-memory",
        from: session?.id ?? "unknown",
        peers: this.sessions.size,
        payload,
      }),
    );
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.sessions.delete(ws);
    ws.close(code, reason);
  }
}
