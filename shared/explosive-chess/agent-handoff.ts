/**
 * Ready-to-paste prompts for explosive-chess.
 * Chinese UI copies a Chinese-only prompt. English UI copies an English-only prompt.
 * The setup page copies `promptInviteAgent`. Filled room prompts stay for a caller that already has a room code.
 * Prompts point at the locale guide and the MCP server. They do not download a WebSocket client.
 */
import {
  explosiveChessGuideUrl,
  explosiveChessMcpUrl,
  explosiveChessPlayUrl,
  explosiveChessRoomEndpoints,
  type AgentLocale,
  type ExplosiveRoomEndpoints,
} from "./agent-guide";

export type { AgentLocale };

function mcpBlock(origin: string, locale: AgentLocale): string {
  const mcpUrl = explosiveChessMcpUrl(origin);
  const example = `{
  "mcpServers": {
    "explosive-chess": {
      "url": "${mcpUrl}"
    }
  }
}`;
  if (locale === "zh") {
    return `在你的 Agent / MCP 客户端里添加这个 MCP URL（Streamable HTTP；旧客户端可用同主机的 /sse）：
${mcpUrl}

示例：
${example}`;
  }
  return `Add this MCP URL in your Agent / MCP client (Streamable HTTP; older clients can use the /sse path on the same host):
${mcpUrl}

Example:
${example}`;
}

