# 滑动色块 Agent WebSocket

Agent 在房间 WebSocket 上玩滑动色块（chroma-slide）。每滑一步，服务器都会推送盘面。没有 MCP。

这是单人谜题。只有座位 `player` 负责解题。第二条连接可以旁观。没有第二个解题座位，也没有对手。不要把它当成对战。

每一步都由你自己决定。先启动官方客户端。读 stdout 上的 `{"event":"listening","port":N,"base":"http://127.0.0.1:N"}`。curl `GET /wait?event=your_turn`，从 `legalActions` 里选一项，再 curl `POST /move`，正文是 `{"row":ROW,"col":COL}`。不要自己编坐标。

不要编写求解器、搜索树、BFS、A*、自动走子循环，或任何代替你选格子的脚本。官方客户端只负责传输：连接、在本地提供 HTTP、发送你用 curl 提交的滑动、等待服务器推送。它们不会解题。不要把它们改成引擎，也不要自己编写 WebSocket 客户端。

一个进程加入房间，并一直握着这条 socket，直到服务器推送 `game_over`（或你 `POST /shutdown`）。不要 sleep 空等，也不要轮询游戏主机。等待只用 `GET /wait`。不要在一次 `your_turn` 之后退出。不要轮询。

公开 Agent Guide（本文）：游戏主机上的 `GET /agent-guide/chroma-slide/zh`。读取这个 URL。不需要 micromist 仓库。Worker 会在正文前加上当前 host（`origin`、agent guide、客户端下载地址、`websocket`）。用那个 host。`Accept: text/html` 返回 HTML 页面；其他情况正文是 `text/markdown`（curl、多数 Agent）。同一份字节也在 `/agent-guide/chroma-slide/zh.md`。`/agent-guide/chroma-slide/en` 是英文指南。不带语言的 `/agent-guide/chroma-slide` 先看 `?lang=`，再看 `Accept-Language`，否则返回英文页。

`/play/chroma-slide` 的设置面板末尾有一行——「点我，把内容发给 AI，让它来解这一局」。整行都是复制按钮。页面上不展示提示正文。复制出的提示会让你先按当前界面语言读取本指南，连上之前在对话里问人类：要不要解一局、用哪个难度、由你建房还是对方已有房间码。提示里的指南 URL 对应当前页面的 origin。如果粘贴的提示里已经有 WebSocket URL，用那个 URL。链接 `/play/chroma-slide?room=<code>` 会在浏览器里以旁观身份打开该房间。人类可以看着你滑动。只有座位还空着时，他们才能 claim `player`。

下面的例子使用测试站 `wss://micromist-staging.goldeneaglepersonal.dpdns.org` 和本机 `ws://127.0.0.1:8787`。如果这份页面来自别的 host，用取回的指南或人类提示里的 host。下文 `ORIGIN` 是 host 块里的 `http`/`https` origin。`WS_ORIGIN` 是对应的 `ws`/`wss` origin。

## 端点

```
GET /ws/chroma-slide:<code>
Upgrade: websocket
```

`<code>` 是建房的人选定的房间号（`[a-z0-9]`，长度不限；6 位就够）。服务器会把它转成小写。建房就是连上并 join。join 不占座：默认身份是旁观。要解题，对 `player` 发送 `claim_seat`（或 `sit`）。该座位有人且连接着，谜题就开始。不需要第二个人。这里的座位不是 `red` 或 `blue`。那两个词是棋盘上的颜色名。房间里第一个连接是配置主持（`you.canConfig`），哪怕当时还在旁观。Durable Object 在第一次连接时创建。没有额外的数据库。下面的 curl 只检查 HTTP 路由。官方客户端负责升级、`join`、入座和之后的滑动。不要再开第二条 socket。

座位只在它的 WebSocket 开着时算在线。从 `join` 到服务器推送 `game_over`，一直留着这条 socket。官方客户端会替你做到：一个进程，直到 JSON 行的 `event` 是 `game_over`，或你 `POST /shutdown`。不要在 `join`、`set_config`、`claim_seat` 或发出房间码之后关掉它。不要在一次 `your_turn` 之后退出。关掉它，该座位就离线。解题者断开且没有其他入座者时，房间会回收。服务器可能在你的 socket 仍开着时休眠房间；那不是断线，你不用为此重连。只有进程在 `game_over` 之前真的退出了，才用同一个 `playerId` 再跑一次来认领。同一个 id 会回到 `player` 或旁观。新 id 是另一个人。

只使用文本帧。两个方向的信封：

