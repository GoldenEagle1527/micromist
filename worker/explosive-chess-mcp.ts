/**
 * Hosted MCP facade for explosive-chess.
 * One Durable Object per MCP session holds the outbound room WebSocket.
 * Game state stays in GameRoom. This object only dials `/ws/explosive-chess:<code>`.
 */
import { DurableObject } from "cloudflare:workers";
import { matchExplosiveChessMcpPath } from "../shared/explosive-chess/agent-guide";
import {
  explosiveChessMcpHttp,
  legacySseResponse,
  mcpCorsPreflight,
} from "../shared/explosive-chess/mcp-rpc";
import {
  bindRoomSocket,
  ExplosiveChessMcpSession,
  type RoomSocket,
  type SeatMemory,
} from "../shared/explosive-chess/mcp-session";

const STORAGE_KEY = "mcp_seat_v1";

async function socketFromResponse(response: Response): Promise<RoomSocket> {
  const ws = response.webSocket;
  if (!ws) throw new Error(`room upgrade failed: ${response.status}`);
  ws.accept();
  return bindRoomSocket(ws as unknown as Parameters<typeof bindRoomSocket>[0]);
}

function roomCodeFromWsUrl(wsUrl: string): string {
  const httpUrl = wsUrl.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:");
  const segment = decodeURIComponent(new URL(httpUrl).pathname.replace(/^\/ws\//, ""));
  const idx = segment.indexOf(":");
  return (idx >= 0 ? segment.slice(idx + 1) : segment).trim().toLowerCase();
}

/**
 * Dial the room the same way a browser would: Upgrade on `/ws/explosive-chess:<code>`.
 * If the public hairpin fails (common in local dev), open that upgrade on the GameRoom stub.
 */
export async function dialExplosiveChessRoom(wsUrl: string, env: Env): Promise<RoomSocket> {
  const httpUrl = wsUrl.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:");
  const init = { headers: { Upgrade: "websocket" } };
  try {
    const response = await fetch(httpUrl, { ...init, signal: AbortSignal.timeout(8_000) });
    return await socketFromResponse(response);
  } catch (err) {
    console.error("explosive-chess mcp public dial failed; opening GameRoom directly", err);
  }
  const code = roomCodeFromWsUrl(wsUrl);
  const stub = env.GAME_ROOM.getByName(`explosive-chess:${code}`);
  return socketFromResponse(await stub.fetch(new Request(httpUrl, init)));
}

export class ExplosiveChessMcp extends DurableObject<Env> {
  private session: ExplosiveChessMcpSession | null = null;
  private legacySend: ((json: unknown) => void) | null = null;
  private saved: SeatMemory | null = null;
  private readonly ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      this.saved = (await this.ctx.storage.get<SeatMemory>(STORAGE_KEY)) ?? null;
    });
  }

  private ensureSession(origin: string): ExplosiveChessMcpSession {
    if (this.session) return this.session;
    const session = new ExplosiveChessMcpSession({
      origin,
      dial: (url) => dialExplosiveChessRoom(url, this.env),
      onSeat: (memory) => {
        if (memory) void this.ctx.storage.put(STORAGE_KEY, memory);
        else void this.ctx.storage.delete(STORAGE_KEY);
      },
    });
    if (this.saved) session.restore(this.saved);
    this.session = session;
    return session;
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);
    const kind = matchExplosiveChessMcpPath(url.pathname);
    if (!kind) return new Response("Not found\n", { status: 404 });
    const sessionId =
      request.headers.get("mcp-session-id") ?? url.searchParams.get("sessionId") ?? this.ctx.id.name ?? "";
    const session = this.ensureSession(url.origin);
    if (kind === "sse" && request.method === "GET") {
      return legacySseResponse(url.origin, sessionId, (send) => {
        this.legacySend = send;
      });
    }
    return explosiveChessMcpHttp(request, session, sessionId, this.legacySend);
  }
}

function plain(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/** Worker entry. Unknown `/mcp/*` paths 404. chroma-slide is not served here. */
export async function routeExplosiveChessMcp(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/mcp" && !url.pathname.startsWith("/mcp/")) return null;
  const kind = matchExplosiveChessMcpPath(url.pathname);
  if (!kind) {
    return plain(404, "No MCP at this path.\nexplosive-chess: /mcp/explosive-chess\n");
  }
  if (request.method === "OPTIONS") return mcpCorsPreflight();

  let sessionId = request.headers.get("mcp-session-id") || url.searchParams.get("sessionId") || "";
  let body: string | undefined;
  if (!sessionId && request.method === "POST") {
    body = await request.text();
    let initialize = false;
    try {
      const parsed = JSON.parse(body) as { method?: string } | Array<{ method?: string }>;
      const method = Array.isArray(parsed) ? parsed[0]?.method : parsed?.method;
      initialize = method === "initialize";
    } catch {
      initialize = false;
    }
    if (!initialize) return plain(400, "Mcp-Session-Id required\n");
    sessionId = crypto.randomUUID();
  } else if (!sessionId) {
    sessionId = crypto.randomUUID();
  }

  const headers = new Headers(request.headers);
  headers.set("mcp-session-id", sessionId);
  const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.method !== "DELETE";
  const forwarded = new Request(request.url, {
    method: request.method,
    headers,
    body: hasBody ? (body ?? (await request.text())) : undefined,
  });
  return env.EXPLOSIVE_CHESS_MCP.getByName(sessionId).fetch(forwarded);
}
