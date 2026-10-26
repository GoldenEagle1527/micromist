#!/usr/bin/env node
/**
 * Official explosive-chess interactive client. No chess strength.
 *
 * One process is the whole match. It joins as kind "agent", prints one JSON
 * line per event, and sends the move you type on stdin. It never picks a move.
 * It exits when event is game_over, or on a fatal disconnect.
 *
 *   node cli.mjs --origin https://HOST create_room
 *   node cli.mjs --origin https://HOST create_room -c CODE
 *   node cli.mjs --origin https://HOST join_room -c CODE
 *   node cli.mjs --url wss://HOST/ws/explosive-chess:CODE join_room
 *
 * Node 22+ (global WebSocket). On older Node, use cli.py.
 * Stdout is one JSON object per line. Diagnostics go to stderr.
 * --poll is the one-shot fallback for environments that cannot hold this session.
 */

import readline from "node:readline";

const HELP = `explosive-chess official interactive client (no chess strength)

One process is the whole match. It joins as kind "agent", prints one JSON
line per event, and reads the move you type on stdin. It does not choose
moves. It exits when event is game_over, or on a fatal disconnect.
Do not wrap it in a solver, search tree, or auto-play loop.
The one-shot client that exited after a single your_turn is retired.

  node cli.mjs --origin https://HOST create_room
  node cli.mjs --origin https://HOST create_room -c CODE
  node cli.mjs --origin https://HOST join_room -c CODE
  node cli.mjs --url wss://HOST/ws/explosive-chess:CODE join_room

  create_room   Open a room. -c is optional. Omit -c for a generated code.
  join_room     Sit in a room. -c CODE is required unless --url has the code.
  -c, --code    Room code [a-z0-9]
  --origin      http(s) origin of the game host
  --url         Exact websocket URL. Used as-is when present.
  --player-id   Seat id to join and reclaim (default: a fresh agent id)
  --name        Display name (default Agent)
  --config      JSON object. Sent as set_config only if you are host and the room is still a lobby
  --verbose     Include board on each JSON line
  --timeout     Seconds to block for one server push. Omit to wait until game_over
  --poll        One-shot fallback. Prints one JSON line and exits. Accepts --move ROW,COL
  --move        Poll only. ROW,COL you already chose. Interactive play types this on stdin
  --help

Interactive stdin is ROW,COL or {"row":ROW,"col":COL}.
Stdout is one JSON object per line. Diagnostics go to stderr.
Node 22+ for global WebSocket. Otherwise use cli.py.
`;

const ABORT = Symbol("abort");
const EOF = Symbol("eof");
const TIMED_OUT = Symbol("timeout");

class CliError extends Error {}

function parseArgs(argv) {
  const args = {
    help: false,
    poll: false,
    verbose: false,
    origin: "",
    url: "",
    playerId: "",
    name: "Agent",
    moveText: null,
    config: null,
    timeout: null,
    command: "",
    code: "",
  };
  const take = (i, flag) => {
    const value = argv[i + 1];
    if (value == null || String(value).startsWith("-")) {
      throw new CliError(`missing value for ${flag}`);
    }
    return String(value);
  };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag === "--poll") args.poll = true;
    else if (flag === "--verbose") args.verbose = true;
    else if (flag === "--origin") {
      args.origin = take(i, flag);
      i += 1;
    } else if (flag === "--url") {
      args.url = take(i, flag);
      i += 1;
    } else if (flag === "--player-id") {
      args.playerId = take(i, flag);
      i += 1;
    } else if (flag === "--name") {
      args.name = take(i, flag);
      i += 1;
    } else if (flag === "--move") {
      args.moveText = take(i, flag);
      i += 1;
    } else if (flag === "--config") {
      args.config = parseConfig(take(i, flag));
      i += 1;
    } else if (flag === "--timeout") {
      args.timeout = Number(take(i, flag));
      i += 1;
    } else if (flag === "-c" || flag === "--code") {
      args.code = take(i, flag).trim().toLowerCase();
      i += 1;
    } else if (flag === "create_room" || flag === "join_room") {
      if (args.command) throw new CliError("only one of create_room or join_room");
      args.command = flag;
    } else {
      throw new CliError(`unknown argument ${flag}`);
    }
  }
  return args;
}

function parseConfig(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CliError("--config must be a JSON object");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("--config must be a JSON object");
  }
  return value;
}

