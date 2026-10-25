/**
 * Ready-to-paste prompts for explosive-chess.
 * The home page copies `promptInviteAgent`: fetch the Agent Guide, then ask the human.
 * The filled-in room prompts stay for a caller that already has a room code.
 */
import {
  explosiveChessGuideUrl,
  explosiveChessRoomEndpoints,
  type ExplosiveRoomEndpoints,
} from "./agent-guide";

/** Home page: one prompt. The agent reads the guide, then asks the human how to start. */
export function promptInviteAgent(origin: string): string {
  const guideUrl = explosiveChessGuideUrl(origin);
  return `Play explosive-chess (爆炸棋) with the human who pasted this. No MCP.
Fetch this Agent Guide and follow it for the rules and WebSocket protocol:
${guideUrl}
Before you connect, ask the human in this chat and wait:
1. Play against me (you versus the human)?
2. Should I create a room?
3. Or do you already have a room code?

你和贴出这段话的人一起玩爆炸棋。没有 MCP。
先读取上面的 Agent Guide，学会规则和 WebSocket。连上之前先问并等待：
1. 要和我对下吗？
2. 需要我建房吗？
3. 还是你已经有房间码？`;
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
};

export type DualAgentPrompt = {
  origin: string;
  roomCode: string;
  playerId: string;
  rules: AgentMatchRules;
  playerName?: string;
};

export function freshAgentId(prefix: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let suffix = "";
  for (const b of bytes) suffix += alphabet[b % alphabet.length]!;
  const safe = prefix.trim().toLowerCase().replace(/[^a-z0-9-]/g, "") || "agent";
  return `${safe}-${suffix}`;
}

function requireRoom(origin: string, roomCode: string): ExplosiveRoomEndpoints {
  const ends = explosiveChessRoomEndpoints(origin, roomCode);
  if (!ends.roomCode) throw new Error("room code required");
  return ends;
}

function joinJson(playerId: string, name: string): string {
  return JSON.stringify({
    type: "join",
    payload: {
      playerId,
      name,
      kind: "agent",
      game: "explosive-chess",
    },
  });
}

function setConfigJson(rules: AgentMatchRules): string {
  return JSON.stringify({
    type: "set_config",
    payload: {
      boardSize: rules.boardSize,
      winMode: rules.winMode,
      winParam: rules.winParam,
      hostColor: rules.hostColor,
    },
  });
}

function rulesLine(rules: AgentMatchRules): string {
  return `boardSize ${rules.boardSize}, winMode ${rules.winMode}, winParam ${rules.winParam}, hostColor ${rules.hostColor}`;
}

const INTRO = `You are an explosive-chess agent. Fetch the Agent Guide, connect the WebSocket, join as kind:"agent" with the playerId below, then play the match. Do not poll. Do not sleep-wait. The server pushes your_turn. There is no MCP.

你是爆炸棋（explosive-chess）Agent。请自己完成下面的步骤，不要向人类追问协议。不要轮询，不要 sleep 空等。服务器会推送 your_turn。没有 MCP。`;

function connectSteps(ends: ExplosiveRoomEndpoints, join: string): string {
  return `1. Open and fetch this Agent Guide (WebSocket protocol, message shapes, push events, legalActions):
${ends.guideUrl}

2. Connect to this WebSocket. room code: ${ends.roomCode}
${ends.wsUrl}
Prefix: explosive-chess:${ends.roomCode}
Text frames only. JSON envelope {"type":"...","payload":{...}}. Ignore text frames ping and pong.

3. Join as kind:"agent". Use this fresh playerId. Reuse it only if you reconnect and must reclaim the same seat:
${join}`;
}

const PLAY = `Wait for the pushed your_turn. It is sent only to the seat that may move. Do not poll and do not loop on observe. On your_turn, pick one entry from payload.observation.legalActions and send it. Do not invent coordinates. Example shape (replace row and col with that entry):
{"type":"move","payload":{"row":0,"col":0}}
{"type":"act","payload":{"type":"move","row":0,"col":0}}
An error such as Invalid move or Not your turn does not advance the turn and does not repeat your_turn. Play a different entry from the legalActions you already have.
Red moves first, even if hostColor is blue. Do not send ready (it is rejected: the match starts when 2 players are seated). After game_over you may send {"type":"rematch","payload":{}}.

不要轮询。只在收到推送的 your_turn 之后，从 legalActions 里选一招。`;

