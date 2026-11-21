# explosive-chess Agent WebSocket

Agents play explosive-chess on the same room socket humans use. The server pushes turn and board changes. There is no MCP endpoint.

You choose every move yourself. Start the official client once. Read the stdout line `{"event":"listening","port":N,"base":"http://127.0.0.1:N"}`. Curl `GET /wait?event=your_turn`, pick one `legalActions` entry, and curl `POST /move` with `{"row":ROW,"col":COL}`. Do not invent coordinates.

Do not write a solver, a search tree, minimax, MCTS, an auto-play loop, or any script that chooses moves for you. The official clients are transport only: they connect, serve a local HTTP API, send the move you curl, and wait for the server push. They have no chess strength. Do not modify them into an engine, and do not write your own WebSocket client.

One process joins and keeps the socket open until the server pushes `game_over` (or you `POST /shutdown`). Do not sleep-loop and do not poll the game host. `GET /wait` is the supported wait. Do not exit after one `your_turn`. Do not poll.

Public Agent Guide (this document): `GET /agent-guide/explosive-chess/en` on the game host. Fetch that URL. You do not need the micromist repository. The Worker serves this file and prepends the live host (`origin`, `agent guide`, client download URLs, `websocket`). Use that host. `Accept: text/html` returns an HTML page; otherwise the body is `text/markdown` (curl, most agents). The same bytes are at `/agent-guide/explosive-chess/en.md`. `/agent-guide/explosive-chess/zh` is the Chinese guide. An unlocalized `/agent-guide/explosive-chess` follows `?lang=` and then `Accept-Language`, and otherwise serves this English page.

On `/play/explosive-chess` (the explosive-chess setup page, after you open the game) the bottom of match setup is one line — "Click me to send this to your AI and play together." That whole line is the copy control. The prompt is not shown on the page. The copied prompt tells you to fetch this guide in the current UI language, then ask the human in chat before you connect: play against them? should you create a room? or do they already have a room code? The guide URL in the prompt is absolute for the page origin. If a pasted prompt also contains a websocket URL, use that exact URL.

Examples below use staging `wss://micromist-staging.goldeneaglepersonal.dpdns.org` and local `ws://127.0.0.1:8787`. If this page was served from another host, use the host in the fetched guide or in the human's prompt. `ORIGIN` below means the `http`/`https` origin from the host block. `WS_ORIGIN` means the matching `ws`/`wss` origin.

## Endpoint

```
GET /ws/explosive-chess:<code>
Upgrade: websocket
```

`<code>` is the room id the host chooses (`[a-z0-9]`, any length; 6 characters is enough). The server lowercases it. Bare `/ws/<code>` is the same room (legacy links default to explosive-chess). Creating a room is connecting and joining. Join does not take a seat: the default role is spectator, and a spectator can watch. To play, send `claim_seat` (or `sit`) for `red` or `blue`. The match starts only when both seats are filled and connected. The first connection is the config host (`you.canConfig`), even while that person is still a spectator. The Durable Object is created on that first connection. No extra database. The curl command below is only the HTTP route check. The official client performs the upgrade, the `join`, the seat claim, and later moves. Do not open a second socket.

A seat is online only while its WebSocket is open. Keep that socket open from `join` until the server pushes `game_over` (and through a rematch if you play one). The official client does this for you: one process, leave it running until the JSON line `event` is `game_over` or you `POST /shutdown`. Do not close it after `join`, after `set_config`, after `claim_seat`, or after you send the room code. Do not exit after one `your_turn`. Closing it, or exiting the process, marks that seat offline (`connected: false` on the `room` push, offline in the lobby) and the match does not start. The server may hibernate the room while your socket stays open; that is not a disconnect, and you do not reconnect for it. Reclaim with the same `playerId` only if the process actually exited before `game_over`; run it again with the same `playerId`. The same id comes back as red, blue, or spectator. A new id is a new person.

Text frames only. Envelope, both directions:

```json
{ "type": "join", "payload": { "playerId": "agent-a", "name": "Agent A" } }
```

Ignore text frames `ping` and `pong` if you see them. They are not game events.

A route check without an upgrade returns 426. This is the HTTP check; it does not create a playable session:

```bash
curl -s -D - -o /dev/null \
  "https://micromist-staging.goldeneaglepersonal.dpdns.org/ws/explosive-chess:demo01"
```

## Official clients

Download one client from the same host. Do not rewrite it. The process is the whole match: it joins the WebSocket, then serves HTTP on `127.0.0.1` at an ephemeral port. You drive it with curl. The one-shot `ws-wait` / `ws-poll` clients that exited after a single `your_turn` are retired.

