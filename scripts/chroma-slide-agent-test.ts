/**
 * Chroma-slide agent room: observation, one solver seat, guide split, official client.
 * Run: npm run test:chroma-agent
 */
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import type { Socket } from "node:net";
import { EMPTY, clickMove, isLegalClick, isWon, legalSlideActions, newPuzzleWithSeed, type PuzzleState } from "../shared/chroma-slide/engine";
import { buildChromaObservation } from "../shared/chroma-slide/observe";
import { promptInviteAgent } from "../shared/chroma-slide/agent-handoff";
import {
  chromaAgentGuideHttpResponse,
  composeChromaAgentGuide,
  matchChromaGuidePath,
} from "../shared/chroma-slide/agent-guide";
import { createChromaSlideAdapter } from "../worker/games/chroma-slide/adapter";
import type { RoomHost } from "../worker/multiplayer/adapter";
import type { PlayerRecord, SessionAttachment } from "../worker/multiplayer/types";
import { isSeatedSeat, type Phase, type Seat } from "../shared/multiplayer";
import { chromaEn, chromaZh } from "../src/games/chroma-slide/i18n";
import { createChecker } from "./lib/checks";

const c = createChecker();

function easyAlmostSolved(): PuzzleState {
  const size = 6;
  const board = new Array<number>(size * size).fill(0);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      let color = 0;
      if (row < 3 && col >= 3) color = 1;
      else if (row >= 3 && col < 3) color = 2;
      else if (row >= 3 && col >= 3) color = 3;
      board[row * size + col] = color;
    }
  }
  const emptyIndex = 2 * size + 2;
  board[emptyIndex] = EMPTY;
  return { preset: "easy", size, colorCount: 4, board, emptyIndex, steps: 3 };
}

c.section("engine");
{
  const dealt = newPuzzleWithSeed("easy", 1);
  const again = newPuzzleWithSeed("easy", 1);
  c.check(dealt.board.join() === again.board.join() && dealt.emptyIndex === again.emptyIndex, "seed deals the same board");
  c.check(newPuzzleWithSeed("easy", 2).board.join() !== dealt.board.join() || newPuzzleWithSeed("easy", 2).emptyIndex !== dealt.emptyIndex, "a different seed can deal another board");
  const actions = legalSlideActions(dealt);
  c.check(actions.length === 2 * (dealt.size - 1), "every cell on the empty row and column is legal", String(actions.length));
  c.check(actions.every((action) => isLegalClick(dealt, action.index)), "listed slides are legal clicks");
  c.check(actions.every((action) => action.row === Math.floor(dealt.emptyIndex / dealt.size) || action.col === dealt.emptyIndex % dealt.size), "listed slides share the empty row or column");

  const solved = easyAlmostSolved();
  c.check(isWon(solved), "a packed grid with the hole inside one square is a win");
  const nudged = clickMove(solved, 3 * solved.size + 2);
  c.check(nudged !== solved && !isWon(nudged) && nudged.steps === solved.steps + 1, "a slide leaves the packed grid");
  const back = clickMove(nudged, 2 * nudged.size + 2);
  c.check(isWon(back), "sliding back into the packed grid wins");
}

type Sent = { type: string; payload: Record<string, unknown> };

