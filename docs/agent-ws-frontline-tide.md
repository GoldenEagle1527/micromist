# Frontline Tide agent protocol

Solo endless run. One seat, `player`. No MCP. You choose every action from `legalActions`. The official client does not play.

## Connect

`GET /ws/frontline-tide:<code>` with `Upgrade: websocket`.

Join:

```json
{"type":"join","payload":{"playerId":"agent-a","name":"Agent","kind":"agent","game":"frontline-tide"}}
```

Join is a spectator. Send `claim_seat` with `{"seat":"player"}` to play. The run starts when that seat is filled. Optional `set_config` before anyone sits: `{"seed":12345}` (non-negative integer). The same seed deals the same day-1 board.

## Turn

`your_turn` carries `observation`:

- `publicState.board` — 8×8. Each cell has `row`, `col`, `terrain` (`shoal`, `reef`, `rip`), `kind` (`gem`, `defense`, `empty`), `color` / `colorName` (`coral`, `kelp`, `foam`), and defense `tier` / `hp` when present.
- `publicState.tidePhase` — `day_match` or `day_build`. Night is not a turn.
- `publicState.day`, `hearts`, `points`, `swapsLeft`, `frontDir` (`-1` toward shore, `1` toward sea), `washColumn`, `pathRow`, `bands`.
- `legalActions` — the only actions you may send.
- `effects` — clears, merges, or the night report from the previous action.
- `lastOpponentMove` — always null.

## Actions

POST the action object. It must equal one `legalActions` entry.

- `{"type":"swap","row":0,"col":0,"row2":0,"col2":1}` during `day_match`. Orthogonal gems that make a match. Costs one swap.
- `{"type":"end_phase"}` during `day_match` moves to `day_build` even if swaps remain.
- `{"type":"place","row":3,"col":2}` during `day_build` when `points` cover `t1Cost` and the cell is not already a defense. Three orthogonally connected defenses of the same tier merge into the next tier on the cell you just placed. T3 does not promote.
- `{"type":"end_phase"}` during `day_build` resolves the night on the server and opens the next day, or ends the run.

## Rules you can read off the board

Biters walk `pathRow` from `seaColumn` toward column 0. Only defenses on that row block and shoot. Shoal matches in orthogonal lines of three for 1 point a gem. Reef also clears diagonals of three that touch the reef column. Rip ignores vertical lines and pays 2 points a gem. After each night the tide pushes one column in `frontDir`: that edge washes away (defenses on it are lost) and a new band enters opposite. There is no last day. Hearts at 0 is `game_over` with `winReason` `"hearts"` and `day` set to the day the shore broke.

## Do not

Do not write a solver, search, or auto-play loop. Do not invent coordinates. Do not open a new process per action. One client holds the socket until `game_over` or `POST /shutdown`.
