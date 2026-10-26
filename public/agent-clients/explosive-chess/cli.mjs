#!/usr/bin/env node
/**
 * Official explosive-chess interactive client. No chess strength.
 *
 * One process is the whole match. It joins as kind "agent", prints one JSON
 * line per event, and sends the move you type on stdin. It never picks a move.
 * It exits when event is game_over, or on a fatal disconnect.
 *
 *   node cli.mjs --origin https://HOST --seat red create_room
 *   node cli.mjs --origin https://HOST --seat red create_room -c CODE
 *   node cli.mjs --origin https://HOST --seat blue join_room -c CODE
 *   node cli.mjs --url wss://HOST/ws/explosive-chess:CODE --seat red claim_seat -c CODE
 *
 * Node 22+ (global WebSocket). On older Node, use cli.py.
 * Stdout is one JSON object per line. Diagnostics go to stderr.
 * --poll is the one-shot fallback for environments that cannot hold this session.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HELP = `explosive-chess official interactive client (no chess strength)

One process is the whole match. It joins as kind "agent", prints one JSON
line per event, and reads the move you type on stdin. It does not choose
moves. It exits when event is game_over, or on a fatal disconnect.
Do not wrap it in a solver, search tree, or auto-play loop.
The one-shot client that exited after a single your_turn is retired.

  node cli.mjs --origin https://HOST --seat red create_room
  node cli.mjs --origin https://HOST --seat red create_room -c CODE
  node cli.mjs --origin https://HOST --seat blue join_room -c CODE
  node cli.mjs --url wss://HOST/ws/explosive-chess:CODE --seat red claim_seat -c CODE

  create_room   Open a room and join as a spectator. -c is optional.
  join_room     Join a room as a spectator. -c CODE is required unless --url has the code.
  claim_seat    Join, then claim --seat red or blue. -c CODE is required unless --url has it.
  -c, --code    Room code [a-z0-9]
  --origin      http(s) origin of the game host
  --url         Exact websocket URL. Used as-is when present.
  --seat        red or blue. Sent as claim_seat after join. Omit to watch.
  --player-id   This process's id. Omit to reuse the id stored on this machine.
  --name        Display name (default Agent)
  --config      JSON object. Sent as set_config only when you.canConfig is true and the room is still a lobby. If it cannot apply, stdout gets an error JSON line and the process exits before play
  --verbose     Include board on each JSON line
  --timeout     Seconds to block for one server push. Omit to wait until game_over
  --poll        One-shot fallback. Prints one JSON line and exits. Accepts --move ROW,COL
  --move        Poll only. ROW,COL you already chose. Interactive play types this on stdin
  --help

Join does not take a seat. Pass --seat red or --seat blue to play.
The same playerId reclaims red, blue, or spectator. A new id is a new person.
Omit --player-id to use ~/.config/micromist/explosive-chess-player-id
(or $XDG_CONFIG_HOME/micromist/explosive-chess-player-id). Passing --player-id
does not replace that file. A second agent on this machine passes its own id.
Interactive stdin is one move per line: ROW,COL or {"row":ROW,"col":COL}, ended by \\n or \\r.
A second Enter is not required. Stdout is one JSON object per line. Diagnostics go to stderr.
Node 22+ for global WebSocket. Otherwise use cli.py.
`;

const ABORT = Symbol("abort");
const EOF = Symbol("eof");
const TIMED_OUT = Symbol("timeout");
const KEEPALIVE_MS = 20000;
const RECONNECT_HINT = "Reconnect with the same --player-id and claim the same seat.";

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
    seat: "",
    playerIdFromFlag: false,
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
      args.playerIdFromFlag = true;
      i += 1;
    } else if (flag === "--seat") {
      args.seat = take(i, flag).trim().toLowerCase();
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
    } else if (flag === "create_room" || flag === "join_room" || flag === "claim_seat") {
      if (args.command) throw new CliError("only one of create_room, join_room, or claim_seat");
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

function playerIdFile() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "micromist", "explosive-chess-player-id");
}

function validPlayerId(value) {
  return /^[A-Za-z0-9._:-]{1,80}$/.test(value);
}

/** Local id for this machine. An explicit --player-id is not written back. */
function loadOrCreatePlayerId() {
  const file = playerIdFile();
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (validPlayerId(existing)) {
      console.error(`playerId ${existing} loaded from ${file}`);
      return existing;
    }
  } catch {
    /* first run, or the file is not readable */
  }
  const id = `agent-${token(8)}`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${id}\n`, { encoding: "utf8", mode: 0o600 });
    console.error(`playerId ${id} stored at ${file}`);
  } catch (err) {
    console.error(`could not store playerId at ${file}: ${err instanceof Error ? err.message : err}`);
  }
  return id;
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
  if (!args.command) throw new CliError("missing command create_room, join_room, or claim_seat");
  if (args.timeout != null && (!Number.isFinite(args.timeout) || args.timeout < 0)) {
    throw new CliError("--timeout must be a non-negative number of seconds");
  }
  if (args.seat && args.seat !== "red" && args.seat !== "blue") {
    throw new CliError("--seat must be red or blue");
  }
  if (args.command === "claim_seat" && !args.seat) {
    throw new CliError("claim_seat requires --seat red or --seat blue");
  }
  if (args.code && !/^[a-z0-9]+$/.test(args.code)) {
    throw new CliError("room code must be [a-z0-9]");
  }
  if (args.command === "create_room" && !args.code && !args.url) args.code = token(6);
  let fromUrl = "";
  if (args.url) fromUrl = codeFromWsUrl(args.url);
  if (args.code && fromUrl && args.code !== fromUrl) {
    throw new CliError("-c does not match the room code in --url");
  }
  if (!args.code) args.code = fromUrl;
  if (!args.code) {
    throw new CliError(args.command === "create_room" ? "missing room code" : `${args.command} requires -c CODE`);
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
  if (!args.playerId.trim()) {
    if (args.playerIdFromFlag) throw new CliError("--player-id must not be empty");
    args.playerId = loadOrCreatePlayerId();
  }
  if (!validPlayerId(args.playerId.trim())) {
    throw new CliError("--player-id must be 1-80 characters of letters, digits, dot, underscore, colon, or dash");
  }
  args.playerId = args.playerId.trim();
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

  startKeepalive() {
    this.stopKeepalive();
    // Text frame "ping" is answered by the room's auto-response ("pong")
    // without waking game logic. Idle proxies drop a quiet socket.
    this._ping = setInterval(() => {
      if (this.closed || this.stopping) return;
      try {
        this.ws.send("ping");
      } catch {
        /* close handler reports the drop */
      }
    }, KEEPALIVE_MS);
    if (typeof this._ping.unref === "function") this._ping.unref();
  }

  stopKeepalive() {
    if (this._ping) clearInterval(this._ping);
    this._ping = null;
  }

  close() {
    this.stopping = true;
    this.stopKeepalive();
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
    reusedRoom: false,
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
    line.reusedRoom = state.reusedRoom === true;
    line.canConfig = state.you?.canConfig === true;
    line.playUrl = state.playUrl;
    line.phase = state.phase;
  }
  if (event === "seated") line.canConfig = state.you?.canConfig === true;
  if (event === "game_over") line.result = state.result;
  if (extra.error) line.error = extra.error;
  if (extra.recoverable === true) line.recoverable = true;
  if (extra.hint) line.hint = extra.hint;
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

function disconnectExtra(message) {
  if (!/websocket closed/i.test(message)) return { ok: false, error: message };
  return { ok: false, error: "websocket closed", recoverable: true, hint: RECONNECT_HINT };
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
      sock.startKeepalive();
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

function canConfigure(you, phase) {
  if (!you || typeof you !== "object") return false;
  if (phase && phase !== "lobby") return false;
  // canConfig is the server bit (playerId === hostId). role "host" is the same
  // fact after a seat claim, but a payload that says canConfig false must not
  // be overridden by role. Missing canConfig keeps the older role fallback.
  if (you.canConfig === false) return false;
  if (you.canConfig === true) return true;
  return you.role === "host";
}

function configBlockedReason(you, phase) {
  if (phase && phase !== "lobby") return "config locked; room is not a lobby";
  if (!you || you.canConfig === false) return "not the config host; ignoring --config";
  return "not the config host; ignoring --config";
}

async function maybeConfig(sock, joined, config) {
  if (!config) return;
  const you = joined.payload && joined.payload.you;
  const phase = joined.payload && joined.payload.phase;
  if (!canConfigure(you, phase)) {
    throw new CliError(configBlockedReason(you, phase));
  }
  sock.buf = sock.buf.filter((msg) => msg.type !== "room");
  sock.send("set_config", config);
  const msg = await sock.waitFor((item) => item.type === "room" || item.type === "error", 15000);
  if (msg.type === "error") {
    const message = String((msg.payload && msg.payload.message) || "set_config failed");
    throw new CliError(message);
  }
}

async function maybeClaim(sock, args, state, quiet = false) {
  if (!args.seat) return;
  const timeoutMs = args.budgetMs > 0 ? args.budgetMs : 15000;
  sock.send("claim_seat", { seat: args.seat });
  const msg = await sock.waitFor(
    (item) => item.type === "seated" || item.type === "error",
    timeoutMs,
  );
  if (msg.type === "error") {
    const message = String((msg.payload && msg.payload.message) || "claim_seat failed");
    throw new CliError(message);
  }
  const payload = msg.payload || {};
  state.you = youFromSeat(state.you, payload);
  if (!quiet) emit(args, state, "seated", { ok: true });
}

function youFromSeat(prev, payload) {
  const fromServer = payload.you && typeof payload.you === "object" ? { ...payload.you } : null;
  if (fromServer) {
    if (typeof fromServer.canConfig !== "boolean" && typeof payload.canConfig === "boolean") {
      fromServer.canConfig = payload.canConfig;
    }
    if (fromServer.seat == null && payload.seat != null) fromServer.seat = payload.seat;
    if (fromServer.role == null && payload.role != null) fromServer.role = payload.role;
    return fromServer;
  }
  if (!prev || typeof prev !== "object") return prev;
  const next = { ...prev, seat: payload.seat ?? prev.seat, color: payload.seat ?? prev.color };
  if (payload.role != null) next.role = payload.role;
  if (typeof payload.canConfig === "boolean") next.canConfig = payload.canConfig;
  return next;
}

function isSpectator(state) {
  return !state.you || state.you.seat === "spectator" || state.you.seat == null;
}

function stateFromJoined(args, joined) {
  const state = blankState(args);
  const payload = joined.payload || {};
  state.roomCode = payload.roomCode || args.code;
  state.you = payload.you || null;
  state.phase = payload.phase || null;
  state.reclaimed = payload.reclaimed === true;
  state.reusedRoom =
    payload.reusedRoom === true || (args.command === "create_room" && state.you && state.you.canConfig === false);
  if (state.roomCode) {
    state.playUrl = `${httpOriginFrom(args)}/play/explosive-chess?room=${state.roomCode}`;
  }
  return state;
}

function isCompleteMove(text) {
  try {
    return parseStdinMove(text) != null;
  } catch {
    return false;
  }
}

function createLines() {
  // Do not use readline. With crlfDelay, a pipe or raw PTY that ends a line on
  // \\r waits for another byte before the line is emitted, so one ROW,COL sits
  // until a second Enter. Split \\n, \\r\\n, and a bare \\r here, and on a
  // non-TTY accept one complete move that arrived without a delimiter.
  const pending = [];
  const waiters = [];
  let buf = "";
  let skipLf = false;
  let eof = false;
  const pushLine = (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else pending.push(line);
  };
  const feed = (text) => {
    if (skipLf) {
      if (text.startsWith("\n")) text = text.slice(1);
      skipLf = false;
    }
    if (!text) return;
    buf += text;
    while (buf.length) {
      const n = buf.indexOf("\n");
      const r = buf.indexOf("\r");
      if (n < 0 && r < 0) break;
      if (r >= 0 && (n < 0 || r < n)) {
        const line = buf.slice(0, r);
        buf = buf.slice(r + 1);
        if (buf.startsWith("\n")) buf = buf.slice(1);
        else if (buf.length === 0) skipLf = true;
        pushLine(line);
        continue;
      }
      const line = buf.slice(0, n);
      buf = buf.slice(n + 1);
      skipLf = false;
      pushLine(line);
    }
  };
  const onData = (chunk) => {
    const text = String(chunk);
    const before = buf;
    feed(text);
    if (!process.stdin.isTTY && before.length === 0 && buf.length > 0 && !/[\r\n]/.test(text) && isCompleteMove(buf)) {
      const line = buf;
      buf = "";
      pushLine(line);
    }
  };
  const onEnd = () => {
    if (buf.length) {
      pushLine(buf);
      buf = "";
    }
    eof = true;
    const waiter = waiters.shift();
    if (waiter) waiter(EOF);
  };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", onData);
  process.stdin.on("end", onEnd);
  process.stdin.resume();
  return {
    rl: {
      close() {
        process.stdin.off("data", onData);
        process.stdin.off("end", onEnd);
        process.stdin.pause();
      },
    },
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
  // Start reading stdin before the handshake so a move written during connect
  // is queued, and a single ROW,COL\\n is not stuck behind readline.
  const lines = createLines();
  let sock = null;
  let state = blankState(args);
  try {
    const connected = await connectAndJoin(args);
    sock = connected.sock;
    state = stateFromJoined(args, connected.joined);
    return await interactiveSession(sock, lines, args, state, connected.joined);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const event = /timeout/i.test(message) && !/websocket closed/i.test(message) ? "timeout" : "error";
    const extra = /websocket closed/i.test(message) ? disconnectExtra(message) : { ok: false, error: message };
    emit(args, state, event, extra);
    return { sock, lines, code: 1 };
  }
}

async function interactiveSession(sock, lines, args, state, joined) {
  try {
    emit(args, state, "joined", { ok: true });
    await maybeConfig(sock, joined, args.config);
    await maybeClaim(sock, args, state);
    await sock.idle();
    if (isSpectator(state)) {
      emit(args, state, "spectator", { ok: true });
    }
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
        emit(args, state, "error", disconnectExtra(message));
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
        if (isSpectator(state)) {
          state.lastOpponentMove = payload.action ?? state.lastOpponentMove;
          emit(args, state, "watch", { ok: true });
          continue;
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
  try {
    await maybeConfig(sock, joined, args.config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit(args, state, "error", { ok: false, error: message, mode: "poll" });
    return { sock, code: 1 };
  }
  await maybeClaim(sock, args, state, true);
  await sock.idle();
  if (isSpectator(state)) {
    pollLine(args, state, "spectator", {
      ok: true,
      mode: "poll",
      yourTurn: false,
    });
    return { sock, code: 0 };
  }
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