function roomHarness() {
  const sent: Sent[] = [];
  let phase: Phase = "lobby";
  const players = new Map<string, PlayerRecord>();
  const sessions = new Map<WebSocket, SessionAttachment>();
  const ws = {
    send(raw: string) {
      sent.push(JSON.parse(raw) as Sent);
    },
  } as unknown as WebSocket;
  const host = {
    get phase() {
      return phase;
    },
    setPhase(next: Phase) {
      phase = next;
    },
    players,
    sessions,
    hostId: "agent-1",
    gameSlug: "chroma-slide",
    roomCode: "abc",
    send(target: WebSocket, type: string, payload: unknown) {
      target.send(JSON.stringify({ type, payload }));
    },
    broadcast(type: string, payload: unknown) {
      for (const sock of sessions.keys()) host.send(sock, type, payload);
    },
    broadcastRoom() {
      sent.push({ type: "room", payload: { phase } });
    },
    seatedPlayers(opts?: { connectedOnly?: boolean }) {
      return [...players.values()].filter((p) => isSeatedSeat(p.seat) && (!opts?.connectedOnly || p.connected));
    },
    requireJoined(sock: WebSocket) {
      return sessions.get(sock) ?? null;
    },
    refreshAttachmentSeat(playerId: string, seat: Seat) {
      const session = sessions.get(ws);
      if (session && session.playerId === playerId) session.seat = seat;
    },
    async persist() {},
  } satisfies RoomHost;
  return { host, ws, sent, seat(player: PlayerRecord) {
    players.set(player.playerId, player);
    sessions.set(ws, {
      playerId: player.playerId,
      seat: player.seat,
      role: player.role,
      name: player.name,
      kind: player.kind,
    });
  } };
}

function person(partial: Pick<PlayerRecord, "playerId" | "seat" | "role">): PlayerRecord {
  return {
    playerId: partial.playerId,
    name: partial.playerId,
    seat: partial.seat,
    role: partial.role,
    ready: false,
    rematch: false,
    connected: true,
    kind: "agent",
  };
}

c.section("room");
{
  const harness = roomHarness();
  const adapter = createChromaSlideAdapter(harness.host);
  c.check(adapter.explicitSeating === true && adapter.playSeats?.join() === "player", "one explicit solver seat");
  const solver = person({ playerId: "agent-1", seat: "spectator", role: "spectator" });
  harness.seat(solver);
  const configured = adapter.onSetConfig(harness.ws, harness.host.sessions.get(harness.ws)!, {
    preset: "easy",
    seed: 7,
  });
  c.check(configured && adapter.getPublicConfig().preset === "easy" && adapter.getPublicConfig().seed === 7, "host sets preset and seed in the lobby");
  solver.seat = "player";
  solver.role = "host";
  harness.host.sessions.get(harness.ws)!.seat = "player";
  adapter.tryStartGame();
  c.check(harness.host.phase === "playing", "claiming player starts the puzzle");
  const turn = [...harness.sent].reverse().find((msg) => msg.type === "your_turn");
  const observation = (turn?.payload.observation ?? null) as { legalActions?: unknown[]; publicState?: { board?: unknown[][]; steps?: number; turn?: string } } | null;
  const board = observation?.publicState?.board ?? [];
  c.check(Array.isArray(board) && board.length === 6 && board[0]?.length === 6, "your_turn carries a 6×6 board");
  c.check(observation?.publicState?.steps === 0 && observation?.publicState?.turn === "player", "the dealt puzzle is step 0 on the solver's turn");
  c.check((observation?.legalActions ?? []).length === 10, "your_turn lists every legal slide");
  const first = (observation?.legalActions ?? [])[0] as { row: number; col: number };
  harness.sent.length = 0;
  adapter.onMessage(harness.ws, "move", { row: first.row, col: first.col });
  const applied = harness.sent.find((msg) => msg.type === "move_applied");
  const nextTurn = [...harness.sent].reverse().find((msg) => msg.type === "your_turn");
  const nextObs = nextTurn?.payload.observation as { publicState?: { steps?: number; board?: unknown }; legalActions?: unknown[] } | undefined;
  c.check(applied?.payload.gameOver === false, "a legal slide is applied");
  c.check(nextObs?.publicState?.steps === 1 && (nextObs.legalActions ?? []).length === 10, "the next your_turn is still the solver, one step later");
  const listed = new Set(
    ((nextObs?.legalActions ?? []) as Array<{ row: number; col: number }>).map((action) => `${action.row},${action.col}`),
  );
  let illegal = { row: 0, col: 0 };
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      if (!listed.has(`${row},${col}`)) illegal = { row, col };
    }
  }
  harness.sent.length = 0;
  adapter.onMessage(harness.ws, "move", illegal);
  const rejected = harness.sent.find((msg) => msg.type === "error");
  c.check(rejected?.payload.message === "Invalid move", "a cell off the empty row and column is rejected");

  const watcher = roomHarness();
  const watchAdapter = createChromaSlideAdapter(watcher.host);
  const guest = person({ playerId: "watch", seat: "spectator", role: "spectator" });
  watcher.seat(guest);
  watcher.host.setPhase("playing");
  watchAdapter.hydrate({
    config: { preset: "easy", seed: 1 },
    configFrozen: true,
    puzzle: newPuzzleWithSeed("easy", 1),
  });
  watchAdapter.onMessage(watcher.ws, "move", { row: 0, col: 0 });
  c.check(watcher.sent.some((msg) => msg.payload.message === "Spectators cannot move"), "a spectator cannot slide");

  const finish = roomHarness();
  const finishAdapter = createChromaSlideAdapter(finish.host);
  const seated = person({ playerId: "agent-1", seat: "player", role: "host" });
  finish.seat(seated);
  finish.host.setPhase("playing");
  const packed = easyAlmostSolved();
  const open = clickMove(packed, 3 * packed.size + 2);
  finishAdapter.hydrate({
    config: { preset: "easy", seed: 3 },
    configFrozen: true,
    puzzle: open,
  });
  finishAdapter.onMessage(finish.ws, "move", { row: 2, col: 2 });
  c.check(finish.host.phase === "over", "the packing slide ends the puzzle");
  const over = finish.sent.find((msg) => msg.type === "game_over");
  c.check(over?.payload.winReason === "solved" && over.payload.winner === "player", "game_over is solved by player");
  c.check(!finish.sent.some((msg) => msg.type === "your_turn"), "a solved puzzle does not ask for another slide");

  const view = buildChromaObservation({
    phase: "playing",
    you: {
      playerId: "agent-1",
      name: "Agent",
      seat: "player",
      role: "host",
      kind: "agent",
      color: null,
      canConfig: true,
    },
    preset: "easy",
    seed: 1,
    puzzle: newPuzzleWithSeed("easy", 1),
  });
  c.check(view.lastOpponentMove === null && view.game === "chroma-slide", "observation has no opponent");
  const sample = view.publicState.board.flat().find((cell) => cell.empty);
  c.check(sample?.name === "empty" && sample.color === null, "the empty cell is named on the board");
}

