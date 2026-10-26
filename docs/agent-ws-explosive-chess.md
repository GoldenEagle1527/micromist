# explosive-chess Agent MCP

Agents play explosive-chess through the MCP server. The room WebSocket (`GameRoom`) is still the source of truth. MCP is a thin facade: it dials `wss://<host>/ws/explosive-chess:<code>`, holds that socket, and forwards the move you already chose. It is not a second game protocol. Human web clients stay on their own sockets and still receive pushes.

You choose every move yourself. When `wait_for_turn` returns `your_turn`, pick one `legalActions` entry and pass that `row` and `col` to `take_turn`. Do not invent coordinates.

Do not write a solver, a search tree, minimax, MCTS, an auto-play loop, or any script that chooses moves for you. The MCP server is transport only. It has no chess strength. Do not modify it into an engine, and do not write your own WebSocket client.

Public Agent Guide (this document): `GET /agent-guide/explosive-chess/en` on the game host. Fetch that URL. You do not need the micromist repository. The Worker prepends the live host (`origin`, `agent guide`, `mcp`). Use that host. `Accept: text/html` returns an HTML page; otherwise the body is `text/markdown`. The same bytes are at `/agent-guide/explosive-chess/en.md`. `/agent-guide/explosive-chess/zh` is the Chinese guide. An unlocalized `/agent-guide/explosive-chess` follows `?lang=` and then `Accept-Language`, and otherwise serves this English page. chroma-slide has no MCP.

On `/play/explosive-chess` (the explosive-chess setup page, after you open the game) the bottom of match setup is one line — "Click me to send this to your AI and play together." That whole line is the copy control. The prompt is not shown on the page. The copied prompt tells you to fetch this guide in the current UI language, connect the MCP server, then ask the human in chat before you connect: play against them? should you create a room? or do they already have a room code? The guide URL and the MCP URL in the prompt are absolute for the page origin.

Examples below use staging `https://micromist-staging.goldeneaglepersonal.dpdns.org`. If this page was served from another host, use the host in the fetched guide or in the human's prompt. `ORIGIN` below means that `http`/`https` origin.

## Connect MCP

Streamable HTTP (preferred):

```
https://micromist-staging.goldeneaglepersonal.dpdns.org/mcp/explosive-chess
```

Cursor `mcp.json`:

```json
{
  "mcpServers": {
    "explosive-chess": {
      "url": "https://micromist-staging.goldeneaglepersonal.dpdns.org/mcp/explosive-chess"
    }
  }
}
```

Older clients that only speak HTTP+SSE use `GET /mcp/explosive-chess/sse` on the same host. The first SSE event is `endpoint`; POST there with the `sessionId` query. One MCP session holds one room socket. Do not also open a WebSocket yourself.

There is no downloadable WebSocket client. Do not curl a script and do not hand-roll `join` / `move` frames.

## Tools

Call these on the MCP session. The server keeps the room socket open between calls.

| Tool | When |
| --- | --- |
| `create_room` | You create the room. Optional `roomCode` (`[a-z0-9]`, 6 characters is enough). Returns `roomCode` and `playUrl`. |
| `join_room` | The human (or Agent A) already has a room code. |
| `set_config` | Host only, once, while `phase` is `lobby`, before the other player sits. |
| `wait_for_turn` | Long-poll, about 25–55 seconds (default 30). |
| `take_turn` | `row` and `col` from the last `legalActions`. |
| `get_state` | Debug only. Not the play loop. |

`create_room` and `join_room` send `kind` `"agent"` and `game` `"explosive-chess"`. The first seated player is the host. Give the human `playUrl` (`/play/explosive-chess?room=<code>`). They tap join in the browser. Your socket stays up while they do.

`set_config` body:

```json
{"boardSize":9,"winMode":"steps","winParam":4,"hostColor":"red"}
```

`boardSize` is 9, 11, or 13. `winMode` is `annihilation`, `steps`, or `area`. Defaults if you skip the tool: 9×9 annihilation, host red. Annihilation games are long; `steps` with a small `winParam` finishes after that many placements. A guest must not call `set_config`. A second call is rejected.

## Play loop

1. `create_room` or `join_room`.
2. If `you.role` is `"host"` and the room is still a lobby, `set_config` once.
3. `wait_for_turn`.
4. If `event` is `no_update`, call `wait_for_turn` again. That stack is how a human can think for a long time. It is cheap. The socket stays open. Do not write your own sleep loop against the WebSocket.
5. If `event` is `your_turn`, read `board`, `legalActions`, and `rules`. Pick one legal cell yourself. `take_turn` with that `row` and `col`. Then go back to step 3.
6. If `event` is `game_over`, stop. `winnerColor` is `red`, `blue`, or `draw`.

