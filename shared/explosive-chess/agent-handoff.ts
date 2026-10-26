/**
 * Ready-to-paste prompts for explosive-chess.
 * Chinese UI copies a Chinese-only prompt. English UI copies an English-only prompt.
 * The setup page copies `promptInviteAgent`. Filled room prompts stay for a caller that already has a room code.
 * Prompts point at the locale guide and the official transport clients. They do not mix languages.
 */
import {
  explosiveChessClientUrl,
  explosiveChessClients,
  explosiveChessGuideUrl,
  explosiveChessRoomEndpoints,
  type AgentLocale,
  type ExplosiveRoomEndpoints,
} from "./agent-guide";

export type { AgentLocale };

/** Setup page (`/play/explosive-chess`): one prompt in the current UI language. */
export function promptInviteAgent(origin: string, locale: AgentLocale): string {
  const guideUrl = explosiveChessGuideUrl(origin, locale);
  const downloads = waitDownloads(origin);
  const polls = pollDownloads(origin);
  if (locale === "zh") {
    return `你是爆炸棋（explosive-chess）Agent。没有 MCP。

先读取这份 Agent Guide，并按它操作：
${guideUrl}

每一手都由你自己决定。客户端打印 your_turn 之后，从 legalActions 里选一项，把其中的 row 和 col 作为 --move ROW,COL 传入。不要自己编坐标。

不要编写求解器、搜索树、minimax、MCTS、自动对弈循环，或任何代替你选着法的脚本。官方客户端只负责传输：连接、发送你已经选定的着法、等待服务器推送。它们没有棋力。不要把它们改成引擎。不要自己编写 WebSocket 客户端。以 kind "agent" 加入，game 为 "explosive-chess"。

建房仍走指南里的现有流程：先用 curl 做 HTTP 路由检查，再连接并 join。第一个入座的是 host。房间打开之后再用官方客户端。不要自己写 WebSocket。

下载等待版客户端（Node 22+ 或 Python 3）：
${downloads}

房间打开后，发送你选定的着法，然后阻塞到服务器推送 your_turn、对手落子或 game_over。把 WS_URL、PLAYER_ID、ROW、COL 换成实际值：

node ws-wait.mjs --url WS_URL --player-id PLAYER_ID --name Agent --move ROW,COL
python3 ws_wait.py --url WS_URL --player-id PLAYER_ID --name Agent --move ROW,COL

等待版客户端会阻塞，并在打印结果之前保持 WebSocket 连接。然后它打印一个 JSON 并退出。在它打印之前不要断开。不要轮询。用同一个 playerId 再次运行即可收回座位。优先使用等待版。

只有当前环境无法让进程阻塞等待时，才下载轮询备用。轮询脚本仍然不会替你选着法：
${polls}

node ws-poll.mjs --url WS_URL --player-id PLAYER_ID --name Agent --move ROW,COL
python3 ws_poll.py --url WS_URL --player-id PLAYER_ID --name Agent --move ROW,COL

连上之前，先在对话里问人类并等待回答：
1. 要和我对下吗？
2. 需要我建房吗？
3. 还是你已经有房间码？`;
  }
  return `You are an explosive-chess agent. There is no MCP.

Fetch this Agent Guide and follow it:
${guideUrl}

You choose every move yourself. When the client prints your_turn, pick one entry from legalActions and pass that row and col as --move ROW,COL. Do not invent coordinates.

Do not write a solver, a search tree, minimax, MCTS, an auto-play loop, or any script that chooses moves for you. The official clients are transport only: they connect, send the move you already chose, and wait for the server push. They have no chess strength. Do not modify them into an engine. Do not write your own WebSocket client. Join as kind "agent" with game "explosive-chess".

Creating a room stays on the guide's existing flow: the curl HTTP route check, then connect and join. The first seated player is the host. After the room is open, use the official client. Do not invent WebSocket glue.

Download a wait client (Node 22+ or Python 3):
${downloads}

After the room is open, send the move you chose, then block until the server pushes your_turn, the opponent's move, or game_over. Replace WS_URL, PLAYER_ID, ROW, and COL:

node ws-wait.mjs --url WS_URL --player-id PLAYER_ID --name Agent --move ROW,COL
python3 ws_wait.py --url WS_URL --player-id PLAYER_ID --name Agent --move ROW,COL

The wait client blocks and keeps the WebSocket open until it prints one JSON object and exits. Leave that process running until it prints. Do not poll. Run it again with the same playerId to reclaim the seat. Prefer the wait client.

Only if this environment cannot keep a process blocked on the socket, download the poll fallback. The poll script still does not choose a move:
${polls}

node ws-poll.mjs --url WS_URL --player-id PLAYER_ID --name Agent --move ROW,COL
python3 ws_poll.py --url WS_URL --player-id PLAYER_ID --name Agent --move ROW,COL

Before you connect, ask the human in this chat and wait:
1. Play against me (you versus the human)?
2. Should I create a room?
3. Or do you already have a room code?`;
}

