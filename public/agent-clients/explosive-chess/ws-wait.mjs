#!/usr/bin/env node
/**
 * Official explosive-chess WebSocket transport. No chess strength.
 *
 * Connects, joins as kind "agent", optionally sends one move you already chose,
 * then either blocks until the server pushes your_turn / game_over (wait) or
 * returns one observation (poll). It never picks a move.
 *
 *   node ws-wait.mjs --url wss://HOST/ws/explosive-chess:CODE --player-id ID --name Agent
 *   node ws-wait.mjs --url wss://HOST/ws/explosive-chess:CODE --player-id ID --move ROW,COL
 *   node ws-poll.mjs --url wss://HOST/ws/explosive-chess:CODE --player-id ID --move ROW,COL
 *
 * Node 22+ (global WebSocket). On older Node, use ws_wait.py.
 * Stdout is one JSON object. Diagnostics go to stderr.
 */

const HELP = `explosive-chess official WebSocket transport (no chess strength)

The process connects, joins as kind "agent", optionally sends one move you
already chose, then either blocks until the server pushes your_turn /
game_over (wait) or returns one observation (poll).

It does not choose moves. Do not wrap it in a solver, search tree, or auto-play loop.

  node ws-wait.mjs --url wss://HOST/ws/explosive-chess:CODE --player-id ID --name Agent
  node ws-wait.mjs --url wss://HOST/ws/explosive-chess:CODE --player-id ID --move ROW,COL
  node ws-poll.mjs --url wss://HOST/ws/explosive-chess:CODE --player-id ID

  --url         WebSocket URL (required)
  --player-id   Seat id to join and reclaim (required)
  --name        Display name (default Agent)
  --move        ROW,COL you already chose from legalActions
  --config      JSON object. Sent as set_config only if you are host and the room is still a lobby
  --timeout     Seconds to block (default 180)
  --poll        Return current state instead of waiting for the opponent
  --help

Stdout is one JSON object. Exit 0 when ok is true.
Node 22+ for global WebSocket. Otherwise use ws_wait.py.
`;

function parseArgs(argv) {
  const file = String(argv[1] ?? "").replace(/\\/g, "/");
  const args = {
    poll: /(?:^|\/)ws-poll\.mjs$/.test(file),
    help: false,
    url: "",
    playerId: "",
    name: "Agent",
    move: null,
    config: null,
    timeout: 180,
  };
  const take = (i, flag) => {
    const value = argv[i + 1];
    if (value == null || String(value).startsWith("--")) {
      throw new Error(`missing value for ${flag}`);
    }
    return value;
  };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag === "--poll") args.poll = true;
    else if (flag === "--url") {
      args.url = String(take(i, flag));
      i += 1;
    } else if (flag === "--player-id") {
      args.playerId = String(take(i, flag));
      i += 1;
    } else if (flag === "--name") {
      args.name = String(take(i, flag));
      i += 1;
    } else if (flag === "--move") {
      args.move = parseMove(String(take(i, flag)));
      i += 1;
    } else if (flag === "--config") {
      args.config = parseConfig(String(take(i, flag)));
      i += 1;
    } else if (flag === "--timeout") {
      args.timeout = Number(take(i, flag));
      i += 1;
    } else {
      throw new Error(`unknown argument ${flag}`);
    }
  }
  return args;
}

function parseMove(text) {
  const match = /^(\d+)\s*,\s*(\d+)$/.exec(text.trim());
  if (!match) throw new Error("--move must be ROW,COL using non-negative integers");
  return { row: Number(match[1]), col: Number(match[2]) };
}

function parseConfig(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("--config must be a JSON object");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("--config must be a JSON object");
  }
  return value;
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
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`timeout after ${timeoutMs}ms`));
      }, timeoutMs);
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
      const cleanup = () => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((wake) => wake !== onMsg);
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
    throw new Error("global WebSocket is missing. Use Node 22+ or the Python client ws_wait.py.");
  }
  const ws = new WebSocket(url);
  const client = new AgentSocket(ws);
  const openTimeout = Math.min(timeoutMs, 20000);
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

