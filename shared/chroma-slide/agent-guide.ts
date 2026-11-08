/**
 * Public chroma-slide Agent Guide.
 * Protocol bodies: docs/agent-ws-chroma-slide.md and docs/agent-ws-chroma-slide.zh.md.
 */
import {
  localeFromAcceptLanguage,
  prefersHtml,
  renderAgentGuideHtml,
  wsOriginFromHttp,
  type AgentLocale,
} from "../explosive-chess/agent-guide";

export const CHROMA_SLIDE_AGENT_GUIDE_PATH = "/agent-guide/chroma-slide";

export const CHROMA_SLIDE_CLIENT_DIR = "/agent-clients/chroma-slide";

export const chromaSlideClients = {
  node: `${CHROMA_SLIDE_CLIENT_DIR}/server.mjs`,
  python: `${CHROMA_SLIDE_CLIENT_DIR}/server.py`,
} as const;

export type { AgentLocale };

export type AgentGuideMatch = "page" | "markdown" | null;

export type AgentGuideProtocols = {
  en: string;
  zh: string;
};

function stripTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

/** Null when this request belongs to another guide (or is not a guide). */
export function matchChromaGuidePath(pathname: string): AgentGuideMatch {
  const path = stripTrailingSlash(pathname);
  if (
    path === CHROMA_SLIDE_AGENT_GUIDE_PATH ||
    path === `${CHROMA_SLIDE_AGENT_GUIDE_PATH}/zh` ||
    path === `${CHROMA_SLIDE_AGENT_GUIDE_PATH}/en`
  ) {
    return "page";
  }
  if (
    path === `${CHROMA_SLIDE_AGENT_GUIDE_PATH}.md` ||
    path === `${CHROMA_SLIDE_AGENT_GUIDE_PATH}/zh.md` ||
    path === `${CHROMA_SLIDE_AGENT_GUIDE_PATH}/en.md`
  ) {
    return "markdown";
  }
  return null;
}

export function localeFromChromaGuidePath(pathname: string): AgentLocale | null {
  const path = stripTrailingSlash(pathname);
  if (path === `${CHROMA_SLIDE_AGENT_GUIDE_PATH}/zh` || path === `${CHROMA_SLIDE_AGENT_GUIDE_PATH}/zh.md`) {
    return "zh";
  }
  if (path === `${CHROMA_SLIDE_AGENT_GUIDE_PATH}/en` || path === `${CHROMA_SLIDE_AGENT_GUIDE_PATH}/en.md`) {
    return "en";
  }
  return null;
}

function localeToken(value: string): AgentLocale | null {
  const token = value.trim().toLowerCase();
  if (token === "zh" || token.startsWith("zh-")) return "zh";
  if (token === "en" || token.startsWith("en-")) return "en";
  return null;
}

export function resolveChromaGuideLocale(url: URL, acceptLanguage: string | null): AgentLocale {
  const fromPath = localeFromChromaGuidePath(url.pathname);
  if (fromPath) return fromPath;
  const query = localeToken(url.searchParams.get("lang") ?? url.searchParams.get("locale") ?? "");
  if (query) return query;
  return localeFromAcceptLanguage(acceptLanguage);
}

export function chromaSlideGuideUrl(origin: string, locale: AgentLocale = "en"): string {
  return `${wsOriginFromHttp(origin).httpOrigin}${CHROMA_SLIDE_AGENT_GUIDE_PATH}/${locale}`;
}

export function chromaSlideClientUrl(origin: string, path: string): string {
  return `${wsOriginFromHttp(origin).httpOrigin}${path}`;
}

export function chromaSlideWsUrl(origin: string, roomCode: string): string {
  const code = roomCode.trim().toLowerCase();
  return `${wsOriginFromHttp(origin).wsOrigin}/ws/chroma-slide:${code}`;
}

export type ChromaRoomEndpoints = {
  origin: string;
  guideUrl: string;
  wsUrl: string;
  roomCode: string;
};

export function chromaSlideRoomEndpoints(
  origin: string,
  roomCode: string,
  locale: AgentLocale = "en",
): ChromaRoomEndpoints {
  const ends = wsOriginFromHttp(origin);
  const code = roomCode.trim().toLowerCase();
  return {
    origin: ends.httpOrigin,
    guideUrl: chromaSlideGuideUrl(ends.httpOrigin, locale),
    wsUrl: `${ends.wsOrigin}/ws/chroma-slide:${code}`,
    roomCode: code,
  };
}

function clientLines(httpOrigin: string): string[] {
  return [
    `- node: ${httpOrigin}${chromaSlideClients.node}`,
    `- python: ${httpOrigin}${chromaSlideClients.python}`,
    "- local HTTP: 127.0.0.1 and an ephemeral port; curl /wait and /move",
  ];
}

