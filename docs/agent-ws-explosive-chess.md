# 爆炸棋 Agent WebSocket

Agents play explosive-chess on the same room socket humans use. The server pushes turn and board changes. Do not poll and do not sleep-wait for the opponent. There is no MCP endpoint.

Public Agent Guide (this document): `GET /agent-guide/explosive-chess` on the game host. Fetch that URL. You do not need the micromist repository. The Worker serves this file and prepends the live host (`origin`, `agent guide`, `websocket`). Use that host. `Accept: text/html` returns an HTML page; otherwise the body is `text/markdown` (curl, most agents). The same bytes are at `/agent-guide/explosive-chess.md`.

On `/play/explosive-chess` (the 爆炸棋 setup page, after you open the game) there is one line —「把下面内容复制，让你的 AI 一起玩」— and one prompt. That prompt tells you to fetch this guide, then ask the human in chat before you connect: play against them? should you create a room? or do they already have a room code? The guide URL in the prompt is absolute for the page origin. If a pasted prompt also contains `wss://…/ws/explosive-chess:<code>`, use that exact URL.

Examples below use staging `wss://micromist-staging.goldeneaglepersonal.dpdns.org` and local `ws://127.0.0.1:8787`. If this page was served from another host, use the host in the fetched guide or in the human's prompt.

## Endpoint

```
GET /ws/explosive-chess:<code>
Upgrade: websocket
```

`<code>` is the room id the host chooses (`[a-z0-9]`, any length; the duel script uses 6). The server lowercases it. Bare `/ws/<code>` is the same room (legacy links default to explosive-chess). Creating a room is connecting and joining: the first seated player is the host. The Durable Object is created on that first connection. No extra database.

Text frames only. Envelope, both directions:

```json
{ "type": "join", "payload": { "playerId": "agent-a", "name": "Agent A" } }
```

Ignore text frames `ping` and `pong` if you see them. They are not game events.

A route check without an upgrade returns 426:

```bash
curl -s -D - -o /dev/null \
  "https://micromist-staging.goldeneaglepersonal.dpdns.org/ws/explosive-chess:demo01"
```

## Connect

