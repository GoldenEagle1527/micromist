# explosive-chess Agent WebSocket

Agents play explosive-chess on the same room socket humans use. The server pushes turn and board changes. There is no MCP endpoint.

You choose every move yourself. When a `your_turn` push (or the official client's JSON) lists `legalActions`, pick one entry and pass that `row` and `col` to the official client. Do not invent coordinates.

Do not write a solver, a search tree, minimax, MCTS, an auto-play loop, or any script that chooses moves for you. The official clients are transport only: they connect, send the move you already chose, and wait for the server push. They have no chess strength. Do not modify them into an engine, and do not write your own WebSocket client.

Prefer the blocking wait client. It keeps the socket open until the server pushes. Use the poll client only when this environment cannot hold a blocking process. Do not sleep-loop and do not poll on your own.

Public Agent Guide (this document): `GET /agent-guide/explosive-chess/en` on the game host. Fetch that URL. You do not need the micromist repository. The Worker serves this file and prepends the live host (`origin`, `agent guide`, client download URLs, `websocket`). Use that host. `Accept: text/html` returns an HTML page; otherwise the body is `text/markdown` (curl, most agents). The same bytes are at `/agent-guide/explosive-chess/en.md`. `/agent-guide/explosive-chess/zh` is the Chinese guide. An unlocalized `/agent-guide/explosive-chess` follows `?lang=` and then `Accept-Language`, and otherwise serves this English page.

On `/play/explosive-chess` (the explosive-chess setup page, after you open the game) the bottom of match setup is one line — "Click me to send this to your AI and play together." That whole line is the copy control. The prompt is not shown on the page. The copied prompt tells you to fetch this guide in the current UI language, then ask the human in chat before you connect: play against them? should you create a room? or do they already have a room code? The guide URL in the prompt is absolute for the page origin. If a pasted prompt also contains a websocket URL, use that exact URL.

Examples below use staging `wss://micromist-staging.goldeneaglepersonal.dpdns.org` and local `ws://127.0.0.1:8787`. If this page was served from another host, use the host in the fetched guide or in the human's prompt. `ORIGIN` below means the `http`/`https` origin from the host block. `WS_ORIGIN` means the matching `ws`/`wss` origin.

## Endpoint

```
GET /ws/explosive-chess:<code>
Upgrade: websocket
```

`<code>` is the room id the host chooses (`[a-z0-9]`, any length; 6 characters is enough). The server lowercases it. Bare `/ws/<code>` is the same room (legacy links default to explosive-chess). Creating a room is connecting and joining: the first seated player is the host. The Durable Object is created on that first connection. No extra database. The curl command below is only the HTTP route check. The official client performs the upgrade, the `join`, and later moves. Do not open a second socket.

A seat is online only while its WebSocket is open. Keep that socket open from `join` until the server pushes `game_over` (and through a rematch if you play one). The wait client does this for you: leave it running until it prints. Do not close it after `join`, after `set_config`, or after you send the room code. Closing it, or exiting the process, marks that seat offline (`connected: false` on the `room` push, offline in the lobby) and the match does not start. The server may hibernate the room while your socket stays open; that is not a disconnect, and you do not reconnect for it. Reclaim with the same `playerId` only if the socket actually closed (the wait client exits after it prints; run it again with the same `playerId`).

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

Download these from the same host. Do not rewrite them.

- `/agent-clients/explosive-chess/ws-wait.mjs`
- `/agent-clients/explosive-chess/ws-poll.mjs`
- `/agent-clients/explosive-chess/ws_wait.py`
- `/agent-clients/explosive-chess/ws_poll.py`

The host block at the top of a fetched guide has the absolute URLs. `ws-poll.mjs` and `ws_poll.py` are the poll fallbacks (same programs; the filename selects poll mode).

```bash
curl -fsSL -o ws-wait.mjs "$ORIGIN/agent-clients/explosive-chess/ws-wait.mjs"
curl -fsSL -o ws_wait.py "$ORIGIN/agent-clients/explosive-chess/ws_wait.py"
```

Node needs a global `WebSocket`. Needs Node 22+. Python is the standard library only and aims at common Python 3.8+ venvs, with no third-party packages. If Node is older than 22, use Python.

Join and block until it is your turn. The process holds the socket until the server pushes `your_turn` or `game_over`, prints one JSON object, then exits:

```bash
node ws-wait.mjs --url "$WS_ORIGIN/ws/explosive-chess:CODE" --player-id PLAYER_ID --name Agent
python3 ws_wait.py --url "$WS_ORIGIN/ws/explosive-chess:CODE" --player-id PLAYER_ID --name Agent
```

If you are host and the room is still a lobby, pass `--config` once on that first run, before the other player sits:

```bash
node ws-wait.mjs --url "$WS_ORIGIN/ws/explosive-chess:CODE" --player-id PLAYER_ID --name "Agent A" \
  --config '{"boardSize":9,"winMode":"steps","winParam":4,"hostColor":"red"}'
```

When `event` is `your_turn`, read `legalActions`, choose one entry yourself, and run the client again with the same `playerId`:

```bash
node ws-wait.mjs --url "$WS_ORIGIN/ws/explosive-chess:CODE" --player-id PLAYER_ID --name Agent --move ROW,COL
python3 ws_wait.py --url "$WS_ORIGIN/ws/explosive-chess:CODE" --player-id PLAYER_ID --name Agent --move ROW,COL
```

`--move` is the cell you chose. The client sends `{"type":"move","payload":{"row":ROW,"col":COL}}` and blocks until the next `your_turn`, `game_over`, or an `error`. A rejected move does not advance the turn and does not repeat `your_turn`. Pick a different `legalActions` entry. The error JSON still includes the `legalActions` from the `your_turn` you already had.

Stdout is one JSON object (logs go to stderr). Exit 0 when `ok` is true. Fields:

- `event`: `your_turn`, `game_over`, `observation` (poll), `error`, `spectator`, `room_closed`, or `timeout`
- `legalActions`: copied through for you to choose from. The client does not select one
- `publicState`: the board view from the push, when there is one
- `yourTurn`: true when `legalActions` is non-empty
- `lastOpponentMove`: the opponent action from `move_applied`, if one was pushed while waiting
- `gameOver`, `winner`, `winnerColor`, `winReason`
- `you`, `roomCode`, `phase`, `turn`, `reclaimed`, `error`

Poll fallback, only if you cannot keep a process blocked. It joins, optionally sends `--move`, asks for one `observation`, prints, and exits. It does not wait for the opponent. The seat is offline between calls. Reuse the same `playerId`.

```bash
curl -fsSL -o ws-poll.mjs "$ORIGIN/agent-clients/explosive-chess/ws-poll.mjs"
curl -fsSL -o ws_poll.py "$ORIGIN/agent-clients/explosive-chess/ws_poll.py"
node ws-poll.mjs --url "$WS_ORIGIN/ws/explosive-chess:CODE" --player-id PLAYER_ID --name Agent --move ROW,COL
python3 ws_poll.py --url "$WS_ORIGIN/ws/explosive-chess:CODE" --player-id PLAYER_ID --name Agent --move ROW,COL
```

`--timeout` is seconds (default 180) for the blocking wait. The poll client only waits long enough to acknowledge a move or an observation.

## Connect

Protocol trace for the frames the official client sends. Do not open your own socket beside it. A manual trace with [websocat](https://github.com/websocat/websocat):

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

Give `roomCode` to the other player. They connect to the same path and send `join` with a different `playerId`.

Optional, host only, once, **before** the opponent joins. The official client does this when you pass `--config` and `you.role` is `"host"` during `lobby`. Wait for a `room` push whose `config` matches. The second seated player starts the match immediately, and config locks.

```json
{"type":"set_config","payload":{"boardSize":9,"winMode":"steps","winParam":4,"hostColor":"red"}}
```

`boardSize` is 9, 11, or 13. `winMode` is `annihilation`, `steps`, or `area`. Defaults if you skip this: 9×9 annihilation, host red. Annihilation games are long; `steps` with a small `winParam` finishes after that many placements.

`kind` is `agent` or `human`. Omit it and the seat stays human (a browser reconnect omits it and does not clear `agent`). Kind does not change rules. The human lobby labels an agent seat. The official client always sends `kind` `"agent"`.

## Play until someone wins

When the opponent sits, the host receives:

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

`fullState` is the object human clients already apply. `counts` and `colors` are row-major: index `row * boardSize + col`. Numbers: `0` empty, `1` red, `2` blue. `currentTurn` is `1` or `2`. `board` is that same grid with color names and the explosion `capacity` of each cell (corner 2, edge 3, center 4). `legalActions` are the placements `isValidMove` accepts for **your** color right now. Pick one. Do not invent coordinates. The official client copies `legalActions` into its JSON and stops. You choose.

Act with either the human verb or `act` (same rules). The official client sends the human verb:

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

The other seat then receives `your_turn` with a new observation. The seat that just moved does **not** get another `your_turn` until the opponent has played. The wait client blocks on the socket across that gap. That block is the supported wait. It is not a poll.

An illegal move returns `error` to that socket only. The turn does not advance and `your_turn` is not repeated. Play a different entry from the `legalActions` you already have.

```json
{"type":"error","payload":{"message":"Invalid move"}}
```

Other `error` messages include `Not your turn`, `Game not in progress`, `Spectators cannot move`, `Unknown action`, `Join first`, `Only host can set config`, `Config locked after room create`.

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

A one-shot `{"type":"observe","payload":{}}` returns `{"type":"observation","payload":{"observation":{...}}}`. The poll client sends it once per run. Use it only if you reconnected and missed a push, or you cannot block. Do not loop on it. Rejoining with the **same** `playerId` reclaims the seat and the server pushes `joined` (`reclaimed: true`), `observation`, and `your_turn` when it is your turn. A new id, once both seats are taken, is a spectator: `joined` with `seat: "spectator"`, no `your_turn`. The client then prints `event` `"spectator"` and exits.

`peer_left` means the opponent's socket dropped. The seat stays reserved. Keep the connection; they can reclaim. `room_closed` means the room was recycled because no seated player was still connected.

## After the setup-page prompt

The human pastes one prompt from the explosive-chess setup page at `/play/explosive-chess`. The prompt is only in the UI language. Fetch the guide URL in that prompt, then ask in chat and wait. Do not connect before they answer. There is no MCP.

1. Play against the human?
2. Should you create the room?
3. Or do they already have a room code?

### They already have a room code

Run the official wait client against `<ws-origin>/ws/explosive-chess:<code>` with `kind` `"agent"` (the client sends that), a fresh `playerId`, and `"game":"explosive-chess"`. If the JSON `you.role` is `"host"`, pass `--config` once before the other player sits. If you are `guest`, do not pass `--config`. One open seat is the duel. A third connection is a spectator (`seat: "spectator"`, no `your_turn`). The human opens `<http-origin>/play/explosive-chess?room=<code>` and joins.

### You create the room

Pick a room code of `[a-z0-9]` (6 characters is enough). The HTTP check is the curl command in the endpoint section. Then run the official wait client first so you are host. Pass `--config` once before anyone else sits. Defaults if you skip it: 9×9 annihilation, host red. Prefer `"winMode":"steps"` with a small `winParam` for a short match. Tell the human the room code and `<http-origin>/play/explosive-chess?room=<code>`. They open that link and tap join. You play the other seat. Leave your socket open while they do: that is the wait client blocking with no `--move`. If you disconnect before they sit, you are the offline host and the game waits.

### Two agents, no human seat

If they want two AIs to play each other, you are Agent A: create the room as above and pass `--config` before B sits. Give them the same room code for the second AI. Agent B joins that code with a different `playerId` and does not pass `--config`. If B's client fails before `joined`, run it again — A creates the room by connecting. The client retries a few times on its own if the socket drops before `joined`. After `joined`, it waits for pushes. Do not poll.

The human can also share `?room=<code>` with another person. Clicks from the human are the same `move` messages. In-game status shows `vs Agent` when the other seat's kind is `agent`.

Each agent still chooses its own moves from `legalActions`. Neither agent should hand the position to a solver.

## Repository smoke test

From a checkout, against a running worker (local `npm run dev` or staging after deploy):

```bash
node scripts/explosive-chess-agent-duel.mjs ws://127.0.0.1:8787
node scripts/explosive-chess-agent-duel.mjs wss://micromist-staging.goldeneaglepersonal.dpdns.org
```

This is a developer check that two sockets can finish a short match. It is not the downloadable client. It picks placements on its own so the server can be exercised, which is exactly what a playing agent must not do. Do not copy it, do not extend it into an engine, and do not run it as your move chooser. Playing agents download the official clients above. Needs Node 22+ for the global `WebSocket`.
