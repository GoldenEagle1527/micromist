/**
 * Public Frontline Tide Agent Guide.
 * Protocol bodies: docs/agent-ws-frontline-tide.md and docs/agent-ws-frontline-tide.zh.md.
 */
import {
  localeFromAcceptLanguage,
  prefersHtml,
  renderAgentGuideHtml,
  wsOriginFromHttp,
  type AgentLocale,
} from "../explosive-chess/agent-guide";

export const FRONTLINETIDE_AGENT_GUIDE_PATH = "/agent-guide/frontline-tide";
export const FRONTLINETIDE_CLIENT_DIR = "/agent-clients/frontline-tide";

export const frontlineTideClients = {
  node: `${FRONTLINETIDE_CLIENT_DIR}/server.mjs`,
  python: `${FRONTLINETIDE_CLIENT_DIR}/server.py`,
} as const;

export type { AgentLocale };

export type AgentGuideMatch = "page" | "markdown" | null;
export type AgentGuideProtocols = { en: string; zh: string };

function stripTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

export function matchFrontlineGuidePath(pathname: string): AgentGuideMatch {
  const path = stripTrailingSlash(pathname);
  if (
    path === FRONTLINETIDE_AGENT_GUIDE_PATH ||
    path === `${FRONTLINETIDE_AGENT_GUIDE_PATH}/zh` ||
    path === `${FRONTLINETIDE_AGENT_GUIDE_PATH}/en`
  ) {
    return "page";
  }
  if (
    path === `${FRONTLINETIDE_AGENT_GUIDE_PATH}.md` ||
    path === `${FRONTLINETIDE_AGENT_GUIDE_PATH}/zh.md` ||
    path === `${FRONTLINETIDE_AGENT_GUIDE_PATH}/en.md`
  ) {
    return "markdown";
  }
  return null;
}

export function localeFromFrontlineGuidePath(pathname: string): AgentLocale | null {
  const path = stripTrailingSlash(pathname);
  if (path.endsWith("/zh") || path.endsWith("/zh.md")) return "zh";
  if (path.endsWith("/en") || path.endsWith("/en.md")) return "en";
  return null;
}

function localeToken(value: string): AgentLocale | null {
  const token = value.trim().toLowerCase();
  if (token === "zh" || token.startsWith("zh-")) return "zh";
  if (token === "en" || token.startsWith("en-")) return "en";
  return null;
}

export function resolveFrontlineGuideLocale(url: URL, acceptLanguage: string | null): AgentLocale {
  return (
    localeFromFrontlineGuidePath(url.pathname) ??
    localeToken(url.searchParams.get("lang") ?? url.searchParams.get("locale") ?? "") ??
    localeFromAcceptLanguage(acceptLanguage)
  );
}

export function frontlineTideGuideUrl(origin: string, locale: AgentLocale = "en"): string {
  return `${wsOriginFromHttp(origin).httpOrigin}${FRONTLINETIDE_AGENT_GUIDE_PATH}/${locale}`;
}

export function frontlineTideClientUrl(origin: string, path: string): string {
  return `${wsOriginFromHttp(origin).httpOrigin}${path}`;
}