function parseCell(text, label) {
  const match = /^(\d+)\s*,\s*(\d+)$/.exec(String(text).trim());
  if (!match) throw new CliError(`${label} must be ROW,COL using non-negative integers`);
  return { row: Number(match[1]), col: Number(match[2]) };
}

function parseStdinMove(text) {
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    let value;
    try {
      value = JSON.parse(trimmed);
    } catch {
      throw new CliError("stdin move must be ROW,COL or compact JSON");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new CliError("stdin move must be ROW,COL or compact JSON");
    }
    const row = value.row;
    const col = value.col;
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) {
      throw new CliError("stdin JSON move needs non-negative integer row and col");
    }
    return { row, col };
  }
  return parseCell(trimmed, "stdin move");
}

function token(size) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

function codeFromWsUrl(value) {
  let pathname = value;
  try {
    pathname = new URL(value).pathname;
  } catch {
    pathname = value;
  }
  const match = /\/ws\/explosive-chess:([a-z0-9]+)/i.exec(pathname);
  return match ? match[1].toLowerCase() : "";
}

function wsUrlFromOrigin(origin, code) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new CliError("--origin must be an http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliError("--origin must be an http(s) URL");
  }
  const proto = url.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${url.host}/ws/explosive-chess:${code}`;
}

function httpOriginFrom(args) {
  if (args.origin) {
    const url = new URL(args.origin);
    return url.origin;
  }
  const url = new URL(args.url);
  const proto = url.protocol === "wss:" ? "https:" : "http:";
  return `${proto}//${url.host}`;
}

function normalize(args) {
  if (!args.command) throw new CliError("missing command create_room or join_room");
  if (args.timeout != null && (!Number.isFinite(args.timeout) || args.timeout < 0)) {
    throw new CliError("--timeout must be a non-negative number of seconds");
  }
  if (args.code && !/^[a-z0-9]+$/.test(args.code)) {
    throw new CliError("room code must be [a-z0-9]");
  }
  if (!args.playerId.trim()) args.playerId = `agent-${token(8)}`;
  if (args.command === "create_room" && !args.code && !args.url) args.code = token(6);
  let fromUrl = "";
  if (args.url) fromUrl = codeFromWsUrl(args.url);
  if (args.code && fromUrl && args.code !== fromUrl) {
    throw new CliError("-c does not match the room code in --url");
  }
  if (!args.code) args.code = fromUrl;
  if (!args.code) {
    throw new CliError(args.command === "join_room" ? "join_room requires -c CODE" : "missing room code");
  }
  if (!/^[a-z0-9]+$/.test(args.code)) throw new CliError("room code must be [a-z0-9]");
  if (!args.url) {
    if (!args.origin) throw new CliError("missing --origin or --url");
    args.url = wsUrlFromOrigin(args.origin, args.code);
  }
  if (args.moveText != null && !args.poll) {
    throw new CliError("--move is only valid with --poll. Type ROW,COL on stdin.");
  }
  args.move = args.moveText == null ? null : parseCell(args.moveText, "--move");
  args.budgetMs = args.timeout == null ? (args.poll ? 20000 : 0) : Math.min(Math.round(args.timeout * 1000), 3600 * 1000);
}

async function textOf(data) {
  if (typeof data === "string") return data;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }
  if (data && typeof data.text === "function") return data.text();
  return "";
}

class AgentSocket {
  constructor(ws) {
    this.ws = ws;
    this.buf = [];
    this.seen = [];
    this.waiters = [];
    this.seq = 0;
    this.closed = false;
    this.stopping = false;
    this.chain = Promise.resolve();
    ws.addEventListener("message", (ev) => {
      this.chain = this.chain.then(() => this._onMessage(ev.data)).catch(() => {});
    });
    ws.addEventListener("close", () => {
      this.closed = true;
      this._wake();
    });
  }

