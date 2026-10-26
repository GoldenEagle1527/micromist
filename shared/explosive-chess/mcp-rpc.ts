/**
 * MCP JSON-RPC for explosive-chess.
 * Streamable HTTP is the hosted transport. SSE is the legacy entry on the same session.
 * Stdio uses Content-Length framing. Neither transport chooses a move.
 */
import {
  ExplosiveChessMcpSession,
  type ToolBody,
} from "./mcp-session";

const EXPLOSIVE_CHESS_MCP_PATH = "/mcp/explosive-chess";

function explosiveChessMcpUrl(origin: string): string {
  return `${new URL(origin).origin}${EXPLOSIVE_CHESS_MCP_PATH}`;
}

export const MCP_PROTOCOL_VERSION = "2025-03-26";
export const MCP_SERVER_NAME = "micromist-explosive-chess";
export const MCP_SERVER_VERSION = "0.1.0";

const WAIT_DEFAULT_MS = 30_000;
const WAIT_MIN_MS = 25_000;
const WAIT_MAX_MS = 55_000;

export function clampWaitMs(timeoutSeconds: unknown): number {
  if (typeof timeoutSeconds !== "number" || !Number.isFinite(timeoutSeconds)) return WAIT_DEFAULT_MS;
  return Math.min(WAIT_MAX_MS, Math.max(WAIT_MIN_MS, Math.round(timeoutSeconds * 1000)));
}

type ToolDef = {
  name: string;
  description: string;
  inputSchema: object;
};

const configSchema = {
  type: "object",
  additionalProperties: false,
  required: ["boardSize", "winMode", "winParam", "hostColor"],
  properties: {
    boardSize: { type: "number", enum: [9, 11, 13], description: "9, 11, or 13" },
    winMode: {
      type: "string",
      enum: ["annihilation", "steps", "area"],
      description: "annihilation is long. steps with a small winParam finishes sooner.",
    },
    winParam: { type: "integer", minimum: 1 },
    hostColor: { type: "string", enum: ["red", "blue"] },
  },
};

export const explosiveChessMcpTools: readonly ToolDef[] = [
  {
    name: "create_room",
    description:
      "Open the room WebSocket and join as kind agent. The first seated player is the host. Optional roomCode ([a-z0-9]); otherwise a 6 character code is chosen. Returns roomCode and playUrl for the human. The socket stays open. Does not choose a move.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        roomCode: { type: "string", description: "Optional [a-z0-9] room code." },
        playerId: { type: "string", description: "Stable id. Reclaim uses the same id." },
        name: { type: "string", description: "Seat name. Default Agent." },
      },
    },
  },
  {
    name: "join_room",
    description:
      "Join an existing explosive-chess room as kind agent and hold the WebSocket. roomCode is required. Does not choose a move.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["roomCode"],
      properties: {
        roomCode: { type: "string" },
        playerId: { type: "string" },
        name: { type: "string" },
      },
    },
  },
  {
    name: "set_config",
    description:
      "Host only, once, while the room is still a lobby and before the other player sits. Skip this tool to keep the defaults (9×9 annihilation, host red). A guest call is rejected and does not change rules.",
    inputSchema: configSchema,
  },
  {
    name: "wait_for_turn",
    description:
      "Long-poll the open room socket for about 25–55 seconds (default 30). On your_turn or game_over, returns the observation: board, legalActions, and rules. On timeout returns event no_update and the socket stays open — call wait_for_turn again. Stack those calls while a human thinks. Does not choose a move.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        timeoutSeconds: {
          type: "number",
          minimum: 25,
          maximum: 55,
          description: "Clamped to 25–55. Default 30.",
        },
      },
    },
  },
  {
    name: "take_turn",
    description:
      "Send one placement. row and col must be an entry from the last legalActions. Any other cell is rejected here and is not sent. Then call wait_for_turn. This tool does not search and does not pick a cell for you.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["row", "col"],
      properties: {
        row: { type: "integer" },
        col: { type: "integer" },
      },
    },
  },
  {
    name: "get_state",
    description:
      "Debug only. One observation snapshot. Not part of the play loop. Use wait_for_turn to wait for your turn or game_over.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
];

type JsonRpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function rpcResult(id: string | number | null, result: unknown): unknown {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: string | number | null, code: number, message: string): unknown {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolResult(body: ToolBody): unknown {
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    isError: body.ok === false,
  };
}

