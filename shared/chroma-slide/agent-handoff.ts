/**
 * Ready-to-paste prompts for chroma-slide.
 * Chinese UI copies a Chinese-only prompt. English UI copies an English-only prompt.
 * The setup page copies `promptInviteAgent`. Prompts do not mix languages.
 */
import {
  chromaSlideClientUrl,
  chromaSlideClients,
  chromaSlideGuideUrl,
  type AgentLocale,
} from "./agent-guide";

export type { AgentLocale };

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function clientDownloads(origin: string): string {
  return [
    `curl -fsSL -o server.mjs ${shQuote(chromaSlideClientUrl(origin, chromaSlideClients.node))}`,
    `curl -fsSL -o server.py ${shQuote(chromaSlideClientUrl(origin, chromaSlideClients.python))}`,
  ].join("\n");
}

function presetGlossary(locale: AgentLocale): string {
  if (locale === "zh") {
    return `难度见指南「难度」。不要在页面上搜中文名。set_config 只传 preset 键，可选 seed（非负整数，同一 seed 摆出同一盘）。只有你可以配置、房间仍是 lobby、并且 player 还没入座时才发送。页面上的难度菜单只影响人类在本机开的一局，不会改这个房间。「简单」= easy：6×6，4 种颜色，每种收成 3×3。不传 --config 时默认就是 easy。「普通」= normal：8×8，每种 4×4。「困难」= hard：10×10，每种 5×5。四种颜色的 name 是 red、blue、green、yellow（color 分别是 0、1、2、3）。获胜：每种颜色各成一个边长为 squareSide 的轴对齐正方形；唯一的空格可以落在其中一个正方形里（那一色少一格）。`;
  }
  return `Difficulties are in the guide section "Difficulties". Do not search the page for the label. set_config takes the preset key, and an optional seed (a non-negative integer; the same seed deals the same board). Send it only when you may configure, the room is still a lobby, and player has not sat yet. The difficulty menu on the page starts a human's local puzzle and does not change this room. "Easy" = easy: 6×6, 4 colors, each gathers into a 3×3 square. Omitting --config uses easy. "Normal" = normal: 8×8, each a 4×4. "Hard" = hard: 10×10, each a 5×5. The four color names are red, blue, green, and yellow (color ids 0, 1, 2, and 3). You win when each color forms one axis-aligned square of side squareSide. The single empty cell may sit inside one of those squares (that color is short one tile).`;
}

function boardRead(locale: AgentLocale): string {
  if (locale === "zh") {
    return "your_turn 和 GET /state、GET /wait 都带 board。board 每一格有 row、col、color（0–3 或 null）、name（red、blue、green、yellow 或 empty）、empty。effects 始终是空数组：滑动没有爆炸。lastOpponentMove 始终是 null：没有对手，不要从坐标变化去猜别人的一手。turn 为 \"player\" 表示谜题还在等解题者滑动；你的 you.seat 不是 \"player\" 时 legalActions 为空。steps 是已经滑动的次数。空格与被点的格子必须同行或同列，中间的整段格子滑向空格，这一下算 1 步。不要只凭 legalActions 反推棋盘。";
  }
  return "your_turn, GET /state, and GET /wait include board. Each cell has row, col, color (0–3 or null), name (red, blue, green, yellow, or empty), and empty. effects is always an empty array: a slide does not explode. lastOpponentMove is always null. There is no opponent, so do not treat a coordinate change as someone else's move. turn is \"player\" while the puzzle still accepts a slide. legalActions is empty unless you.seat is \"player\". steps is how many slides have been played. The clicked cell must share a row or a column with the empty cell. Every tile between them slides toward the empty cell, and that is 1 step. Do not reconstruct the board from legalActions alone.";
}

