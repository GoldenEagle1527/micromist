# chroma-slide Agent WebSocket

Agents play chroma-slide (Chroma Slide) on a room socket. The server pushes the board after every slide. There is no MCP endpoint.

This is a solo puzzle. One seat, `player`, solves it. A second connection can watch. There is no second solving seat and no opponent. Do not treat it as a match.

You choose every slide yourself. Start the official client once. Read the stdout line `{"event":"listening","port":N,"base":"http://127.0.0.1:N"}`. Curl `GET /wait?event=your_turn`, pick one `legalActions` entry, and curl `POST /move` with `{"row":ROW,"col":COL}`. Do not invent coordinates.

Do not write a solver, a search tree, BFS, A*, an auto-play loop, or any script that chooses cells for you. The official clients are transport only: they connect, serve a local HTTP API, send the slide you curl, and wait for the server push. They do not solve the puzzle. Do not modify them into an engine, and do not write your own WebSocket client.

One process joins and keeps the socket open until the server pushes `game_over` (or you `POST /shutdown`). Do not sleep-loop and do not poll the game host. `GET /wait` is the supported wait. Do not exit after one `your_turn`. Do not poll.

Public Agent Guide (this document): `GET /agent-guide/chroma-slide/en` on the game host. Fetch that URL. You do not need the micromist repository. The Worker serves this file and prepends the live host (`origin`, `agent guide`, client download URLs, `websocket`). Use that host. `Accept: text/html` returns an HTML page; otherwise the body is `text/markdown` (curl, most agents). The same bytes are at `/agent-guide/chroma-slide/en.md`. `/agent-guide/chroma-slide/zh` is the Chinese guide. An unlocalized `/agent-guide/chroma-slide` follows `?lang=` and then `Accept-Language`, and otherwise serves this English page.

On `/play/chroma-slide` the setup panel ends with one line — "Click me to send this to your AI and let it solve a puzzle." That whole line is the copy control. The prompt is not shown on the page. The copied prompt tells you to fetch this guide in the current UI language, then ask the human in chat before you connect: solve a puzzle? which difficulty? should you create a room, or do they already have a room code? The guide URL in the prompt is absolute for the page origin. If a pasted prompt also contains a websocket URL, use that exact URL. A link `/play/chroma-slide?room=<code>` opens that room in the browser as a spectator. The human can watch your slides. They can claim `player` only while the seat is empty.

Examples below use staging `wss://micromist-staging.goldeneaglepersonal.dpdns.org` and local `ws://127.0.0.1:8787`. If this page was served from another host, use the host in the fetched guide or in the human's prompt. `ORIGIN` below means the `http`/`https` origin from the host block. `WS_ORIGIN` means the matching `ws`/`wss` origin.

## Endpoint

```
GET /ws/chroma-slide:<code>
Upgrade: websocket
```

`<code>` is the room id the host chooses (`[a-z0-9]`, any length; 6 characters is enough). The server lowercases it. Creating a room is connecting and joining. Join does not take the seat: the default role is spectator. To solve, send `claim_seat` (or `sit`) for `player`. The puzzle starts when that seat is filled and connected. A second player is not required. `red` and `blue` are not seats here. Those words are tile hues on the board. The first connection is the config host (`you.canConfig`), even while that person is still a spectator. The Durable Object is created on that first connection. No extra database. The curl command below is only the HTTP route check. The official client performs the upgrade, the `join`, the seat claim, and later slides. Do not open a second socket.

A seat is online only while its WebSocket is open. Keep that socket open from `join` until the server pushes `game_over`. The official client does this for you: one process, leave it running until the JSON line `event` is `game_over` or you `POST /shutdown`. Do not close it after `join`, after `set_config`, after `claim_seat`, or after you send the room code. Do not exit after one `your_turn`. Closing it marks that seat offline. If the solver disconnects and nobody seated remains, the room recycles. The server may hibernate the room while your socket stays open; that is not a disconnect, and you do not reconnect for it. Reclaim with the same `playerId` only if the process actually exited before `game_over`; run it again with the same `playerId`. The same id comes back as `player` or spectator. A new id is a new person.

Text frames only. Envelope, both directions:

```json
{ "type": "join", "payload": { "playerId": "agent-a", "name": "Agent A" } }
```

Ignore text frames `ping` and `pong` if you see them. They are not game events.

A route check without an upgrade returns 426. This is the HTTP check; it does not create a playable session:

