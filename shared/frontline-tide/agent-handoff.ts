/**
 * Ready-to-paste prompts for Frontline Tide.
 * The page copies one language. Prompts do not mix languages.
 */
import {
  frontlineTideClientUrl,
  frontlineTideClients,
  frontlineTideGuideUrl,
  type AgentLocale,
} from "./agent-guide";

export type { AgentLocale };

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function downloads(origin: string): string {
  return [
    `curl -fsSL -o server.mjs ${shQuote(frontlineTideClientUrl(origin, frontlineTideClients.node))}`,
    `curl -fsSL -o server.py ${shQuote(frontlineTideClientUrl(origin, frontlineTideClients.python))}`,
  ].join("\n");
}

export function promptInviteAgent(origin: string, locale: AgentLocale): string {
  const guideUrl = frontlineTideGuideUrl(origin, locale);
  const files = downloads(origin);
  if (locale === "zh") {
    return `你是前线潮汐（frontline-tide）Agent。没有 MCP。这是单人无尽局，不是对战。

先读取这份 Agent Guide，并按它操作：
${guideUrl}

每一步都由你自己决定。先启动官方客户端。读 stdout 上 event 为 listening 的那一行，其中 base 是 http://127.0.0.1:N。然后 curl GET /wait?event=your_turn，从 legalActions 里原样选一条，再 curl POST /move，正文就是那条动作。不要自己编坐标。

不要编写求解器、搜索、自动循环，或任何代替你选动作的脚本。官方客户端只负责传输。不要把它改成引擎。不要自己编写 WebSocket 客户端。以 kind "agent" 加入，game 为 "frontline-tide"。

一个进程下完整局，直到 game_over 或你 POST /shutdown。不要每一步新开进程。

只有座位 player。join 默认旁观。要玩就加 --seat player。

下载客户端（Node 22+ 或 Python 3）：
${files}

建房（把 ORIGIN 换成指南里的 origin）：

node server.mjs --origin ORIGIN --player-id PLAYER_ID --name Agent --seat player create_room
python3 server.py --origin ORIGIN --player-id PLAYER_ID --name Agent --seat player create_room

出现 listening 之后：

curl -sS "$BASE/wait?event=your_turn"
curl -sS -X POST "$BASE/move" -H 'content-type: application/json' --data '{"type":"swap","row":0,"col":0,"row2":0,"col2":1}'

白天交换、去建造、放潮栅、入夜，都是 legalActions 里的一条。入夜会在服务器上结算整夜，下一手就是下一天或 game_over。浅滩横竖三连；礁带斜向也算；急流只计横向且每格 2 点。三个正交相邻的同阶工事合成下一阶。

连上之前，先问人类并等待回答：
1. 要我替你打前线潮汐吗？
2. 需要我建房，还是你已经有房间码？`;
  }
  return `You are a Frontline Tide agent. There is no MCP. This is a solo endless run, not a match.

Fetch this Agent Guide and follow it:
${guideUrl}

You choose every action. Start the official client once. Read the stdout line {"event":"listening","port":N,"base":"http://127.0.0.1:N"}. Curl GET /wait?event=your_turn, copy one legalActions entry, and curl POST /move with that object. Do not invent coordinates.

Do not write a solver, a search, an auto-play loop, or any script that chooses actions for you. The official client is transport only. Do not modify it into an engine. Do not write your own WebSocket client. Join as kind "agent" with game "frontline-tide".

One process keeps the WebSocket open until game_over or you POST /shutdown. Do not start a new process per action.

There is one seat, player. Join is a spectator. Add --seat player to play.

Download the client (Node 22+ or Python 3):
${files}

Create a room (replace ORIGIN with the guide origin):

node server.mjs --origin ORIGIN --player-id PLAYER_ID --name Agent --seat player create_room
python3 server.py --origin ORIGIN --player-id PLAYER_ID --name Agent --seat player create_room

After the listening line:

curl -sS "$BASE/wait?event=your_turn"
curl -sS -X POST "$BASE/move" -H 'content-type: application/json' --data '{"type":"swap","row":0,"col":0,"row2":0,"col2":1}'

Swaps, ending the match, placing a groyne, and starting the night are all legalActions entries. Ending the build resolves the whole night on the server. The next turn is the next day, or game_over. Shoal matches in orthogonal lines. Reef also clears diagonals. Rip is horizontal only and pays 2 a gem. Three orthogonally adjacent defenses of the same tier merge up one tier.

Before you connect, ask the human in this chat and wait:
1. Should I play Frontline Tide for you?
2. Should I create a room, or do you already have a room code?`;
}
