# 前线潮汐 Agent 协议

单人无尽局。只有一个座位 `player`。没有 MCP。每一手都从 `legalActions` 里选。官方客户端不会自己下。

## 连接

`GET /ws/frontline-tide:<code>`，带 `Upgrade: websocket`。

加入：

```json
{"type":"join","payload":{"playerId":"agent-a","name":"Agent","kind":"agent","game":"frontline-tide"}}
```

加入时是旁观。要玩就发 `claim_seat`，正文 `{"seat":"player"}`。这个座位一坐上就开局。开局前可以 `set_config`：`{"seed":12345}`（非负整数）。同一个 seed 的第一天棋盘相同。

## 回合

`your_turn` 里有 `observation`：

- `publicState.board` — 8×8。每格有 `row`、`col`、`terrain`（`shoal` 浅滩、`reef` 礁带、`rip` 急流）、`kind`（`gem`、`defense`、`empty`）、`color` / `colorName`（`coral`、`kelp`、`foam`），工事还有 `tier` / `hp`。
- `publicState.tidePhase` — `day_match` 或 `day_build`。夜里不是一回合。
- `publicState.day`、`hearts`、`points`、`swapsLeft`、`frontDir`（`-1` 向岸，`1` 向外海）、`washColumn`（最外侧那一列）、`washColumns`、`washWidth`、`pathRow`（从 0 起算；人看到的是这一行加 1）、`openRoadCols`、`scrubbedRoad`、`shear`、`bands`。
- `legalActions` — 你只能发这里面的动作。
- `effects` — 上一手的消除、合成，或夜战结算。
- `lastOpponentMove` — 永远是 null。

## 动作

POST 的对象必须和某一条 `legalActions` 相同。

- `day_match`：`{"type":"swap","row":0,"col":0,"row2":0,"col2":1}`。正交相邻的潮印，换完要能连成三消，消耗 1 次交换。第 25 天起（`shear: true`）只有同一行的交换合法。
- `day_match`：`{"type":"end_phase"}` 进入 `day_build`。交换没用完也可以。
- `day_build`：`{"type":"place","row":3,"col":2}`。`points` 够 `t1Cost`，格子在 `pathRow` 上，而且这格还没有工事。潮路以外的格子不会出现在 `legalActions` 里。三个正交相邻的同阶工事会在你刚放下的那格合成下一阶，被清掉的格子补回潮印。T3 不再升。
- `day_build`：`{"type":"end_phase"}` 由服务器结算整夜，然后进入下一天；心归零则结束。`openRoadCols` 非空而且 `points` 还够 `t1Cost` 时，这个动作不会出现。先补潮路。工事点不够再放时，即使潮路还有空档，`end_phase` 也合法。

## 从棋盘上能读到的规则

潮噬沿 `pathRow` 从 `seaColumn` 走向第 0 列。只有这一行上的工事会挡、会打。不在 `pathRow` 上的工事夜里不管事。浅滩是横竖三连，每格 1 点。礁带额外算斜向三连（这列礁带碰到的斜线）。急流不计竖连，每格 2 点。每夜潮水按 `frontDir` 推 `washWidth` 列（第 10 天前是 1，第 10 天起是 2）：那几列被卷走（上面的工事没了），另一侧补上新地形。`scrubbedRoad` 是这一次卷走刚空出来的潮路列。第 25 天起只能左右交换。第 50 天起 `pathRow` 翻到对面那一行，旧行上的工事不再挡潮。潮噬的体力在第 50 天前停在 8，之后升到 12。咬伤一直是 1。第 50 天起有两只疾走，之前没有。没有最后一天。心归零时 `game_over`，`winReason` 是 `"hearts"`，`day` 是溃掉的那天。

## 不要做

不要写求解器、搜索或自动循环。不要自己编坐标。不要每一步新开进程。一个客户端握着连接，直到 `game_over` 或 `POST /shutdown`。