```bash
curl -s -D - -o /dev/null \
  "https://micromist-staging.goldeneaglepersonal.dpdns.org/ws/chroma-slide:demo01"
```

## Official clients

Download one client from the same host. Do not rewrite it. The process is the whole puzzle: it joins the WebSocket, then serves HTTP on `127.0.0.1` at an ephemeral port. You drive it with curl. It does not choose slides.

- `/agent-clients/chroma-slide/server.mjs`
- `/agent-clients/chroma-slide/server.py`

The host block at the top of a fetched guide has the absolute URLs.

```bash
curl -fsSL -o server.mjs "$ORIGIN/agent-clients/chroma-slide/server.mjs"
curl -fsSL -o server.py "$ORIGIN/agent-clients/chroma-slide/server.py"
```

Node needs a global `WebSocket`. Needs Node 22+. Python is the standard library only and aims at common Python 3.8+ venvs, with no third-party packages. If Node is older than 22, use Python.

`create_room` opens a room and joins as a spectator. Omit `-c` and the client generates a room code. Pass `-c CODE` to choose one. `join_room` requires `-c CODE` unless `--url` already contains the code. `claim_seat` is `join_room` plus a required `--seat player`. `--seat player` sends `claim_seat` after `join`. Omit `--seat` to watch. After the socket joins, the process binds `127.0.0.1` and stays in the foreground. The first stdout line after listen is `{"event":"listening","port":N,"base":"http://127.0.0.1:N"}`. It exits when `event` is `game_over`, when you `POST /shutdown`, or on a fatal disconnect. Do not run it again for each slide.

`playerId` is stored on the client, not issued by the server. The server maps that id to a seat inside the room. Omit `--player-id` and the client reuses the id in `~/.config/micromist/chroma-slide-player-id` (or `$XDG_CONFIG_HOME/micromist/chroma-slide-player-id` when that variable is set). The same id reclaims `player` or spectator. Passing `--player-id` uses that id for this process only and does not replace the stored file. A second agent on the same machine passes its own `--player-id`. A new id is a new person: they join as a spectator. Only an empty `player` seat can be claimed.

```bash
node server.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name Agent --seat player create_room
node server.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name Agent --seat player create_room -c CODE
node server.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name Watcher join_room -c CODE
python3 server.py --origin "$ORIGIN" --player-id PLAYER_ID --name Agent --seat player join_room -c CODE
node server.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name Agent --seat player claim_seat -c CODE
```

If a prompt already contains an exact websocket URL, pass it with `--url` and do not rebuild it:

```bash
node server.mjs --url "$WS_ORIGIN/ws/chroma-slide:CODE" --player-id PLAYER_ID --name Agent --seat player join_room
```

If `you.canConfig` is true (you connected first) and the room is still a lobby, pass `--config` on that same command, before you claim `player`. Claiming the seat deals the puzzle and locks config.

```bash
node server.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name "Agent" \
  --config '{"preset":"normal","seed":1}' \
  --seat player create_room -c CODE
```

Check `you.canConfig` on the `joined` line before you rely on `--config`. `you.role` `"host"` means this `playerId` is the config host (the first connection in the room), not a second color. `claim_seat` does not grant `canConfig` and does not move the config host. `canConfig: false` is a guest and cannot change the preset. `create_room -c` on a code that already exists joins that room: `joined` then has `reusedRoom: true`, and `canConfig` is often false. If you passed `--config` and it cannot be applied (`canConfig` is false, the room is not a lobby, or `set_config` is rejected), the client writes `{"event":"error","ok":false,"error":"..."}` to stdout and exits non-zero before play. Do not keep playing on the default preset. `POST /config` has the same hard-fail: the JSON error is the response, and the process exits non-zero.

Stdout is one JSON object per line (logs go to stderr). Relevant lines:

- `event` `joined` — the room is open. `roomCode` is the code to share. `playUrl` is the human link (`/play/chroma-slide?room=<code>`). `canConfig` and `reusedRoom` are on this line.
- `event` `listening` — the local HTTP server is up. `port` and `base` are how you curl it. This is the first line after listen.
- `event` `your_turn` — the puzzle is waiting for your slide. `legalActions` is copied through. `board` is the grid. `steps` is the slides already played. `empty` is the hole. `preset` is the difficulty. The client does not select a cell.
- `event` `game_over` — the puzzle is solved. `result.winReason` is `solved`. `result.winner` is `player`. The process then exits 0.
- `event` `error` — a rejected slide, or a fatal failure. A rejected slide does not exit. Curl a different cell from `legalActions`. `error` `websocket closed` with `recoverable: true` means the socket dropped and the seat is still reserved. Run the same command again with the same `--player-id` and `--seat player`. The next `joined` line has `reclaimed: true` when that seat is still yours.

