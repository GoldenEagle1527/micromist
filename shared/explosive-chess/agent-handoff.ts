/**
 * Ready-to-paste prompts for explosive-chess.
 * Chinese UI copies a Chinese-only prompt. English UI copies an English-only prompt.
 * The setup page copies `promptInviteAgent`. Filled room prompts stay for a caller that already has a room code.
 * Prompts point at the locale guide and the official interactive clients. They do not mix languages.
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
  const downloads = clientDownloads(origin);
  if (locale === "zh") {
    return `你是爆炸棋（explosive-chess）Agent。没有 MCP。

先读取这份 Agent Guide，并按它操作：
${guideUrl}

每一手都由你自己决定。客户端每来一条事件就打印一行 JSON。当 event 是 your_turn 时，从 legalActions 里选一项，在同一个进程的 stdin 上输入 ROW,COL。不要自己编坐标。

不要编写求解器、搜索树、minimax、MCTS、自动对弈循环，或任何代替你选着法的脚本。官方客户端只负责传输：连接、发送你输入的着法、等待服务器推送。它们没有棋力。不要把它们改成引擎。不要自己编写 WebSocket 客户端。以 kind "agent" 加入，game 为 "explosive-chess"。

建房和加入都用这一份交互客户端。一个进程下完整局，它会一直握着 WebSocket。不要在一次 your_turn 之后退出。不要为每一手新开进程。在 event 为 game_over 之前不要断开。不要轮询。

下载客户端（Node 22+ 或 Python 3）：
${downloads}

建房（省略 -c 则由客户端生成房间码；带上 -c 则使用该码）。把 ORIGIN 换成指南里的 origin，PLAYER_ID 换成你的座位 id：

node cli.mjs --origin ORIGIN --player-id PLAYER_ID --name Agent create_room
node cli.mjs --origin ORIGIN --player-id PLAYER_ID --name Agent create_room -c CODE
python3 cli.py --origin ORIGIN --player-id PLAYER_ID --name Agent create_room

加入已有房间（必须带 -c）：

node cli.mjs --origin ORIGIN --player-id PLAYER_ID --name Agent join_room -c CODE
python3 cli.py --origin ORIGIN --player-id PLAYER_ID --name Agent join_room -c CODE

读每一行 stdout JSON。轮到你时，把选定的格子写成 ROW,COL，或写成 {"row":ROW,"col":COL}，然后回车。客户端发送后会阻塞等待下一次推送。只有 event 是 game_over（或连接致命断开）时进程才退出。

只有当前环境无法让进程一直阻塞时，才在同一份客户端上加 --poll。它仍然不会替你选着法。--move 只属于这一备用路径：

node cli.mjs --origin ORIGIN --poll --player-id PLAYER_ID --name Agent join_room -c CODE --move ROW,COL
python3 cli.py --origin ORIGIN --poll --player-id PLAYER_ID --name Agent join_room -c CODE --move ROW,COL

连上之前，先在对话里问人类并等待回答：
1. 要和我对下吗？
2. 需要我建房吗？
3. 还是你已经有房间码？`;
  }
  return `You are an explosive-chess agent. There is no MCP.

Fetch this Agent Guide and follow it:
${guideUrl}

You choose every move yourself. The client prints one JSON line per event. When event is your_turn, pick one entry from legalActions and type ROW,COL on that same process's stdin. Do not invent coordinates.

Do not write a solver, a search tree, minimax, MCTS, an auto-play loop, or any script that chooses moves for you. The official client is transport only: it connects, sends the move you type, and waits for the server push. It has no chess strength. Do not modify it into an engine. Do not write your own WebSocket client. Join as kind "agent" with game "explosive-chess".

Create and join with this one interactive client. One process plays the whole match and keeps the WebSocket open. Do not exit after one your_turn. Do not start a new process per move. Do not disconnect before event is game_over. Do not poll.

Download the client (Node 22+ or Python 3):
${downloads}

Create a room (omit -c and the client generates a code; pass -c to choose one). Replace ORIGIN with the guide origin and PLAYER_ID with your seat id:

node cli.mjs --origin ORIGIN --player-id PLAYER_ID --name Agent create_room
node cli.mjs --origin ORIGIN --player-id PLAYER_ID --name Agent create_room -c CODE
python3 cli.py --origin ORIGIN --player-id PLAYER_ID --name Agent create_room

Join a room that already exists (-c is required):

node cli.mjs --origin ORIGIN --player-id PLAYER_ID --name Agent join_room -c CODE
python3 cli.py --origin ORIGIN --player-id PLAYER_ID --name Agent join_room -c CODE

Read each stdout JSON line. On your_turn, type the chosen cell as ROW,COL or {"row":ROW,"col":COL} and press enter. The client sends it and block-waits for the next push. The process exits only when event is game_over, or the socket dies.

Only if this environment cannot keep a process blocked on the socket, add --poll to the same client. It still does not choose a move. --move belongs only to that fallback:

node cli.mjs --origin ORIGIN --poll --player-id PLAYER_ID --name Agent join_room -c CODE --move ROW,COL
python3 cli.py --origin ORIGIN --poll --player-id PLAYER_ID --name Agent join_room -c CODE --move ROW,COL

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

function clientDownloads(origin: string): string {
  return [
    `curl -fsSL -o cli.mjs ${shQuote(explosiveChessClientUrl(origin, explosiveChessClients.node))}`,
    `curl -fsSL -o cli.py ${shQuote(explosiveChessClientUrl(origin, explosiveChessClients.python))}`,
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
  kind: "node" | "py",
  wsUrl: string,
  playerId: string,
  name: string,
  command: "create_room" | "join_room",
  code: string,
  extra = "",
): string {
  const bin = kind === "node" ? "node cli.mjs" : "python3 cli.py";
  const head = `${bin} --url ${shQuote(wsUrl)} --player-id ${shQuote(playerId)} --name ${shQuote(name)}`;
  const tail = `${command} -c ${shQuote(code)}`;
  return extra ? `${head} ${extra} ${tail}` : `${head} ${tail}`;
}

function pollCmd(kind: "node" | "py", wsUrl: string, playerId: string, name: string, code: string): string {
  const bin = kind === "node" ? "node cli.mjs" : "python3 cli.py";
  return `${bin} --url ${shQuote(wsUrl)} --poll --player-id ${shQuote(playerId)} --name ${shQuote(name)} join_room -c ${shQuote(code)} --move ROW,COL`;
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
        ? `你是 Agent A（host）。另一个 Agent B 会用同一个 room code 加入。人类不入座。你必须先加入，这样 you.role 是 "host"。在 Agent B 入座之前，在这一次 create_room 命令上加上 --config（set_config），并且只加一次。`
        : role === "guest"
          ? `你是 Agent B（guest）。用 join_room 加入房间码 ${ends.roomCode}。Agent A 是 host，会先连上并建房。你和 Agent A 对打。人类不入座。不要改房间规则。如果客户端在 joined 之前失败，用同一个 playerId 再运行一次。joined 之后它会留在这个进程里等待推送。不要轮询。`
          : humanSeated
            ? `房间里会有人类下对面。你和人类对打。用 join_room 加入。客户端只在 you.role 是 "host" 且房间仍是 lobby 时发送 set_config；你是 guest 时它会忽略 --config。`
            : `用 join_room 加入这个房间码。第一个入座的是 host。你是 guest 就和已在座的人下；你是 host 就在这次命令上带一次 --config（set_config），再等对手。`;
    return {
      configFlag,
      copy: {
        intro: "你是爆炸棋（explosive-chess）Agent。没有 MCP。",
        choose:
          "每一手都由你自己决定。客户端打印 your_turn 之后，从 legalActions 里选一项，在这个进程的 stdin 上输入 ROW,COL。不要自己编坐标。",
        forbid:
          '不要编写求解器、搜索树、minimax、MCTS、自动对弈循环，或任何代替你选着法的脚本。官方客户端只负责传输：连接、发送你输入的着法、等待服务器推送。它们没有棋力。不要把它们改成引擎。不要自己编写 WebSocket 客户端。以 kind "agent" 加入，game 为 "explosive-chess"。',
        hold: "这一个进程会一直握着 WebSocket，直到 JSON 行的 event 是 game_over。它不会在一次 your_turn 之后退出。在那之前不要断开。不要轮询。用同一个 playerId 再运行，只在进程真的退出之后才用来收回座位。",
        pollLead: "只有当前环境无法让进程一直阻塞时，才使用 --poll 备用。轮询仍然不会替你选着法：",
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
            : `规则（${rulesLine(rules)}）。只有你是 host 且房间仍是 lobby 时，客户端才会发送这一次 set_config：\n${configFlag}`,
      },
    };
  }
  const seat =
    role === "host"
      ? `You are Agent A (host). A second agent (Agent B) will join the same room code. The human will not sit. Join first so you.role is "host". Pass --config (set_config) once on this create_room command, before Agent B sits.`
      : role === "guest"
        ? `You are Agent B (guest). join_room into room code ${ends.roomCode}. Agent A is the host and connects first. You duel Agent A. The human will not sit. Do not change the room rules. If the client fails before joined, run it again with the same playerId. After joined, this process waits for pushes. Do not poll.`
        : humanSeated
          ? `A human is already in this room (or is connecting now) and will play the other seat. You duel that human. join_room into the room. The client sends set_config only when you.role is "host" and the room is still a lobby. If you are guest, it ignores --config.`
          : `join_room into this room code. The first seated player is the host. If you are guest, duel whoever is already seated. If you are host, pass --config (set_config) once on this command before the other player sits, then wait for them.`;
  return {
    configFlag,
    copy: {
      intro: "You are an explosive-chess agent. There is no MCP.",
      choose:
        "You choose every move yourself. When the client prints your_turn, pick one entry from legalActions and type ROW,COL on that process's stdin. Do not invent coordinates.",
      forbid:
        'Do not write a solver, a search tree, minimax, MCTS, an auto-play loop, or any script that chooses moves for you. The official client is transport only: it connects, sends the move you type, and waits for the server push. It has no chess strength. Do not modify it into an engine. Do not write your own WebSocket client. Join as kind "agent" with game "explosive-chess".',
      hold: "This one process keeps the WebSocket open until the JSON line event is game_over. It does not exit after one your_turn. Leave that process running. Do not poll. Run it again with the same playerId only if the process actually exited, to reclaim the seat.",
      pollLead:
        "Only if this environment cannot keep a process blocked on the socket, use the --poll fallback. The poll invocation still does not choose a move:",
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
          : `Rules (${rulesLine(rules)}). The client sends this set_config once only when you are host and the room is still a lobby:\n${configFlag}`,
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
  const downloadLead = locale === "zh" ? "下载交互客户端：" : "Download the interactive client:";
  const command = input.role === "host" ? "create_room" : "join_room";
  const configExtra = input.role === "guest" ? "" : packed.configFlag;
  const firstLead =
    locale === "zh"
      ? `运行这一次，然后留在这个进程里（host 才在这次加上 --config）。如果提示里的 WebSocket URL 和 -c 不一致，以 URL 为准：`
      : `Run this once and stay in the process (add --config on this command only if you are host). If the WebSocket URL and -c disagree, trust the URL:`;
  const moveLead =
    locale === "zh"
      ? "当 event 是 your_turn 时，自己选一项 legalActions，在 stdin 输入 ROW,COL 或 {\"row\":ROW,\"col\":COL}。不要新开进程。"
      : "When event is your_turn, choose one legalActions entry yourself and type ROW,COL or {\"row\":ROW,\"col\":COL} on stdin. Do not start a new process.";
  const node = clientCmd("node", ends.wsUrl, playerId, name, command, ends.roomCode, configExtra);
  const py = clientCmd("py", ends.wsUrl, playerId, name, command, ends.roomCode, configExtra);
  const pollNode = pollCmd("node", ends.wsUrl, playerId, name, ends.roomCode);
  const pollPy = pollCmd("py", ends.wsUrl, playerId, name, ends.roomCode);
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
    clientDownloads(origin),
    "",
    firstLead,
    node,
    py,
    "",
    moveLead,
    "",
    copy.hold,
    "",
    copy.pollLead,
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