- `/agent-clients/explosive-chess/server.mjs`
- `/agent-clients/explosive-chess/server.py`

The host block at the top of a fetched guide has the absolute URLs.

```bash
curl -fsSL -o server.mjs "$ORIGIN/agent-clients/explosive-chess/server.mjs"
curl -fsSL -o server.py "$ORIGIN/agent-clients/explosive-chess/server.py"
```

Node needs a global `WebSocket`. Needs Node 22+. Python is the standard library only and aims at common Python 3.8+ venvs, with no third-party packages. If Node is older than 22, use Python.

`create_room` opens a room and joins as a spectator. Omit `-c` and the client generates a room code. Pass `-c CODE` to choose one. `join_room` requires `-c CODE` unless `--url` already contains the code. `claim_seat` is `join_room` plus a required `--seat`. `--seat red` or `--seat blue` sends `claim_seat` after `join`. Omit `--seat` to watch. After the socket joins, the process binds `127.0.0.1` and stays in the foreground. The first stdout line after listen is `{"event":"listening","port":N,"base":"http://127.0.0.1:N"}`. It exits when `event` is `game_over`, when you `POST /shutdown`, or on a fatal disconnect. Do not run it again for each move.

`playerId` is stored on the client, not issued by the server. The server maps that id to a seat inside the room. Omit `--player-id` and the client reuses the id in `~/.config/micromist/explosive-chess-player-id` (or `$XDG_CONFIG_HOME/micromist/explosive-chess-player-id` when that variable is set). The same id reclaims red, blue, or spectator. Passing `--player-id` uses that id for this process only and does not replace the stored file. A second agent on the same machine passes its own `--player-id`. A new id is a new person: they join as a spectator and may claim an empty seat.

```bash
node server.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name Agent --seat red create_room
node server.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name Agent --seat red create_room -c CODE
node server.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name Agent --seat blue join_room -c CODE
python3 server.py --origin "$ORIGIN" --player-id PLAYER_ID --name Agent --seat blue join_room -c CODE
node server.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name Agent --seat red claim_seat -c CODE
```

If a prompt already contains an exact websocket URL, pass it with `--url` and do not rebuild it:

```bash
node server.mjs --url "$WS_ORIGIN/ws/explosive-chess:CODE" --player-id PLAYER_ID --name Agent --seat blue join_room
```

If `you.canConfig` is true (you connected first) and the room is still a lobby, pass `--config` on that same command, before the second seat is claimed:

```bash
node server.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name "Agent A" \
  --config '{"boardSize":9,"winMode":"steps","winParam":4,"hostColor":"red"}' \
  --seat red create_room -c CODE
```

Check `you.canConfig` on the `joined` line before you rely on `--config`. `you.role` `"host"` means this `playerId` is the config host (the first connection in the room), not the red seat. A blue seat is the config host only when that same id connected first. `claim_seat` does not grant `canConfig` and does not move the config host. `canConfig: false` is a guest and cannot change rules. `create_room -c` on a code that already exists joins that room: `joined` then has `reusedRoom: true`, and `canConfig` is often false. If you passed `--config` and it cannot be applied (`canConfig` is false, the room is not a lobby, or `set_config` is rejected), the client writes `{"event":"error","ok":false,"error":"..."}` to stdout and exits non-zero before play. Do not keep playing on the default rules. `POST /config` has the same hard-fail: the JSON error is the response, and the process exits non-zero.

Stdout is one JSON object per line (logs go to stderr). Relevant lines:

- `event` `joined` — the room is open. `roomCode` is the code to share. `playUrl` is the human link. `canConfig` and `reusedRoom` are on this line.
- `event` `listening` — the local HTTP server is up. `port` and `base` are how you curl it. This is the first line after listen.
- `event` `your_turn` — it is your turn. `legalActions` is copied through. `board` is the grid after the latest placement. `effects` lists explosions from that placement. The client does not select one.
- `event` `opponent` — the opponent update. `lastOpponentMove` is the cell they placed on. `board` and `effects` are the position after that placement.
- `event` `game_over` — the match is over. `result` has `winner`, `winnerColor`, and `winReason`. The process then exits 0.
- `event` `error` — a rejected move, or a fatal failure. A rejected move does not exit. Curl a different cell from `legalActions`. `error` `websocket closed` with `recoverable: true` means the socket dropped and the seat is still reserved. Run the same command again with the same `--player-id` and the same `--seat`. The next `joined` line has `reclaimed: true` when that seat is still yours.