Each line also includes `you`, `lastOpponentMove`, `legalActions`, `turn`, `board`, `effects`, `steps`, `empty`, `preset`, and `won` when they are known. `board` is the grid after the latest applied slide. Read `board` for the position. Do not reconstruct the position from `legalActions` alone. `lastOpponentMove` is always `null`. `effects` is always `[]`. A slide does not explode.

Set `BASE` from the `listening` line (`http://127.0.0.1:PORT`). Then:

```bash
curl -sS "$BASE/wait?event=your_turn"
curl -sS -X POST "$BASE/move" -H "content-type: application/json" --data '{"row":ROW,"col":COL}'
```

`GET /state` returns the current you, turn, board, effects, legalActions, steps, empty, preset, won, phase, last event, roomCode, canConfig, and result when the puzzle is solved. `GET /wait?event=your_turn` blocks until the next `your_turn` or `game_over`. After you slide, the server pushes `your_turn` again immediately when the puzzle is not solved, because it is still your turn. Add `?timeout=SECONDS` to bound that wait; the response is still the state JSON. `POST /move` sends the cell only when it is in `legalActions`. Anything else is a JSON error and is not sent. `POST /seat` with `{"seat":"player"}` claims the seat if you did not pass `--seat` at startup. `POST /shutdown` exits 0.

The client sends `{"type":"move","payload":{"row":ROW,"col":COL}}` and keeps the socket open until the next push. Leave that process running. Do not poll. A rejected slide does not advance `steps` and does not repeat `your_turn`. The error still includes the `legalActions` you already had. Pick a different entry.

`--timeout` is seconds for one blocking wait on the game socket. Omit it and the process waits until `game_over`, `POST /shutdown`, or the socket dies. The `/wait` query `timeout` is separate and only bounds that HTTP call.

Local clears on this browser are a different score list. A solve in this room is not written into that list.

## Connect

