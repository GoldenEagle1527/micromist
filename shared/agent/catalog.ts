export const AGENT_CLIENTS = {
  node: "/agent-clients/server.mjs",
  python: "/agent-clients/server.py",
} as const;

/** First port the official local server tries. If taken, it tries the next ones. */
export const DEFAULT_AGENT_PORT = 18780;

export const AGENT_PORT_SPAN = 100;

export type AgentLocale = "zh" | "en";

export type AgentGameMeta = {
  slug: string;
  title: Record<AgentLocale, string>;
  seats: string[];
  summary: Record<AgentLocale, string>;
};

export const agentGames: AgentGameMeta[] = [
  {
    slug: "explosive-chess",
    title: { zh: "爆炸棋", en: "Explosive Chess" },
    seats: ["red", "blue"],
    summary: {
      zh: "两座 red / blue。落子叠满即爆。坐满开局。",
      en: "Two seats, red and blue. Cells burst when full. Play starts when both seats are filled.",
    },
  },
  {
    slug: "gomoku",
    title: { zh: "五子棋", en: "Gomoku" },
    seats: ["red", "blue"],
    summary: {
      zh: "两座 red（黑）/ blue（白）。十五路，黑先，连五即胜。坐满开局。",
      en: "Two seats: red is black, blue is white. 15×15, black first, five in a row. Play starts when both seats are filled.",
    },
  },
  {
    slug: "chroma-slide",
    title: { zh: "滑动色块", en: "Chroma Slide" },
    seats: ["player"],
    summary: {
      zh: "单人谜题，只有座位 player。把每种颜色收成一块正方形。",
      en: "Solo puzzle with one seat, player. Slide tiles until each color is a solid square.",
    },
  },
];

export function getAgentGame(slug: string): AgentGameMeta | undefined {
  return agentGames.find((game) => game.slug === slug);
}

export function isAgentSlug(slug: string): boolean {
  return agentGames.some((game) => game.slug === slug);
}

export function agentGuidePath(slug: string, locale?: AgentLocale): string {
  if (!locale) return `/agent-guide/${slug}`;
  return `/agent-guide/${slug}/${locale}`;
}

export function agentClientUrl(origin: string, kind: keyof typeof AGENT_CLIENTS): string {
  return `${origin.replace(/\/$/, "")}${AGENT_CLIENTS[kind]}`;
}

export function agentIndexPayload(origin: string, locale: AgentLocale) {
  const httpOrigin = origin.replace(/\/$/, "");
  return {
    origin: httpOrigin,
    locale,
    clients: {
      node: `${httpOrigin}${AGENT_CLIENTS.node}`,
      python: `${httpOrigin}${AGENT_CLIENTS.python}`,
    },
    listen: {
      host: "127.0.0.1",
      startPort: DEFAULT_AGENT_PORT,
      note:
        locale === "zh"
          ? `默认从 ${DEFAULT_AGENT_PORT} 起绑本机端口，被占用则依次加一。`
          : `Binds 127.0.0.1 from port ${DEFAULT_AGENT_PORT}, then the next free port.`,
    },
    games: agentGames.map((game) => ({
      slug: game.slug,
      title: game.title[locale],
      seats: game.seats,
      summary: game.summary[locale],
      guide: `${httpOrigin}${agentGuidePath(game.slug, locale)}`,
      markdown: `${httpOrigin}${agentGuidePath(game.slug, locale)}.md`,
    })),
  };
}