function blank(mode) {
  return {
    ok: false,
    mode,
    event: "error",
    roomCode: null,
    you: null,
    phase: null,
    turn: null,
    yourTurn: false,
    legalActions: [],
    publicState: null,
    gameOver: false,
    winner: null,
    winnerColor: null,
    winReason: null,
    lastOpponentMove: null,
    reclaimed: null,
    error: null,
  };
}

function applyObservation(base, obs) {
  if (!obs || typeof obs !== "object") return;
  const legal = Array.isArray(obs.legalActions) ? obs.legalActions : [];
  const publicState =
    obs.publicState && typeof obs.publicState === "object" ? obs.publicState : null;
  const full =
    publicState && publicState.fullState && typeof publicState.fullState === "object"
      ? publicState.fullState
      : null;
  if (obs.you && typeof obs.you === "object") base.you = obs.you;
  if (typeof obs.phase === "string") base.phase = obs.phase;
  if (publicState && ("turn" in publicState)) base.turn = publicState.turn ?? null;
  base.legalActions = legal;
  base.publicState = publicState;
  base.yourTurn = legal.length > 0;
  if (full && full.gameOver === true) base.gameOver = true;
}

function latestObservation(seen) {
  let obs = null;
  for (const msg of seen) {
    if (msg.type === "your_turn" && msg.payload && msg.payload.observation) obs = msg.payload.observation;
    if (msg.type === "observation" && msg.payload && msg.payload.observation) obs = msg.payload.observation;
  }
  return obs;
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

function publicStateFromSeen(seen) {
  let found = null;
  for (const msg of seen) {
    if (msg.type === "move_applied" && msg.payload && msg.payload.publicState) found = msg.payload.publicState;
    if (
      msg.type === "your_turn" &&
      msg.payload &&
      msg.payload.observation &&
      msg.payload.observation.publicState
    ) {
      found = msg.payload.observation.publicState;
    }
  }
  return found;
}

function finishMessage(base, msg, seen, playerId) {
  const prior = latestObservation(seen);
  if (prior) applyObservation(base, prior);
  if (msg.type === "your_turn") {
    applyObservation(base, msg.payload && msg.payload.observation);
    base.ok = true;
    base.event = "your_turn";
    base.error = null;
  } else if (msg.type === "observation") {
    applyObservation(base, msg.payload && msg.payload.observation);
    base.ok = true;
    base.event = "observation";
    base.error = null;
  } else if (msg.type === "game_over") {
    const payload = msg.payload || {};
    if (!base.publicState) base.publicState = publicStateFromSeen(seen);
    base.ok = true;
    base.event = "game_over";
    base.gameOver = true;
    base.yourTurn = false;
    base.legalActions = [];
    base.winner = payload.winner ?? null;
    base.winnerColor = payload.winnerColor ?? null;
    base.winReason = payload.winReason ?? null;
    base.error = null;
  } else if (msg.type === "room_closed") {
    base.ok = false;
    base.event = "room_closed";
    base.error = "Room closed";
  } else if (msg.type === "error") {
    base.ok = false;
    base.event = "error";
    base.error = String((msg.payload && msg.payload.message) || "error");
  } else {
    base.ok = false;
    base.event = msg.type;
    base.error = `unexpected ${msg.type}`;
  }
  base.lastOpponentMove = opponentMove(seen, playerId);
  return base;
}

async function connectAndJoin(args, timeoutMs) {
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
        throw new Error(message);
      }
      await sock.idle();
      return { sock, joined };
    } catch (err) {
      lastErr = err;
      if (sock) sock.close();
      if (attempt === 4 || !retriable(err)) break;
      console.error(`join attempt ${attempt} failed: ${err.message}; retrying`);
      await delay(250 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("join failed");
}

async function maybeConfig(sock, joined, config, timeoutMs) {
  if (!config) return;
  const you = joined.payload && joined.payload.you;
  if (!you || you.role !== "host") {
    console.error("not host; ignoring --config");
    return;
  }
  if (joined.payload.phase && joined.payload.phase !== "lobby") return;
  sock.buf = sock.buf.filter((msg) => msg.type !== "room");
  sock.send("set_config", config);
  const msg = await sock.waitFor(
    (item) => item.type === "room" || item.type === "error",
    Math.min(timeoutMs, 15000),
  );
  if (msg.type === "error") {
    const message = String((msg.payload && msg.payload.message) || "");
    if (!/locked/i.test(message)) throw new Error(message || "set_config failed");
  }
}

async function run(args) {
  const mode = args.poll ? "poll" : "wait";
  const timeoutMs = Math.min(Math.round(args.timeout * 1000), 3600 * 1000);
  const ackMs = Math.min(timeoutMs, 20000);
  const { sock, joined } = await connectAndJoin(args, timeoutMs);
  const base = blank(mode);
  base.roomCode = (joined.payload && joined.payload.roomCode) || null;
  base.you = (joined.payload && joined.payload.you) || null;
  base.reclaimed = joined.payload ? joined.payload.reclaimed === true : null;
  const you = base.you;
  if (you && you.seat === "spectator") {
    base.event = "spectator";
    base.error = "Room is full. This connection is a spectator and will not receive your_turn.";
    return { sock, result: base };
  }
  await maybeConfig(sock, joined, args.config, timeoutMs);
  await sock.idle();

  if (!args.move) {
    if (args.poll) {
      const mark = sock.highWater();
      sock.send("observe", {});
      const msg = await sock.waitFor(
        (item) => item._seq > mark && (item.type === "observation" || item.type === "error" || item.type === "game_over" || item.type === "room_closed"),
        ackMs,
      );
      return { sock, result: finishMessage(base, msg, sock.seen, args.playerId) };
    }
    const msg = await sock.waitFor(
      (item) => item.type === "your_turn" || item.type === "game_over" || item.type === "room_closed",
      timeoutMs,
    );
    return { sock, result: finishMessage(base, msg, sock.seen, args.playerId) };
  }

  const earlyOver = sock.buf.find((item) => item.type === "game_over");
  if (earlyOver) {
    sock.buf = sock.buf.filter((item) => item !== earlyOver);
    return { sock, result: finishMessage(base, earlyOver, sock.seen, args.playerId) };
  }
  const mark = sock.highWater();
  sock.send("move", { row: args.move.row, col: args.move.col });

  if (args.poll) {
    const ack = await sock.waitFor((item) => {
      if (item._seq <= mark) return false;
      return item.type === "error" || item.type === "move_applied" || item.type === "game_over" || item.type === "room_closed";
    }, ackMs);
    if (ack.type !== "move_applied") {
      return { sock, result: finishMessage(base, ack, sock.seen, args.playerId) };
    }
    await sock.idle();
    const pendingOver = sock.buf.find((item) => item.type === "game_over");
    if (pendingOver) {
      return { sock, result: finishMessage(base, pendingOver, sock.seen, args.playerId) };
    }
    const observeMark = sock.highWater();
    sock.send("observe", {});
    const msg = await sock.waitFor((item) => {
      if (item._seq <= observeMark) return false;
      return item.type === "observation" || item.type === "error" || item.type === "game_over" || item.type === "room_closed";
    }, ackMs);
    return { sock, result: finishMessage(base, msg, sock.seen, args.playerId) };
  }

  const msg = await sock.waitFor((item) => {
    if (item._seq <= mark) return false;
    if (item.type === "error" || item.type === "game_over" || item.type === "room_closed") return true;
    if (item.type !== "your_turn") return false;
    const applied = ourApplySeq(sock.seen, args.playerId, mark);
    return applied > 0 && item._seq > applied;
  }, timeoutMs);
  return { sock, result: finishMessage(base, msg, sock.seen, args.playerId) };
}

let finished = false;

function emit(result, sock) {
  if (finished) return;
  finished = true;
  if (sock) sock.close();
  const code = result.ok ? 0 : 1;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, () => process.exit(code));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (!args.url) throw new Error("missing --url");
  if (!args.playerId.trim()) throw new Error("missing --player-id");
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) throw new Error("--timeout must be a positive number of seconds");
  const { sock, result } = await run(args);
  emit(result, sock);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  const mode = /(?:^|\/)ws-poll\.mjs$/.test(String(process.argv[1] ?? "")) || process.argv.includes("--poll")
    ? "poll"
    : "wait";
  const result = blank(mode);
  result.error = message;
  result.event = /timeout/i.test(message) ? "timeout" : "error";
  emit(result, null);
});