async function runTool(session: ExplosiveChessMcpSession, name: string, args: Record<string, unknown>): Promise<ToolBody> {
  switch (name) {
    case "create_room":
      return session.createRoom(args);
    case "join_room":
      return session.joinRoom(args);
    case "set_config":
      return session.setConfig(args);
    case "wait_for_turn":
      return session.waitForTurn(clampWaitMs(args.timeoutSeconds));
    case "take_turn":
      return session.takeTurn(args.row, args.col);
    case "get_state":
      return session.getState();
    default:
      return { ok: false, event: "error", error: `Unknown tool: ${name}` };
  }
}

export async function dispatchMcpMessage(
  session: ExplosiveChessMcpSession,
  message: unknown,
): Promise<unknown | null> {
  const rpc = asRecord(message) as JsonRpc | null;
  if (!rpc || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
    const id = rpc && "id" in rpc ? (rpc.id ?? null) : null;
    return rpcError(id, -32600, "Invalid Request");
  }
  const hasId = Object.prototype.hasOwnProperty.call(rpc, "id");
  const id = hasId ? (rpc.id ?? null) : undefined;
  if (!hasId) {
    if (rpc.method === "notifications/initialized" || rpc.method === "notifications/cancelled") return null;
    return null;
  }
  switch (rpc.method) {
    case "initialize":
      return rpcResult(id ?? null, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        instructions:
          "You choose every move from legalActions. This server has no chess engine. wait_for_turn returns no_update on timeout; call it again. The server holds the room WebSocket.",
      });
    case "ping":
      return rpcResult(id ?? null, {});
    case "tools/list":
      return rpcResult(id ?? null, { tools: explosiveChessMcpTools });
    case "tools/call": {
      const params = asRecord(rpc.params);
      const name = typeof params?.name === "string" ? params.name : "";
      const args = asRecord(params?.arguments) ?? {};
      if (!name) return rpcError(id ?? null, -32602, "tools/call requires name");
      try {
        const body = await runTool(session, name, args);
        return rpcResult(id ?? null, toolResult(body));
      } catch (err) {
        const message = err instanceof Error ? err.message : "tool failed";
        return rpcResult(id ?? null, toolResult({ ok: false, event: "error", error: message }));
      }
    }
    default:
      return rpcError(id ?? null, -32601, `Method not found: ${rpc.method}`);
  }
}

export async function dispatchMcpBody(
  session: ExplosiveChessMcpSession,
  raw: string,
): Promise<unknown[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [rpcError(null, -32700, "Parse error")];
  }
  if (Array.isArray(parsed)) {
    const out: unknown[] = [];
    for (const item of parsed) {
      const response = await dispatchMcpMessage(session, item);
      if (response) out.push(response);
    }
    return out;
  }
  const response = await dispatchMcpMessage(session, parsed);
  return response ? [response] : [];
}

const MCP_CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "Accept, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
  "access-control-expose-headers": "Mcp-Session-Id, MCP-Protocol-Version",
};

export function mcpCorsPreflight(): Response {
  const headers = new Headers(MCP_CORS);
  headers.set("mcp-protocol-version", MCP_PROTOCOL_VERSION);
  return new Response(null, { status: 204, headers });
}

function mcpHeaders(sessionId: string, contentType?: string): Headers {
  const headers = new Headers(MCP_CORS);
  headers.set("cache-control", "no-store");
  headers.set("mcp-session-id", sessionId);
  headers.set("mcp-protocol-version", MCP_PROTOCOL_VERSION);
  if (contentType) headers.set("content-type", contentType);
  return headers;
}

function wantsJson(accept: string | null): boolean {
  if (!accept) return true;
  if (accept.includes("application/json") || accept.includes("*/*")) return true;
  return false;
}

function sseChunk(event: string, data: string): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${data}\n\n`);
}

export function legacySseEndpoint(origin: string, sessionId: string): string {
  const url = new URL(explosiveChessMcpUrl(origin));
  url.searchParams.set("sse", "1");
  url.searchParams.set("sessionId", sessionId);
  return url.toString();
}

/** Legacy SSE: first event tells the client where to POST. The stream stays open. */
export function legacySseResponse(
  origin: string,
  sessionId: string,
  register: (send: ((json: unknown) => void) | null) => void,
): Response {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (json: unknown): void => {
        controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(json)}\n\n`));
      };
      register(send);
      controller.enqueue(sseChunk("endpoint", legacySseEndpoint(origin, sessionId)));
      timer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* closed */
        }
      }, 15_000);
    },
    cancel() {
      if (timer) clearInterval(timer);
      register(null);
    },
  });
  const headers = mcpHeaders(sessionId, "text/event-stream; charset=utf-8");
  headers.set("cache-control", "no-cache, no-transform");
  headers.set("x-accel-buffering", "no");
  return new Response(stream, { status: 200, headers });
}