```json
{ "type": "join", "payload": { "playerId": "agent-a", "name": "Agent A" } }
```

如果看到文本帧 `ping` 和 `pong`，忽略它们。它们不是对局事件。

不带升级的路由检查返回 426。这只是 HTTP 检查，不会创建可玩的会话：

```bash
curl -s -D - -o /dev/null \
  "https://micromist-staging.goldeneaglepersonal.dpdns.org/ws/chroma-slide:demo01"
```

## 官方客户端

从同一 host 下载一份客户端。不要改写它。这个进程就是整局谜题：它加入 WebSocket，然后在 `127.0.0.1` 的临时端口上提供 HTTP。你用 curl 驱动它。它不选格子。

- `/agent-clients/chroma-slide/server.mjs`
- `/agent-clients/chroma-slide/server.py`

取回的指南顶部 host 块里有绝对地址。

```bash
curl -fsSL -o server.mjs "$ORIGIN/agent-clients/chroma-slide/server.mjs"
curl -fsSL -o server.py "$ORIGIN/agent-clients/chroma-slide/server.py"
```

Node 需要全局 `WebSocket`。需要 Node 22+。Python 只用标准库，面向常见的 Python 3.8+ 环境，没有第三方包。Node 低于 22 就用 Python。

`create_room` 开房并以旁观加入。省略 `-c`，客户端会生成房间码。传 `-c CODE` 则使用该码。`join_room` 需要 `-c CODE`，除非 `--url` 里已经有房间码。`claim_seat` 就是 `join_room` 再加必填的 `--seat player`。`--seat player` 会在 `join` 之后发送 `claim_seat`。省略 `--seat` 就是旁观。socket 加入之后，进程绑定 `127.0.0.1` 并留在前台。listen 之后的第一行 stdout 是 `{"event":"listening","port":N,"base":"http://127.0.0.1:N"}`。`event` 为 `game_over`、你 `POST /shutdown`、或致命断线时，进程退出。不要为每一步重开进程。

`playerId` 存在客户端，不是服务器签发的。服务器在房间里把这个 id 映射到座位。省略 `--player-id` 时，客户端复用 `~/.config/micromist/chroma-slide-player-id`（若设置了 `$XDG_CONFIG_HOME`，则是 `$XDG_CONFIG_HOME/micromist/chroma-slide-player-id`）。同一个 id 会认领 `player` 或旁观。传入 `--player-id` 只用于这个进程，不会改写那个文件。同一台机器上的第二个 Agent 必须另传 `--player-id`。新 id 是另一个人：以旁观加入。只有空着的 `player` 座位可以被 claim。

```bash
node server.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name Agent --seat player create_room
node server.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name Agent --seat player create_room -c CODE
node server.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name Watcher join_room -c CODE
python3 server.py --origin "$ORIGIN" --player-id PLAYER_ID --name Agent --seat player join_room -c CODE
node server.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name Agent --seat player claim_seat -c CODE
```

如果提示里已经有完整的 WebSocket URL，用 `--url` 原样传入，不要自己再拼：

```bash
node server.mjs --url "$WS_ORIGIN/ws/chroma-slide:CODE" --player-id PLAYER_ID --name Agent --seat player join_room
```

若 `you.canConfig` 为 true（你是第一个连上的）且房间仍是 lobby，在 claim `player` 之前，把 `--config` 加在同一条命令上。入座会发牌并锁住配置。

```bash
node server.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name "Agent" \
  --config '{"preset":"normal","seed":1}' \
  --seat player create_room -c CODE
```

依赖 `--config` 之前，先看 `joined` 那一行的 `you.canConfig`。`you.role` 为 `"host"` 表示这个 `playerId` 是配置主持（房间里的第一个连接），不是第二种颜色。`claim_seat` 不会授予 `canConfig`，也不会搬走配置主持。`canConfig: false` 是客人，不能改难度。`create_room -c` 用在已经存在的房间码上，会加入那个房间：随后的 `joined` 带 `reusedRoom: true`，而且 `canConfig` 常常是 false。如果你传了 `--config` 但无法应用（`canConfig` 为 false、房间不是 lobby、或 `set_config` 被拒绝），客户端会往 stdout 写 `{"event":"error","ok":false,"error":"..."}` 并以非零退出，不会开始解题。不要在默认难度上继续。`POST /config` 同样是硬失败：JSON 错误就是响应，进程非零退出。

stdout 每行一个 JSON 对象（日志在 stderr）。相关的行：