export function composeFrontlineAgentGuide(origin: string, protocolMarkdown: string, locale: AgentLocale = "en"): string {
  const ends = wsOriginFromHttp(origin);
  const guideUrl = frontlineTideGuideUrl(ends.httpOrigin, locale);
  const clients = [
    `- node: ${ends.httpOrigin}${frontlineTideClients.node}`,
    `- python: ${ends.httpOrigin}${frontlineTideClients.python}`,
    "- local HTTP: 127.0.0.1 and an ephemeral port; curl /wait and /move",
  ];
  const banner =
    locale === "zh"
      ? [
          "# 当前站点",
          "",
          "下面的 origin 就是这份响应所在的环境。WebSocket 和官方客户端下载都用同一 host。这是中文指南。前线潮汐页面上的提示会让你先读与界面语言一致的指南，再问人类要不要替他打、由你建房，还是已有房间码。房间前缀是 `frontline-tide:`。只有座位 `player`。没有 MCP。",
          "",
          "每一步都由你自己决定。官方客户端连上后在 127.0.0.1 监听。你 curl /wait，从 legalActions 里选一条，再 curl /move。它不会下棋。一个进程握着 WebSocket，直到 game_over 或你退出。",
          "",
          `- origin: ${ends.httpOrigin}`,
          `- host: ${ends.host}`,
          `- agent guide: ${guideUrl}`,
          `- markdown: ${guideUrl}.md`,
          ...clients,
          `- websocket: ${ends.wsOrigin}/ws/frontline-tide:<code>`,
          "- Upgrade: websocket",
          "- 没有 MCP",
          "",
          "---",
          "",
        ]
      : [
          "# This host",
          "",
          "The origin below is the deployment that served this Agent Guide. Use the same host for the WebSocket and the official client downloads. This page is English. The prompt on the Frontline Tide page tells you to read this guide, then ask the human whether you should play, whether you should create a room, or whether they already have a room code. Room id prefix: `frontline-tide:`. One seat, `player`. There is no MCP.",
          "",
          "You choose every action. The official client connects, then listens on 127.0.0.1. You curl /wait, pick one legalActions entry, and curl /move. It does not play. One process keeps the WebSocket open until game_over or you exit.",
          "",
          `- origin: ${ends.httpOrigin}`,
          `- host: ${ends.host}`,
          `- agent guide: ${guideUrl}`,
          `- markdown: ${guideUrl}.md`,
          ...clients,
          `- websocket: ${ends.wsOrigin}/ws/frontline-tide:<code>`,
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

export function frontlineAgentGuideHttpResponse(request: Request, protocols: AgentGuideProtocols): Response | null {
  const url = new URL(request.url);
  const kind = matchFrontlineGuidePath(url.pathname);
  if (kind === null) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: GUIDE_CORS });
  if (request.method !== "GET" && request.method !== "HEAD") {
    const headers = guideHeaders("text/plain; charset=utf-8");
    headers.set("allow", "GET, HEAD, OPTIONS");
    return new Response(request.method === "HEAD" ? null : "Expected GET\n", { status: 405, headers });
  }
  const locale = resolveFrontlineGuideLocale(url, request.headers.get("accept-language"));
  const protocol = locale === "zh" ? protocols.zh : protocols.en;
  const markdown = composeFrontlineAgentGuide(url.origin, protocol, locale);
  const rawUrl = `${url.origin}${FRONTLINETIDE_AGENT_GUIDE_PATH}/${locale}.md`;
  const other: AgentLocale = locale === "zh" ? "en" : "zh";
  const alternateUrl = `${url.origin}${FRONTLINETIDE_AGENT_GUIDE_PATH}/${other}`;
  const wantHtml = kind === "page" && prefersHtml(request.headers.get("accept"), url.searchParams.get("format"));
  if (wantHtml) {
    const headers = guideHeaders("text/html; charset=utf-8");
    const title = locale === "zh" ? "前线潮汐 Agent Guide" : "Frontline Tide Agent Guide";
    const description =
      locale === "zh"
        ? "前线潮汐 WebSocket Agent 指南：座位 player、legalActions、地形条带。没有 MCP。"
        : "Frontline Tide WebSocket agent guide: seat player, legalActions, terrain bands. No MCP.";
    const html = renderAgentGuideHtml(markdown, rawUrl, locale, alternateUrl, {
      title,
      description,
      banner: `Agent Guide · frontline-tide · <a href="${rawUrl}">text/markdown</a>`,
    });
    return new Response(request.method === "HEAD" ? null : html, { status: 200, headers });
  }
  const headers = guideHeaders("text/markdown; charset=utf-8");
  return new Response(request.method === "HEAD" ? null : markdown, { status: 200, headers });
}
