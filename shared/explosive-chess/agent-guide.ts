/**
 * Public explosive-chess Agent Guide.
 * Protocol body: docs/agent-ws-explosive-chess.md (the Worker imports that file).
 * This module only adds the live host banner, HTML page, and HTTP negotiation.
 */

export const EXPLOSIVE_CHESS_AGENT_GUIDE_PATH = "/agent-guide/explosive-chess";

export type AgentGuideMatch = "page" | "markdown" | "index" | "unknown" | null;

export function matchAgentGuidePath(pathname: string): AgentGuideMatch {
  let path = pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path === "/agent-guide") return "index";
  if (path === EXPLOSIVE_CHESS_AGENT_GUIDE_PATH) return "page";
  if (path === `${EXPLOSIVE_CHESS_AGENT_GUIDE_PATH}.md`) return "markdown";
  if (path.startsWith("/agent-guide/")) return "unknown";
  return null;
}

export function wsOriginFromHttp(origin: string): {
  httpOrigin: string;
  wsOrigin: string;
  host: string;
} {
  const url = new URL(origin);
  const wsProto = url.protocol === "https:" ? "wss:" : "ws:";
  return {
    httpOrigin: url.origin,
    wsOrigin: `${wsProto}//${url.host}`,
    host: url.host,
  };
}

export function explosiveChessGuideUrl(origin: string): string {
  return `${wsOriginFromHttp(origin).httpOrigin}${EXPLOSIVE_CHESS_AGENT_GUIDE_PATH}`;
}

/** `wss://<host>/ws/explosive-chess:<code>` — colon stays literal so agents can paste it. */
export function explosiveChessWsUrl(origin: string, roomCode: string): string {
  const code = roomCode.trim().toLowerCase();
  return `${wsOriginFromHttp(origin).wsOrigin}/ws/explosive-chess:${code}`;
}

export type ExplosiveRoomEndpoints = {
  origin: string;
  guideUrl: string;
  wsUrl: string;
  roomCode: string;
};

export function explosiveChessRoomEndpoints(origin: string, roomCode: string): ExplosiveRoomEndpoints {
  const ends = wsOriginFromHttp(origin);
  const code = roomCode.trim().toLowerCase();
  return {
    origin: ends.httpOrigin,
    guideUrl: `${ends.httpOrigin}${EXPLOSIVE_CHESS_AGENT_GUIDE_PATH}`,
    wsUrl: `${ends.wsOrigin}/ws/explosive-chess:${code}`,
    roomCode: code,
  };
}

/** Prepend the host that actually served this response. The protocol body is unchanged. */
export function composeAgentGuide(origin: string, protocolMarkdown: string): string {
  const ends = wsOriginFromHttp(origin);
  const guideUrl = `${ends.httpOrigin}${EXPLOSIVE_CHESS_AGENT_GUIDE_PATH}`;
  const banner = [
    "# 当前站点 / This host",
    "",
    "下面的 origin 就是**这份响应**所在的环境（staging、production 或 local）。WebSocket 用同一 host。主页上的提示会让你先读这份指南，再问人类：对下、由你建房，还是已有房间码。若提示里已经写了 `wss://…/ws/explosive-chess:<code>`，以那个 URL 为准。",
    "",
    "The origin below is the deployment that served this Agent Guide. Open the WebSocket on the same host. The home-page prompt tells you to read this guide, then ask the human whether to play them, create a room, or use a room code they already have. If the pasted prompt already contains a `wss://…/ws/explosive-chess:<code>` URL, use that exact URL. Room id prefix: `explosive-chess:`.",
    "",
    `- origin: ${ends.httpOrigin}`,
    `- host: ${ends.host}`,
    `- agent guide: ${guideUrl}`,
    `- markdown: ${guideUrl}.md`,
    `- websocket: ${ends.wsOrigin}/ws/explosive-chess:<code>`,
    "- Upgrade: websocket",
    "- no MCP",
    "",
    "---",
    "",
  ].join("\n");
  return `${banner}${protocolMarkdown.trim()}\n`;
}

/**
 * HTML when the client asks for it (browsers). Otherwise the caller returns markdown,
 * which is what curl and most agents receive.
 */
export function prefersHtml(accept: string | null, format: string | null): boolean {
  const fmt = format?.trim().toLowerCase() ?? "";
  if (fmt === "md" || fmt === "markdown" || fmt === "txt" || fmt === "text") return false;
  if (fmt === "html") return true;
  if (!accept) return false;
  let htmlQ = -1;
  let mdQ = -1;
  for (const part of accept.split(",")) {
    const [rawType, ...params] = part
      .trim()
      .toLowerCase()
      .split(";")
      .map((s) => s.trim());
    if (!rawType) continue;
    const qParam = params.find((p) => p.startsWith("q="));
    const q = qParam ? Number(qParam.slice(2)) : 1;
    if (!Number.isFinite(q)) continue;
    if (rawType === "text/html" || rawType === "application/xhtml+xml") htmlQ = Math.max(htmlQ, q);
    else if (
      rawType === "text/markdown" ||
      rawType === "text/plain" ||
      rawType === "text/x-markdown"
    ) {
      mdQ = Math.max(mdQ, q);
    }
  }
  if (htmlQ < 0) return false;
  if (mdQ < 0) return true;
  return htmlQ > mdQ;
}