- `event` 为 `joined` — 房间已开。`roomCode` 是要分享的码。`playUrl` 是人类链接（`/play/chroma-slide?room=<code>`）。`canConfig` 和 `reusedRoom` 在这一行。
- `event` 为 `listening` — 本地 HTTP 已起来。`port` 和 `base` 就是你 curl 的地址。这是 listen 之后的第一行。
- `event` 为 `your_turn` — 谜题在等你滑动。`legalActions` 被原样抄出。`board` 是棋盘。`steps` 是已经滑过的步数。`empty` 是空格。`preset` 是难度。客户端不替你选格。
- `event` 为 `game_over` — 谜题解开。`result.winReason` 是 `solved`。`result.winner` 是 `player`。进程随后以 0 退出。
- `event` 为 `error` — 非法滑动，或致命失败。非法滑动不会退出。改 curl `legalActions` 里的另一格。`error` 为 `websocket closed` 且 `recoverable: true` 表示 socket 掉了、座位仍保留。用同一个 `--player-id` 和 `--seat player` 再跑同一条命令。座位还是你的时，下一次 `joined` 带 `reclaimed: true`。

每一行在已知时还包括 `you`、`lastOpponentMove`、`legalActions`、`turn`、`board`、`effects`、`steps`、`empty`、`preset`、`won`。`board` 是最近一次滑动之后的棋盘。读 `board` 看局面。不要只凭 `legalActions` 反推局面。`lastOpponentMove` 始终是 `null`。`effects` 始终是 `[]`。滑动不会爆炸。

把 `BASE` 设成 `listening` 那一行的 base（`http://127.0.0.1:PORT`）。然后：

```bash
curl -sS "$BASE/wait?event=your_turn"
curl -sS -X POST "$BASE/move" -H "content-type: application/json" --data '{"row":ROW,"col":COL}'
```

`GET /state` 返回当前的 you、turn、board、effects、legalActions、steps、empty、preset、won、phase、最近事件、roomCode、canConfig，解开之后还有 result。`GET /wait?event=your_turn` 会阻塞到下一次 `your_turn` 或 `game_over`。你滑完一步且还没解开时，服务器会立刻再推一次 `your_turn`，因为仍然是你在解。加上 `?timeout=SECONDS` 可以限制这次等待；响应仍是状态 JSON。`POST /move` 只在该格位于 `legalActions` 时才发送。其他格子是 JSON 错误，不会发出去。启动时没传 `--seat` 的话，`POST /seat` 正文 `{"seat":"player"}` 可以入座。`POST /shutdown` 以 0 退出。

客户端发送 `{"type":"move","payload":{"row":ROW,"col":COL}}`，并一直留着 socket 直到下一次推送。让那个进程继续跑。不要轮询。被拒绝的滑动不会增加 `steps`，也不会重复 `your_turn`。错误里仍有你已经看到的 `legalActions`。改选另一项。

`--timeout` 是在游戏 socket 上阻塞等待一次推送的秒数。省略它，进程会等到 `game_over`、`POST /shutdown` 或 socket 死亡。`/wait` 的查询参数 `timeout` 是另一回事，只限制那一次 HTTP 调用。

这个浏览器里的本机成绩是另一份列表。在这个房间里解开不会写入那份列表。

## 连接

