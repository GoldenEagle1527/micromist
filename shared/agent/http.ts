import {
  prefersHtml,
  renderAgentGuideHtml,
  localeFromAcceptLanguage,
  wsOriginFromHttp,
  type AgentLocale,
} from "../explosive-chess/agent-guide";
import {
  AGENT_CLIENTS,
  agentGames,
  agentGuidePath,
  agentIndexPayload,
  getAgentGame,
  isAgentSlug,
} from "./catalog";

export type AgentGuideProtocols = {
  en: string;
  zh: string;
};

export type AgentGuideLibrary = Record<string, AgentGuideProtocols>;

export type AgentGuideMatch = "index" | "page" | "markdown" | "unknown" | null;

function stripTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function localeToken(value: string): AgentLocale | null {
  const token = value.trim().toLowerCase();
  if (token === "zh" || token.startsWith("zh-")) return "zh";
  if (token === "en" || token.startsWith("en-")) return "en";
  return null;
}

export function matchAgentGuidePath(pathname: string): {
  kind: AgentGuideMatch;
  slug: string;
  locale: AgentLocale | null;
} {
  const path = stripTrailingSlash(pathname);
  if (path === "/agent-guide") return { kind: "index", slug: "", locale: null };
  const md = /^\/agent-guide\/([a-z0-9-]+)(?:\/(zh|en))?\.md$/.exec(path);
  if (md?.[1]) {
    const slug = md[1];
    const locale = (md[2] as AgentLocale | undefined) ?? null;
    if (!isAgentSlug(slug)) return { kind: "unknown", slug, locale };
    return { kind: "markdown", slug, locale };
  }
  const page = /^\/agent-guide\/([a-z0-9-]+)(?:\/(zh|en))?$/.exec(path);
  if (page?.[1]) {
    const slug = page[1];
    const locale = (page[2] as AgentLocale | undefined) ?? null;
    if (!isAgentSlug(slug)) return { kind: "unknown", slug, locale };
    return { kind: "page", slug, locale };
  }
  if (path.startsWith("/agent-guide/")) return { kind: "unknown", slug: "", locale: null };
  return { kind: null, slug: "", locale: null };
}

export function resolveGuideLocale(
  url: URL,
  acceptLanguage: string | null,
  pathLocale: AgentLocale | null,
): AgentLocale {
  if (pathLocale) return pathLocale;
  const query = localeToken(url.searchParams.get("lang") ?? url.searchParams.get("locale") ?? "");
  if (query) return query;
  return localeFromAcceptLanguage(acceptLanguage);
}

function prefersJson(accept: string | null, format: string | null): boolean {
  const fmt = format?.trim().toLowerCase() ?? "";
  if (fmt === "json") return true;
  if (fmt === "md" || fmt === "markdown" || fmt === "html" || fmt === "txt" || fmt === "text") return false;
  if (!accept) return false;
  return accept
    .split(",")
    .some((part) => part.trim().toLowerCase().startsWith("application/json"));
}

export function composeGameGuide(
  origin: string,
  slug: string,
  protocolMarkdown: string,
  locale: AgentLocale,
): string {
  const game = getAgentGame(slug);
  const ends = wsOriginFromHttp(origin);
  const guideUrl = `${ends.httpOrigin}${agentGuidePath(slug, locale)}`;
  const title = game?.title[locale] ?? slug;
  const seats = game?.seats.join(" / ") ?? "";
  const banner =
    locale === "zh"
      ? [
          "# 当前站点",
          "",
          `这是「${title}」（\`${slug}\`）的规则与用法。origin 就是这份响应所在的环境。WebSocket 和官方客户端都用同一 host。座位：${seats}。没有 MCP。`,
          "",
          "站点上有一份本机客户端，管理全部游戏。先启动它，再拉游戏列表，问人类玩哪一款，然后读对应指南。",
          "",
          `- origin: ${ends.httpOrigin}`,
          `- host: ${ends.host}`,
          `- agent guide: ${guideUrl}`,
          `- markdown: ${guideUrl}.md`,
          `- games: ${ends.httpOrigin}/agent-guide`,
          `- node: ${ends.httpOrigin}${AGENT_CLIENTS.node}`,
          `- python: ${ends.httpOrigin}${AGENT_CLIENTS.python}`,
          `- websocket: ${ends.wsOrigin}/ws/${slug}:<code>`,
          "- Upgrade: websocket",
          "",
          "---",
          "",
        ]
      : [
          "# This host",
          "",
          `Rules and usage for ${title} (\`${slug}\`). The origin below served this page. Use the same host for the WebSocket and the official client. Seats: ${seats}. There is no MCP.`,
          "",
          "One local client covers every game. Start it, fetch the game list, ask the human which game to play, then read that game's guide.",
          "",
          `- origin: ${ends.httpOrigin}`,
          `- host: ${ends.host}`,
          `- agent guide: ${guideUrl}`,
          `- markdown: ${guideUrl}.md`,
          `- games: ${ends.httpOrigin}/agent-guide`,
          `- node: ${ends.httpOrigin}${AGENT_CLIENTS.node}`,
          `- python: ${ends.httpOrigin}${AGENT_CLIENTS.python}`,
          `- websocket: ${ends.wsOrigin}/ws/${slug}:<code>`,
          "- Upgrade: websocket",
          "",
          "---",
          "",
        ];
  return `${banner.join("\n")}${protocolMarkdown.trim()}\n`;
}