export type AgentMatchRules = {
  boardSize: number;
  winMode: string;
  winParam: number;
  hostColor: string;
};

export type HumanOpponentPrompt = {
  origin: string;
  roomCode: string;
  playerId: string;
  /** Local human is seated, connecting, or shared this room. */
  humanSeated: boolean;
  rules: AgentMatchRules;
  playerName?: string;
  locale: AgentLocale;
};

export type DualAgentPrompt = {
  origin: string;
  roomCode: string;
  playerId: string;
  rules: AgentMatchRules;
  playerName?: string;
  locale: AgentLocale;
};

export function freshAgentId(prefix: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let suffix = "";
  for (const b of bytes) suffix += alphabet[b % alphabet.length]!;
  const safe = prefix.trim().toLowerCase().replace(/[^a-z0-9-]/g, "") || "agent";
  return `${safe}-${suffix}`;
}

function requireRoom(origin: string, roomCode: string, locale: AgentLocale): ExplosiveRoomEndpoints {
  const ends = explosiveChessRoomEndpoints(origin, roomCode, locale);
  if (!ends.roomCode) throw new Error("room code required");
  return ends;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function waitDownloads(origin: string): string {
  return [
    `curl -fsSL -o ws-wait.mjs ${shQuote(explosiveChessClientUrl(origin, explosiveChessClients.nodeWait))}`,
    `curl -fsSL -o ws_wait.py ${shQuote(explosiveChessClientUrl(origin, explosiveChessClients.pythonWait))}`,
  ].join("\n");
}

function pollDownloads(origin: string): string {
  return [
    `curl -fsSL -o ws-poll.mjs ${shQuote(explosiveChessClientUrl(origin, explosiveChessClients.nodePoll))}`,
    `curl -fsSL -o ws_poll.py ${shQuote(explosiveChessClientUrl(origin, explosiveChessClients.pythonPoll))}`,
  ].join("\n");
}

function configJson(rules: AgentMatchRules): string {
  return JSON.stringify({
    boardSize: rules.boardSize,
    winMode: rules.winMode,
    winParam: rules.winParam,
    hostColor: rules.hostColor,
  });
}

function rulesLine(rules: AgentMatchRules): string {
  return `boardSize ${rules.boardSize}, winMode ${rules.winMode}, winParam ${rules.winParam}, hostColor ${rules.hostColor}`;
}

function clientCmd(
  script: "node-wait" | "node-poll" | "py-wait" | "py-poll",
  wsUrl: string,
  playerId: string,
  name: string,
  extra = "",
): string {
  const bin = script.startsWith("node") ? `node ${script.endsWith("poll") ? "ws-poll.mjs" : "ws-wait.mjs"}` : `python3 ${script.endsWith("poll") ? "ws_poll.py" : "ws_wait.py"}`;
  const line = `${bin} --url ${shQuote(wsUrl)} --player-id ${shQuote(playerId)} --name ${shQuote(name)}`;
  return extra ? `${line} ${extra}` : line;
}

type RoomCopy = {
  intro: string;
  choose: string;
  forbid: string;
  hold: string;
  pollLead: string;
  goal: string;
  seat: string;
  configNote: string;
};

function roomCopy(input: {
  locale: AgentLocale;
  ends: ExplosiveRoomEndpoints;
  name: string;
  humanSeated?: boolean;
  role: "human" | "host" | "guest";
  rules: AgentMatchRules;
}): { copy: RoomCopy; configFlag: string } {
  const { locale, ends, rules, role, humanSeated } = input;
  const configFlag = `--config ${shQuote(configJson(rules))}`;
  if (locale === "zh") {
    const seat =
      role === "host"
        ? `你是 Agent A（host）。另一个 Agent B 会用同一个 room code 加入。人类不入座。你必须先加入，这样 you.role 是 "host"。在 Agent B 入座之前，立刻在第一次运行时加上 --config（set_config），并且只加一次。`
        : role === "guest"
          ? `你是 Agent B（guest）。加入房间码 ${ends.roomCode}。Agent A 是 host，会先连上并建房。你和 Agent A 对打。人类不入座。不要改房间规则。如果客户端在 joined 之前失败，再运行一次。joined 之后它会等待推送。不要轮询。`
          : humanSeated
            ? `房间里会有人类下对面。你和人类对打。优先作为 guest 加入。如果 JSON 里 you.role 是 "host"，说明你先入座：在对手入座前的第一次运行加上一次 --config（set_config）。如果是 "guest"，不要加 --config。`
            : `加入这个房间码。第一个入座的是 host。你是 guest 就和已在座的人下；你是 host 就先加一次 --config（set_config），再等对手。`;
    return {
      configFlag,
      copy: {
        intro: "你是爆炸棋（explosive-chess）Agent。没有 MCP。",
        choose:
          "每一手都由你自己决定。客户端打印 your_turn 之后，从 legalActions 里选一项，把其中的 row 和 col 作为 --move ROW,COL 传入。不要自己编坐标。",
        forbid:
          '不要编写求解器、搜索树、minimax、MCTS、自动对弈循环，或任何代替你选着法的脚本。官方客户端只负责传输：连接、发送你已经选定的着法、等待服务器推送。它们没有棋力。不要把它们改成引擎。不要自己编写 WebSocket 客户端。以 kind "agent" 加入，game 为 "explosive-chess"。',
        hold: "等待版客户端会阻塞，并在打印结果之前保持 WebSocket 连接，直到服务器推送 your_turn、对手落子或 game_over。然后它打印一个 JSON 并退出。在它打印之前不要断开。不要轮询。用同一个 playerId 再次运行即可收回座位。优先使用等待版。",
        pollLead: "只有当前环境无法让进程阻塞等待时，才使用轮询备用。轮询脚本仍然不会替你选着法：",
        goal:
          role === "host"
            ? `目标：和 Agent B 对打，直到 JSON 的 event 是 game_over。如果人类还要把房间码交给 B，房间码是 ${ends.roomCode}。`
            : role === "guest"
              ? `目标：你是 B。加入房间码 ${ends.roomCode}，和 Agent A 对打，直到 JSON 的 event 是 game_over。`
              : "目标：和人类（或另一座位）下到 JSON 的 event 是 game_over。",
        seat,
        configNote:
          role === "guest"
            ? ""
            : `规则（${rulesLine(rules)}）。只有你是 host 时，在第二个人入座之前的第一次运行加上：\n${configFlag}`,
      },
    };
  }
  const seat =
    role === "host"
      ? `You are Agent A (host). A second agent (Agent B) will join the same room code. The human will not sit. Join first so you.role is "host". Pass --config (set_config) once on the first run, immediately, before Agent B sits.`
      : role === "guest"
        ? `You are Agent B (guest). Join room code ${ends.roomCode}. Agent A is the host and connects first. You duel Agent A. The human will not sit. Do not change the room rules. If the client fails before joined, run it again. After joined, it waits for pushes. Do not poll.`
        : humanSeated
          ? `A human is already in this room (or is connecting now) and will play the other seat. You duel that human. Prefer joining as guest. If the JSON you.role is "host", you sat first: pass --config (set_config) once on the first run, before the other player sits. If you.role is "guest", do not pass --config.`
          : `Join this room code. The first seated player is the host. If you are guest, duel whoever is already seated. If you are host, pass --config (set_config) once before the other player sits, then wait for them.`;
  return {
    configFlag,
    copy: {
      intro: "You are an explosive-chess agent. There is no MCP.",
      choose:
        "You choose every move yourself. When the client prints your_turn, pick one entry from legalActions and pass that row and col as --move ROW,COL. Do not invent coordinates.",
      forbid:
        'Do not write a solver, a search tree, minimax, MCTS, an auto-play loop, or any script that chooses moves for you. The official clients are transport only: they connect, send the move you already chose, and wait for the server push. They have no chess strength. Do not modify them into an engine. Do not write your own WebSocket client. Join as kind "agent" with game "explosive-chess".',
      hold: "The wait client blocks and keeps the WebSocket open until the server pushes your_turn, the opponent's move, or game_over. It then prints one JSON object and exits. Leave that process running until it prints. Do not poll. Run it again with the same playerId to reclaim the seat. Prefer the wait client.",
      pollLead:
        "Only if this environment cannot keep a process blocked on the socket, use the poll fallback. The poll script still does not choose a move:",
      goal:
        role === "host"
          ? `Goal: duel Agent B until the JSON event is game_over. If the human still needs to invite B, the room code is ${ends.roomCode}.`
          : role === "guest"
            ? `Goal: you are B. Join room code ${ends.roomCode} and duel Agent A until the JSON event is game_over.`
            : "Goal: play the match and duel the human (or the other seat) until the JSON event is game_over.",
      seat,
      configNote:
        role === "guest"
          ? ""
          : `Rules (${rulesLine(rules)}). Add this once on the first run only when you are host, before the second player sits:\n${configFlag}`,
    },
  };
}

function renderRoomPrompt(input: {
  locale: AgentLocale;
  origin: string;
  ends: ExplosiveRoomEndpoints;
  playerId: string;
  name: string;
  rules: AgentMatchRules;
  role: "human" | "host" | "guest";
  humanSeated?: boolean;
}): string {
  const packed = roomCopy(input);
  const { copy } = packed;
  const { ends, playerId, name, origin, locale } = input;
  const guideLine = locale === "zh" ? "先读取这份 Agent Guide，并按它操作：" : "Fetch this Agent Guide and follow it:";
  const roomLine = locale === "zh" ? `房间码：${ends.roomCode}` : `Room code: ${ends.roomCode}`;
  const wsLine = locale === "zh" ? `WebSocket：${ends.wsUrl}` : `WebSocket: ${ends.wsUrl}`;
  const downloadLead = locale === "zh" ? "下载等待版客户端：" : "Download a wait client:";
  const firstLead =
    locale === "zh"
      ? "第一次运行会加入并等待（host 才在这次加上 --config）："
      : "The first run joins and waits (add --config on this run only if you are host):";
  const moveLead =
    locale === "zh"
      ? "当 event 是 your_turn 时，自己选一项 legalActions，再运行："
      : "When event is your_turn, choose one legalActions entry yourself, then run:";
  const configExtra = input.role === "guest" ? "" : packed.configFlag;
  const firstNode = clientCmd("node-wait", ends.wsUrl, playerId, name, configExtra);
  const firstPy = clientCmd("py-wait", ends.wsUrl, playerId, name, configExtra);
  const moveNode = clientCmd("node-wait", ends.wsUrl, playerId, name, "--move ROW,COL");
  const movePy = clientCmd("py-wait", ends.wsUrl, playerId, name, "--move ROW,COL");
  const pollNode = clientCmd("node-poll", ends.wsUrl, playerId, name, "--move ROW,COL");
  const pollPy = clientCmd("py-poll", ends.wsUrl, playerId, name, "--move ROW,COL");
  const parts = [
    copy.intro,
    "",
    guideLine,
    ends.guideUrl,
    "",
    roomLine,
    wsLine,
    "",
    copy.choose,
    "",
    copy.forbid,
    "",
    copy.seat,
    "",
    copy.configNote,
    "",
    downloadLead,
    waitDownloads(origin),
    "",
    firstLead,
    firstNode,
    firstPy,
    "",
    moveLead,
    moveNode,
    movePy,
    "",
    copy.hold,
    "",
    copy.pollLead,
    pollDownloads(origin),
    pollNode,
    pollPy,
    "",
    copy.goal,
  ];
  return parts.filter((part, index) => part !== "" || parts[index - 1] !== "").join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** Human created or opened the room. One agent takes the other seat. */
export function promptHumanOpponent(input: HumanOpponentPrompt): string {
  const ends = requireRoom(input.origin, input.roomCode, input.locale);
  return renderRoomPrompt({
    locale: input.locale,
    origin: input.origin,
    ends,
    playerId: input.playerId,
    name: input.playerName ?? "Agent",
    rules: input.rules,
    role: "human",
    humanSeated: input.humanSeated,
  });
}

/** Agent A creates the room. The human does not sit. */
export function promptDualHost(input: DualAgentPrompt): string {
  const ends = requireRoom(input.origin, input.roomCode, input.locale);
  return renderRoomPrompt({
    locale: input.locale,
    origin: input.origin,
    ends,
    playerId: input.playerId,
    name: input.playerName ?? "Agent A",
    rules: input.rules,
    role: "host",
  });
}

/** Agent B joins a room Agent A creates. The human does not sit. */
export function promptDualGuest(input: DualAgentPrompt): string {
  const ends = requireRoom(input.origin, input.roomCode, input.locale);
  return renderRoomPrompt({
    locale: input.locale,
    origin: input.origin,
    ends,
    playerId: input.playerId,
    name: input.playerName ?? "Agent B",
    rules: input.rules,
    role: "guest",
  });
}
