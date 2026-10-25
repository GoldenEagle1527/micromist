#!/usr/bin/env node
/**
 * Two explosive-chess agents on one room WebSocket.
 * They wait on server pushes (no sleep loop). Host sets a 4-step match so it ends.
 *
 *   node scripts/explosive-chess-agent-duel.mjs ws://127.0.0.1:8787
 *   node scripts/explosive-chess-agent-duel.mjs wss://micromist-staging.goldeneaglepersonal.dpdns.org
 */

const base = (process.argv[2] ?? "ws://127.0.0.1:8787").replace(/\/$/, "");

function roomCode() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let code = "";
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return code;
}

function textOf(data) {
  if (typeof data === "string") return data;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) return data.toString("utf8");
  return null;
}

class AgentSocket {
  constructor(ws) {
    this.ws = ws;
    this.buf = [];
    this.waiters = [];
    ws.addEventListener("message", (ev) => {
      const text = textOf(ev.data);
      if (!text || text === "ping" || text === "pong") return;
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== "string") return;
      this.buf.push(msg);
      for (const wake of [...this.waiters]) wake();
    });
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
        this.waiters = this.waiters.filter((wake) => wake !== onMsg);
        const seen = this.buf.map((msg) => msg.type).join(",") || "(empty)";
        reject(new Error(`timeout after ${timeoutMs}ms; still buffered: ${seen}`));
      }, timeoutMs);
      const onMsg = () => {
        const msg = take();
        if (!msg) return;
        clearTimeout(timer);
        this.waiters = this.waiters.filter((wake) => wake !== onMsg);
        resolve(msg);
      };
      this.waiters.push(onMsg);
      onMsg();
    });
  }

  close() {
    try {
      this.ws.close(1000, "duel done");
    } catch {
      /* already closed */
    }
  }
}

function connect(url) {
  if (typeof WebSocket !== "function") {
    throw new Error("This script needs a global WebSocket (Node 22+).");
  }
  const ws = new WebSocket(url);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`connect timeout ${url}`)), 15000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(new AgentSocket(ws));
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`websocket error ${url}`));
    });
  });
}

async function drive(client, playerId, label) {
  let moves = 0;
  let checkedIllegal = false;
  while (moves < 20) {
    const msg = await client.waitFor(
      (m) => m.type === "your_turn" || m.type === "game_over" || m.type === "room_closed",
      20000,
    );
    if (msg.type === "room_closed") throw new Error(`${label} room closed`);
    if (msg.type === "game_over") return msg;
    const obs = msg.payload?.observation;
    const actions = obs?.legalActions;
    if (!Array.isArray(actions) || actions.length === 0) {
      throw new Error(`${label} your_turn without legalActions`);
    }
    const step = obs.publicState?.fullState?.stepCount ?? -1;
    if (step === 0) {
      if (actions.length !== 81) {
        throw new Error(`${label} expected 81 opening moves, got ${actions.length}`);
      }
      const corner = obs.publicState?.board?.[0]?.[0];
      if (!corner || corner.color !== "empty" || corner.capacity !== 2) {
        throw new Error(`${label} opening corner was ${JSON.stringify(corner)}`);
      }
    }
    const action = actions[Math.floor(Math.random() * actions.length)];
    if (label === "red" && !checkedIllegal) {
      checkedIllegal = true;
      client.send("move", { row: -1, col: 0 });
      const err = await client.waitFor(
        (m) => m.type === "error" || m.type === "move_applied" || m.type === "game_over",
        8000,
      );
      if (err.type !== "error") {
        throw new Error(`illegal move was accepted: ${JSON.stringify(err)}`);
      }
    }
    if (step === 0) client.send("move", { row: action.row, col: action.col });
    else if (moves % 2 === 0) {
      client.send("act", { action: { type: "move", row: action.row, col: action.col } });
    } else {
      client.send("act", { type: "move", row: action.row, col: action.col });
    }
    const applied = await client.waitFor(
      (m) =>
        m.type === "error" ||
        (m.type === "move_applied" &&
          m.payload?.by?.playerId === playerId &&
          m.payload?.action?.row === action.row &&
          m.payload?.action?.col === action.col),
      8000,
    );
    if (applied.type === "error") {
      throw new Error(`${label} rejected a listed move: ${applied.payload?.message}`);
    }
    moves += 1;
    console.log(`${label} (${action.row},${action.col}) step ${step} → ${step + 1}`);
  }
  throw new Error(`${label} played ${moves} moves without game_over`);
}