`take_turn` rejects a cell that is not in the last `legalActions` and does not send it. A cell the server still rejects comes back as `event` `"error"` with the same `legalActions`. Pick a different entry. The turn does not advance.

`wait_for_turn` on your turn or game over returns the observation fields: `board`, `legalActions`, `rules`, `publicState`, `you`, `phase`, `yourTurn`, and `lastOpponentMove` when the opponent's placement arrived while waiting. `yourTurn` is true when `legalActions` is non-empty.

`event` `"spectator"` means both seats were taken. `event` `"room_closed"` means the room was recycled because no seated player was still connected.

A seat is online only while its WebSocket is open. Keep that socket open from `join` until the server pushes `game_over` (and through a rematch if you play one). The MCP server does this: leave the MCP session connected. Do not close it after `create_room`, after `set_config`, or after you send the room code. Closing it marks that seat offline (`connected: false` on the `room` push) and the match does not start. The server may hibernate the room while your socket stays open; that is not a disconnect. Reclaim with the same `playerId` only if the socket actually closed (call `join_room` or `create_room` again on this same MCP session).

## After the setup-page prompt

The human pastes one prompt from `/play/explosive-chess`. Fetch the guide URL in that prompt, connect MCP, then ask in chat and wait. Do not call `create_room` or `join_room` before they answer.

1. Play against the human?
2. Should you create the room?
3. Or do they already have a room code?

### They already have a room code

`join_room` with that code, `kind` `"agent"`. If `you.role` is `"host"`, `set_config` once before the other player sits. If you are `guest`, do not call `set_config`. One open seat is the duel. A third connection is a spectator. The human opens `<origin>/play/explosive-chess?room=<code>`.

### You create the room

`create_room`. You are host. `set_config` once before anyone else sits. Tell the human the `roomCode` and `playUrl`. Leave the MCP session connected while they sit: that is `wait_for_turn` with no `take_turn`. If `event` is `no_update`, call `wait_for_turn` again. If you disconnect before they sit, you are the offline host and the game waits.

### Two agents, no human seat

You are Agent A: `create_room` and `set_config` before B sits. Give B the same room code. Agent B calls `join_room` with a different `playerId` and does not call `set_config`. If B fails before `joined`, call `join_room` again — A creates the room by connecting. Do not open your own socket.

The human can also share `?room=<code>` with another person. Clicks from the human are the same `move` messages. In-game status shows `vs Agent` when the other seat's kind is `agent`.

Each agent still chooses its own moves from `legalActions`. Neither agent should hand the position to a solver.

## Frames the MCP server sends

You do not send these yourself. They are the room protocol behind the tools, so you can read an `error` string if one comes back. Text frames only. Ignore `ping` and `pong`.

```json
{"type":"join","payload":{"playerId":"agent-a","name":"Agent A","kind":"agent","game":"explosive-chess"}}
```

```json
{"type":"set_config","payload":{"boardSize":9,"winMode":"steps","winParam":4,"hostColor":"red"}}
```

```json
{"type":"move","payload":{"row":0,"col":0}}
```

The server pushes `joined`, then `your_turn` only to the seat that may move. `legalActions` are the placements the server accepts for your color right now. `board` is the grid with color names and explosion `capacity` (corner 2, edge 3, center 4). `rules` / `publicState.config` is the match config. Red moves first even when `hostColor` is `blue`.

An illegal move returns `error` to that socket only (`Invalid move`, `Not your turn`, `Game not in progress`, `Spectators cannot move`, `Only host can set config`, `Config locked after room create`, `Join first`). `your_turn` is not repeated. A client `ready` message is rejected (`Ready is disabled; game starts with 2 players`).

When the match ends, both seats receive `game_over` with `winner` (`1` red, `2` blue, or `"draw"`), `winnerColor`, and `winReason` (may be Chinese).

Surrender and rematch exist on the socket. The MCP tools do not send them. Do not add an engine to send them.

## Repository

From a checkout, the stdio process is the same facade (it dials the room and holds the socket). Playing agents use the hosted MCP URL above. Needs Node 22+ for the global `WebSocket`. Default origin is staging.

```bash
npm run mcp:explosive-chess
```

Developer smoke test that two sockets can finish a short match. It picks placements on its own, which a playing agent must not do. Do not copy it and do not run it as your move chooser.

```bash
node scripts/explosive-chess-agent-duel.mjs ws://127.0.0.1:8787
node scripts/explosive-chess-agent-duel.mjs wss://micromist-staging.goldeneaglepersonal.dpdns.org
```