Each line also includes `you`, `lastOpponentMove`, `legalActions`, `turn`, `board`, and `effects` when they are known. `board` is the grid after the latest applied placement. Each cell has `row`, `col`, `count` (orbs on that cell), `color` (`empty`, `red`, or `blue`), and `capacity` (corner 2, edge 3, center 4). Read `board` for the position. Do not reconstruct the position from `legalActions` alone. `lastOpponentMove` is only the cell the opponent placed on. The same coordinates on the next opponent line are another placement on that cell, not a stuck value. `effects` lists the explosions caused by the placement that produced this position. Each entry has `exploded` (`row`, `col`) and `spread` (the orthogonal neighbors that received one orb). An empty `effects` array means that placement did not explode. A cell may show `count` 0 with `color` `red` or `blue`: the explosion removed the orbs and the cell still belongs to that color, so the other color's `legalActions` still omit it. That cell is not a stack that failed to explode.

Set `BASE` from the `listening` line (`http://127.0.0.1:PORT`). Then:

```bash
curl -sS "$BASE/wait?event=your_turn"
curl -sS -X POST "$BASE/move" -H "content-type: application/json" --data '{"row":ROW,"col":COL}'
```

`GET /state` returns the current you, turn, board, effects, legalActions, phase, last event, roomCode, canConfig, and result when the match is over. `GET /wait?event=your_turn` blocks until `your_turn` or `game_over`. Add `?timeout=SECONDS` to bound that wait; the response is still the state JSON. `POST /move` sends the cell only when it is in `legalActions`. Anything else is a JSON error and is not sent. `POST /seat` with `{"seat":"red"}` or `{"seat":"blue"}` claims a seat if you did not pass `--seat` at startup. `POST /shutdown` exits 0.

The client sends `{"type":"move","payload":{"row":ROW,"col":COL}}` and keeps the socket open until the next push. Leave that process running. Do not poll. A rejected move does not advance the turn and does not repeat `your_turn`. The error still includes the `legalActions` you already had. Pick a different entry.

`--timeout` is seconds for one blocking wait on the game socket. Omit it and the process waits until `game_over`, `POST /shutdown`, or the socket dies. The `/wait` query `timeout` is separate and only bounds that HTTP call.

## Connect

Protocol trace for the frames the official client sends. Do not open your own socket beside it. A manual trace with [websocat](https://github.com/websocat/websocat):

```bash
websocat "wss://micromist-staging.goldeneaglepersonal.dpdns.org/ws/explosive-chess:demo01"
```

```json
{"type":"join","payload":{"playerId":"agent-a","name":"Agent A","kind":"agent","game":"explosive-chess"}}
```

Server push (among the human messages `welcome` and `room`, which you may ignore). A new id joins as a spectator. `you.canConfig` is true only for the first connection in the room:

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
      "seat": "spectator",
      "role": "spectator",
      "kind": "agent",
      "color": null,
      "canConfig": true
    }
  }
}
```

To play, claim an empty seat. `sit` is the same message. The room creator who claims becomes `role` `"host"`. Anyone else who claims becomes `"guest"`.

```json
{"type":"claim_seat","payload":{"seat":"red"}}
```

```json
{
  "type": "seated",
  "payload": {
    "playerId": "agent-a",
    "seat": "red",
    "role": "host",
    "changed": true,
    "canConfig": true,
    "you": {
      "playerId": "agent-a",
      "name": "Agent A",
      "seat": "red",
      "role": "host",
      "kind": "agent",
      "color": "red",
      "canConfig": true
    }
  }
}
```

Give `roomCode` to the other player. They connect to the same path, send `join` with a different `playerId` (they are a spectator), then `claim_seat` the empty color.

Optional, config host only, once, **before** the second seat is claimed. The official client does this when you pass `--config` and `you.canConfig` is true (or `you.role` is `"host"`) during `lobby`. Wait for a `room` push whose `config` matches. The second claimed seat starts the match immediately, and config locks. `hostColor` is a preference. It does not move anyone between seats.

```json
{"type":"set_config","payload":{"boardSize":9,"winMode":"steps","winParam":4,"hostColor":"red"}}
```

`boardSize` is 9, 11, or 13. `hostColor` is `red` or `blue`. Defaults if you skip this: 9×9, `annihilation`, host red. `winMode` and `winParam` are defined in the "Win modes" section below.

## Win modes

The setup page labels this field "Win mode". Pass the `winMode` key in `set_config`, not the label. Do not search the page for the label. There are three modes.

**Annihilation** (`annihilation`). The setup label is "Annihilation". The engine is created without `winParam` and never reads it, so there is no step limit. A stored default of 50 on the room does not end the match. After a placement explodes, and only once at least two placements have been made, the side that still has cells of its color wins when the other color has none. The UI calls that "Wiped out all enemy pieces". These matches are long.

**Step limit** (`steps`). The setup label is "Step limit". `winParam` is the total number of placements by both sides, shown as "Steps", an integer of at least 1. When the placement count reaches `winParam`, the side with more cells wins. Equal cell counts is a draw. The UI calls that "After {n} steps, more area ({a} vs {b})" or "After {n} steps, equal area ({a})". That comparison is what ends the match. For a short match, use `steps` with a small `winParam`.

**Area control** (`area`). The setup label is "Area control". `winParam` is the target cell count, shown as "Target cells", an integer of at least 1. After a placement explodes, and only once at least two placements have been made, the first side with at least `winParam` cells wins. When both sides cross that count on the same explosion, red is checked first. The UI calls that "First to hold {n} cells". The count is checked when a placement explodes.

`kind` is `agent` or `human`. Omit it and the seat stays human (a browser reconnect omits it and does not clear `agent`). Kind does not change rules. The human lobby labels an agent seat. The official client always sends `kind` `"agent"`.

## Play until someone wins

When the opponent claims a seat, the other seated player receives:

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
      "legalActions": [{ "type": "move", "row": 0, "col": 0 }],
      "effects": []
    }
  }
}
```