const code = roomCode();
const url = `${base}/ws/explosive-chess:${code}`;
const idA = crypto.randomUUID();
const idB = crypto.randomUUID();
let alpha = null;
let beta = null;

try {
  console.log(`room ${code}`);
  console.log(`connect ${url}`);
  alpha = await connect(url);
  alpha.send("join", {
    playerId: idA,
    name: "Agent A",
    kind: "agent",
    game: "explosive-chess",
  });
  const joinedA = await alpha.waitFor((m) => m.type === "joined", 15000);
  if (joinedA.payload?.you?.role !== "host" || joinedA.payload?.you?.kind !== "agent") {
    throw new Error(`host join was ${JSON.stringify(joinedA.payload?.you)}`);
  }
  if (joinedA.payload?.roomCode !== code) {
    throw new Error(`room code echo ${joinedA.payload?.roomCode}`);
  }

  alpha.send("set_config", {
    boardSize: 9,
    winMode: "steps",
    winParam: 4,
    hostColor: "red",
  });
  const configured = await alpha.waitFor(
    (m) => m.type === "room" && m.payload?.config?.winMode === "steps" && m.payload?.config?.winParam === 4,
    8000,
  );
  if (configured.payload?.phase !== "lobby") {
    throw new Error(`expected lobby after config, got ${configured.payload?.phase}`);
  }

  beta = await connect(url);
  beta.send("join", {
    playerId: idB,
    name: "Agent B",
    kind: "agent",
    game: "explosive-chess",
  });

  const [opp, joinedB] = await Promise.all([
    alpha.waitFor((m) => m.type === "opponent_joined" && m.payload?.playerId === idB, 15000),
    beta.waitFor((m) => m.type === "joined", 15000),
  ]);
  if (opp.payload?.kind !== "agent" || opp.payload?.seat !== "blue") {
    throw new Error(`opponent_joined ${JSON.stringify(opp.payload)}`);
  }
  if (joinedB.payload?.you?.role !== "guest" || joinedB.payload?.you?.color !== "blue") {
    throw new Error(`guest join ${JSON.stringify(joinedB.payload?.you)}`);
  }

  await Promise.all([
    alpha.waitFor((m) => m.type === "start" && m.payload?.yourColor === "red" && m.payload?.firstColor === "red", 8000),
    beta.waitFor((m) => m.type === "start" && m.payload?.yourColor === "blue", 8000),
  ]);

  const [overRed, overBlue] = await Promise.all([
    drive(alpha, idA, "red"),
    drive(beta, idB, "blue"),
  ]);
  const colors = new Set([overRed.payload?.winnerColor, overBlue.payload?.winnerColor]);
  if (colors.size !== 1 || !["red", "blue", "draw"].includes(overRed.payload?.winnerColor)) {
    throw new Error(`game_over mismatch ${JSON.stringify(overRed.payload)} / ${JSON.stringify(overBlue.payload)}`);
  }
  for (const [client, label] of [
    [alpha, "A"],
    [beta, "B"],
  ]) {
    const types = new Set(client.buf.map((m) => m.type));
    for (const required of ["welcome", "room", "game_start", "state"]) {
      if (!types.has(required)) {
        throw new Error(`${label} missing human frame ${required} (saw ${[...types].join(",")})`);
      }
    }
  }
  const finalState = alpha.buf.find((m) => m.type === "state" && m.payload?.fullState?.gameOver);
  if (!finalState || finalState.payload.fullState.counts?.length !== 81) {
    throw new Error("human state frame did not carry the finished board");
  }
  console.log(`game_over ${overRed.payload.winnerColor} (${overRed.payload.winReason})`);
} finally {
  alpha?.close();
  beta?.close();
}
