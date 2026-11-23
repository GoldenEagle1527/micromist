import {
  AGENT_CLIENTS,
  DEFAULT_AGENT_PORT,
  type AgentLocale,
  agentClientUrl,
} from "./catalog";

export type { AgentLocale };

/** Homepage `/agent` copy-paste prompt. One language. No play-style instructions. */
export function promptInviteAgent(origin: string, locale: AgentLocale): string {
  const base = origin.replace(/\/$/, "");
  const node = agentClientUrl(base, "node");
  const python = agentClientUrl(base, "python");
  const listUrl = `${base}/agent-guide`;
  if (locale === "zh") {
    return `这是微渺（micromist）的官方本机客户端。没有 MCP。

下载（Node 22+ 或 Python 3，二选一）：
${node}
${python}

启动时带上这个站点的 origin。进程先在 127.0.0.1 监听，默认端口 ${DEFAULT_AGENT_PORT}，被占用则依次加一：

node server.mjs --origin ${base}
python3 server.py --origin ${base}

读 stdout 里 event 为 listening 的那一行，把 BASE 设成其中的 base（形如 http://127.0.0.1:N）。

拉游戏列表：
curl -sS "$BASE/games"
也可以直接：
curl -sS -H 'accept: application/json' ${listUrl}

在对话里问人类要玩哪一款，等回答。选定后拉该游戏的规则和用法：
curl -sS "$BASE/games/SLUG"

按那份文档建房或加入、看局面、落子。`;
  }
  return `This is the official micromist local client. There is no MCP.

Download (Node 22+ or Python 3):
${node}
${python}

Start it with this site's origin. It listens on 127.0.0.1 first. Default port ${DEFAULT_AGENT_PORT}; if that port is taken it tries the next ones:

node server.mjs --origin ${base}
python3 server.py --origin ${base}

Read the stdout line whose event is listening. Set BASE to its base (http://127.0.0.1:N).

Fetch the game list:
curl -sS "$BASE/games"
Or:
curl -sS -H 'accept: application/json' ${listUrl}

Ask the human which game to play, and wait. Then fetch that game's rules and usage:
curl -sS "$BASE/games/SLUG"

Follow that document to create or join a room, read the position, and send moves.`;
}

export const AGENT_CLIENT_PATHS = AGENT_CLIENTS;
