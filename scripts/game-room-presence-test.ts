/**
 * GameRoom presence across hibernation.
 * Storage reloads seats as offline; open sockets must be applied after that.
 * Run: npm run test:room-presence
 */
import { readFileSync } from "node:fs";
import { overlayLiveSockets, replacePlayersFromSnapshot } from "../worker/multiplayer/presence";
import type { PlayerRecord, SessionAttachment } from "../worker/multiplayer/types";
import { createChecker } from "./lib/checks";

const c = createChecker();

type Sock = { id: string };

function seat(partial: Pick<PlayerRecord, "playerId" | "name" | "seat" | "role" | "kind"> & { connected?: boolean }): PlayerRecord {
  return {
    ready: false,
    rematch: false,
    connected: partial.connected ?? true,
    ...partial,
  };
}

function attachment(p: PlayerRecord, kind?: PlayerRecord["kind"]): SessionAttachment {
  return {
    playerId: p.playerId,
    seat: p.seat,
    role: p.role,
    name: p.name,
    kind,
  };
}

function wake(saved: readonly PlayerRecord[], sockets: { id: string; attachment: SessionAttachment | null | undefined }[]) {
  const players = new Map<string, PlayerRecord>();
  const sessions = new Map<Sock, SessionAttachment>();
  replacePlayersFromSnapshot(players, saved);
  const newHostId = overlayLiveSockets(
    players,
    sessions,
    sockets.map((s) => ({ socket: { id: s.id }, attachment: s.attachment })),
  );
  return { players, sessions, newHostId };
}

c.section("hibernation wake");
{
  const host = seat({
    playerId: "agent-doubao",
    name: "Agent Doubao",
    seat: "red",
    role: "host",
    kind: "agent",
    connected: true,
  });
  const saved = [{ ...host, connected: false, ready: false }];
  const { players, sessions } = wake(saved, [
    { id: "host-ws", attachment: attachment(host, "agent") },
  ]);
  const restored = players.get("agent-doubao");
  c.check(restored?.connected === true, "open host socket stays online after snapshot reload");
  c.check(restored?.kind === "agent", "agent kind survives wake");
  c.check(restored?.seat === "red" && restored?.role === "host", "host seat and role survive wake");
  c.check(sessions.size === 1, "host socket is in the session map");

  const human = seat({
    playerId: "human-host",
    name: "Player",
    seat: "red",
    role: "host",
    kind: "human",
  });
  const humanWake = wake([{ ...human, connected: false }], [
    { id: "human-ws", attachment: attachment(human, "human") },
  ]);
  c.check(humanWake.players.get("human-host")?.connected === true, "open human host stays online after wake");
  c.check(humanWake.players.get("human-host")?.kind === "human", "human kind stays human");
}

c.section("false offline if overlay is wiped");
{
  const host = seat({
    playerId: "agent-doubao",
    name: "Agent Doubao",
    seat: "red",
    role: "host",
    kind: "agent",
  });
  const players = new Map<string, PlayerRecord>();
  const sessions = new Map<Sock, SessionAttachment>();
  overlayLiveSockets(players, sessions, [
    { socket: { id: "host-ws" }, attachment: attachment(host, "agent") },
  ]);
  c.check(players.get("agent-doubao")?.connected === true, "socket scan alone marks the host online");
  replacePlayersFromSnapshot(players, [...players.values()]);
  c.check(players.get("agent-doubao")?.connected === false, "snapshot reload clears presence");
  c.check(sessions.size === 1, "snapshot reload does not drop the live socket");
}

c.section("guest join roster");
{
  const host = seat({
    playerId: "agent-doubao",
    name: "Agent Doubao",
    seat: "red",
    role: "host",
    kind: "agent",
  });
  const { players } = wake([{ ...host, connected: false }], [
    { id: "host-ws", attachment: attachment(host, "agent") },
  ]);
  const guest = seat({
    playerId: "player-blue",
    name: "Player",
    seat: "blue",
    role: "guest",
    kind: "human",
  });
  players.set(guest.playerId, guest);
  const seated = [...players.values()].filter((p) => p.seat === "red" || p.seat === "blue");
  const online = seated.filter((p) => p.connected);
  c.check(seated.length === 2, "host and guest are both seated");
  c.check(online.length === 2, "guest join still counts the hibernated host as online");
  c.check(
    online.some((p) => p.playerId === "agent-doubao" && p.kind === "agent"),
    "agent host is in the connected roster",
  );
}

c.section("real disconnect and reclaim edges");
{
  const host = seat({
    playerId: "host",
    name: "Player",
    seat: "red",
    role: "host",
    kind: "human",
  });
  const gone = wake([{ ...host, connected: false }], []);
  c.check(gone.players.get("host")?.connected === false, "no socket stays offline");
  c.check(gone.sessions.size === 0, "no socket means no session");

  const kept = wake([{ ...host, connected: false, kind: "agent" }], [
    { id: "blank", attachment: { playerId: "", seat: "spectator", role: "spectator", name: "" } },
    { id: "host-ws", attachment: attachment({ ...host, kind: "agent" }) },
  ]);
  c.check(kept.players.get("host")?.connected === true, "empty attachment does not clear a real socket");
  c.check(kept.players.get("host")?.kind === "agent", "omitted kind on the socket keeps the stored agent kind");

  const late = wake([], [{ id: "host-ws", attachment: attachment(host, "human") }]);
  c.check(late.players.get("host")?.connected === true, "socket with no snapshot row is still online");
  c.check(late.newHostId === "host", "missing snapshot host id is recovered from the socket");

  const already = wake([{ ...host, connected: false }], [
    { id: "host-ws", attachment: attachment(host, "human") },
  ]);
  c.check(already.newHostId === null, "snapshot host is not reported as a new host");
}

c.section("wake order in GameRoom");
{
  const src = readFileSync("worker/multiplayer/base-room.ts", "utf8");
  const ctorStart = src.indexOf("constructor(ctx: DurableObjectState, env: Env)");
  const ctorEnd = src.indexOf("private attachHibernatedSockets(");
  const ctor = src.slice(ctorStart, ctorEnd);
  const restoreAt = ctor.indexOf("await this.restore()");
  const overlayAt = ctor.indexOf("this.attachHibernatedSockets()");
  c.check(ctor.includes("blockConcurrencyWhile"), "wake is inside blockConcurrencyWhile");
  c.check(restoreAt >= 0 && overlayAt > restoreAt, "live sockets overlay after snapshot restore");
  c.check(!ctor.includes("this.ctx.getWebSockets"), "constructor does not scan sockets before restore");
  const method = src.slice(ctorEnd, src.indexOf("private ensureAdapter("));
  c.check(method.includes("getWebSockets"), "hibernated sockets are read in attachHibernatedSockets");
  c.check(method.includes("overlayLiveSockets"), "attachHibernatedSockets uses the shared overlay");
}

c.finish();