/**
 * Streamable HTTP on `/mcp/explosive-chess`.
 * GET is the server-message SSE stream. POST returns the JSON-RPC result.
 * `?sse=1` is the legacy POST: the body is pushed to `legacySend` and the status is 202.
 */
export async function explosiveChessMcpHttp(
  request: Request,
  session: ExplosiveChessMcpSession,
  sessionId: string,
  legacySend?: ((json: unknown) => void) | null,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: mcpHeaders(sessionId) });
  }
  if (request.method === "DELETE") {
    session.close();
    return new Response(null, { status: 200, headers: mcpHeaders(sessionId) });
  }
  if (request.method === "GET") {
    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setInterval> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(": explosive-chess mcp\n\n"));
        timer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            /* closed */
          }
        }, 15_000);
      },
      cancel() {
        if (timer) clearInterval(timer);
      },
    });
    const headers = mcpHeaders(sessionId, "text/event-stream; charset=utf-8");
    headers.set("cache-control", "no-cache, no-transform");
    return new Response(stream, { status: 200, headers });
  }
  if (request.method !== "POST") {
    const headers = mcpHeaders(sessionId, "text/plain; charset=utf-8");
    headers.set("allow", "GET, POST, DELETE, OPTIONS");
    return new Response("Expected POST\n", { status: 405, headers });
  }
  const accept = request.headers.get("accept");
  if (accept && !wantsJson(accept) && !accept.includes("text/event-stream")) {
    return new Response("Expected application/json or text/event-stream\n", {
      status: 406,
      headers: mcpHeaders(sessionId, "text/plain; charset=utf-8"),
    });
  }
  const raw = await request.text();
  const responses = raw.trim() ? await dispatchMcpBody(session, raw) : [];
  const legacy = url.searchParams.get("sse") === "1";
  if (legacy) {
    if (legacySend) {
      for (const message of responses) legacySend(message);
    }
    return new Response(null, { status: 202, headers: mcpHeaders(sessionId) });
  }
  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: mcpHeaders(sessionId) });
  }
  const payload = responses.length === 1 ? responses[0] : responses;
  const body = JSON.stringify(payload);
  if (accept && !wantsJson(accept) && accept.includes("text/event-stream")) {
    const headers = mcpHeaders(sessionId, "text/event-stream; charset=utf-8");
    const streamBody = `event: message\ndata: ${body}\n\n`;
    return new Response(streamBody, { status: 200, headers });
  }
  return new Response(body, {
    status: 200,
    headers: mcpHeaders(sessionId, "application/json; charset=utf-8"),
  });
}

export function encodeStdioMessage(message: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(message));
  const header = new TextEncoder().encode(`Content-Length: ${body.byteLength}\r\n\r\n`);
  const out = new Uint8Array(header.byteLength + body.byteLength);
  out.set(header, 0);
  out.set(body, header.byteLength);
  return out;
}

export function takeStdioMessages(buffer: Uint8Array): { messages: unknown[]; rest: Uint8Array } {
  const messages: unknown[] = [];
  let offset = 0;
  const decoder = new TextDecoder();
  while (offset < buffer.length) {
    const headerEnd = indexOfCrlfCrlf(buffer, offset);
    if (headerEnd < 0) break;
    const header = decoder.decode(buffer.subarray(offset, headerEnd));
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match?.[1]) {
      offset = headerEnd + 4;
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) break;
    const json = decoder.decode(buffer.subarray(start, start + length));
    offset = start + length;
    try {
      messages.push(JSON.parse(json) as unknown);
    } catch {
      messages.push({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
  }
  return { messages, rest: buffer.subarray(offset) };
}

function indexOfCrlfCrlf(buffer: Uint8Array, from: number): number {
  for (let i = from; i + 3 < buffer.length; i += 1) {
    if (buffer[i] === 13 && buffer[i + 1] === 10 && buffer[i + 2] === 13 && buffer[i + 3] === 10) {
      return i;
    }
  }
  return -1;
}

export function stdioHelp(): string {
  return [
    `${MCP_SERVER_NAME} — MCP facade for explosive-chess.`,
    "Holds one room WebSocket. It has no chess strength. You choose from legalActions.",
    "",
    "stdio (Content-Length frames). Default origin is staging.",
    "  MICROMIST_ORIGIN=https://micromist-staging.goldeneaglepersonal.dpdns.org node <this-file>",
    `  --origin https://host   room socket wss://host/ws/explosive-chess:<code>`,
    `Tools: ${explosiveChessMcpTools.map((tool) => tool.name).join(", ")}`,
    "Hosted HTTP MCP is not published. Agents play with the official clients from /agent-guide/explosive-chess.",
    "",
  ].join("\n");
}