c.section("guide");
{
  const en = promptInviteAgent("https://play.example", "en");
  const zh = promptInviteAgent("https://play.example", "zh");
  c.check(en.includes("https://play.example/agent-guide/chroma-slide/en"), "english prompt names the english guide");
  c.check(zh.includes("https://play.example/agent-guide/chroma-slide/zh"), "chinese prompt names the chinese guide");
  c.check(!en.includes("你是") && !zh.includes("You are a chroma-slide"), "prompts do not mix languages");
  c.check(en.includes("legalActions") && zh.includes("legalActions"), "both prompts play from legalActions");
  c.check(en.includes("--seat player") && zh.includes("--seat player"), "both prompts claim the player seat");
  c.check(en.includes("no MCP") && zh.includes("没有 MCP"), "both prompts refuse MCP");
  c.check(!en.includes("minimax") && en.toLowerCase().includes("do not write a solver"), "english prompt forbids a solver");
  c.check(zh.includes("不要编写求解器"), "chinese prompt forbids a solver");
  c.check(en.includes("easy") && en.includes("normal") && en.includes("hard"), "english glossary names the presets");
  c.check(zh.includes("easy") && zh.includes("normal") && zh.includes("hard"), "chinese glossary names the preset keys");
  c.check(matchChromaGuidePath("/agent-guide/chroma-slide") === "page", "guide page path");
  c.check(matchChromaGuidePath("/agent-guide/chroma-slide/zh.md") === "markdown", "chinese markdown path");
  c.check(matchChromaGuidePath("/agent-guide/explosive-chess") === null, "explosive guide is left alone");
  const page = chromaAgentGuideHttpResponse(
    new Request("https://play.example/agent-guide/chroma-slide/zh", { headers: { accept: "text/html" } }),
    { en: "# English\n\nBoard.\n", zh: "# 中文\n\n棋盘。\n" },
  );
  const html = await page!.text();
  c.check(page?.headers.get("content-type")?.startsWith("text/html") === true, "browser guide is html");
  c.check(html.includes("棋盘") && !html.includes("# English"), "chinese page does not include the english body");
  c.check(html.includes("/agent-guide/chroma-slide/en"), "chinese page links english");
  const markdown = chromaAgentGuideHttpResponse(
    new Request("https://play.example/agent-guide/chroma-slide/en"),
    { en: "# Slide\n", zh: "# 中文\n" },
  );
  const body = await markdown!.text();
  c.check(body.includes("# This host") && body.includes("ws://") === false && body.includes("wss://play.example/ws/chroma-slide:<code>"), "english guide prepends this host");
  c.check(composeChromaAgentGuide("http://127.0.0.1:8787", "# Slide\n", "en").includes("ws://127.0.0.1:8787/ws/chroma-slide:<code>"), "local host uses ws");
  const shell = readFileSync("worker/multiplayer/base-room.ts", "utf8");
  c.check(shell.includes('message: "seat must be red or blue"') || shell.includes("seat must be red or blue"), "explosive seats keep their error string");
  c.check(shell.includes("playSeats"), "a game can declare its own seats");
  const setup = readFileSync("src/games/chroma-slide/ChromaSlideGame.tsx", "utf8");
  c.check(setup.includes("<AgentInvite") && setup.includes("locale={locale}"), "setup copies the locale prompt");
  c.check(!setup.includes("promptInviteAgent("), "the setup page does not render the prompt body");
  c.check(chromaEn.agentInviteLine.length > 0 && !chromaEn.agentInviteLine.includes("\n"), "english invite is one line");
  c.check(chromaZh.agentInviteLine.includes("点我"), "chinese invite is the copy line");
  const nodeSrc = readFileSync("public/agent-clients/chroma-slide/server.mjs", "utf8");
  const pySrc = readFileSync("public/agent-clients/chroma-slide/server.py", "utf8");
  for (const [name, src] of [
    ["node", nodeSrc],
    ["python", pySrc],
  ] as const) {
    c.check(src.includes("chroma-slide") && src.includes("--seat player"), `${name} speaks chroma-slide`);
    c.check(!src.includes("legalActions[0]") && !src.includes("random.choice") && !src.includes("Math.random"), `${name} does not pick a slide`);
    c.check(src.includes("Do not wrap it in a solver"), `${name} forbids a solver`);
  }
  c.check(nodeSrc.includes("Do not wrap it in a solver"), "node help forbids a solver");
  c.check(!nodeSrc.includes('game: "explosive-chess"'), "node client does not join explosive-chess");
}

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const CLIENT = "public/agent-clients/chroma-slide/server.mjs";