下面是官方客户端发出的帧，供对照。不要在它旁边再开一条自己的 socket。用 [websocat](https://github.com/websocat/websocat) 做手工跟踪：

```bash
websocat "wss://micromist-staging.goldeneaglepersonal.dpdns.org/ws/chroma-slide:demo01"
```

```json
{"type":"join","payload":{"playerId":"agent-a","name":"Agent A","kind":"agent","game":"chroma-slide"}}
```

服务器推送（另外还有人类消息 `welcome` 和 `room`，可以忽略）。新 id 以旁观加入。`you.canConfig` 只对房间里的第一个连接为 true：

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

要解题，claim 空座位。`sit` 是同一条消息。

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

`you.color` 一直是 `null`。颜色在 `board` 上，不在座位上。

可选，仅配置主持，一次，并且必须在 `player` 入座之前。官方客户端在你传入 `--config`、且 lobby 期间 `you.canConfig` 为 true 时会发送它。等到一条 `config.preset` 相符的 `room` 推送。claim `player` 会立刻发牌，配置随之锁住。

```json
{"type":"set_config","payload":{"preset":"easy","seed":1}}
```

`preset` 是 `easy`、`normal` 或 `hard`。`seed` 是可选的非负整数。同一个 seed 摆出同一盘。省略 `seed`，服务器会自己选一个，并在发牌后的 `config.seed` 里告诉你。不发 `set_config` 时的默认是 `easy` 和随机 seed。

## 难度

设置页把这个字段标成「难度」。`set_config` 传 `preset` 键，不传界面上的文字。不要在页面上搜那个标签。那个菜单开的是人类的本机一局。它不会改 Agent 房间。一共三档。都是 4 种颜色。

**简单**（`easy`）。界面标签是「简单」。6×6。每种颜色收成 3×3。不传 `--config` 时就是这一档。

**普通**（`normal`）。界面标签是「普通」。8×8。每种颜色收成 4×4。

**困难**（`hard`）。界面标签是「困难」。10×10。每种颜色收成 5×5。

`kind` 是 `agent` 或 `human`。省略它，座位保持人类（浏览器重连会省略它，也不会清掉 `agent`）。kind 不改变规则。官方客户端始终发送 `kind` `"agent"`。

## 一步怎么滑

棋盘是一块彩色方格加上一个空格。`board[row][col]` 有：

- `row`、`col` — 从 0 开始的坐标。`POST /move` 用它们。
- `color` — 整数 `0`、`1`、`2` 或 `3`，空格为 `null`。
- `name` — `red`、`blue`、`green`、`yellow` 或 `empty`。`red` 是 color `0`，`blue` 是 `1`，`green` 是 `2`，`yellow` 是 `3`。
- `empty` — 只有空格为 `true`。

观察里的 `empty` 是这个空格的 `{row, col}`。`steps` 计的是滑动次数，不是移动的色块个数。

合法滑动要点一个与空格同行或同列的色块。空格和被点格子之间（含被点的那一格）的每一格都朝空格滑一步。被点的格子变成新的空格。这一整下算 1 步。不在空格那一行或那一列上的格子不会出现在 `legalActions` 里。空格自己也不会。

四种颜色各自占住一个边长为 `squareSide`（`config.squareSide`）的轴对齐正方形时，你获胜。空格可以落在其中一个正方形里面。那一色就少一格，而且别的颜色不能出现在它的正方形里。这个局面的 `won` 为 `true`。`turn` 变成 `null`。`legalActions` 变成 `[]`。服务器推送 `game_over`，`winReason` 为 `"solved"`。

## 一直解到解开

你 claim `player` 之后，服务器发牌，并向该座位推送 `your_turn`。旁观者收到 `state`，可以用 `publicState.board` 画棋盘。他们收不到 `your_turn`，他们的 `legalActions` 保持为空。

`your_turn` 的载荷（官方客户端会把 `board`、`legalActions`、`turn`、`steps`、`empty`、`preset`、`won` 抄到 stdout 那一行和 `GET /state` 上）：

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

`index` 是 `row * size + col`。`POST /move` 只需要 `row` 和 `col`。不在 `legalActions` 里的格子，客户端会拒绝并且不发送。

```json
{ "type": "move", "payload": { "row": 2, "col": 0 } }
```

服务器随后推送 `move_applied`（带滑动之后的 `publicState`，以及 `effects: []`）。还没解开时，接着再推 `your_turn`。`GET /wait?event=your_turn` 会阻塞到这次新的推送。仍然是你的回合。没有 `opponent` 事件。

这一步解开时，`move_applied` 的 `gameOver` 为 `true`，服务器推送：

```json
{
  "type": "game_over",
  "payload": { "winner": "player", "winnerColor": null, "winReason": "solved", "steps": 12, "preset": "easy" }
}
```

官方客户端打印 `event` 为 `game_over` 并以 0 退出。再解一盘就新开一个房间。固定的 `seed` 会再次摆出同一个开局。

## 旁观

省略 `--seat` 就是旁观。你会收到 `state` 和 `move_applied`。`legalActions` 保持为空。`POST /move` 会被拒绝，文案是 `Spectators cannot move`。如果人类想在浏览器里看棋盘，把 `playUrl` 给他们。他们以旁观加入，看到同一份 `board`。不需要第二个 Agent。

## 错误

其他 `error` 文案包括 `Invalid move`、`Move rejected`、`Game not in progress`、`Spectators cannot move`、`Unknown action`、`Join first`、`Only host can set config`、`Config locked after start`、`Config locked after room create`、`Seat taken`、`seat must be player`、`Cannot change seats after the match starts`、`preset must be easy, normal, or hard`、`seed must be a non-negative integer`。这些是服务器原文，不随界面语言改变。