Host (Agent A), with [websocat](https://github.com/websocat/websocat):

```bash
websocat "wss://micromist-staging.goldeneaglepersonal.dpdns.org/ws/explosive-chess:demo01"
```

```json
{"type":"join","payload":{"playerId":"agent-a","name":"Agent A","kind":"agent","game":"explosive-chess"}}
```

Server push (among the human messages `welcome` and `room`, which you may ignore):

```json
{
  "type": "joined",
  "payload": {
    "game": "explosive-chess",
    "roomCode": "demo01",
    "roomId": "explosive-chess:demo01",
    "phase": "lobby",
    "reclaimed": false,
    "you": {
      "playerId": "agent-a",
      "name": "Agent A",
      "seat": "red",
      "role": "host",
      "kind": "agent",
      "color": "red"
    }
  }
}
```

Give `roomCode` to Agent B. B connects to the same path and sends `join` with a different `playerId`.

Optional, host only, once, **before** B joins. Wait for a `room` push whose `config` matches. The second seated player starts the match immediately, and config locks.

```json
{"type":"set_config","payload":{"boardSize":9,"winMode":"steps","winParam":4,"hostColor":"red"}}
```

`boardSize` is 9, 11, or 13. `winMode` is `annihilation`, `steps`, or `area`. Defaults if you skip this: 9×9 annihilation, host red. Annihilation games are long; `steps` with a small `winParam` finishes after that many placements.

`kind` is `agent` or `human`. Omit it and the seat stays human (a browser reconnect omits it and does not clear `agent`). Kind does not change rules. The human lobby labels an agent seat.

## Play until someone wins

When B sits, A receives:

```json
{
  "type": "opponent_joined",
  "payload": {
    "playerId": "agent-b",
    "name": "Agent B",
    "seat": "blue",
    "role": "guest",
    "kind": "agent",
    "reclaimed": false
  }
}
```

Both then receive `start`. There is no ready handshake. A client `ready` message is rejected (`Ready is disabled; game starts with 2 players`). `start` is the ready/start push: both seats are connected and the match is live.

```json
{
  "type": "start",
  "payload": {
    "phase": "playing",
    "config": { "boardSize": 9, "winMode": "steps", "winParam": 4, "hostColor": "red" },
    "yourColor": "red",
    "firstColor": "red"
  }
}
```

Red always moves first, even when `hostColor` is `blue`. Wait for `your_turn`. It is pushed only to the seat that may move. Arrays in the example are shortened; a 9×9 `fullState` has 81 numbers and `board` has 9 rows of 9 cells. `legalActions` on an empty board lists every cell.

```json
{
  "type": "your_turn",
  "payload": {
    "observation": {
      "game": "explosive-chess",
      "phase": "playing",
      "you": { "playerId": "agent-a", "name": "Agent A", "seat": "red", "role": "host", "kind": "agent", "color": "red" },
      "publicState": {
        "config": { "boardSize": 9, "winMode": "steps", "winParam": 4, "hostColor": "red" },
        "turn": "red",
        "fullState": {
          "counts": [0],
          "colors": [0],
          "currentTurn": 1,
          "stepCount": 0,
          "gameOver": false,
          "winner": null,
          "winReason": ""
        },
        "board": [
          [{ "row": 0, "col": 0, "count": 0, "color": "empty", "capacity": 2 }]
        ]
      },
      "legalActions": [{ "type": "move", "row": 0, "col": 0 }]
    }
  }
}
```

`fullState` is the object human clients already apply. `counts` and `colors` are row-major: index `row * boardSize + col`. Numbers: `0` empty, `1` red, `2` blue. `currentTurn` is `1` or `2`. `board` is that same grid with color names and the explosion `capacity` of each cell (corner 2, edge 3, center 4). `legalActions` are the placements `isValidMove` accepts for **your** color right now. Pick one. Do not invent coordinates.

Act with either the human verb or `act` (same rules):

```json
{"type":"move","payload":{"row":0,"col":0}}
```

```json
{"type":"act","payload":{"type":"move","row":0,"col":0}}
```

`row` and `col` are integers. Both players then receive `move_applied` (the board after the placement) and the human `state` frame (includes animation frames; agents can ignore it):

```json
{
  "type": "move_applied",
  "payload": {
    "action": { "type": "move", "row": 0, "col": 0 },
    "by": { "playerId": "agent-a", "seat": "red", "color": "red", "kind": "agent", "role": "host", "name": "Agent A" },
    "publicState": { "turn": "blue", "fullState": {}, "board": [], "config": {} },
    "gameOver": false
  }
}
```

The other seat then receives `your_turn` with a new observation. The seat that just moved does **not** get another `your_turn` until the opponent has played. Block on the socket.

An illegal move returns `error` to that socket only. The turn does not advance and `your_turn` is not repeated. Play a different entry from the `legalActions` you already have.

```json
{"type":"error","payload":{"message":"Invalid move"}}
```

Other `error` messages include `Not your turn`, `Game not in progress`, `Spectators cannot move`, `Unknown action`, `Join first`, `Only host can set config`.

When the match ends, both receive `move_applied` with `gameOver: true` and:

```json
{
  "type": "game_over",
  "payload": { "winner": 1, "winnerColor": "red", "winReason": "4 步后占据更多面积 (2 vs 1)" }
}
```

`winner` is the human field (`1` red, `2` blue, or `"draw"`). Prefer `winnerColor`: `red`, `blue`, or `draw`.

Surrender (not listed in `legalActions`) from a seated player during play:

```json
{"type":"surrender","payload":{}}
```

```json
{"type":"act","payload":{"type":"surrender"}}
```

The opponent wins. After `game_over`, both seats may send `{"type":"rematch","payload":{}}`. When both have, the server pushes `start` and `your_turn` again.

A one-shot `{"type":"observe","payload":{}}` returns `{"type":"observation","payload":{"observation":{...}}}`. Use it only if you reconnected and missed a push. Do not loop on it. Rejoining with the **same** `playerId` reclaims the seat and the server pushes `joined` (`reclaimed: true`), `observation`, and `your_turn` when it is your turn. A new id, once both seats are taken, is a spectator: `joined` with `seat: "spectator"`, no `your_turn`.

`peer_left` means the opponent's socket dropped. The seat stays reserved. Keep the connection; they can reclaim. You may `surrender`. `room_closed` means the room was recycled because no seated player was still connected.

## After the setup-page prompt

The human pastes one prompt from the explosive-chess setup page at `/play/explosive-chess`. Fetch this guide, then ask in chat and wait. Do not connect before they answer. There is no MCP.

1. Play against the human?
2. Should you create the room?
3. Or do they already have a room code?

### They already have a room code

Connect to the websocket shape in the host block at the top, with their code: `<ws-origin>/ws/explosive-chess:<code>`. `join` with `kind:"agent"`, a fresh `playerId`, and `"game":"explosive-chess"`. If `joined` says `you.role` is `"host"`, send `set_config` once before the other player sits. If you are `guest`, do not send `set_config`. One open seat is the duel. A third connection is a spectator (`seat: "spectator"`, no `your_turn`). The human opens `<http-origin>/play/explosive-chess?room=<code>` and joins.

### You create the room

Pick a room code of `[a-z0-9]` (6 characters is enough). Connect and `join` first so you are host. Send `set_config` once before anyone else sits. Defaults if you skip it: 9×9 annihilation, host red. Prefer `"winMode":"steps"` with a small `winParam` for a short match. Tell the human the room code and `<http-origin>/play/explosive-chess?room=<code>`. They open that link and tap join. You play the other seat.

### Two agents, no human seat

If they want two AIs to play each other, you are Agent A: create the room as above and send `set_config` before B sits. Give them the same room code for the second AI. Agent B joins that code with a different `playerId` and does not send `set_config`. If B's socket drops before `joined`, reconnect a few times — A creates the room by connecting. After `joined`, wait for pushes. Do not poll.

The human can also share `?room=<code>` with another person. Clicks from the human are the same `move` messages. In-game status shows `vs Agent` when the other seat's kind is `agent`.

## Dual-agent script

From a checkout, against a running worker (local `npm run dev` or staging after deploy):

```bash
node scripts/explosive-chess-agent-duel.mjs ws://127.0.0.1:8787
node scripts/explosive-chess-agent-duel.mjs wss://micromist-staging.goldeneaglepersonal.dpdns.org
```

Agent A creates the room, sets a 4-step match, Agent B joins, each plays only from pushed `legalActions` (one rejected illegal move, then `move` and `act`), and both exit when `game_over` is pushed. Needs Node 22+ for the global `WebSocket`.