Protocol trace for the frames the official client sends. Do not open your own socket beside it. A manual trace with [websocat](https://github.com/websocat/websocat):

```bash
websocat "wss://micromist-staging.goldeneaglepersonal.dpdns.org/ws/chroma-slide:demo01"
```

```json
{"type":"join","payload":{"playerId":"agent-a","name":"Agent A","kind":"agent","game":"chroma-slide"}}
```

Server push (among the human messages `welcome` and `room`, which you may ignore). A new id joins as a spectator. `you.canConfig` is true only for the first connection in the room:

```json
{
  "type": "joined",
  "payload": {
    "game": "chroma-slide",
    "roomCode": "demo01",
    "roomId": "chroma-slide:demo01",
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

To solve, claim the empty seat. `sit` is the same message.

```json
{"type":"claim_seat","payload":{"seat":"player"}}
```

```json
{
  "type": "seated",
  "payload": {
    "playerId": "agent-a",
    "seat": "player",
    "role": "host",
    "changed": true,
    "canConfig": true,
    "you": {
      "playerId": "agent-a",
      "name": "Agent A",
      "seat": "player",
      "role": "host",
      "kind": "agent",
      "color": null,
      "canConfig": true
    }
  }
}
```

`you.color` stays `null`. Tile hues live on `board`, not on the seat.

Optional, config host only, once, **before** `player` is claimed. The official client does this when you pass `--config` and `you.canConfig` is true during `lobby`. Wait for a `room` push whose `config.preset` matches. Claiming `player` deals the puzzle immediately, and config locks.

```json
{"type":"set_config","payload":{"preset":"easy","seed":1}}
```

`preset` is `easy`, `normal`, or `hard`. `seed` is an optional non-negative integer. The same seed deals the same board. Omit `seed` and the server picks one and reports it on `config.seed` after the deal. Defaults if you skip `set_config`: `easy`, random seed.

## Difficulties

The setup page labels this field "Difficulty". Pass the `preset` key in `set_config`, not the label. Do not search the page for the label. The menu on that page starts the human's local puzzle. It does not change an agent room. There are three difficulties. All of them use 4 colors.

**Easy** (`easy`). The setup label is "Easy". Board 6×6. Each color gathers into a 3×3 square. This is the default when you skip `--config`.

**Normal** (`normal`). The setup label is "Normal". Board 8×8. Each color gathers into a 4×4 square.

**Hard** (`hard`). The setup label is "Hard". Board 10×10. Each color gathers into a 5×5 square.

`kind` is `agent` or `human`. Omit it and the seat stays human (a browser reconnect omits it and does not clear `agent`). Kind does not change rules. The official client always sends `kind` `"agent"`.

## How a slide works

The board is a square of colored tiles plus one empty cell. `board[row][col]` has:

- `row`, `col` — zero-based coordinates. `POST /move` uses these.
- `color` — integer `0`, `1`, `2`, or `3`, or `null` when the cell is empty.
- `name` — `red`, `blue`, `green`, `yellow`, or `empty`. `red` is color `0`, `blue` is `1`, `green` is `2`, `yellow` is `3`.
- `empty` — `true` only for the hole.

`empty` on the observation is that hole as `{row, col}`. `steps` counts slides, not tiles moved.

A legal slide clicks a tile that shares a row or a column with the hole. Every tile strictly between the hole and the clicked cell, including the clicked cell, slides one step toward the hole. The clicked cell becomes the hole. That whole slide is one step. Cells that are not on the hole's row or column are absent from `legalActions`. The hole itself is absent too.

You win when each of the four colors occupies one axis-aligned square of side `squareSide` (`config.squareSide`). The empty cell may sit inside one of those squares. That color then has one fewer tile, and no other color may sit inside its square. `won` is `true` on that position. `turn` becomes `null`. `legalActions` becomes `[]`. The server pushes `game_over` with `winReason` `"solved"`.

## Play until the puzzle is solved

When you claim `player`, the server deals the board and pushes `your_turn` to that seat. Spectators receive `state` and can render `publicState.board`. They do not receive `your_turn`, and their `legalActions` stay empty.

`your_turn` payload (the official client copies `board`, `legalActions`, `turn`, `steps`, `empty`, `preset`, and `won` onto the stdout line and onto `GET /state`):

```json
{
  "type": "your_turn",
  "payload": {
    "observation": {
      "game": "chroma-slide",
      "phase": "playing",
      "you": { "playerId": "agent-a", "seat": "player", "color": null, "canConfig": true },
      "publicState": {
        "config": { "preset": "easy", "size": 6, "colorCount": 4, "squareSide": 3, "seed": 1 },
        "board": [[{ "row": 0, "col": 0, "color": 0, "name": "red", "empty": false }]],
        "empty": { "row": 2, "col": 3 },
        "steps": 0,
        "won": false,
        "turn": "player"
      },
      "legalActions": [{ "type": "move", "row": 2, "col": 0, "index": 12 }],
      "lastOpponentMove": null
    }
  }
}
```

`index` is `row * size + col`. `POST /move` only needs `row` and `col`. The client rejects a cell that is not in `legalActions` and does not send it.

```json
{ "type": "move", "payload": { "row": 2, "col": 0 } }
```

The server then pushes `move_applied` (with `publicState` for the position after the slide, and `effects: []`), then `your_turn` again if the puzzle is not solved. `GET /wait?event=your_turn` blocks until that next push. It is still your turn. There is no `opponent` event.

When the slide solves the puzzle, `move_applied` has `gameOver: true` and the server pushes:

```json
{
  "type": "game_over",
  "payload": { "winner": "player", "winnerColor": null, "winReason": "solved", "steps": 12, "preset": "easy" }
}
```

The official client prints `event` `game_over` and exits 0. Open a new room for another deal. A fixed `seed` deals the same starting board again.

## Watching

Omit `--seat` to watch. You receive `state` updates and `move_applied`. `legalActions` stays empty. `POST /move` is rejected with `Spectators cannot move`. Give the human `playUrl` if they want the board in the browser. They join as a spectator and see the same `board`. They do not need a second agent.

## Errors

Other `error` messages include `Invalid move`, `Move rejected`, `Game not in progress`, `Spectators cannot move`, `Unknown action`, `Join first`, `Only host can set config`, `Config locked after start`, `Config locked after room create`, `Seat taken`, `seat must be player`, `Cannot change seats after the match starts`, `preset must be easy, normal, or hard`, `seed must be a non-negative integer`. These strings are the server's English text in every locale.
