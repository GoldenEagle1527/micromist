/**
 * Explosive-chess MCP facade: session, JSON-RPC, and the stdio process.
 * Run: npm run test:explosive-mcp
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import type { Socket } from "node:net";
import { explosiveChessMcpHttp, clampWaitMs, dispatchMcpMessage, encodeStdioMessage, explosiveChessMcpTools, legacySseResponse, takeStdioMessages } from "../shared/explosive-chess/mcp-rpc";
import {
  connectWebSocketUrl,
  ExplosiveChessMcpSession,
  parseMatchConfig,
  type RoomSocket,
} from "../shared/explosive-chess/mcp-session";
import { createChecker } from "./lib/checks";

const c = createChecker();
const STDIO = "node_modules/.cache/ec-mcp-stdio.mjs";

c.section("limits");
{
  c.check(clampWaitMs(undefined) === 30_000, "default wait is 30s");
  c.check(clampWaitMs(1) === 25_000, "short waits clamp to 25s");
  c.check(clampWaitMs(90) === 55_000, "long waits clamp to 55s");
  c.check(clampWaitMs(40) === 40_000, "in-range wait is kept");
  c.check(typeof parseMatchConfig({ boardSize: 9, winMode: "steps", winParam: 4, hostColor: "red" }) !== "string", "config accepts a short match");
  c.check(parseMatchConfig({ boardSize: 8, winMode: "steps", winParam: 4, hostColor: "red" }) === "boardSize must be 9, 11, or 13", "config rejects a bad board");
  c.check(explosiveChessMcpTools.map((tool) => tool.name).join() === "create_room,join_room,set_config,wait_for_turn,take_turn,get_state", "tool list");
  const sources = [
    "shared/explosive-chess/mcp-session.ts",
    "shared/explosive-chess/mcp-rpc.ts",
    "worker/explosive-chess-mcp.ts",
    "scripts/explosive-chess-mcp-stdio.ts",
  ].map((file) => readFileSync(file, "utf8")).join("\n");
  c.check(!sources.includes("minimax") && !sources.includes("legalActions[0]") && !sources.includes("Math.random"), "facade does not search or pick a cell");
  c.check(sources.includes("kind") && sources.includes('"agent"'), "facade joins as kind agent");
}

class FakeSocket implements RoomSocket {
  sent: string[] = [];
  closed = false;
  private onMessageHandler: ((data: string) => void) | null = null;
  private onCloseHandler: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.onCloseHandler?.();
  }
  onMessage(handler: (data: string) => void): void {
    this.onMessageHandler = handler;
  }
  onClose(handler: () => void): void {
    this.onCloseHandler = handler;
  }
  push(value: unknown): void {
    this.onMessageHandler?.(typeof value === "string" ? value : JSON.stringify(value));
  }
  frames(): Array<{ type?: string; payload?: Record<string, unknown> }> {
    return this.sent.filter((line) => line !== "ping").map((line) => JSON.parse(line) as { type?: string; payload?: Record<string, unknown> });
  }
}

function seat(role: "host" | "guest" | "spectator" = "guest") {
  const playing = role !== "spectator";
  return {
    playerId: "agent-1",
    name: "Agent",
    seat: role === "host" ? "red" : playing ? "blue" : "spectator",
    role,
    kind: "agent",
    color: role === "host" ? "red" : playing ? "blue" : null,
  };
}

function joined(role: "host" | "guest" | "spectator" = "guest", roomCode = "abc") {
  return { type: "joined", payload: { roomCode, phase: "lobby", reclaimed: false, you: seat(role) } };
}

function yourTurn(actions = [
  { type: "move", row: 1, col: 1 },
  { type: "move", row: 4, col: 5 },
]) {
  return {
    type: "your_turn",
    payload: {
      observation: {
        phase: "playing",
        you: seat(),
        publicState: {
          turn: "blue",
          config: { boardSize: 9, winMode: "steps", winParam: 4, hostColor: "red" },
          board: [[{ row: 0, col: 0, count: 0, color: "empty", capacity: 2 }]],
          fullState: { gameOver: false },
        },
        legalActions: actions,
      },
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

function sessionWith(fake: FakeSocket): ExplosiveChessMcpSession {
  return new ExplosiveChessMcpSession({
    origin: "https://micromist-staging.goldeneaglepersonal.dpdns.org",
    dial: async () => fake,
  });
}

c.section("session");
{
  const fake = new FakeSocket();
  const session = sessionWith(fake);
  const pending = session.createRoom({ roomCode: "Ab12CD", playerId: "agent-1", name: "Agent" });
  await flush();
  c.check(fake.frames().some((frame) => frame.type === "join" && frame.payload?.kind === "agent" && frame.payload?.game === "explosive-chess"), "create_room joins as agent");
  c.check(fake.sent.some((line) => line.includes("wss://") ) === false, "join frame is json");
  fake.push("ping");
  fake.push("pong");
  fake.push(joined());
  fake.push(yourTurn());
  const created = await pending;
  c.check(created.ok === true && created.event === "joined" && created.roomCode === "ab12cd", "create_room lowercases the code", JSON.stringify(created));
  c.check(String(created.playUrl).includes("/play/explosive-chess?room=ab12cd"), "create_room returns the human play url");
  c.check(fake.closed === false, "socket stays open after create_room");

  const turn = await session.waitForTurn(50);
  c.check(turn.event === "your_turn" && turn.yourTurn === true, "stashed your_turn is returned", JSON.stringify(turn));
  const actions = turn.legalActions as Array<{ row: number; col: number }>;
  c.check(actions.length === 2 && Array.isArray(turn.board), "observation includes board and legalActions");
  c.check((turn.rules as { winMode?: string })?.winMode === "steps", "observation includes rules");

  const rejected = await session.takeTurn(0, 0);
  c.check(rejected.ok === false && String(rejected.error).includes("legalActions"), "take_turn rejects a cell outside legalActions");
  c.check(fake.frames().every((frame) => frame.type !== "move"), "rejected cell is not sent");

  const move = session.takeTurn(1, 1);
  await flush();
  c.check(fake.frames().some((frame) => frame.type === "move" && frame.payload?.row === 1 && frame.payload?.col === 1), "take_turn sends the chosen cell");
  fake.push({ type: "error", payload: { message: "Invalid move" } });
  const moveResult = await move;
  c.check(moveResult.ok === false && moveResult.error === "Invalid move", "server rejection is returned", JSON.stringify(moveResult));
  c.check((moveResult.legalActions as unknown[]).length === 2, "rejection keeps legalActions");

  const again = session.takeTurn(4, 5);
  await flush();
  fake.push({
    type: "move_applied",
    payload: { action: { type: "move", row: 4, col: 5 }, by: { playerId: "agent-1" }, gameOver: false },
  });
  const sent = await again;
  c.check(sent.ok === true && sent.event === "move_sent" && sent.heldSocket === true, "accepted move keeps the socket", JSON.stringify(sent));

  const quiet = await session.waitForTurn(40);
  c.check(quiet.event === "no_update" && quiet.heldSocket === true && fake.closed === false, "timeout is no_update and the socket stays open", JSON.stringify(quiet));

  const guestConfig = await session.setConfig({ boardSize: 9, winMode: "steps", winParam: 4, hostColor: "red" });
  c.check(guestConfig.ok === false && guestConfig.error === "Only host can set config", "guest cannot set_config");
  c.check(fake.frames().every((frame) => frame.type !== "set_config"), "guest set_config is not sent");
  session.close();
  c.check(fake.closed === true, "close drops the room socket");
}

c.section("host config and game over");
{
  const fake = new FakeSocket();
  const session = sessionWith(fake);
  const pending = session.joinRoom({ roomCode: "room42", playerId: "agent-a", name: "Agent A" });
  await flush();
  fake.push(joined("host", "room42"));
  const joinedBody = await pending;
  c.check(joinedBody.event === "joined" && (joinedBody.you as { role?: string }).role === "host", "join_room can be host");

  const config = session.setConfig({ boardSize: 9, winMode: "steps", winParam: 4, hostColor: "red" });
  await flush();
  c.check(fake.frames().filter((frame) => frame.type === "set_config").length === 1, "host sends set_config once");
  fake.push({ type: "room", payload: { phase: "lobby", config: { boardSize: 9, winMode: "steps", winParam: 4, hostColor: "red" } } });
  const configBody = await config;
  c.check(configBody.ok === true && configBody.event === "config_set", "set_config waits for the room push", JSON.stringify(configBody));
  const second = await session.setConfig({ boardSize: 11, winMode: "area", winParam: 3, hostColor: "blue" });
  c.check(second.ok === false && second.error === "set_config already sent", "set_config is once");
  c.check(fake.frames().filter((frame) => frame.type === "set_config").length === 1, "second set_config is not sent");

  fake.push(yourTurn([{ type: "move", row: 2, col: 2 }]));
  const turn = await session.waitForTurn(20);
  c.check(turn.event === "your_turn", "host reaches your_turn");
  const finishing = session.takeTurn(2, 2);
  await flush();
  fake.push({
    type: "move_applied",
    payload: {
      action: { type: "move", row: 2, col: 2 },
      by: { playerId: "human-1" },
      publicState: { turn: "blue", board: [], config: { boardSize: 9, winMode: "steps", winParam: 4, hostColor: "red" } },
      gameOver: false,
    },
  });
  fake.push({
    type: "move_applied",
    payload: { action: { type: "move", row: 2, col: 2 }, by: { playerId: "agent-a" }, gameOver: true },
  });
  fake.push({ type: "game_over", payload: { winner: 1, winnerColor: "red", winReason: "4 steps" } });
  const finished = await finishing;
  c.check(finished.event === "move_sent", "take_turn returns after the move", JSON.stringify(finished));
  const over = await session.waitForTurn(20);
  c.check(over.event === "game_over" && over.winnerColor === "red" && over.gameOver === true, "next wait returns game_over", JSON.stringify(over));
  session.close();
}

c.section("opponent move and debug state");
{
  const fake = new FakeSocket();
  const session = sessionWith(fake);
  const pending = session.joinRoom({ roomCode: "abcd", playerId: "agent-1", name: "Agent" });
  await flush();
  fake.push(joined());
  await pending;
  fake.push({
    type: "move_applied",
    payload: { action: { type: "move", row: 3, col: 4 }, by: { playerId: "human-1" }, gameOver: false },
  });
  fake.push(yourTurn([{ type: "move", row: 0, col: 2 }]));
  const turn = await session.waitForTurn(20);
  const last = turn.lastOpponentMove as { row?: number; col?: number } | null;
  c.check(turn.event === "your_turn" && last?.row === 3 && last?.col === 4, "wait reports the opponent move", JSON.stringify(turn));

  const state = session.getState();
  await flush();
  c.check(fake.frames().some((frame) => frame.type === "observe"), "get_state sends observe");
  fake.push({
    type: "observation",
    payload: {
      observation: {
        phase: "playing",
        you: seat(),
        publicState: { turn: "blue", board: [[]], config: { winMode: "steps" } },
        legalActions: [{ type: "move", row: 0, col: 2 }],
      },
    },
  });
  const snap = await state;
  c.check(snap.event === "state" && snap.debug === true, "get_state is marked debug", JSON.stringify(snap));
  session.close();
}

c.section("http");
{
  const fake = new FakeSocket();
  const session = sessionWith(fake);
  const origin = "https://micromist-staging.goldeneaglepersonal.dpdns.org";
  const post = (body: unknown, extra?: HeadersInit) =>
    explosiveChessMcpHttp(
      new Request(`${origin}/mcp/explosive-chess`, {
        method: "POST",
        headers: { accept: "application/json, text/event-stream", "content-type": "application/json", ...extra },
        body: JSON.stringify(body),
      }),
      session,
      "sess-1",
    );

  const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  c.check(init.status === 200 && init.headers.get("mcp-session-id") === "sess-1", "initialize sets the session header");
  const initBody = (await init.json()) as { result?: { serverInfo?: { name?: string }; instructions?: string } };
  c.check(initBody.result?.serverInfo?.name === "micromist-explosive-chess", "server name");
  c.check(String(initBody.result?.instructions).includes("legalActions"), "instructions say to use legalActions");

  const listed = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const listedBody = (await listed.json()) as { result?: { tools?: Array<{ name: string }> } };
  c.check(listedBody.result?.tools?.some((tool) => tool.name === "wait_for_turn"), "tools/list includes wait_for_turn");

  const note = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  c.check(note.status === 202, "initialized notification is accepted");

  const missing = await dispatchMcpMessage(session, { jsonrpc: "2.0", id: 3, method: "resources/list" });
  c.check(JSON.stringify(missing).includes("Method not found"), "unknown method errors");

  const created = post({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "create_room", arguments: { roomCode: "zz99", playerId: "agent-1" } } });
  await flush();
  fake.push(joined("guest", "zz99"));
  const createdRes = await created;
  const createdJson = (await createdRes.json()) as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
  const createdBody = JSON.parse(createdJson.result?.content?.[0]?.text ?? "{}") as { event?: string; roomCode?: string };
  c.check(createdJson.result?.isError === false && createdBody.event === "joined" && createdBody.roomCode === "zz99", "tools/call create_room", JSON.stringify(createdBody));

  const denied = await explosiveChessMcpHttp(
    new Request(`${origin}/mcp/explosive-chess`, { method: "POST", headers: { accept: "image/png" }, body: "{}" }),
    session,
    "sess-1",
  );
  c.check(denied.status === 406, "bad accept is rejected");

  const sse = legacySseResponse(origin, "sess-1", () => {});
  c.check(sse.headers.get("content-type")?.includes("text/event-stream") === true, "legacy sse content type");
  const reader = sse.body?.getReader();
  const first = await reader?.read();
  const text = new TextDecoder().decode(first?.value);
  c.check(text.includes("event: endpoint") && text.includes("sess-1") && text.includes("sse=1"), "legacy sse announces the endpoint", text);
  await reader?.cancel();

  const removed = await explosiveChessMcpHttp(new Request(`${origin}/mcp/explosive-chess`, { method: "DELETE" }), session, "sess-1");
  c.check(removed.status === 200 && fake.closed === true, "DELETE closes the room socket");
}

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function listenMock(onMessage: (msg: { type?: string; payload?: { row?: number; col?: number; kind?: string; playerId?: string } }, send: (value: unknown) => void) => void): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const server = createServer();
  server.on("upgrade", (req: IncomingMessage, socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
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
    const send = (value: unknown): void => {
      const body = Buffer.from(JSON.stringify(value));
      const header =
        body.length < 126
          ? Buffer.from([0x81, body.length])
          : Buffer.from([0x81, 126, (body.length >> 8) & 0xff, body.length & 0xff]);
      try {
        socket.write(Buffer.concat([header, body]));
      } catch {
        /* closed */
      }
    };
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const b0 = buf[0] ?? 0;
        const b1 = buf[1] ?? 0;
        const opcode = b0 & 0x0f;
        let len = b1 & 0x7f;
        let pos = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          pos = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          pos = 10;
        }
        const masked = (b1 & 0x80) !== 0;
        const maskLen = masked ? 4 : 0;
        if (buf.length < pos + maskLen + len) return;
        const payload = Buffer.alloc(len);
        if (masked) {
          const mask = buf.subarray(pos, pos + 4);
          for (let i = 0; i < len; i += 1) payload[i] = (buf[pos + 4 + i] ?? 0) ^ (mask[i % 4] ?? 0);
        } else {
          buf.copy(payload, 0, pos, pos + len);
        }
        buf = buf.subarray(pos + maskLen + len);
        if (opcode !== 0x1) continue;
        const text = payload.toString("utf8");
        if (text === "ping" || text === "pong") continue;
        try {
          onMessage(JSON.parse(text) as { type?: string; payload?: { row?: number; col?: number; kind?: string; playerId?: string } }, send);
        } catch {
          /* ignore */
        }
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        close: () =>
          new Promise((done) => {
            for (const sock of sockets) sock.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

c.section("real socket");
{
  const mock = await listenMock((msg, send) => {
    if (msg.type === "join") {
      send(joined());
      send(yourTurn());
    }
  });
  try {
    const session = new ExplosiveChessMcpSession({
      origin: `http://127.0.0.1:${mock.port}`,
      dial: connectWebSocketUrl,
    });
    const created = await session.createRoom({ roomCode: "live01", playerId: "agent-1", name: "Agent" });
    c.check(created.ok === true && created.event === "joined", "node websocket create_room", JSON.stringify(created));
    const turn = await session.waitForTurn(1_000);
    c.check(turn.event === "your_turn" && (turn.legalActions as unknown[]).length === 2, "node websocket wait_for_turn", JSON.stringify(turn));
    c.check(session.heldSocket() === true, "node websocket stays open");
    session.close();
  } finally {
    await mock.close();
  }
}

function runStdio(args: string[], origin: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [STDIO, ...args], {
      env: { ...process.env, MICROMIST_ORIGIN: origin },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`stdio hung\n${stderr}\n${stdout}`));
    }, 8_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

c.section("stdio");
{
  const help = await runStdio(["--help"], "https://micromist-staging.goldeneaglepersonal.dpdns.org");
  c.check(help.code === 0 && help.stderr.includes("no chess strength"), "stdio help", help.stderr);
  c.check(help.stderr.includes("https://micromist-staging.goldeneaglepersonal.dpdns.org/mcp/explosive-chess"), "stdio help names staging");
  c.check(!help.stdout.includes("ws-wait"), "stdio help does not mention the removed client");

  const mock = await listenMock((msg, send) => {
    if (msg.type === "join") {
      c.check(msg.payload?.kind === "agent", "stdio join kind is agent");
      send(joined("guest", "stdio1"));
      send(yourTurn());
    }
    if (msg.type === "move") {
      send({
        type: "move_applied",
        payload: { action: { type: "move", row: msg.payload?.row, col: msg.payload?.col }, by: { playerId: "agent-1" }, gameOver: false },
      });
      send(yourTurn([{ type: "move", row: 0, col: 2 }]));
    }
  });
  const child = spawn(process.execPath, [STDIO, "--origin", `http://127.0.0.1:${mock.port}`], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let raw = Buffer.alloc(0);
  const pending: unknown[] = [];
  let waiters: Array<() => void> = [];
  child.stdout.on("data", (chunk: Buffer) => {
    raw = Buffer.concat([raw, chunk]);
    const taken = takeStdioMessages(raw);
    raw = Buffer.from(taken.rest);
    pending.push(...taken.messages);
    const current = waiters;
    waiters = [];
    for (const wake of current) wake();
  });
  const nextMessage = () =>
    new Promise<unknown>((resolve, reject) => {
      if (pending.length > 0) {
        resolve(pending.shift());
        return;
      }
      const timer = setTimeout(() => reject(new Error("stdio response timeout")), 8_000);
      waiters.push(() => {
        clearTimeout(timer);
        resolve(pending.shift());
      });
    });
  const call = async (id: number, method: string, params?: unknown) => {
    child.stdin.write(encodeStdioMessage({ jsonrpc: "2.0", id, method, params }));
    return (await nextMessage()) as { id?: number; result?: { content?: Array<{ text: string }>; tools?: unknown[]; isError?: boolean } };
  };
  try {
    const init = await call(1, "initialize", {});
    c.check(init.id === 1 && JSON.stringify(init.result).includes("micromist-explosive-chess"), "stdio initialize");
    const tools = await call(2, "tools/list");
    c.check(JSON.stringify(tools.result).includes("take_turn"), "stdio tools/list");
    const created = await call(3, "tools/call", { name: "create_room", arguments: { roomCode: "stdio1", playerId: "agent-1", name: "Agent" } });
    const createdBody = JSON.parse(created.result?.content?.[0]?.text ?? "{}") as { event?: string };
    c.check(createdBody.event === "joined", "stdio create_room", created.result?.content?.[0]?.text);
    const turn = await call(4, "tools/call", { name: "wait_for_turn", arguments: {} });
    const turnBody = JSON.parse(turn.result?.content?.[0]?.text ?? "{}") as { event?: string; legalActions?: unknown[] };
    c.check(turnBody.event === "your_turn" && (turnBody.legalActions?.length ?? 0) === 2, "stdio wait_for_turn", turn.result?.content?.[0]?.text);
    const bad = await call(5, "tools/call", { name: "take_turn", arguments: { row: 9, col: 9 } });
    const badBody = JSON.parse(bad.result?.content?.[0]?.text ?? "{}") as { ok?: boolean };
    c.check(bad.result?.isError === true && badBody.ok === false, "stdio rejects an illegal cell");
    const good = await call(6, "tools/call", { name: "take_turn", arguments: { row: 1, col: 1 } });
    const goodBody = JSON.parse(good.result?.content?.[0]?.text ?? "{}") as { event?: string };
    c.check(goodBody.event === "move_sent", "stdio take_turn", good.result?.content?.[0]?.text);
    const next = await call(7, "tools/call", { name: "wait_for_turn", arguments: {} });
    const nextBody = JSON.parse(next.result?.content?.[0]?.text ?? "{}") as { event?: string; legalActions?: Array<{ row: number }> };
    c.check(nextBody.event === "your_turn" && nextBody.legalActions?.[0]?.row === 0, "stdio stacks another wait", next.result?.content?.[0]?.text);
  } finally {
    child.kill("SIGKILL");
    await mock.close();
  }
}

c.finish();