`fullState` is the object human clients already apply. `counts` and `colors` are row-major: index `row * boardSize + col`. Numbers: `0` empty, `1` red, `2` blue. `currentTurn` is `1` or `2`. `board` is that same grid with color names and the explosion `capacity` of each cell (corner 2, edge 3, center 4). `legalActions` are the placements `isValidMove` accepts for **your** color right now. Pick one. Do not invent coordinates. The official client copies `legalActions`, `board`, and `effects` onto the `your_turn` and `opponent` lines and into `GET /state` and `GET /wait`. You choose from `legalActions`, then `POST /move`. Read `board` and `effects` to see what the last placement did.

Act with either the human verb or `act` (same rules). The official client sends the human verb:

```json
{"type":"move","payload":{"row":0,"col":0}}
```

```json
{"type":"act","payload":{"type":"move","row":0,"col":0}}
```

`row` and `col` are integers. Both players then receive `move_applied` (the board after the placement, plus `effects`) and the human `state` frame (animation frames for the board UI). The official client folds those frames into `effects` when `move_applied` does not already include them. Read `board` and `effects` on the client JSON. Do not treat a repeated `lastOpponentMove` coordinate as proof that the cell only stacked.

```json
{
  "type": "move_applied",
  "payload": {
    "action": { "type": "move", "row": 0, "col": 0 },
    "by": { "playerId": "agent-a", "seat": "red", "color": "red", "kind": "agent", "role": "host", "name": "Agent A" },
    "publicState": { "turn": "blue", "fullState": {}, "board": [], "config": {} },
    "effects": [{ "exploded": { "row": 8, "col": 0 }, "spread": [{ "row": 7, "col": 0 }, { "row": 8, "col": 1 }] }],
    "gameOver": false
  }
}
```

The other seat then receives `your_turn` with a new observation. The seat that just moved does **not** get another `your_turn` until the opponent has played. The official client keeps the socket open across that gap, prints an `opponent` line for their move, and `GET /wait?event=your_turn` blocks until that push. That block is the supported wait. It is not a poll.

An illegal move returns `error` to that socket only. The turn does not advance and `your_turn` is not repeated. Play a different entry from the `legalActions` you already have.

```json
{"type":"error","payload":{"message":"Invalid move"}}
```

Other `error` messages include `Not your turn`, `Game not in progress`, `Spectators cannot move`, `Unknown action`, `Join first`, `Only host can set config`, `Config locked after room create`, `Seat taken`, `seat must be red or blue`, `Cannot change seats after the match starts`.

When the match ends, both receive `move_applied` with `gameOver: true` and:

```json
{
  "type": "game_over",
  "payload": { "winner": 1, "winnerColor": "red", "winReason": "4 步后占据更多面积 (2 vs 1)" }
}
```

`winner` is the human field (`1` red, `2` blue, or `"draw"`). Prefer `winnerColor`: `red`, `blue`, or `draw`. `winReason` is a server string and may be Chinese. The official client copies these fields onto the JSON result.

Surrender (not listed in `legalActions`) from a seated player during play:

```json
{"type":"surrender","payload":{}}
```

```json
{"type":"act","payload":{"type":"surrender"}}
```

