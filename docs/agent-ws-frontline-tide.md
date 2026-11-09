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
- `publicState.day`, `hearts`, `points`, `swapsLeft`, `frontDir` (`-1` toward shore, `1` toward sea), `washColumn` (outer edge), `washColumns`, `washWidth`, `pathRow` (0-indexed; the human UI says this row + 1), `openRoadCols`, `scrubbedRoad`, `shear`, `bands`.
- `legalActions` — the only actions you may send.
- `effects` — clears, merges, or the night report from the previous action.
- `lastOpponentMove` — always null.

## Actions

POST the action object. It must equal one `legalActions` entry.

- `{"type":"swap","row":0,"col":0,"row2":0,"col2":1}` during `day_match`. Orthogonal gems that make a match. Costs one swap. From day 25 (`shear: true`) only same-row swaps are legal.
- `{"type":"end_phase"}` during `day_match` moves to `day_build` even if swaps remain.
- `{"type":"place","row":3,"col":2}` during `day_build` when `points` cover `t1Cost`, the cell is on `pathRow`, and it is not already a defense. Off-road cells are not legal. Three orthogonally connected defenses of the same tier merge into the next tier on the cell you just placed. The cells that merge away refill with gems. T3 does not promote.
- `{"type":"end_phase"}` during `day_build` resolves the night on the server and opens the next day, or ends the run. It is absent while `openRoadCols` is non-empty and `points` still cover `t1Cost`. Patch the tide road first. When you cannot afford another groyne, `end_phase` is legal even if the road still has gaps.

## Rules you can read off the board

Biters walk `pathRow` from `seaColumn` toward column 0. Only defenses on that row block and shoot. Groynes off `pathRow` do nothing at night. Shoal matches in orthogonal lines of three for 1 point a gem. Reef also clears diagonals of three that touch the reef column. Rip ignores vertical lines and pays 2 points a gem. After each night the tide pushes `washWidth` columns in `frontDir` (`1` before day 10, `2` from day 10): those columns wash away (defenses on them are lost) and new bands enter opposite. `scrubbedRoad` lists the road columns that wash just opened. From day 25 only horizontal swaps match. From day 50 `pathRow` flips to the opposite row and defenses on the old row stop fighting. Biter HP stops at 8 until day 50, then rises to 12. Bite damage stays 1. Two biters rush from day 50; none rush before that. There is no last day. Hearts at 0 is `game_over` with `winReason` `"hearts"` and `day` set to the day the shore broke.

## Do not

Do not write a solver, search, or auto-play loop. Do not invent coordinates. Do not open a new process per action. One client holds the socket until `game_over` or `POST /shutdown`.