  async _onMessage(data) {
    const text = await textOf(data);
    if (!text || text === "ping" || text === "pong") return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== "string") return;
    this.seq += 1;
    msg._seq = this.seq;
    this.seen.push(msg);
    this.buf.push(msg);
    this._wake();
  }

  async idle() {
    for (let guard = 0; guard < 20; guard += 1) {
      const current = this.chain;
      await current;
      if (current === this.chain) return;
    }
  }

  highWater() {
    return this.seq;
  }

  _wake() {
    for (const wake of [...this.waiters]) wake();
  }

  send(type, payload = {}) {
    this.ws.send(JSON.stringify({ type, payload }));
  }

  waitFor(pred, timeoutMs) {
    const take = () => {
      const index = this.buf.findIndex(pred);
      if (index < 0) return null;
      return this.buf.splice(index, 1)[0];
    };
    return new Promise((resolve, reject) => {
      let timer = null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this.waiters = this.waiters.filter((wake) => wake !== onMsg);
      };
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          cleanup();
          reject(new Error(`timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      }
      const onMsg = () => {
        const msg = take();
        if (msg) {
          cleanup();
          resolve(msg);
          return;
        }
        if (this.closed && !this.stopping) {
          cleanup();
          reject(new Error("websocket closed"));
        }
      };
      this.waiters.push(onMsg);
      onMsg();
    });
  }

  close() {
    this.stopping = true;
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

function connect(url, timeoutMs) {
  if (typeof WebSocket !== "function") {
    throw new CliError("global WebSocket is missing. Use Node 22+ or the Python client cli.py.");
  }
  const ws = new WebSocket(url);
  const client = new AgentSocket(ws);
  const openTimeout = Math.min(timeoutMs > 0 ? timeoutMs : 20000, 20000);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.close();
      reject(new Error(`connect timeout ${url}`));
    }, openTimeout);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(client);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`websocket error ${url}`));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retriable(err) {
  return /timeout|websocket|connect|ECONN|closed/i.test(String(err && err.message ? err.message : err));
}

function writeLine(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function blankState(args) {
  return {
    roomCode: args.code || null,
    you: null,
    turn: null,
    legalActions: [],
    lastOpponentMove: null,
    board: null,
    phase: null,
    reclaimed: null,
    playUrl: `${httpOriginFrom(args)}/play/explosive-chess?room=${args.code}`,
    result: null,
    moveMark: 0,
    awaitingAck: false,
  };
}

function emit(args, state, event, extra = {}) {
  const line = {
    event,
    ok: extra.ok !== false,
    you: state.you,
    lastOpponentMove: state.lastOpponentMove,
    legalActions: state.legalActions,
    turn: state.turn,
    roomCode: state.roomCode,
  };
  if (event === "joined") {
    line.playerId = args.playerId;
    line.reclaimed = state.reclaimed;
    line.playUrl = state.playUrl;
    line.phase = state.phase;
  }
  if (event === "game_over") line.result = state.result;
  if (extra.error) line.error = extra.error;
  if (extra.mode) line.mode = extra.mode;
  if (extra.yourTurn != null) line.yourTurn = extra.yourTurn;
  if (args.verbose) line.board = state.board ?? null;
  writeLine(line);
}

function applyPublic(state, publicState) {
  if (!publicState || typeof publicState !== "object") return;
  if ("turn" in publicState) state.turn = publicState.turn ?? null;
  if ("board" in publicState) state.board = publicState.board;
}

function applyObservation(state, obs) {
  if (!obs || typeof obs !== "object") return;
  if (obs.you && typeof obs.you === "object") state.you = obs.you;
  if (typeof obs.phase === "string") state.phase = obs.phase;
  state.legalActions = Array.isArray(obs.legalActions) ? obs.legalActions : [];
  applyPublic(state, obs.publicState);
}

function ourApplySeq(seen, playerId, mark) {
  let seq = 0;
  for (const item of seen) {
    if (
      item._seq > mark &&
      item.type === "move_applied" &&
      item.payload &&
      item.payload.by &&
      item.payload.by.playerId === playerId
    ) {
      seq = item._seq;
    }
  }
  return seq;
}

function opponentMove(seen, playerId) {
  let found = null;
  for (const msg of seen) {
    if (msg.type !== "move_applied" || !msg.payload) continue;
    const by = msg.payload.by && msg.payload.by.playerId;
    if (typeof by === "string" && by !== playerId) found = msg.payload.action ?? null;
  }
  return found;
}

function isTerminal(msg) {
  if (!msg) return false;
  if (msg.type === "game_over" || msg.type === "room_closed") return true;
  return msg.type === "move_applied" && msg.payload && msg.payload.gameOver === true;
}

function hasFatal(sock) {
  return sock.closed || sock.buf.some((msg) => isTerminal(msg));
}

async function connectAndJoin(args) {
  const timeoutMs = args.budgetMs > 0 ? args.budgetMs : 20000;
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    let sock = null;
    try {
      sock = await connect(args.url, timeoutMs);
      sock.send("join", {
        playerId: args.playerId,
        name: args.name,
        kind: "agent",
        game: "explosive-chess",
      });
      const joined = await sock.waitFor(
        (msg) => msg.type === "joined" || msg.type === "error",
        timeoutMs,
      );
      if (joined.type === "error") {
        const message = String((joined.payload && joined.payload.message) || "join failed");
        throw new CliError(message);
      }
      await sock.idle();
      return { sock, joined };
    } catch (err) {
      lastErr = err;
      if (sock) sock.close();
      if (attempt === 4 || err instanceof CliError || !retriable(err)) break;
      console.error(`join attempt ${attempt} failed: ${err.message}; retrying`);
      await delay(250 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new CliError("join failed");
}

async function maybeConfig(sock, joined, config) {
  if (!config) return;
  const you = joined.payload && joined.payload.you;
  if (!you || you.role !== "host") {
    console.error("not host; ignoring --config");
    return;
  }
  if (joined.payload.phase && joined.payload.phase !== "lobby") return;
  sock.buf = sock.buf.filter((msg) => msg.type !== "room");
  sock.send("set_config", config);
  const msg = await sock.waitFor((item) => item.type === "room" || item.type === "error", 15000);
  if (msg.type === "error") {
    const message = String((msg.payload && msg.payload.message) || "");
    if (!/locked/i.test(message)) throw new CliError(message || "set_config failed");
  }
}

function stateFromJoined(args, joined) {
  const state = blankState(args);
  const payload = joined.payload || {};
  state.roomCode = payload.roomCode || args.code;
  state.you = payload.you || null;
  state.phase = payload.phase || null;
  state.reclaimed = payload.reclaimed === true;
  if (state.roomCode) {
    state.playUrl = `${httpOriginFrom(args)}/play/explosive-chess?room=${state.roomCode}`;
  }
  return state;
}

function createLines() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity });
  const pending = [];
  const waiters = [];
  let eof = false;
  rl.on("line", (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else pending.push(line);
  });
  rl.on("close", () => {
    eof = true;
    const waiter = waiters.shift();
    if (waiter) waiter(EOF);
  });
  return {
    rl,
    pending,
    waiters,
    get eof() {
      return eof;
    },
    cancel(waiter) {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
    },
  };
}

function readLineOrPush(sock, lines, timeoutMs) {
  if (hasFatal(sock)) return Promise.resolve(ABORT);
  if (lines.pending.length) return Promise.resolve(lines.pending.shift());
  if (lines.eof) return Promise.resolve(EOF);
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      lines.cancel(onLine);
      sock.waiters = sock.waiters.filter((wake) => wake !== onSock);
      resolve(value);
    };
    const onLine = (line) => {
      if (line === EOF) finish(EOF);
      else if (hasFatal(sock)) finish(ABORT);
      else finish(line);
    };
    const onSock = () => {
      if (hasFatal(sock)) finish(ABORT);
    };
    if (timeoutMs > 0) {
      timer = setTimeout(() => finish(TIMED_OUT), timeoutMs);
    }
    lines.waiters.push(onLine);
    sock.waiters.push(onSock);
    if (hasFatal(sock)) onSock();
  });
}

async function promptAndSend(sock, lines, args, state) {
  while (true) {
    if (hasFatal(sock)) return "abort";
    const line = await readLineOrPush(sock, lines, args.budgetMs);
    if (line === ABORT || hasFatal(sock)) return "abort";
    if (line === TIMED_OUT) return "timeout";
    if (line === EOF || line == null) return "stdin-closed";
    let move;
    try {
      move = parseStdinMove(line);
    } catch (err) {
      emit(args, state, "error", { ok: false, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (!move) continue;
    await sock.idle();
    state.moveMark = sock.highWater();
    state.awaitingAck = true;
    sock.send("move", { row: move.row, col: move.col });
    return "sent";
  }
}

function relevant(sock, args, state) {
  return (msg) => {
    if (msg.type === "game_over" || msg.type === "room_closed") return true;
    if (msg.type === "move_applied") {
      if (state.awaitingAck && msg._seq <= state.moveMark) return false;
      return true;
    }
    if (msg.type === "error") return state.awaitingAck && msg._seq > state.moveMark;
    if (msg.type === "your_turn") {
      if (!state.awaitingAck) return true;
      if (msg._seq <= state.moveMark) return false;
      const applied = ourApplySeq(sock.seen, args.playerId, state.moveMark);
      return applied > 0 && msg._seq > applied;
    }
    return false;
  };
}

async function fillResult(sock, state, moveMsg) {
  let over = null;
  const index = sock.buf.findIndex((msg) => msg.type === "game_over");
  if (index >= 0) over = sock.buf.splice(index, 1)[0];
  else {
    try {
      over = await sock.waitFor((msg) => msg.type === "game_over", 800);
    } catch {
      over = null;
    }
  }
  const payload = (over && over.payload) || {};
  const fromMove = (moveMsg && moveMsg.payload) || {};
  const full = fromMove.publicState && fromMove.publicState.fullState;
  state.result = {
    winner: payload.winner ?? (full && full.winner) ?? null,
    winnerColor: payload.winnerColor ?? null,
    winReason: payload.winReason ?? (full && full.winReason) ?? null,
  };
  state.legalActions = [];
}

async function runInteractive(args) {
  const { sock, joined } = await connectAndJoin(args);
  const state = stateFromJoined(args, joined);
  const lines = createLines();
  try {
    return await interactiveSession(sock, lines, args, state, joined);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit(args, state, /timeout/i.test(message) ? "timeout" : "error", { ok: false, error: message });
    return { sock, lines, code: 1 };
  }
}

async function interactiveSession(sock, lines, args, state, joined) {
  try {
    emit(args, state, "joined", { ok: true });
    const you = state.you;
    if (you && you.seat === "spectator") {
      emit(args, state, "spectator", {
        ok: false,
        error: "Room is full. This connection is a spectator and will not receive your_turn.",
      });
      return { sock, lines, code: 1 };
    }
    await maybeConfig(sock, joined, args.config);
    await sock.idle();
    while (true) {
      let msg;
      try {
        msg = await sock.waitFor(relevant(sock, args, state), args.budgetMs);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/timeout/i.test(message)) {
          emit(args, state, "timeout", { ok: false, error: message });
          return { sock, lines, code: 1 };
        }
        emit(args, state, "error", { ok: false, error: /closed/i.test(message) ? "websocket closed" : message });
        return { sock, lines, code: 1 };
      }
      if (msg.type === "game_over") {
        const payload = msg.payload || {};
        state.result = {
          winner: payload.winner ?? null,
          winnerColor: payload.winnerColor ?? null,
          winReason: payload.winReason ?? null,
        };
        state.legalActions = [];
        state.lastOpponentMove = opponentMove(sock.seen, args.playerId);
        emit(args, state, "game_over", { ok: true });
        return { sock, lines, code: 0 };
      }
      if (msg.type === "room_closed") {
        emit(args, state, "room_closed", { ok: false, error: "Room closed" });
        return { sock, lines, code: 1 };
      }
      if (msg.type === "move_applied") {
        const payload = msg.payload || {};
        const by = payload.by && payload.by.playerId;
        if (typeof by === "string" && by !== args.playerId) state.lastOpponentMove = payload.action ?? null;
        applyPublic(state, payload.publicState);
        if (payload.gameOver === true) {
          await fillResult(sock, state, msg);
          state.lastOpponentMove = opponentMove(sock.seen, args.playerId) ?? state.lastOpponentMove;
          emit(args, state, "game_over", { ok: true });
          return { sock, lines, code: 0 };
        }
        if (typeof by === "string" && by !== args.playerId) emit(args, state, "opponent", { ok: true });
        continue;
      }
      if (msg.type === "error") {
        state.awaitingAck = false;
        const message = String((msg.payload && msg.payload.message) || "error");
        emit(args, state, "error", { ok: false, error: message });
        const status = await promptAndSend(sock, lines, args, state);
        if (status === "timeout") {
          emit(args, state, "timeout", { ok: false, error: "timeout waiting for stdin" });
          return { sock, lines, code: 1 };
        }
        if (status === "stdin-closed") {
          emit(args, state, "error", { ok: false, error: "stdin closed" });
          return { sock, lines, code: 1 };
        }
        continue;
      }
      if (msg.type === "your_turn") {
        state.awaitingAck = false;
        applyObservation(state, msg.payload && msg.payload.observation);
        state.lastOpponentMove = opponentMove(sock.seen, args.playerId) ?? state.lastOpponentMove;
        emit(args, state, "your_turn", { ok: true });
        const status = await promptAndSend(sock, lines, args, state);
        if (status === "timeout") {
          emit(args, state, "timeout", { ok: false, error: "timeout waiting for stdin" });
          return { sock, lines, code: 1 };
        }
        if (status === "stdin-closed") {
          emit(args, state, "error", { ok: false, error: "stdin closed" });
          return { sock, lines, code: 1 };
        }
      }
    }
  } finally {
    /* caller closes */
  }
}

function pollLine(args, state, event, extra = {}) {
  emit(args, state, event, extra);
}

async function runPoll(args) {
  const { sock, joined } = await connectAndJoin(args);
  const state = stateFromJoined(args, joined);
  const you = state.you;
  if (you && you.seat === "spectator") {
    pollLine(args, state, "spectator", {
      ok: false,
      mode: "poll",
      yourTurn: false,
      error: "Room is full. This connection is a spectator and will not receive your_turn.",
    });
    return { sock, code: 1 };
  }
  await maybeConfig(sock, joined, args.config);
  await sock.idle();
  const ackMs = Math.min(args.budgetMs > 0 ? args.budgetMs : 20000, 20000);
  if (!args.move) {
    const mark = sock.highWater();
    sock.send("observe", {});
    const msg = await sock.waitFor(
      (item) =>
        item._seq > mark &&
        (item.type === "observation" || item.type === "error" || item.type === "game_over" || item.type === "room_closed"),
      ackMs,
    );
    return { sock, code: finishPoll(args, state, sock, msg) };
  }
  const early = sock.buf.find((item) => item.type === "game_over");
  if (early) {
    sock.buf = sock.buf.filter((item) => item !== early);
    return { sock, code: finishPoll(args, state, sock, early) };
  }
  const mark = sock.highWater();
  sock.send("move", { row: args.move.row, col: args.move.col });
  const ack = await sock.waitFor((item) => {
    if (item._seq <= mark) return false;
    return item.type === "error" || item.type === "move_applied" || item.type === "game_over" || item.type === "room_closed";
  }, ackMs);
  if (ack.type !== "move_applied") return { sock, code: finishPoll(args, state, sock, ack) };
  await sock.idle();
  const pendingOver = sock.buf.find((item) => item.type === "game_over");
  if (pendingOver) return { sock, code: finishPoll(args, state, sock, pendingOver) };
  const observeMark = sock.highWater();
  sock.send("observe", {});
  const msg = await sock.waitFor((item) => {
    if (item._seq <= observeMark) return false;
    return item.type === "observation" || item.type === "error" || item.type === "game_over" || item.type === "room_closed";
  }, ackMs);
  return { sock, code: finishPoll(args, state, sock, msg) };
}

function finishPoll(args, state, sock, msg) {
  state.lastOpponentMove = opponentMove(sock.seen, args.playerId);
  if (msg.type === "your_turn" || msg.type === "observation") {
    applyObservation(state, msg.payload && msg.payload.observation);
    const event = msg.type === "your_turn" ? "your_turn" : "observation";
    pollLine(args, state, event, { ok: true, mode: "poll", yourTurn: state.legalActions.length > 0 });
    return 0;
  }
  if (msg.type === "game_over" || (msg.type === "move_applied" && msg.payload && msg.payload.gameOver === true)) {
    const payload = msg.payload || {};
    state.result = {
      winner: payload.winner ?? null,
      winnerColor: payload.winnerColor ?? null,
      winReason: payload.winReason ?? null,
    };
    state.legalActions = [];
    pollLine(args, state, "game_over", { ok: true, mode: "poll", yourTurn: false });
    return 0;
  }
  if (msg.type === "room_closed") {
    pollLine(args, state, "room_closed", { ok: false, mode: "poll", yourTurn: false, error: "Room closed" });
    return 1;
  }
  const message = String((msg.payload && msg.payload.message) || `unexpected ${msg.type}`);
  pollLine(args, state, "error", { ok: false, mode: "poll", yourTurn: false, error: message });
  return 1;
}

function fail(message, event = "error") {
  writeLine({
    event: /timeout/i.test(message) ? "timeout" : event,
    ok: false,
    error: message,
    you: null,
    lastOpponentMove: null,
    legalActions: [],
    turn: null,
    roomCode: null,
  });
  process.stdout.write("", () => process.exit(1));
}

let quitting = false;

function shutdown(sock, lines, code) {
  if (quitting) return;
  quitting = true;
  if (sock) sock.close();
  if (lines && lines.rl) lines.rl.close();
  process.stdout.write("", () => process.exit(code));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  normalize(args);
  if (args.poll) {
    const { sock, code } = await runPoll(args);
    shutdown(sock, null, code);
    return;
  }
  const { sock, lines, code } = await runInteractive(args);
  shutdown(sock, lines, code);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  fail(message);
});
