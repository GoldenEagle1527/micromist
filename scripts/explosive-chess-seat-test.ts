/**
 * Explicit seating: join does not take red/blue; claim_seat does.
 * Run: npm run test:explosive-seat
 */
import { readFileSync } from "node:fs";
import type { PlayerRecord } from "../worker/multiplayer/types";
import { decideClaim } from "../worker/multiplayer/seating";
import { createChecker } from "./lib/checks";

const c = createChecker();

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

c.section("claim_seat");
{
  const watcher = person({ playerId: "host", seat: "spectator", role: "spectator" });
  const red = decideClaim({
    phase: "lobby",
    hostId: "host",
    player: watcher,
    seat: "red",
    players: [watcher],
  });
  c.check(red.ok === true && red.changed === true && red.role === "host" && red.seat === "red", "room creator claims red as host");

  const guest = person({ playerId: "guest", seat: "spectator", role: "spectator" });
  const seatedHost = person({ playerId: "host", seat: "red", role: "host" });
  const blue = decideClaim({
    phase: "lobby",
    hostId: "host",
    player: guest,
    seat: "blue",
    players: [seatedHost, guest],
  });
  c.check(blue.ok === true && blue.changed === true && blue.role === "guest", "second person claims the empty seat as guest");

  const taken = decideClaim({
    phase: "lobby",
    hostId: "host",
    player: guest,
    seat: "red",
    players: [seatedHost, guest],
  });
  c.check(taken.ok === false && taken.message === "Seat taken", "a reserved seat cannot be claimed, even to replace someone");

  const offline = person({ playerId: "away", seat: "blue", role: "guest" });
  offline.connected = false;
  const blocked = decideClaim({
    phase: "lobby",
    hostId: "host",
    player: guest,
    seat: "blue",
    players: [seatedHost, offline, guest],
  });
  c.check(blocked.ok === false && blocked.message === "Seat taken", "an offline seat stays reserved for that playerId");

  const again = decideClaim({
    phase: "playing",
    hostId: "host",
    player: seatedHost,
    seat: "red",
    players: [seatedHost],
  });
  c.check(again.ok === true && again.changed === false && again.role === "host", "claiming the seat you already hold is a no-op");

  const late = decideClaim({
    phase: "playing",
    hostId: "host",
    player: guest,
    seat: "blue",
    players: [seatedHost, guest],
  });
  c.check(late.ok === false && late.message === "Cannot change seats after the match starts", "a new id cannot sit after the match starts");

  const swapped = decideClaim({
    phase: "lobby",
    hostId: "host",
    player: seatedHost,
    seat: "blue",
    players: [seatedHost],
  });
  c.check(swapped.ok === true && swapped.changed === true && swapped.seat === "blue" && swapped.role === "host", "lobby allows moving to the empty color");
}

c.section("room shell");
{
  const src = readFileSync("worker/multiplayer/base-room.ts", "utf8");
  c.check(src.includes("explicitSeating"), "join can stay a spectator");
  c.check(src.includes('msg.type === "claim_seat" || msg.type === "sit"'), "claim_seat and sit are the seat messages");
  const join = src.slice(src.indexOf("private handleJoin"), src.indexOf("private canConfigure"));
  c.check(join.includes("if (existing)"), "the same playerId is reclaimed before a new seat is chosen");
  c.check(!join.includes("isSeatedSeat(existing.seat)"), "reconnect reclaims spectator as well as red and blue");
  c.check(join.includes('seat: "spectator"'), "a new id joins as spectator when the game asks for explicit seating");
  const adapter = readFileSync("worker/games/explosive-chess/adapter.ts", "utf8");
  c.check(adapter.includes("explicitSeating: true"), "explosive-chess opts into explicit seating");
  c.check(adapter.includes('p.seat === "red"') && adapter.includes('p.seat === "blue"'), "the match waits for both colors");
  c.check(src.includes("canConfig: this.hostId === player.playerId"), "seated canConfig follows hostId, not the color");
  c.check(src.includes("canConfig: this.hostId === playerId"), "welcome canConfig follows hostId");
  c.check(adapter.includes("canConfig: host.hostId === player.playerId"), "observation canConfig follows hostId");
  c.check(adapter.includes("reusedRoom"), "joined reports when create_room attached to an existing room");
}

c.finish();