function composeIndexMarkdown(origin: string, locale: AgentLocale): string {
  const data = agentIndexPayload(origin, locale);
  const lines =
    locale === "zh"
      ? [
          "# 微渺 Agent 游戏列表",
          "",
          "先下载官方客户端，启动后再拉本列表，问人类玩哪一款，再读该游戏指南。",
          "",
          `- origin: ${data.origin}`,
          `- node: ${data.clients.node}`,
          `- python: ${data.clients.python}`,
          `- ${data.listen.note}`,
          "",
        ]
      : [
          "# micromist agent games",
          "",
          "Download the official client, start it, fetch this list, ask the human which game to play, then read that game's guide.",
          "",
          `- origin: ${data.origin}`,
          `- node: ${data.clients.node}`,
          `- python: ${data.clients.python}`,
          `- ${data.listen.note}`,
          "",
        ];
  for (const game of data.games) {
    lines.push(`## ${game.title} (\`${game.slug}\`)`);
    lines.push("");
    lines.push(game.summary);
    lines.push("");
    lines.push(`- seats: ${game.seats.join(", ")}`);
    lines.push(`- guide: ${game.guide}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
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

function unknownBody(origin: string): string {
  const lines = ["No agent guide at this path.", "Games:"];
  for (const game of agentGames) {
    lines.push(`- ${game.slug}: ${origin}${agentGuidePath(game.slug)}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function agentPlatformHttpResponse(request: Request, library: AgentGuideLibrary): Response | null {
  const url = new URL(request.url);
  const matched = matchAgentGuidePath(url.pathname);
  if (matched.kind === null) return null;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: GUIDE_CORS });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    const headers = guideHeaders("text/plain; charset=utf-8");
    headers.set("allow", "GET, HEAD, OPTIONS");
    return new Response(request.method === "HEAD" ? null : "Expected GET\n", { status: 405, headers });
  }

  const locale = resolveGuideLocale(url, request.headers.get("accept-language"), matched.locale);
  const wantJson = prefersJson(request.headers.get("accept"), url.searchParams.get("format"));

  if (matched.kind === "unknown") {
    const headers = guideHeaders("text/plain; charset=utf-8");
    return new Response(request.method === "HEAD" ? null : unknownBody(url.origin), { status: 404, headers });
  }

  if (matched.kind === "index") {
    const payload = agentIndexPayload(url.origin, locale);
    if (wantJson) {
      const headers = guideHeaders("application/json; charset=utf-8");
      const body = `${JSON.stringify(payload, null, 2)}\n`;
      return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
    }
    const markdown = composeIndexMarkdown(url.origin, locale);
    const wantHtml = prefersHtml(request.headers.get("accept"), url.searchParams.get("format"));
    if (wantHtml) {
      const headers = guideHeaders("text/html; charset=utf-8");
      const html = renderAgentGuideHtml(
        markdown,
        `${url.origin}/agent-guide?format=md`,
        locale,
        undefined,
        {
          title: locale === "zh" ? "微渺 Agent 游戏列表" : "micromist agent games",
          description: locale === "zh" ? "可与 AI 一起玩的游戏列表。" : "Games an AI can play through the official local client.",
          banner: `Agent · micromist · <a href="${url.origin}/agent-guide?format=md">text/markdown</a>`,
        },
      );
      return new Response(request.method === "HEAD" ? null : html, { status: 200, headers });
    }
    const headers = guideHeaders("text/markdown; charset=utf-8");
    return new Response(request.method === "HEAD" ? null : markdown, { status: 200, headers });
  }

  const protocols = library[matched.slug];
  if (!protocols) {
    const headers = guideHeaders("text/plain; charset=utf-8");
    return new Response(request.method === "HEAD" ? null : unknownBody(url.origin), { status: 404, headers });
  }

  const protocol = locale === "zh" ? protocols.zh : protocols.en;
  const markdown = composeGameGuide(url.origin, matched.slug, protocol, locale);
  const rawUrl = `${url.origin}${agentGuidePath(matched.slug, locale)}.md`;
  const other: AgentLocale = locale === "zh" ? "en" : "zh";
  const alternateUrl = `${url.origin}${agentGuidePath(matched.slug, other)}`;
  const game = getAgentGame(matched.slug);
  const title = game ? `${game.title[locale]} Agent Guide` : `${matched.slug} Agent Guide`;

  if (wantJson) {
    const headers = guideHeaders("application/json; charset=utf-8");
    const body = `${JSON.stringify({ slug: matched.slug, locale, markdown, guide: `${url.origin}${agentGuidePath(matched.slug, locale)}` }, null, 2)}\n`;
    return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
  }

  const wantHtml =
    matched.kind === "page" && prefersHtml(request.headers.get("accept"), url.searchParams.get("format"));
  if (wantHtml) {
    const headers = guideHeaders("text/html; charset=utf-8");
    const html = renderAgentGuideHtml(markdown, rawUrl, locale, alternateUrl, {
      title,
      description: game?.summary[locale] ?? title,
      banner: `Agent Guide · ${matched.slug} · <a href="${rawUrl}">text/markdown</a>`,
    });
    return new Response(request.method === "HEAD" ? null : html, { status: 200, headers });
  }
  const headers = guideHeaders("text/markdown; charset=utf-8");
  return new Response(request.method === "HEAD" ? null : markdown, { status: 200, headers });
}