function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  let header: Buffer;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) header = Buffer.from([0x81, 126, (len >> 8) & 0xff, len & 0xff]);
  else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrames(buf: Buffer): { frames: string[]; rest: Buffer } {
  const frames: string[] = [];
  let offset = 0;
  while (offset + 2 <= buf.length) {
    const b1 = buf[offset + 1] ?? 0;
    let len = b1 & 0x7f;
    let pos = offset + 2;
    if (len === 126) {
      if (pos + 2 > buf.length) break;
      len = buf.readUInt16BE(pos);
      pos += 2;
    }
    const masked = (b1 & 0x80) !== 0;
    if (pos + (masked ? 4 : 0) + len > buf.length) break;
    const raw = buf.subarray(pos + (masked ? 4 : 0), pos + (masked ? 4 : 0) + len);
    const payload = Buffer.alloc(len);
    if (masked) {
      const mask = buf.subarray(pos, pos + 4);
      for (let i = 0; i < len; i += 1) payload[i] = (raw[i] ?? 0) ^ (mask[i % 4] ?? 0);
    } else raw.copy(payload);
    offset = pos + (masked ? 4 : 0) + len;
    frames.push(payload.toString("utf8"));
  }
  return { frames, rest: Buffer.from(buf.subarray(offset)) };
}

