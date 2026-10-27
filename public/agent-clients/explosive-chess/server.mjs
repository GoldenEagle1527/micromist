#!/usr/bin/env node
/**
 * Official explosive-chess client. No chess strength.
 *
 * One process joins the room WebSocket, then listens on 127.0.0.1 at an
 * ephemeral port. Drive the match with curl against that port. This process
 * does not choose moves. It exits on game_over, on
 * POST /shutdown, or on a fatal disconnect.
 *
 *   node server.mjs --origin https://HOST --seat red create_room
 *   node server.mjs --origin https://HOST --seat red create_room -c CODE
 *   node server.mjs --origin https://HOST --seat blue join_room -c CODE
 *   node server.mjs --url wss://HOST/ws/explosive-chess:CODE --seat red claim_seat -c CODE
 *
 * Node 22+ (global WebSocket). On older Node, use server.py.
 * Stdout is one JSON object per line. The first line after listen is
 * {"event":"listening","port":N,"base":"http://127.0.0.1:N"}.
 * Diagnostics go to stderr.
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const HELP = `explosive-chess official client (no chess strength)

One process joins as kind "agent", keeps the WebSocket open, and serves a
local HTTP API on 127.0.0.1. You choose every move with curl. The process
does not read moves from anywhere else, and it does not choose moves.
It exits when event is game_over, when you POST /shutdown, or on a fatal disconnect.
Do not wrap it in a solver, search tree, or auto-play loop.
The one-shot client that exited after a single your_turn is retired.

  node server.mjs --origin https://HOST --seat red create_room
  node server.mjs --origin https://HOST --seat red create_room -c CODE
  node server.mjs --origin https://HOST --seat blue join_room -c CODE
  node server.mjs --url wss://HOST/ws/explosive-chess:CODE --seat red claim_seat -c CODE

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
  --verbose     Accepted for older commands. board and effects are always included
  --timeout     Seconds to block for one server push. Omit to wait until game_over
  --help

After the socket joins, the process binds 127.0.0.1 on an ephemeral port and
prints {"event":"listening","port":N,"base":"http://127.0.0.1:N"}.
Replace BASE with that base:

  curl -sS "$BASE/state"
  curl -sS "$BASE/wait?event=your_turn"
  curl -sS -X POST "$BASE/move" -H "content-type: application/json" --data "{\\"row\\":0,\\"col\\":0}"
  curl -sS -X POST "$BASE/seat" -H "content-type: application/json" --data "{\\"seat\\":\\"red\\"}"
  curl -sS -X POST "$BASE/config" -H "content-type: application/json" --data "{\\"boardSize\\":9,\\"winMode\\":\\"steps\\",\\"winParam\\":4,\\"hostColor\\":\\"red\\"}"
  curl -sS -X POST "$BASE/shutdown"

GET /state is you, turn, board, effects, legalActions, phase, the last event, roomCode, canConfig, and result when the match is over.
GET /wait blocks until your_turn or game_over. ?timeout=SECONDS returns the state. Omit timeout to wait until the match ends.
POST /move sends {"row":n,"col":n} only when that cell is in legalActions.
POST /config is set_config when canConfig is true and the room is still a lobby. If it cannot apply, the response is an error and the process exits non-zero.
POST /seat claims red or blue.
POST /shutdown closes the socket and exits 0.

Join does not take a seat. Pass --seat red or --seat blue to play.
The same playerId reclaims red, blue, or spectator. A new id is a new person.
Omit --player-id to use ~/.config/micromist/explosive-chess-player-id
(or $XDG_CONFIG_HOME/micromist/explosive-chess-player-id). Passing --player-id
does not replace that file. A second agent on this machine passes its own id.
Stdout is one JSON object per line. Diagnostics go to stderr.
Node 22+ for global WebSocket. Otherwise use server.py.
`;

const INTERRUPT = Symbol("interrupt");
const KEEPALIVE_MS = 20000;
const RECONNECT_HINT = "Reconnect with the same --player-id and claim the same seat.";

class CliError extends Error {}

function parseArgs(argv) {
  const args = {
    help: false,
    verbose: false,
    origin: "",
    url: "",
    playerId: "",
    name: "Agent",
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
  args.budgetMs = args.timeout == null ? 0 : Math.min(Math.round(args.timeout * 1000), 3600 * 1000);
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
    this._interrupted = false;
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

  interrupt() {
    this._interrupted = true;
    this._wake();
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
          // A queued HTTP command stays in session.commands. Drop the wake
          // flag so the next wait does not spin, then the pump drains commands.
          this._interrupted = false;
          cleanup();
          resolve(msg);
          return;
        }
        if (this._interrupted) {
          this._interrupted = false;
          cleanup();
          resolve(INTERRUPT);
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
    throw new CliError("global WebSocket is missing. Use Node 22+ or the Python client server.py.");
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
    effects: [],
    phase: null,
    reclaimed: null,
    reusedRoom: false,
    playUrl: `${httpOriginFrom(args)}/play/explosive-chess?room=${args.code}`,
    result: null,
    moveMark: 0,
    awaitingAck: false,
    lastEvent: null,
    errorText: null,
    recoverable: false,
    hint: null,
    fatal: false,
  };
}

function emit(args, state, event, extra = {}) {
  if (event !== "listening") {
    state.lastEvent = event;
    state.errorText = extra.error || null;
    state.recoverable = extra.recoverable === true;
    state.hint = extra.hint || null;
  }
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
  if (event === "listening") {
    line.port = extra.port;
    line.base = extra.base;
  }
  if (extra.error) line.error = extra.error;
  if (extra.recoverable === true) line.recoverable = true;
  if (extra.hint) line.hint = extra.hint;
  line.board = state.board ?? null;
  line.effects = Array.isArray(state.effects) ? state.effects : [];
  writeLine(line);
  notifyWaiters();
}

function applyPublic(state, publicState) {
  if (!publicState || typeof publicState !== "object") return;
  if ("turn" in publicState) state.turn = publicState.turn ?? null;
  if ("board" in publicState) state.board = publicState.board;
}

function boardSizeOf(state, payload) {
  const board = state.board;
  if (Array.isArray(board) && board.length > 0) return board.length;
  const counts = payload && payload.fullState && payload.fullState.counts;
  if (Array.isArray(counts) && counts.length > 0) {
    const size = Math.round(Math.sqrt(counts.length));
    if (size * size === counts.length) return size;
  }
  const pubBoard = payload && payload.publicState && payload.publicState.board;
  if (Array.isArray(pubBoard) && pubBoard.length > 0) return pubBoard.length;
  return 0;
}

function coordFromIndex(index, boardSize) {
  if (!Number.isInteger(index) || boardSize <= 0) return null;
  if (index < 0 || index >= boardSize * boardSize) return null;
  return { row: Math.floor(index / boardSize), col: index % boardSize };
}

function effectsFromFrames(frames, boardSize) {
  if (!Array.isArray(frames) || boardSize <= 0) return [];
  const effects = [];
  for (const frame of frames) {
    if (!frame || typeof frame !== "object") continue;
    const exploded = coordFromIndex(frame.explodedCell, boardSize);
    if (!exploded) continue;
    const spread = [];
    const affected = Array.isArray(frame.affectedCells) ? frame.affectedCells : [];
    for (const idx of affected) {
      const cell = coordFromIndex(idx, boardSize);
      if (cell) spread.push(cell);
    }
    effects.push({ exploded, spread });
  }
  return effects;
}

function applyEffects(state, effects) {
  if (Array.isArray(effects)) state.effects = effects;
}

function applyObservation(state, obs) {
  if (!obs || typeof obs !== "object") return;
  if (obs.you && typeof obs.you === "object") state.you = obs.you;
  if (typeof obs.phase === "string") state.phase = obs.phase;
  state.legalActions = Array.isArray(obs.legalActions) ? obs.legalActions : [];
  applyPublic(state, obs.publicState);
  applyEffects(state, obs.effects);
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
  return "not the config host; ignoring --config";
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

async function maybeClaim(sock, args, state) {
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
  emit(args, state, "seated", { ok: true });
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

async function fillResult(sock, state, moveMsg) {
  let over = null;
  const index = sock.buf.findIndex((msg) => msg.type === "game_over");
  if (index >= 0) over = sock.buf.splice(index, 1)[0];
  else {
    const deadline = Date.now() + 800;
    while (Date.now() < deadline) {
      try {
        const next = await sock.waitFor((msg) => msg.type === "game_over", Math.max(1, deadline - Date.now()));
        if (next === INTERRUPT) continue;
        over = next;
        break;
      } catch {
        over = null;
        break;
      }
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

function snapshot(args, state, ok, extra = {}) {
  const you = state.you && typeof state.you === "object" ? state.you : null;
  const body = {
    ok: extra.error ? false : ok,
    event: extra.event || state.lastEvent,
    you: you ? { ...you } : you,
    turn: state.turn,
    legalActions: state.legalActions.map((action) => (action && typeof action === "object" ? { ...action } : action)),
    phase: state.phase,
    roomCode: state.roomCode,
    canConfig: you?.canConfig === true,
    lastOpponentMove: state.lastOpponentMove,
    result: state.result,
  };
  if (state.listenBase) {
    body.port = state.listenPort;
    body.base = state.listenBase;
  }
  if (extra.error || (!body.ok && state.errorText)) body.error = extra.error || state.errorText;
  if (state.recoverable) body.recoverable = true;
  if (state.hint) body.hint = state.hint;
  body.board = state.board ?? null;
  body.effects = Array.isArray(state.effects) ? state.effects : [];
  return body;
}

function yourTurnReady(state) {
  return state.lastEvent === "your_turn" && !state.awaitingAck && !state.result && state.legalActions.length > 0;
}

function waitMatches(state, target) {
  if (state.fatal || state.lastEvent === "game_over" || state.lastEvent === "room_closed" || state.result) return true;
  if (target === "game_over") return false;
  if (target === "your_turn") return yourTurnReady(state);
  return state.lastEvent === target && !state.awaitingAck;
}

const httpWaiters = [];

function notifyWaiters() {
  for (const waiter of [...httpWaiters]) waiter.check();
}

function waitForEvent(args, state, target, timeoutSec) {
  const finish = (status, body, waiter) => {
    if (waiter) {
      if (waiter.timer) clearTimeout(waiter.timer);
      const index = httpWaiters.indexOf(waiter);
      if (index >= 0) httpWaiters.splice(index, 1);
    }
    return { status, body };
  };
  return new Promise((resolve) => {
    const waiter = {
      timer: null,
      check() {
        if (!waitMatches(state, target)) return false;
        const ok = state.lastEvent !== "error" && state.lastEvent !== "room_closed" && state.lastEvent !== "timeout" && !state.fatal;
        resolve(finish(200, snapshot(args, state, ok), waiter));
        return true;
      },
    };
    if (waiter.check()) return;
    if (timeoutSec === 0) {
      const body = snapshot(args, state, false, { event: "timeout", error: "timeout" });
      resolve(finish(408, body, null));
      return;
    }
    if (timeoutSec != null && timeoutSec > 0) {
      waiter.timer = setTimeout(() => {
        const body = snapshot(args, state, false, { event: "timeout", error: "timeout" });
        resolve(finish(408, body, waiter));
      }, Math.round(timeoutSec * 1000));
    }
    httpWaiters.push(waiter);
  });
}

function cellInLegal(state, row, col) {
  return state.legalActions.some((action) => action && action.row === row && action.col === col);
}

function moveRejectReason(state, row, col) {
  if (state.result || state.lastEvent === "game_over") return "game is over";
  if (state.awaitingAck) return "not your turn";
  if (!cellInLegal(state, row, col)) return "move is not in legalActions";
  return "";
}

function parseJsonObject(text, label) {
  if (!text || !String(text).trim()) throw new CliError(`${label} must be a JSON object`);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CliError(`${label} must be a JSON object`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError(`${label} must be a JSON object`);
  }
  return value;
}

function parseMoveBody(text) {
  const value = parseJsonObject(text, "move");
  const { row, col } = value;
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) {
    throw new CliError("move requires non-negative integer row and col");
  }
  return { row, col };
}

function parseSeatBody(text) {
  const value = parseJsonObject(text, "seat");
  const seat = typeof value.seat === "string" ? value.seat.trim().toLowerCase() : "";
  if (seat !== "red" && seat !== "blue") throw new CliError("seat must be red or blue");
  return seat;
}

function parseTimeoutQuery(raw) {
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new CliError("timeout must be a non-negative number of seconds");
  return Math.min(value, 86400);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 65536) {
        reject(new CliError("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj, done) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body, () => {
    if (done) done();
  });
}

let quitting = false;
let exitTimer = null;
let httpServer = null;
let activeSock = null;

function shutdown(code) {
  if (quitting) return;
  quitting = true;
  if (exitTimer) clearTimeout(exitTimer);
  if (activeSock) activeSock.close();
  const finish = () => {
    process.stdout.write("", () => process.exit(code));
  };
  if (httpServer) {
    httpServer.close(finish);
    setTimeout(finish, 200).unref?.();
    return;
  }
  finish();
}

function requestExit(code) {
  if (exitTimer || quitting) return;
  exitTimer = setTimeout(() => shutdown(code), 50);
}

function settlePending(box, result) {
  if (!box || box.settled) return;
  box.settled = true;
  box.resolve(result);
}

function failPending(session, status, body, exitCode) {
  const result = { status, body, exitCode };
  settlePending(session.pendingMove, result);
  settlePending(session.pendingSeat, result);
  settlePending(session.pendingConfig, result);
  session.pendingMove = null;
  session.pendingSeat = null;
  session.pendingConfig = null;
  while (session.commands.length) {
    settlePending(session.commands.shift(), result);
  }
}

function createSession(sock, args, state) {
  return {
    sock,
    args,
    state,
    commands: [],
    pendingMove: null,
    pendingSeat: null,
    pendingConfig: null,
    pumpWaiting: false,
    stopped: false,
  };
}

function enqueue(session, type, payload) {
  return new Promise((resolve, reject) => {
    session.commands.push({ type, payload, resolve, reject, settled: false });
    if (session.pumpWaiting) session.sock.interrupt();
  });
}

function busy(session) {
  return session.pendingMove || session.pendingSeat || session.pendingConfig;
}

function beginMove(session, row, col) {
  const reason = moveRejectReason(session.state, row, col);
  if (reason) {
    return { immediate: { status: 400, body: snapshot(session.args, session.state, false, { error: reason }) } };
  }
  const mark = session.sock.highWater();
  session.state.awaitingAck = true;
  session.state.moveMark = mark;
  session.sock.send("move", { row, col });
  return { pending: "move", mark };
}

function beginSeat(session, seat) {
  const mark = session.sock.highWater();
  session.sock.send("claim_seat", { seat });
  return { pending: "seat", mark };
}

function beginConfig(session, config) {
  const you = session.state.you;
  const phase = session.state.phase;
  if (!canConfigure(you, phase)) {
    const message = configBlockedReason(you, phase);
    emit(session.args, session.state, "error", { ok: false, error: message });
    return {
      immediate: {
        status: 409,
        body: snapshot(session.args, session.state, false, { error: message }),
        exitCode: 1,
      },
    };
  }
  const mark = session.sock.highWater();
  session.sock.buf = session.sock.buf.filter((msg) => msg.type !== "room" || msg._seq > mark);
  session.sock.send("set_config", config);
  return { pending: "config", mark };
}

function startCommand(session, box) {
  try {
    let started;
    if (box.type === "move") started = beginMove(session, box.payload.row, box.payload.col);
    else if (box.type === "seat") started = beginSeat(session, box.payload);
    else if (box.type === "config") started = beginConfig(session, box.payload);
    else {
      settlePending(box, { status: 500, body: snapshot(session.args, session.state, false, { error: "unknown command" }) });
      return;
    }
    if (started.immediate) {
      settlePending(box, started.immediate);
      if (started.immediate.exitCode != null) requestExit(started.immediate.exitCode);
      return;
    }
    const pending = { ...box, mark: started.mark };
    if (started.pending === "move") session.pendingMove = pending;
    else if (started.pending === "seat") session.pendingSeat = pending;
    else session.pendingConfig = pending;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    settlePending(box, { status: 400, body: snapshot(session.args, session.state, false, { error: message }) });
  }
}

async function finishGame(session, msg) {
  const payload = msg.payload || {};
  session.state.result = {
    winner: payload.winner ?? null,
    winnerColor: payload.winnerColor ?? null,
    winReason: payload.winReason ?? null,
  };
  session.state.legalActions = [];
  session.state.awaitingAck = false;
  session.state.lastOpponentMove = opponentMove(session.sock.seen, session.args.playerId) ?? session.state.lastOpponentMove;
  emit(session.args, session.state, "game_over", { ok: true });
  const body = snapshot(session.args, session.state, true);
  if (session.pendingMove && msg._seq > session.pendingMove.mark) {
    const box = session.pendingMove;
    session.pendingMove = null;
    settlePending(box, { status: 200, body, exitCode: 0 });
  }
  requestExit(0);
}

async function applyMessage(session, msg) {
  const { args, state, sock } = session;
  const type = msg.type;
  const payload = msg.payload || {};
  if (type === "state") {
    if (Array.isArray(payload.animationFrames)) {
      state.effects = effectsFromFrames(payload.animationFrames, boardSizeOf(state, payload));
    }
    return;
  }
  if (type === "room") {
    if (typeof payload.phase === "string") state.phase = payload.phase;
    if (session.pendingConfig && msg._seq > session.pendingConfig.mark) {
      const box = session.pendingConfig;
      session.pendingConfig = null;
      settlePending(box, { status: 200, body: snapshot(args, state, true) });
    }
    return;
  }
  if (type === "seated") {
    state.you = youFromSeat(state.you, payload);
    emit(args, state, "seated", { ok: true });
    if (session.pendingSeat && msg._seq > session.pendingSeat.mark) {
      const box = session.pendingSeat;
      session.pendingSeat = null;
      settlePending(box, { status: 200, body: snapshot(args, state, true) });
    }
    return;
  }
  if (type === "error") {
    const message = String(payload.message || "error");
    if (session.pendingConfig && msg._seq > session.pendingConfig.mark) {
      emit(args, state, "error", { ok: false, error: message });
      const box = session.pendingConfig;
      session.pendingConfig = null;
      settlePending(box, {
        status: 409,
        body: snapshot(args, state, false, { error: message }),
        exitCode: 1,
      });
      requestExit(1);
      return;
    }
    if (session.pendingSeat && msg._seq > session.pendingSeat.mark) {
      emit(args, state, "error", { ok: false, error: message });
      const box = session.pendingSeat;
      session.pendingSeat = null;
      settlePending(box, { status: 409, body: snapshot(args, state, false, { error: message }) });
      return;
    }
    if (session.pendingMove && msg._seq > session.pendingMove.mark) {
      state.awaitingAck = false;
      emit(args, state, "error", { ok: false, error: message });
      const box = session.pendingMove;
      session.pendingMove = null;
      settlePending(box, { status: 400, body: snapshot(args, state, false, { error: message }) });
      return;
    }
    emit(args, state, "error", { ok: false, error: message });
    return;
  }
  if (type === "move_applied") {
    const by = payload.by && payload.by.playerId;
    const ours = typeof by === "string" && by === args.playerId;
    if (typeof by === "string" && by !== args.playerId) state.lastOpponentMove = payload.action ?? null;
    applyPublic(state, payload.publicState);
    applyEffects(state, payload.effects);
    if (payload.gameOver === true) {
      await fillResult(sock, state, msg);
      state.awaitingAck = false;
      state.lastOpponentMove = opponentMove(sock.seen, args.playerId) ?? state.lastOpponentMove;
      emit(args, state, "game_over", { ok: true });
      const body = snapshot(args, state, true);
      if (session.pendingMove) {
        const box = session.pendingMove;
        session.pendingMove = null;
        settlePending(box, { status: 200, body, exitCode: 0 });
      }
      requestExit(0);
      return;
    }
    if (ours && session.pendingMove && msg._seq > session.pendingMove.mark) {
      state.awaitingAck = false;
      state.legalActions = [];
      state.lastEvent = "move_applied";
      state.errorText = null;
      const box = session.pendingMove;
      session.pendingMove = null;
      settlePending(box, { status: 200, body: snapshot(args, state, true) });
      notifyWaiters();
      return;
    }
    if (isSpectator(state)) {
      state.lastOpponentMove = payload.action ?? state.lastOpponentMove;
      emit(args, state, "watch", { ok: true });
      return;
    }
    if (typeof by === "string" && by !== args.playerId) emit(args, state, "opponent", { ok: true });
    return;
  }
  if (type === "your_turn") {
    if (state.awaitingAck) {
      const applied = ourApplySeq(sock.seen, args.playerId, state.moveMark);
      if (!(applied > 0 && msg._seq > applied)) return;
    }
    state.awaitingAck = false;
    applyObservation(state, payload.observation);
    state.lastOpponentMove = opponentMove(sock.seen, args.playerId) ?? state.lastOpponentMove;
    emit(args, state, "your_turn", { ok: true });
    return;
  }
  if (type === "game_over") {
    await finishGame(session, msg);
    return;
  }
  if (type === "room_closed") {
    emit(args, state, "room_closed", { ok: false, error: "Room closed" });
    const body = snapshot(args, state, false, { error: "Room closed" });
    failPending(session, 409, body, 1);
    requestExit(1);
    return;
  }
  if (type === "observation") {
    applyObservation(state, payload.observation || payload);
  }
}

function onPumpFailure(session, err) {
  if (quitting || exitTimer) return;
  const message = err instanceof Error ? err.message : String(err);
  const event = /timeout/i.test(message) && !/websocket closed/i.test(message) ? "timeout" : "error";
  const extra = /websocket closed/i.test(message) ? disconnectExtra(message) : { ok: false, error: message };
  session.state.fatal = true;
  emit(session.args, session.state, event, extra);
  const body = snapshot(session.args, session.state, false, { error: extra.error || message });
  failPending(session, 500, body, 1);
  requestExit(1);
}

async function pump(session) {
  while (!session.stopped && !quitting) {
    if (session.commands.length && !busy(session)) {
      session.sock._interrupted = false;
      startCommand(session, session.commands.shift());
      continue;
    }
    let msg;
    session.pumpWaiting = true;
    try {
      msg = await session.sock.waitFor(() => true, session.args.budgetMs);
    } catch (err) {
      session.pumpWaiting = false;
      onPumpFailure(session, err);
      return;
    }
    session.pumpWaiting = false;
    if (msg === INTERRUPT) continue;
    try {
      await applyMessage(session, msg);
    } catch (err) {
      onPumpFailure(session, err);
      return;
    }
  }
}

async function handleHttp(session, req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const route = url.pathname;
  const method = req.method || "GET";
  if (method === "GET" && route === "/state") {
    const ok = session.state.lastEvent !== "error" && session.state.lastEvent !== "room_closed" && !session.state.fatal;
    sendJson(res, 200, snapshot(session.args, session.state, ok));
    return;
  }
  if (method === "GET" && route === "/wait") {
    const target = url.searchParams.get("event") || "your_turn";
    const timeoutSec = parseTimeoutQuery(url.searchParams.get("timeout"));
    const result = await waitForEvent(session.args, session.state, target, timeoutSec);
    sendJson(res, result.status, result.body);
    return;
  }
  if (method === "POST" && (route === "/move" || route === "/seat" || route === "/config" || route === "/shutdown")) {
    if (route === "/shutdown") {
      const body = snapshot(session.args, session.state, true, { event: "shutdown" });
      body.event = "shutdown";
      body.ok = true;
      sendJson(res, 200, body, () => requestExit(0));
      return;
    }
    const text = await readBody(req);
    let queued;
    if (route === "/move") queued = enqueue(session, "move", parseMoveBody(text));
    else if (route === "/seat") queued = enqueue(session, "seat", parseSeatBody(text));
    else queued = enqueue(session, "config", parseJsonObject(text, "config"));
    const result = await queued;
    sendJson(res, result.status, result.body, () => {
      if (result.exitCode != null) requestExit(result.exitCode);
    });
    return;
  }
  if (route === "/state" || route === "/wait" || route === "/move" || route === "/seat" || route === "/config" || route === "/shutdown") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  sendJson(res, 404, { ok: false, error: "not found" });
}

function listenAndServe(session) {
  const server = http.createServer((req, res) => {
    handleHttp(session, req, res).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) sendJson(res, 400, snapshot(session.args, session.state, false, { error: message }));
      else res.destroy();
    });
  });
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.timeout = 0;
  server.keepAliveTimeout = 5000;
  httpServer = server;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;
      session.state.listenPort = port;
      session.state.listenBase = base;
      emit(session.args, session.state, "listening", { ok: true, port, base });
      resolve();
      pump(session).catch((err) => onPumpFailure(session, err));
    });
  });
}

function fail(message) {
  writeLine({
    event: /timeout/i.test(message) ? "timeout" : "error",
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

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  normalize(args);
  let state = blankState(args);
  try {
    const connected = await connectAndJoin(args);
    activeSock = connected.sock;
    state = stateFromJoined(args, connected.joined);
    emit(args, state, "joined", { ok: true });
    await maybeConfig(activeSock, connected.joined, args.config);
    await maybeClaim(activeSock, args, state);
    await activeSock.idle();
    if (isSpectator(state)) emit(args, state, "spectator", { ok: true });
    const session = createSession(activeSock, args, state);
    await listenAndServe(session);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const event = /timeout/i.test(message) && !/websocket closed/i.test(message) ? "timeout" : "error";
    const extra = /websocket closed/i.test(message) ? disconnectExtra(message) : { ok: false, error: message };
    emit(args, state, event, extra);
    shutdown(1);
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  fail(message);
});