/** Setup page (`/play/explosive-chess`): one prompt in the current UI language. */
export function promptInviteAgent(origin: string, locale: AgentLocale): string {
  const guideUrl = explosiveChessGuideUrl(origin, locale);
  if (locale === "zh") {
    return `你是爆炸棋（explosive-chess）Agent。通过 MCP 下棋。不要自己连接 WebSocket。

先读取这份 Agent Guide，并按它操作：
${guideUrl}

${mcpBlock(origin, locale)}

每一手都由你自己决定。wait_for_turn 返回 your_turn 之后，从 legalActions 里选一项，用其中的 row 和 col 调用 take_turn。不要自己编坐标。

不要编写求解器、搜索树、minimax、MCTS、自动对弈循环，或任何代替你选着法的脚本。MCP 只负责传输：它握着房间 WebSocket，发送你已经选定的着法，等待服务器推送。它没有棋力。不要把它改成引擎。不要自己编写 WebSocket 客户端。以 kind "agent" 加入，game 为 "explosive-chess"（由 MCP 发送）。

工具：
- create_room 或 join_room
- 只有你是 host、且对局还没开始时，才调用一次 set_config
- wait_for_turn。如果 event 是 no_update，就再调用一次。人类可能想很久。连接保持开着。
- take_turn 的 row 和 col 必须来自上一份 legalActions
- get_state 只用于调试，不要拿它当主循环

MCP 会一直握着房间 WebSocket，直到 game_over。在那之前不要断开 MCP。

连上之前，先在对话里问人类并等待回答：
1. 要和我对下吗？
2. 需要我建房吗？
3. 还是你已经有房间码？`;
  }
  return `You are an explosive-chess agent. Play through MCP. Do not open a WebSocket yourself.

Fetch this Agent Guide and follow it:
${guideUrl}

${mcpBlock(origin, locale)}

You choose every move yourself. When wait_for_turn returns your_turn, pick one entry from legalActions and call take_turn with that row and col. Do not invent coordinates.

Do not write a solver, a search tree, minimax, MCTS, an auto-play loop, or any script that chooses moves for you. The MCP server is transport only: it keeps the WebSocket open, sends the move you already chose, and waits for the server push. It has no chess strength. Do not modify it into an engine. Do not write your own WebSocket client. Join as kind "agent" with game "explosive-chess" (the MCP server sends that).

Tools:
- create_room or join_room
- set_config once, only if you are host, before the match starts
- wait_for_turn. If event is no_update, call wait_for_turn again. A human may think for a long time. The socket stays open.
- take_turn with row and col from the last legalActions
- get_state is debug only. Do not use it as the play loop.

The MCP process keeps the WebSocket open until game_over. Do not disconnect the MCP session before then.

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

type RoomCopy = {
  intro: string;
  choose: string;
  forbid: string;
  hold: string;
  goal: string;
  seat: string;
  configNote: string;
};

function roomCopy(input: {
  locale: AgentLocale;
  ends: ExplosiveRoomEndpoints;
  humanSeated?: boolean;
  role: "human" | "host" | "guest";
  rules: AgentMatchRules;
}): RoomCopy {
  const { locale, ends, rules, role, humanSeated } = input;
  const config = configJson(rules);
  if (locale === "zh") {
    const seat =
      role === "host"
        ? `你是 Agent A（host）。调用 create_room，roomCode 用 ${ends.roomCode}，playerId 用下面给出的值。另一个 Agent B 会用同一个 room code 调用 join_room。人类不入座。你必须先入座，这样 you.role 是 "host"。在 Agent B 入座之前立刻调用一次 set_config。`
        : role === "guest"
          ? `你是 Agent B（guest）。调用 join_room，roomCode 为 ${ends.roomCode}。Agent A 是 host，会先连上并建房。你和 Agent A 对打。人类不入座。不要改房间规则。如果 join_room 在 joined 之前失败，用同一个 playerId 再调用一次。joined 之后调用 wait_for_turn。`
          : humanSeated
            ? `房间里会有人类下对面。调用 join_room，roomCode 为 ${ends.roomCode}。你和人类对打。优先作为 guest。如果返回的 you.role 是 "host"，说明你先入座：在对手入座前调用一次 set_config。如果是 "guest"，不要调用 set_config。`
            : `调用 join_room，roomCode 为 ${ends.roomCode}。第一个入座的是 host。你是 guest 就和已在座的人下；你是 host 就先调用一次 set_config，再 wait_for_turn。`;
    return {
      intro: "你是爆炸棋（explosive-chess）Agent。通过 MCP 下棋。不要自己连接 WebSocket。",
      choose:
        "每一手都由你自己决定。wait_for_turn 返回 your_turn 之后，从 legalActions 里选一项，用其中的 row 和 col 调用 take_turn。不要自己编坐标。",
      forbid:
        '不要编写求解器、搜索树、minimax、MCTS、自动对弈循环，或任何代替你选着法的脚本。MCP 只负责传输：它握着房间 WebSocket，发送你已经选定的着法，等待服务器推送。它没有棋力。不要把它改成引擎。不要自己编写 WebSocket 客户端。以 kind "agent" 加入，game 为 "explosive-chess"（由 MCP 发送）。',
      hold: "如果 wait_for_turn 返回 no_update，就再调用一次。人类可能想很久。MCP 会一直握着房间 WebSocket，直到 game_over。在那之前不要断开 MCP。get_state 只用于调试。",
      goal:
        role === "host"
          ? `目标：和 Agent B 对打，直到 wait_for_turn 的 event 是 game_over。房间码是 ${ends.roomCode}。`
          : role === "guest"
            ? `目标：你是 B。加入房间码 ${ends.roomCode}，和 Agent A 对打，直到 event 是 game_over。`
            : "目标：和人类（或另一座位）下到 event 是 game_over。",
      seat,
      configNote:
        role === "guest"
          ? ""
          : `规则（${rulesLine(rules)}）。只有你是 host 时，在第二个人入座之前调用一次 set_config，参数为：\n${config}`,
    };
  }
  const seat =
    role === "host"
      ? `You are Agent A (host). Call create_room with roomCode ${ends.roomCode} and the playerId below. A second agent (Agent B) will join_room the same room code. The human will not sit. Join first so you.role is "host". Call set_config once, immediately, before Agent B sits.`
      : role === "guest"
        ? `You are Agent B (guest). Call join_room with room code ${ends.roomCode}. Agent A is the host and connects first. You duel Agent A. The human will not sit. Do not change the room rules. If join_room fails before joined, call it again with the same playerId. After joined, call wait_for_turn.`
        : humanSeated
          ? `A human is already in this room (or is connecting now) and will play the other seat. Call join_room with room code ${ends.roomCode}. You duel that human. Prefer joining as guest. If you.role is "host", you sat first: call set_config once before the other player sits. If you.role is "guest", do not call set_config.`
          : `Call join_room with room code ${ends.roomCode}. The first seated player is the host. If you are guest, duel whoever is already seated. If you are host, call set_config once before the other player sits, then wait_for_turn.`;
  return {
    intro: "You are an explosive-chess agent. Play through MCP. Do not open a WebSocket yourself.",
    choose:
      "You choose every move yourself. When wait_for_turn returns your_turn, pick one entry from legalActions and call take_turn with that row and col. Do not invent coordinates.",
    forbid:
      'Do not write a solver, a search tree, minimax, MCTS, an auto-play loop, or any script that chooses moves for you. The MCP server is transport only: it keeps the WebSocket open, sends the move you already chose, and waits for the server push. It has no chess strength. Do not modify it into an engine. Do not write your own WebSocket client. Join as kind "agent" with game "explosive-chess" (the MCP server sends that).',
    hold: "If wait_for_turn returns no_update, call wait_for_turn again. A human may think for a long time. The MCP process keeps the WebSocket open until game_over. Do not disconnect the MCP session before then. get_state is debug only.",
    goal:
      role === "host"
        ? `Goal: duel Agent B until wait_for_turn returns event game_over. The room code is ${ends.roomCode}.`
        : role === "guest"
          ? `Goal: you are B. Join room code ${ends.roomCode} and duel Agent A until event is game_over.`
          : "Goal: play the match and duel the human (or the other seat) until event is game_over.",
    seat,
    configNote:
      role === "guest"
        ? ""
        : `Rules (${rulesLine(rules)}). Only when you are host, call set_config once before the second player sits, with:\n${config}`,
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
  const copy = roomCopy(input);
  const { ends, playerId, name, origin, locale } = input;
  const guideLine = locale === "zh" ? "先读取这份 Agent Guide，并按它操作：" : "Fetch this Agent Guide and follow it:";
  const roomLine = locale === "zh" ? `房间码：${ends.roomCode}` : `Room code: ${ends.roomCode}`;
  const playLine =
    locale === "zh"
      ? `人类加入页面：${explosiveChessPlayUrl(origin, ends.roomCode)}`
      : `Human join page: ${explosiveChessPlayUrl(origin, ends.roomCode)}`;
  const idLine = locale === "zh" ? `playerId：${playerId}` : `playerId: ${playerId}`;
  const nameLine = locale === "zh" ? `name：${name}` : `name: ${name}`;
  const parts = [
    copy.intro,
    "",
    guideLine,
    ends.guideUrl,
    "",
    mcpBlock(origin, locale),
    "",
    roomLine,
    idLine,
    nameLine,
    playLine,
    "",
    copy.choose,
    "",
    copy.forbid,
    "",
    copy.seat,
    "",
    copy.configNote,
    "",
    copy.hold,
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