/** Setup page (`/play/chroma-slide`): one prompt in the current UI language. */
export function promptInviteAgent(origin: string, locale: AgentLocale): string {
  const guideUrl = chromaSlideGuideUrl(origin, locale);
  const downloads = clientDownloads(origin);
  if (locale === "zh") {
    return `你是滑动色块（chroma-slide）Agent。没有 MCP。这是单人谜题，不是对战。

先读取这份 Agent Guide，并按它操作：
${guideUrl}

每一步都由你自己决定。先启动官方客户端。读 stdout 上 event 为 listening 的那一行，其中 base 是 http://127.0.0.1:N。然后 curl GET /wait?event=your_turn，从 legalActions 里选一项，再 curl POST /move，正文是 {"row":ROW,"col":COL}。不要自己编坐标。

不要编写求解器、搜索树、BFS、A*、自动走子循环，或任何代替你选格子的脚本。官方客户端只负责传输：连接、在 127.0.0.1 提供 HTTP、发送你用 curl 提交的滑动、等待服务器推送。它们不会解题。不要把它们改成引擎。不要自己编写 WebSocket 客户端。以 kind "agent" 加入，game 为 "chroma-slide"。

建房和加入都用这一份客户端。一个进程下完整局，它会一直握着 WebSocket，直到 game_over 或你 POST /shutdown。不要在一次 your_turn 之后退出。不要为每一步新开进程。在 event 为 game_over 之前不要断开。不要轮询。

只有一个座位 player。join 默认是旁观。要解题就加上 --seat player，客户端会发送 claim_seat。入座后立刻开局，不需要第二个人。另一个 Agent 可以不带 --seat 旁观同一盘，不能再占一个解题座位。不要把这局做成双人对打。

下载客户端（Node 22+ 或 Python 3）：
${downloads}

建房（省略 -c 则由客户端生成房间码；带上 -c 则使用该码）。把 ORIGIN 换成指南里的 origin。省略 --player-id 时，客户端把 playerId 存在这台机器上并在重连时复用。

node server.mjs --origin ORIGIN --player-id PLAYER_ID --name Agent --seat player --config '{"preset":"easy"}' create_room
python3 server.py --origin ORIGIN --player-id PLAYER_ID --name Agent --seat player --config '{"preset":"easy"}' create_room

加入已有房间（必须带 -c）。不带 --seat 就是旁观：

node server.mjs --origin ORIGIN --player-id PLAYER_ID --name Agent --seat player join_room -c CODE
node server.mjs --origin ORIGIN --player-id PLAYER_ID --name Agent join_room -c CODE

出现 listening 之后，把 BASE 设成那一行的 base。重复到 event 为 game_over：

curl -sS "$BASE/wait?event=your_turn"
curl -sS -X POST "$BASE/move" -H 'content-type: application/json' --data '{"row":ROW,"col":COL}'

POST /shutdown 会提前退出。不在 legalActions 里的格子会被拒绝，并且不会发出去。

${boardRead("zh")}

${presetGlossary("zh")}

连上之前，先在对话里问人类并等待回答：
1. 要我解一局滑动色块吗？
2. 难度用 easy、normal 还是 hard？
3. 需要我建房，还是你已经有房间码？`;
  }
  return `You are a chroma-slide agent. There is no MCP. This is a solo puzzle, not a match.

Fetch this Agent Guide and follow it:
${guideUrl}

You choose every slide yourself. Start the official client once. Read the stdout line {"event":"listening","port":N,"base":"http://127.0.0.1:N"}. Curl GET /wait?event=your_turn, pick one entry from legalActions, and curl POST /move with {"row":ROW,"col":COL}. Do not invent coordinates.

Do not write a solver, a search tree, BFS, A*, an auto-play loop, or any script that chooses cells for you. The official client is transport only: it connects, serves HTTP on 127.0.0.1, sends the slide you curl, and waits for the server push. It does not solve the puzzle. Do not modify it into an engine. Do not write your own WebSocket client. Join as kind "agent" with game "chroma-slide".

Create and join with this one client. One process keeps the WebSocket open until game_over or you POST /shutdown. Do not exit after one your_turn. Do not start a new process per slide. Do not disconnect before event is game_over. Do not poll.

There is one seat, player. Join is a spectator. Add --seat player to solve; the client sends claim_seat. The puzzle starts as soon as that seat is filled. A second person is not required. Another agent may watch the same puzzle by omitting --seat. It cannot take a second solving seat. Do not turn this into a two-player match.

Download the client (Node 22+ or Python 3):
${downloads}

Create a room (omit -c and the client generates a code; pass -c to choose one). Replace ORIGIN with the guide origin. Omit --player-id and the client stores one id on this machine and reuses it on reconnect.

node server.mjs --origin ORIGIN --player-id PLAYER_ID --name Agent --seat player --config '{"preset":"easy"}' create_room
python3 server.py --origin ORIGIN --player-id PLAYER_ID --name Agent --seat player --config '{"preset":"easy"}' create_room

Join a room that already exists (-c is required). Without --seat you watch:

node server.mjs --origin ORIGIN --player-id PLAYER_ID --name Agent --seat player join_room -c CODE
node server.mjs --origin ORIGIN --player-id PLAYER_ID --name Agent join_room -c CODE

After the listening line, set BASE to its base. Repeat until event is game_over:

curl -sS "$BASE/wait?event=your_turn"
curl -sS -X POST "$BASE/move" -H 'content-type: application/json' --data '{"row":ROW,"col":COL}'

POST /shutdown exits early. A cell that is not in legalActions is rejected and is not sent.

${boardRead("en")}

${presetGlossary("en")}

Before you connect, ask the human in this chat and wait:
1. Should I solve a chroma-slide puzzle?
2. Which difficulty: easy, normal, or hard?
3. Should I create a room, or do you already have a room code?`;
}
