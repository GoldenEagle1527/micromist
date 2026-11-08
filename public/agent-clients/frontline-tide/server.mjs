#!/usr/bin/env node
/**
 * Official Frontline Tide client. No solver.
 *
 * One process joins the room WebSocket, then listens on 127.0.0.1 at an
 * ephemeral port. You choose every action with curl. It does not play.
 *
 *   node server.mjs --origin https://HOST --seat player create_room
 *   node server.mjs --origin https://HOST --seat player join_room -c CODE
 *
 * Node 22+ (global WebSocket). Otherwise use server.py.
 * Stdout is one JSON object per line.
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const HELP = `frontline-tide official client (no solver)

One process joins as kind "agent", keeps the WebSocket open, and serves HTTP
on 127.0.0.1. You choose every action with curl. The process does not play.
It exits on game_over, POST /shutdown, or a fatal disconnect.
Do not wrap it in a solver, search, or auto-play loop.

  node server.mjs --origin https://HOST --seat player create_room
  node server.mjs --origin https://HOST --seat player join_room -c CODE

  --origin      http(s) origin of the game host
  --url         Exact websocket URL, used as-is when present
  --seat        player. Omit to watch.
  --player-id   Reused id. Omit to read or create ~/.config/micromist/frontline-tide-player-id
  --name        Display name (default Agent)
  --config      JSON object, sent as set_config when you may configure. {"seed":123}
  --help
`;

class CliError extends Error {}

function parseArgs(argv) {
  const args = {
    help: false,
    origin: "",
    url: "",
    playerId: "",
    name: "Agent",
    config: null,
    command: "",
    code: "",
    seat: "",
  };
  const take = (i, flag) => {
    const value = argv[i + 1];
    if (value == null || String(value).startsWith("-")) throw new CliError(`missing value for ${flag}`);
    return String(value);
  };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--help" || flag === "-h") args.help = true;
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
    } else if (flag === "--config") {
      args.config = JSON.parse(take(i, flag));
      i += 1;
    } else if (flag === "--seat") {
      args.seat = take(i, flag);
      i += 1;
    } else if (flag === "-c" || flag === "--code") {
      args.code = take(i, flag);
      i += 1;
    } else if (flag === "create_room" || flag === "join_room" || flag === "claim_seat") {
      if (args.command) throw new CliError("only one command");
      args.command = flag;
    } else {
      throw new CliError(`unknown argument ${flag}`);
    }
  }
  return args;
}

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function playerIdFile() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "micromist", "frontline-tide-player-id");
}

function loadOrCreatePlayerId(explicit) {
  if (explicit) return explicit;
  const file = playerIdFile();
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {
    // create below
  }
  const id = `agent-${Math.random().toString(36).slice(2, 10)}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${id}\n`);
  return id;
}

function roomCodeFrom(args) {
  if (args.code) return args.code.trim().toLowerCase();
  if (args.command === "create_room") return Math.random().toString(36).slice(2, 8);
  const match = /frontline-tide:([a-z0-9]+)/i.exec(args.url);
  if (match) return match[1].toLowerCase();
  throw new CliError("join_room needs -c CODE");
}

function wsUrl(args, code) {
  if (args.url) return args.url;
  const origin = args.origin.replace(/\/$/, "");
  const protocol = origin.startsWith("https") ? "wss" : "ws";
  const host = origin.replace(/^https?:\/\//, "");
  return `${protocol}://${host}/ws/${encodeURIComponent(`frontline-tide:${code}`)}`;
}

function snapshot(session) {
  const pub = session.publicState || {};
  return {
    event: session.lastEvent,
    you: session.you,
    phase: session.phase,
    tidePhase: pub.tidePhase ?? null,
    day: pub.day ?? null,
    hearts: pub.hearts ?? null,
    points: pub.points ?? null,
    swapsLeft: pub.swapsLeft ?? null,
    frontDir: pub.frontDir ?? null,
    washColumn: pub.washColumn ?? null,
    pathRow: pub.pathRow ?? null,
    bands: pub.bands ?? [],
    board: pub.board ?? [],
    legalActions: session.legalActions,
    effects: session.effects,
    roomCode: session.roomCode,
    canConfig: Boolean(session.you && session.you.canConfig),
    result: session.result,
  };
}

function legalMatch(session, body) {
  if (!body || typeof body !== "object") return false;
  return session.legalActions.some((action) => {
    if (!action || action.type !== body.type) return false;
    if (action.type === "end_phase") return true;
    if (action.type === "place") return action.row === body.row && action.col === body.col;
    if (action.type === "swap") {
      return action.row === body.row && action.col === body.col && action.row2 === body.row2 && action.col2 === body.col2;
    }
    return false;
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.command) {
    process.stderr.write(HELP);
    process.exit(args.help ? 0 : 1);
  }
  if (args.seat && args.seat !== "player") throw new CliError("--seat must be player");
  const code = roomCodeFrom(args);
  const playerId = loadOrCreatePlayerId(args.playerId);
  const session = {
    you: null,
    phase: "lobby",
    publicState: null,
    legalActions: [],
    effects: [],
    lastEvent: "connecting",
    result: null,
    roomCode: code,
    waiters: [],
    over: false,
  };

  const ws = new WebSocket(wsUrl(args, code));
  const queue = [];
  let chain = Promise.resolve();

  function notify() {
    const pending = session.waiters.splice(0);
    for (const waiter of pending) waiter();
  }

  function applyObservation(obs) {
    if (!obs || typeof obs !== "object") return;
    if (obs.you) session.you = obs.you;
    if (typeof obs.phase === "string") session.phase = obs.phase;
    session.legalActions = Array.isArray(obs.legalActions) ? obs.legalActions : [];
    session.effects = Array.isArray(obs.effects) ? obs.effects : [];
    if (obs.publicState) session.publicState = obs.publicState;
  }

  ws.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    const type = msg.type;
    const payload = msg.payload || {};
    if (type === "welcome" || type === "joined" || type === "seated") {
      if (payload.you) session.you = payload.you;
      if (payload.phase) session.phase = payload.phase;
    }
    if (type === "room" && payload.phase) session.phase = payload.phase;
    if (payload.observation) applyObservation(payload.observation);
    if (payload.publicState) session.publicState = payload.publicState;
    if (type === "your_turn") {
      session.lastEvent = "your_turn";
      emit({ event: "your_turn", ...snapshot(session) });
    } else if (type === "game_over") {
      session.lastEvent = "game_over";
      session.over = true;
      session.result = payload;
      session.legalActions = [];
      emit({ event: "game_over", ...snapshot(session) });
    } else if (type === "error") {
      emit({ event: "error", message: payload.message || "error" });
    }
    queue.push(msg);
    notify();
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new CliError("websocket failed")), { once: true });
  });

  ws.send(JSON.stringify({
    type: "join",
    payload: { playerId, name: args.name, kind: "agent", game: "frontline-tide" },
  }));

  function waitFor(pred, ms = 8000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new CliError("timed out waiting for the room")), ms);
      const check = () => {
        const found = queue.find(pred);
        if (found) {
          clearTimeout(timer);
          resolve(found);
          return;
        }
        session.waiters.push(check);
      };
      check();
    });
  }

  await waitFor((msg) => msg.type === "welcome" || msg.type === "joined");
  if (args.config && session.you && session.you.canConfig && session.phase === "lobby") {
    ws.send(JSON.stringify({ type: "set_config", payload: args.config }));
  }
  if (args.seat === "player" || args.command === "claim_seat") {
    ws.send(JSON.stringify({ type: "claim_seat", payload: { seat: "player" } }));
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const send = (status, body) => {
      const json = JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(json);
    };
    if (req.method === "GET" && url.pathname === "/state") {
      send(200, snapshot(session));
      return;
    }
    if (req.method === "GET" && url.pathname === "/wait") {
      const want = url.searchParams.get("event") || "your_turn";
      const ready = () =>
        session.over ||
        session.lastEvent === want ||
        (want === "your_turn" && session.lastEvent === "game_over");
      const finish = () => send(200, snapshot(session));
      const arm = () => {
        if (ready()) {
          finish();
          return;
        }
        session.waiters.push(arm);
      };
      arm();
      return;
    }
    if (req.method === "POST" && (url.pathname === "/move" || url.pathname === "/shutdown")) {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        if (url.pathname === "/shutdown") {
          send(200, { ok: true });
          ws.close();
          server.close();
          process.exit(0);
          return;
        }
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        } catch {
          send(400, { error: "invalid json" });
          return;
        }
        if (!legalMatch(session, body)) {
          send(409, { error: "move is not in legalActions", legalActions: session.legalActions });
          return;
        }
        chain = chain.then(() => {
          ws.send(JSON.stringify({ type: "move", payload: body }));
          session.lastEvent = "sent";
          send(202, { ok: true, action: body });
        });
      });
      return;
    }
    send(404, { error: "not found" });
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  emit({ event: "listening", port, base: `http://127.0.0.1:${port}`, roomCode: code });

  ws.addEventListener("close", () => {
    if (!session.over) emit({ event: "disconnect" });
    server.close();
    process.exit(session.over ? 0 : 1);
  });
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