export function composeChromaAgentGuide(
  origin: string,
  protocolMarkdown: string,
  locale: AgentLocale = "en",
): string {
  const ends = wsOriginFromHttp(origin);
  const guideUrl = chromaSlideGuideUrl(ends.httpOrigin, locale);
  const clients = clientLines(ends.httpOrigin);
  const banner =
    locale === "zh"
      ? [
          "# 当前站点",
          "",
          "下面的 origin 就是这份响应所在的环境（staging、production 或 local）。WebSocket 和官方客户端下载都用同一 host。这是中文指南。滑动色块设置页（`/play/chroma-slide`）上的提示会让你先读与界面语言一致的指南，再问人类：解一局、难度、由你建房，还是已有房间码。若提示里已经写了 WebSocket URL，以那个 URL 为准。房间前缀是 `chroma-slide:`。这是单人谜题，只有座位 `player`。",
          "",
          "每一步都由你自己决定。官方客户端连上房间后在 127.0.0.1 监听。你 curl /wait，从 legalActions 里选一格，再 curl /move。它不会解题。一个进程握着 WebSocket 直到解出或你退出。没有 MCP。",
          "",
          `- origin: ${ends.httpOrigin}`,
          `- host: ${ends.host}`,
          `- agent guide: ${guideUrl}`,
          `- markdown: ${guideUrl}.md`,
          ...clients,
          `- websocket: ${ends.wsOrigin}/ws/chroma-slide:<code>`,
          "- Upgrade: websocket",
          "- 没有 MCP",
          "",
          "---",
          "",
        ]
      : [
          "# This host",
          "",
          "The origin below is the deployment that served this Agent Guide. Use the same host for the WebSocket and the official client downloads. This page is English. The prompt on the chroma-slide setup page (`/play/chroma-slide`) tells you to read this guide, then ask the human whether to solve a puzzle, which difficulty, whether you should create a room, or whether they already have a room code. If the pasted prompt already contains a websocket URL, use that exact URL. Room id prefix: `chroma-slide:`. This is a solo puzzle with one seat, `player`.",
          "",
          "You choose every slide. The official client connects, then listens on 127.0.0.1. You curl /wait, pick from legalActions, and curl /move. It does not solve the puzzle. One process keeps the WebSocket open until the puzzle is solved or you exit. There is no MCP.",
          "",
          `- origin: ${ends.httpOrigin}`,
          `- host: ${ends.host}`,
          `- agent guide: ${guideUrl}`,
          `- markdown: ${guideUrl}.md`,
          ...clients,
          `- websocket: ${ends.wsOrigin}/ws/chroma-slide:<code>`,
          "- Upgrade: websocket",
          "- no MCP",
          "",
          "---",
          "",
        ];
  return `${banner.join("\n")}${protocolMarkdown.trim()}\n`;
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
  headers.set("vary", "Accept, Accept-Language");
  return headers;
}

/**
 * Response for `/agent-guide/chroma-slide…`, or null when the path is not this guide.
 */
export function chromaAgentGuideHttpResponse(
  request: Request,
  protocols: AgentGuideProtocols,
): Response | null {
  const url = new URL(request.url);
  const kind = matchChromaGuidePath(url.pathname);
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

  const locale = resolveChromaGuideLocale(url, request.headers.get("accept-language"));
  const protocol = locale === "zh" ? protocols.zh : protocols.en;
  const markdown = composeChromaAgentGuide(url.origin, protocol, locale);
  const rawUrl = `${url.origin}${CHROMA_SLIDE_AGENT_GUIDE_PATH}/${locale}.md`;
  const other: AgentLocale = locale === "zh" ? "en" : "zh";
  const alternateUrl = `${url.origin}${CHROMA_SLIDE_AGENT_GUIDE_PATH}/${other}`;
  const wantHtml =
    kind === "page" && prefersHtml(request.headers.get("accept"), url.searchParams.get("format"));
  if (wantHtml) {
    const headers = guideHeaders("text/html; charset=utf-8");
    const title = locale === "zh" ? "滑动色块 Agent Guide" : "chroma-slide Agent Guide";
    const description =
      locale === "zh"
        ? "滑动色块 WebSocket Agent 指南：座位 player、your_turn、legalActions、board。没有 MCP。"
        : "chroma-slide WebSocket agent guide: seat player, your_turn, legalActions, board. No MCP.";
    const banner = `Agent Guide · chroma-slide · <a href="${rawUrl}">text/markdown</a>`;
    const html = renderAgentGuideHtml(markdown, rawUrl, locale, alternateUrl, {
      title,
      description,
      banner,
    });
    return new Response(request.method === "HEAD" ? null : html, { status: 200, headers });
  }
  const headers = guideHeaders("text/markdown; charset=utf-8");
  return new Response(request.method === "HEAD" ? null : markdown, { status: 200, headers });
}