/** Human created or opened the room. One agent takes the other seat. */
export function promptHumanOpponent(input: HumanOpponentPrompt): string {
  const ends = requireRoom(input.origin, input.roomCode);
  const name = input.playerName ?? "Agent";
  const join = joinJson(input.playerId, name);
  const config = setConfigJson(input.rules);
  const seat = input.humanSeated
    ? `A human is already in this room (or is connecting now) and will play the other seat. You duel that human. Prefer joining as guest. If joined says you.role is "host", you sat first: send set_config once, immediately, before the other player sits, then wait. If you.role is "guest", do not send set_config.

房间里会有人类下对面。你最好作为 guest 加入。若 joined 里 you.role 是 "host"，说明你先入座，立刻发送一次 set_config，然后等待；若是 "guest"，不要发送 set_config。`
    : `Join this room code. The first seated player is the host. If you are guest, duel whoever is already seated. If you are host, send set_config once before the other player sits, then wait for them.

加入这个房间码。第一个入座的是 host。你是 guest 就和已在座的人下；你是 host 就先 set_config 再等对手。`;
  return `${INTRO}

${connectSteps(ends, join)}

4. ${seat}
Rules selected in the UI (${rulesLine(input.rules)}). Send this only when you are host, once, before the second player sits:
${config}

5. ${PLAY}

6. Goal: play the match and duel the human (or the other seat) until the server pushes game_over.`;
}

/** Agent A creates the room. The human does not sit. */
export function promptDualHost(input: DualAgentPrompt): string {
  const ends = requireRoom(input.origin, input.roomCode);
  const name = input.playerName ?? "Agent A";
  const join = joinJson(input.playerId, name);
  const config = setConfigJson(input.rules);
  return `${INTRO}

You are Agent A (host). You create this room. A second agent (Agent B) will join the same room code. The human will not sit.

你是 Agent A（host）。由你建房。另一个 Agent B 会用同一个 room code 加入。人类不入座。

${connectSteps(ends, join)}

4. You must be the first to join, so you.role is "host". Immediately, once, before Agent B sits, send set_config and wait for a room push whose config matches. Do this before the second player connects; the second seated player starts the match and locks config.
Rules: ${rulesLine(input.rules)}
${config}

5. ${PLAY}

6. Goal: play the match and duel Agent B until the server pushes game_over. Give the human the same room code ${ends.roomCode} if they still need to invite B.`;
}

/** Agent B joins a room Agent A creates. The human does not sit. */
export function promptDualGuest(input: DualAgentPrompt): string {
  const ends = requireRoom(input.origin, input.roomCode);
  const name = input.playerName ?? "Agent B";
  const join = joinJson(input.playerId, name);
  return `${INTRO}

You are Agent B (guest). Join room code ${ends.roomCode}. Agent A is the host and creates the room by connecting first. You duel Agent A. The human will not sit. Do not change room rules.

你是 Agent B（guest）。加入房间码 ${ends.roomCode}。Agent A 是 host，会先连上并建房。你和 Agent A 对打。人类不入座。不要改房间规则。

${connectSteps(ends, join)}

4. If the socket closes before you receive joined, Agent A may not be connected yet. Reconnect to the same WebSocket URL a few times. After joined, stop reconnecting and wait for pushed events. Do not poll for state. You should be guest. If both seats are taken you will be told seat "spectator" and will not receive your_turn — stop and tell the human the room is full.

若在收到 joined 之前连接断开，可能是 Agent A 还没连上。用同一个 WebSocket URL 重连几次。一旦 joined，就停在 socket 上等待推送，不要轮询。

5. ${PLAY}

6. Goal: you are B. Join room code ${ends.roomCode} and duel Agent A until the server pushes game_over.`;
}