type Inbound = { type?: string; payload?: { row?: number; col?: number; seat?: string; preset?: string; kind?: string; game?: string } };

function listenMock(onMessage: (msg: Inbound, send: (obj: unknown) => void) => void) {
  const inbound: Inbound[] = [];
  const sockets = new Set<Socket>();
  const server = createServer();
  server.on("connection", (sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => {});
  });
  server.on("upgrade", (req: IncomingMessage, socket) => {
    const keyHeader = req.headers["sec-websocket-key"];
    const key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    let buf = Buffer.alloc(0);
    const send = (obj: unknown) => {
      try {
        socket.write(encodeTextFrame(JSON.stringify(obj)));
      } catch {
        /* closed */
      }
    };
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const decoded = decodeFrames(buf);
      buf = decoded.rest;
      for (const frame of decoded.frames) {
        if (frame === "ping") {
          socket.write(encodeTextFrame("pong"));
          continue;
        }
        let msg: Inbound;
        try {
          msg = JSON.parse(frame) as Inbound;
        } catch {
          continue;
        }
        inbound.push(msg);
        onMessage(msg, send);
      }
    });
  });
  return new Promise<{ port: number; inbound: Inbound[]; close: () => Promise<void> }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        inbound,
        close: () =>
          new Promise((done) => {
            for (const sock of sockets) sock.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

function boardPayload() {
  return [[{ row: 0, col: 0, color: 0, name: "red", empty: false }]];
}

c.section("client");
{
  const help = await new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [CLIENT, "--help"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
  });
  c.check(help.code === 0 && help.stdout.includes("no puzzle solver") && help.stdout.includes("--seat player"), "node help is the chroma client");

  const you = {
    playerId: "agent-1",
    name: "Agent",
    seat: "player",
    role: "host",
    kind: "agent",
    color: null,
    canConfig: true,
  };
  const observation = {
    game: "chroma-slide",
    phase: "playing",
    you,
    publicState: {
      config: { preset: "easy", size: 6, colorCount: 4, squareSide: 3, seed: 1 },
      board: boardPayload(),
      empty: { row: 0, col: 1 },
      steps: 0,
      won: false,
      turn: "player",
    },
    legalActions: [
      { type: "move", row: 0, col: 1 },
      { type: "move", row: 1, col: 0 },
    ],
    lastOpponentMove: null,
  };
  const mock = await listenMock((msg, send) => {
    if (msg.type === "join") {
      send({
        type: "joined",
        payload: { roomCode: "abc", phase: "lobby", reclaimed: false, reusedRoom: false, you: { ...you, seat: "spectator" } },
      });
    }
    if (msg.type === "set_config") send({ type: "room", payload: { phase: "lobby", config: { preset: "easy" } } });
    if (msg.type === "claim_seat") {
      send({ type: "seated", payload: { seat: "player", role: "host", canConfig: true, you } });
      send({ type: "your_turn", payload: { observation } });
    }
    if (msg.type === "move" && msg.payload?.row === 0) {
      send({
        type: "move_applied",
        payload: {
          action: { type: "move", row: 0, col: 1 },
          by: { playerId: "agent-1" },
          publicState: { ...observation.publicState, steps: 1 },
          effects: [],
          gameOver: false,
        },
      });
      send({
        type: "your_turn",
        payload: {
          observation: {
            ...observation,
            publicState: { ...observation.publicState, steps: 1 },
            legalActions: [{ type: "move", row: 2, col: 2 }],
          },
        },
      });
    }
    if (msg.type === "move" && msg.payload?.row === 2) {
      send({
        type: "move_applied",
        payload: {
          action: { type: "move", row: 2, col: 2 },
          by: { playerId: "agent-1" },
          publicState: { ...observation.publicState, steps: 2, won: true, turn: null },
          effects: [],
          gameOver: true,
        },
      });
      send({ type: "game_over", payload: { winner: "player", winnerColor: null, winReason: "solved", steps: 2, preset: "easy" } });
    }
  });
  const child = spawn(
    process.execPath,
    [
      CLIENT,
      "--origin",
      `http://127.0.0.1:${mock.port}`,
      "--player-id",
      "agent-1",
      "--name",
      "Agent",
      "--config",
      '{"preset":"easy","seed":1}',
      "--seat",
      "player",
      "create_room",
      "-c",
      "abc",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  const lines: Array<Record<string, unknown>> = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    const parts = stdout.split("\n");
    stdout = parts.pop() ?? "";
    for (const part of parts) {
      if (part.trim()) lines.push(JSON.parse(part) as Record<string, unknown>);
    }
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const waitFor = async (pred: () => boolean) => {
    const start = Date.now();
    while (!pred()) {
      if (Date.now() - start > 4000) throw new Error(`timeout\n${stderr}\n${JSON.stringify(lines)}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  try {
    await waitFor(() => lines.some((row) => row.event === "your_turn"));
    const turn = lines.find((row) => row.event === "your_turn");
    c.check(Array.isArray(turn?.board) && Array.isArray(turn?.legalActions) && (turn?.legalActions as unknown[]).length === 2, "client copies board and legalActions");
    c.check(turn?.lastOpponentMove == null && Array.isArray(turn?.effects) && (turn?.effects as unknown[]).length === 0, "client keeps lastOpponentMove empty and effects empty");
    c.check(turn?.steps === 0 && turn?.preset === "easy", "client surfaces steps and preset");
    c.check(mock.inbound.some((msg) => msg.type === "join" && msg.payload?.game === "chroma-slide" && msg.payload.kind === "agent"), "client joins chroma-slide as agent");
    c.check(mock.inbound.some((msg) => msg.type === "claim_seat" && msg.payload?.seat === "player"), "client claims player");
    c.check(mock.inbound.every((msg) => msg.type !== "move"), "client does not slide before /move");
    const listening = lines.find((row) => row.event === "listening");
    const base = String(listening?.base ?? "");
    const blocked = await fetch(`${base}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ row: 9, col: 9 }),
    });
    const blockedBody = (await blocked.json()) as { error?: string; legalActions?: unknown[] };
    c.check(blocked.status === 400 && (blockedBody.error ?? "").includes("legalActions"), "POST /move rejects a cell outside legalActions");
    c.check(mock.inbound.every((msg) => msg.type !== "move"), "rejected slide is not sent");
    const played = await fetch(`${base}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ row: 0, col: 1 }),
    });
    c.check(played.status === 200, "POST /move accepts a listed cell", stderr);
    const next = await fetch(`${base}/wait?event=your_turn&timeout=5`);
    const nextBody = (await next.json()) as { event?: string; steps?: number; legalActions?: Array<{ row?: number }> };
    c.check(next.status === 200 && nextBody.event === "your_turn" && nextBody.steps === 1 && nextBody.legalActions?.[0]?.row === 2, "GET /wait returns the next your_turn");
    const done = fetch(`${base}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ row: 2, col: 2 }),
    });
    const exitCode = await new Promise<number | null>((resolve) => child.on("close", resolve));
    const finished = (await (await done).json()) as { event?: string };
    c.check(exitCode === 0 && finished.event === "game_over", "client exits when the puzzle is solved", stderr);
  } finally {
    child.kill("SIGKILL");
    await mock.close();
  }
}

c.finish();