function escText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escAttr(value: string): string {
  return escText(value).replace(/"/g, "&quot;");
}

function inline(source: string): string {
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let html = "";
  while ((match = re.exec(source))) {
    html += escText(source.slice(last, match.index));
    if (match[1] != null) html += `<code>${escText(match[1])}</code>`;
    else if (match[2] != null) html += `<strong>${escText(match[2])}</strong>`;
    else if (match[3] != null && match[4] != null) {
      html += `<a href="${escAttr(match[4])}">${escText(match[3])}</a>`;
    }
    last = match.index + match[0].length;
  }
  html += escText(source.slice(last));
  return html;
}

/** Small markdown subset used by the agent guide. Unrecognized lines stay as paragraphs. */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  const para: string[] = [];
  const flushPara = (): void => {
    if (para.length === 0) return;
    out.push(`<p>${inline(para.join(" "))}</p>`);
    para.length = 0;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("```")) {
      flushPara();
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
        buf.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      const cls = lang ? ` class="language-${escAttr(lang)}"` : "";
      out.push(`<pre><code${cls}>${escText(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if (line.trim() === "") {
      flushPara();
      i += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading?.[1] && heading[2] != null) {
      flushPara();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }
    if (line.trim() === "---") {
      flushPara();
      out.push("<hr>");
      i += 1;
      continue;
    }
    if (line.startsWith("> ")) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith("> ")) {
        quote.push((lines[i] ?? "").slice(2));
        i += 1;
      }
      out.push(`<blockquote><p>${inline(quote.join(" "))}</p></blockquote>`);
      continue;
    }
    para.push(line.trim());
    i += 1;
  }
  flushPara();
  return out.join("\n");
}

export function renderAgentGuideHtml(markdown: string, rawUrl: string): string {
  const body = renderMarkdown(markdown);
  const raw = escAttr(rawUrl);
  return `<!DOCTYPE html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>爆炸棋 Agent Guide · explosive-chess</title>
<meta name="description" content="explosive-chess WebSocket agent guide: join kind agent, your_turn, legalActions. No MCP.">
<link rel="alternate" type="text/markdown" href="${raw}">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif; line-height: 1.55; background: #f6f4ef; color: #1c1b19; }
  main { max-width: 44rem; margin: 0 auto; padding: 1.5rem 1.1rem 3rem; }
  h1 { font-size: 1.55rem; line-height: 1.25; }
  h2 { font-size: 1.15rem; margin-top: 1.7rem; }
  a { color: #0b57d0; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.88em; background: #efeae2; padding: 0.08em 0.28em; border-radius: 4px; }
  pre { overflow: auto; padding: 0.8rem 0.9rem; background: #efeae2; border-radius: 8px; }
  pre code { background: transparent; padding: 0; white-space: pre; }
  .banner { font-size: 0.92rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #161513; color: #ece8e1; }
    a { color: #9ecbff; }
    code, pre { background: #241f1b; }
  }
</style>
</head>
<body>
<main>
<p class="banner">Agent Guide · explosive-chess · <a href="${raw}">text/markdown</a> · no MCP</p>
${body}
</main>
</body>
</html>
`;
}

const GUIDE_CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "Accept, Content-Type",
};

function guideHeaders(contentType: string): Headers {
  const headers = new Headers(GUIDE_CORS);
  headers.set("content-type", contentType);
  headers.set("cache-control", "public, max-age=60");
  headers.set("x-content-type-options", "nosniff");
  headers.set("vary", "Accept");
  return headers;
}

/**
 * Response for `/agent-guide…`, or null when the path is not an agent guide
 * (caller continues with WebSocket / asset routing).
 */
export function agentGuideHttpResponse(request: Request, protocolMarkdown: string): Response | null {
  const url = new URL(request.url);
  const kind = matchAgentGuidePath(url.pathname);
  if (kind === null) return null;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: GUIDE_CORS });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    const headers = guideHeaders("text/plain; charset=utf-8");
    headers.set("allow", "GET, HEAD, OPTIONS");
    return new Response(request.method === "HEAD" ? null : "Expected GET\n", {
      status: 405,
      headers,
    });
  }

  if (kind === "unknown") {
    const headers = guideHeaders("text/plain; charset=utf-8");
    const body = `No agent guide at this path.\nexplosive-chess: ${url.origin}${EXPLOSIVE_CHESS_AGENT_GUIDE_PATH}\n`;
    return new Response(request.method === "HEAD" ? null : body, { status: 404, headers });
  }

  if (kind === "index") {
    const headers = guideHeaders("text/plain; charset=utf-8");
    const body = [
      `explosive-chess agent guide: ${url.origin}${EXPLOSIVE_CHESS_AGENT_GUIDE_PATH}`,
      `markdown: ${url.origin}${EXPLOSIVE_CHESS_AGENT_GUIDE_PATH}.md`,
      "",
    ].join("\n");
    return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
  }

  const markdown = composeAgentGuide(url.origin, protocolMarkdown);
  const rawUrl = `${url.origin}${EXPLOSIVE_CHESS_AGENT_GUIDE_PATH}.md`;
  const wantHtml =
    kind === "page" && prefersHtml(request.headers.get("accept"), url.searchParams.get("format"));
  if (wantHtml) {
    const headers = guideHeaders("text/html; charset=utf-8");
    const html = renderAgentGuideHtml(markdown, rawUrl);
    return new Response(request.method === "HEAD" ? null : html, { status: 200, headers });
  }
  const headers = guideHeaders("text/markdown; charset=utf-8");
  return new Response(request.method === "HEAD" ? null : markdown, { status: 200, headers });
}