The opponent wins. After `game_over`, both seats may send `{"type":"rematch","payload":{}}`. When both have, the server pushes `start` and `your_turn` again. The official client does not send `surrender` or `rematch`; those frames are documented so you can read them if the server pushes the result. Do not add an engine to send them.

A one-shot `{"type":"observe","payload":{}}` returns `{"type":"observation","payload":{"observation":{...}}}`. The official client does not poll with it. Use `GET /state` or `GET /wait` on the local server. Do not loop on `observe`. Rejoining with the **same** `playerId` reclaims the prior seat (red, blue, or spectator) and the server pushes `joined` (`reclaimed: true`), `observation`, and `your_turn` when it is your turn. A new id is a new person and joins as a spectator. They may `claim_seat` an empty color. When both seats are taken, that new id stays a spectator: `joined` with `seat: "spectator"`, no `your_turn`. The client prints `event` `"spectator"` and stays up, then prints `event` `"watch"` for each move until `game_over`.

`peer_left` means the opponent's socket dropped. The seat stays reserved. Keep the connection; they can reclaim. `room_closed` means the room was recycled because no seated player was still connected.

## After the setup-page prompt

The human pastes one prompt from the explosive-chess setup page at `/play/explosive-chess`. The prompt is only in the UI language. Fetch the guide URL in that prompt, then ask in chat and wait. Do not connect before they answer. There is no MCP.

1. Play against the human?
2. Should you create the room?
3. Or do they already have a room code?

### They already have a room code

Run `join_room -c <code> --seat red` or `--seat blue` against that host (`--url` with the exact `<ws-origin>/ws/explosive-chess:<code>` if the prompt already has it). The client joins as `kind` `"agent"` with `"game":"explosive-chess"`, then sends `claim_seat`. If the `joined` line says `you.canConfig` is true, the client sends `--config` only when you passed it and the room is still a lobby. If you are not the config host, do not rely on changing rules. Claim the empty seat. Anyone who does not claim, including a human who only joins, is a spectator (`seat: "spectator"`, no `your_turn`) and can watch. The human opens `<http-origin>/play/explosive-chess?room=<code>`, joins, and taps Sit. Stay in that process. Read `listening`, then curl `/wait` and `/move`.

### You create the room

Run `create_room` with `--seat red` or `--seat blue`. Omit `-c` for a generated `[a-z0-9]` code, or pass `-c` with your own (6 characters is enough). The HTTP check is the curl command in the endpoint section. The client connects first, so `you.canConfig` is true. Pass `--config` once on that command, before the other seat is claimed. Defaults if you skip it: 9×9 annihilation, host red. Prefer `"winMode":"steps"` with a small `winParam` for a short match. The "Win modes" section maps the setup labels "Annihilation", "Step limit", and "Area control" to those keys and states what `winParam` does in each. Read `roomCode` and `playUrl` from the `joined` line and tell the human. They open that link, tap join, and sit in the empty color. You play the seat you claimed. Leave your socket open while they do: that is the official client after `create_room`, serving HTTP until the server pushes. If you disconnect before they sit, your seat stays reserved and the game waits.

### Two agents, no human seat

If they want two AIs to play each other, you are Agent A: `create_room --seat red` as above and pass `--config` before B claims a seat. Give them the same room code for the second AI. Agent B runs `join_room -c <code> --seat blue` with a different `playerId` and does not pass `--config`. Humans and other agents can `join_room` with no `--seat` and watch. If B's client fails before `joined`, run it again — A creates the room by connecting. The client retries a few times on its own if the socket drops before `joined`. After `joined`, it prints `listening` and waits for pushes. Curl `/wait`. Do not poll.

The human can also share `?room=<code>` with another person. Clicks from a seated human are the same `move` messages. In-game status shows `vs Agent` when the other seat's kind is `agent`. A person who does not sit stays on the roster as a spectator.

Each agent still chooses its own moves from `legalActions`. Neither agent should hand the position to a solver.

## Repository smoke test

From a checkout, against a running worker (local `npm run dev` or staging after deploy):

```bash
node scripts/explosive-chess-agent-duel.mjs ws://127.0.0.1:8787
node scripts/explosive-chess-agent-duel.mjs wss://micromist-staging.goldeneaglepersonal.dpdns.org
```

This is a developer check that two sockets can finish a short match. It is not the downloadable client. It picks placements on its own so the server can be exercised, which is exactly what a playing agent must not do. Do not copy it, do not extend it into an engine, and do not run it as your move chooser. Playing agents download the official clients above. Needs Node 22+ for the global `WebSocket`.
