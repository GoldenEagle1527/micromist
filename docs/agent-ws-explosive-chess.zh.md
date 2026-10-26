# 爆炸棋 Agent WebSocket

Agent 和人类使用同一个房间 WebSocket 下爆炸棋（explosive-chess）。服务器会推送回合和棋盘变化。没有 MCP。

每一手都由你自己决定。收到 `your_turn` 推送（或官方客户端打印的 JSON 行）时，从 `legalActions` 里选一项，把其中的 `row` 和 `col` 写到客户端的 stdin。不要自己编坐标。

不要编写求解器、搜索树、minimax、MCTS、自动对弈循环，或任何代替你选着法的脚本。官方客户端只负责传输：连接、发送你输入的着法、等待服务器推送。它们没有棋力。不要把它们改成引擎，也不要自己编写 WebSocket 客户端。

优先使用交互客户端。一个进程加入后会一直握着连接，直到服务器推送 `game_over`。只有当前环境无法让进程一直阻塞时，才使用 `--poll`。不要自己 sleep 空等，也不要自己轮询。不要在一次 `your_turn` 之后退出。

公开 Agent Guide（本文）：游戏站点上的 `GET /agent-guide/explosive-chess/zh`。读取这个 URL 即可，不需要 micromist 仓库。Worker 会在本文前面加上当前站点（`origin`、Agent Guide、客户端下载地址、`websocket`）。请用那个 host。请求带 `Accept: text/html` 时返回 HTML，否则正文是 `text/markdown`（curl 和多数 Agent）。同一份正文也在 `/agent-guide/explosive-chess/zh.md`。英文指南在 `/agent-guide/explosive-chess/en`。不带语言的 `/agent-guide/explosive-chess` 会先看 `?lang=`，再看 `Accept-Language`，否则返回英文。

在 `/play/explosive-chess`（打开爆炸棋之后的设置页）里，对局设置底部有一行：「点我，把内容发给 AI 陪你一起玩吧」。整行都是复制按钮。页面上不显示提示词。复制出来的提示词会让你按当前界面语言读取这份指南，连上之前先在对话里问人类：要不要和他们对下、要不要由你建房，还是他们已经有房间码。提示词里的指南 URL 是该页面 origin 的绝对地址。如果贴出来的提示词里已经有 WebSocket URL，就用那个 URL。

下面的例子使用 staging `wss://micromist-staging.goldeneaglepersonal.dpdns.org` 和本地 `ws://127.0.0.1:8787`。如果这份页面来自别的 host，以指南开头的 host 块或人类提示词里的 host 为准。下文 `ORIGIN` 是 host 块里的 `http`/`https` origin，`WS_ORIGIN` 是对应的 `ws`/`wss` origin。

## 端点

```
GET /ws/explosive-chess:<code>
Upgrade: websocket
```

`<code>` 是 host 选的房间号（`[a-z0-9]`，长度不限；6 位就够）。服务器会把它转成小写。裸的 `/ws/<code>` 是同一个房间（旧分享链接默认爆炸棋）。建房就是连上并 join。join 不占座位：默认角色是旁观，旁观可以看棋。要下棋，对 `red` 或 `blue` 发送 `claim_seat`（或 `sit`）。只有红蓝两个座位都有人并且都连着，对局才开始。房间里的第一条连接是配置 host（`you.canConfig`），即使当时还是旁观。Durable Object 在第一次连接时创建。没有额外的数据库。下面的 curl 只是 HTTP 路由检查。升级、`join`、占座和之后的落子都由官方客户端完成。不要再开第二条连接。

座位只有在 WebSocket 开着的时候才在线。从 `join` 到服务器推送 `game_over` 都要保持连接（如果再来一局，也保持到那一局结束）。交互客户端会替你握住连接：一个进程，直到 JSON 行的 `event` 是 `game_over` 再退出。发出 `join`、`set_config`、`claim_seat` 或把房间码告诉对方之后，都不要主动断开。不要在一次 `your_turn` 之后退出。断开或进程退出会把该座位标成离线（`room` 推送里 `connected: false`，大厅显示离线），对局不会开始。服务器可能在连接仍然开着时休眠房间；那不是断开，也不要为此重连。只有进程在 `game_over` 之前真的退出了，才用同一个 `playerId` 再运行一次收回座位。同一个 id 会回到原来的红方、蓝方或旁观。新的 id 是另一个人。

只使用文本帧。双向信封：

```json
{ "type": "join", "payload": { "playerId": "agent-a", "name": "Agent A" } }
```

如果看到文本帧 `ping` 和 `pong`，忽略它们。它们不是对局事件。

没有升级的路由检查会返回 426。这只是 HTTP 检查，不会建立可下棋的会话：

```bash
curl -s -D - -o /dev/null \
  "https://micromist-staging.goldeneaglepersonal.dpdns.org/ws/explosive-chess:demo01"
```

## 官方客户端

从同一个 host 下载一份。不要重写它。同一份程序就是交互会话；加上 `--poll` 才是无法长时间占用进程时的备用。以前那种打完一次 `your_turn` 就退出的 `ws-wait` / `ws-poll` 一次性客户端已经停用。

- `/agent-clients/explosive-chess/cli.mjs`
- `/agent-clients/explosive-chess/cli.py`

拉取到的指南顶部 host 块里有绝对地址。

```bash
curl -fsSL -o cli.mjs "$ORIGIN/agent-clients/explosive-chess/cli.mjs"
curl -fsSL -o cli.py "$ORIGIN/agent-clients/explosive-chess/cli.py"
```

Node 需要全局 `WebSocket`，需要 Node 22+。Python 只用标准库，面向常见的 Python 3.8+ 环境，不安装第三方包。Node 低于 22 时改用 Python。

`create_room` 建房，并以旁观加入。省略 `-c` 时客户端自己生成房间码。带上 `-c CODE` 则使用这个码。`join_room` 必须带 `-c CODE`，除非 `--url` 里已经有房间码。`claim_seat` 就是 `join_room` 再加必填的 `--seat`。`--seat red` 或 `--seat blue` 会在 `join` 之后发送 `claim_seat`。省略 `--seat` 就是旁观。连接并加入之后，进程留在前台。每来一条事件就打印一行短 JSON，并从 stdin 读你的着法。只有 `event` 是 `game_over`，或连接致命断开时才退出。不要为每一手重新运行。

`playerId` 存在客户端，不是服务器发的。服务器只在房间里把这个 id 映射到座位。省略 `--player-id` 时，客户端复用 `~/.config/micromist/explosive-chess-player-id`（如果设置了 `$XDG_CONFIG_HOME`，则是 `$XDG_CONFIG_HOME/micromist/explosive-chess-player-id`）。同一个 id 会收回红方、蓝方或旁观。传入 `--player-id` 只用于这一次进程，不会改写已经存下的文件。同一台机器上的第二个 Agent 要另传自己的 `--player-id`。新的 id 是另一个人：以旁观加入，并可以占一个空座位。

```bash
node cli.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name Agent --seat red create_room
node cli.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name Agent --seat red create_room -c CODE
node cli.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name Agent --seat blue join_room -c CODE
python3 cli.py --origin "$ORIGIN" --player-id PLAYER_ID --name Agent --seat blue join_room -c CODE
node cli.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name Agent --seat red claim_seat -c CODE
```

如果提示词里已经有一条完整的 WebSocket URL，用 `--url` 原样传入，不要自己再拼：

```bash
node cli.mjs --url "$WS_ORIGIN/ws/explosive-chess:CODE" --player-id PLAYER_ID --name Agent --seat blue join_room
```

如果 `you.canConfig` 为 true（你是第一条连接）而且房间还在 lobby，在第二个座位被占之前，在同一条命令上加上 `--config`：

```bash
node cli.mjs --origin "$ORIGIN" --player-id PLAYER_ID --name "Agent A" \
  --config '{"boardSize":9,"winMode":"steps","winParam":4,"hostColor":"red"}' \
  --seat red create_room -c CODE
```

先看 `joined` 行里的 `you.canConfig`，再决定能不能靠 `--config`。`you.role` 为 `"host"` 表示这个 `playerId` 是配置 host（房间里的第一条连接），不是红方座位。蓝方只有在该 id 最先连上时才是配置 host。`claim_seat` 不会授予 `canConfig`，也不会把配置 host 换人。`canConfig` 为 false 就是 guest，不能改规则。`create_room -c` 用到一个已经存在的房间码时，是加入那个房间：`joined` 行会带 `reusedRoom: true`，并且 `canConfig` 经常是 false。如果你带了 `--config` 但它用不上（`canConfig` 为 false、房间已经不是 lobby，或 `set_config` 被拒绝），客户端会在标准输出写一行 `{"event":"error","ok":false,"error":"..."}`，并且在开下之前以非 0 退出。不要在默认规则下把这局下下去。

标准输出是每行一个 JSON（日志在标准错误）。相关的行：

- `event` 为 `joined`：房间已打开。`roomCode` 是要分享的房间码。`playUrl` 是给人类的链接。
- `event` 为 `your_turn`：轮到你。`legalActions` 原样交给你。客户端不会替你选。
- `event` 为 `opponent`：对手更新。`lastOpponentMove` 是对手的着法。
- `event` 为 `game_over`：对局结束。`result` 里有 `winner`、`winnerColor` 和 `winReason`。进程随后以 0 退出。
- `event` 为 `error`：着法被拒绝，或发生致命错误。着法被拒绝时不要退出，再输入一格。`error` 为 `websocket closed` 且 `recoverable` 为 true，表示连接掉了，座位仍保留。用同一个 `--player-id` 和同一个 `--seat` 再运行一次。座位还是你的时候，下一条 `joined` 的 `reclaimed` 为 true。

每一行在已知时还会带上 `you`、`lastOpponentMove`、`legalActions` 和 `turn`。完整 `board` 只在加上 `--verbose` 时出现。

当 `event` 是 `your_turn` 时，自己从 `legalActions` 里选一项，写到 stdin。一手就是单独的 `ROW,COL` 或一个 JSON 对象，以换行或回车结束。不需要再按一次 Enter：

```text
ROW,COL
```

或一行紧凑 JSON：

```text
{"row":ROW,"col":COL}
```

客户端会发送 `{"type":"move","payload":{"row":ROW,"col":COL}}`，然后阻塞到下一次推送。让这个进程一直跑着。不要轮询。被拒绝的着法不会推进回合，也不会再推一次 `your_turn`。错误行里仍会带上你已经拿到的那份 `legalActions`。请改选另一项。

轮询备用只在无法让进程一直阻塞时使用。`--poll` 会 join，可选地发送一次 `--move`，请求一次 observation，打印一行 JSON 后退出。它不等待对手。两次调用之间座位是离线的。请复用同一个 `playerId`。这不是主路径。`--move` 只属于这个备用。

```bash
node cli.mjs --origin "$ORIGIN" --poll --player-id PLAYER_ID --name Agent join_room -c CODE --move ROW,COL
python3 cli.py --origin "$ORIGIN" --poll --player-id PLAYER_ID --name Agent join_room -c CODE --move ROW,COL
```

`--timeout` 是一次阻塞等待的秒数。交互客户端省略它时，会一直等到 `game_over` 或连接断开。轮询只等待着法确认或一次 observation 所需的时间。

## 连接

下面是官方客户端会发送的帧，用来说明协议。不要在客户端之外再开一条连接。手动查看可以用 [websocat](https://github.com/websocat/websocat)：

```bash
websocat "wss://micromist-staging.goldeneaglepersonal.dpdns.org/ws/explosive-chess:demo01"
```

```json
{"type":"join","payload":{"playerId":"agent-a","name":"Agent A","kind":"agent","game":"explosive-chess"}}
```

服务器推送（另外还有给人看的 `welcome` 和 `room`，可以忽略）。新的 id 以旁观加入。只有房间里的第一条连接 `you.canConfig` 为 true：

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

要下棋，占一个空座位。`sit` 是同一条消息。房间创建者占座后 `role` 变成 `"host"`。其他人占座后是 `"guest"`。

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

把 `roomCode` 交给另一位。对方连同一个路径，用不同的 `playerId` 发送 `join`（此时是旁观），再对空着的颜色发送 `claim_seat`。

可选，仅配置 host，一次，并且必须在第二个座位被占**之前**。官方客户端在你传入 `--config`、且 `you.canConfig` 为 true（或 `you.role` 为 `"host"`）、房间仍是 `lobby` 时会发送它。等待一条 `config` 匹配的 `room` 推送。第二个座位被占会立刻开始对局，并锁住配置。`hostColor` 只是偏好，不会把人从一个座位挪到另一个座位。

```json
{"type":"set_config","payload":{"boardSize":9,"winMode":"steps","winParam":4,"hostColor":"red"}}
```

`boardSize` 是 9、11 或 13。`hostColor` 是 `red` 或 `blue`。省略时默认 9×9、`annihilation`、host 为红。`winMode` 和 `winParam` 的含义见下面的「胜负模式」。

## 胜负模式

设置页把这一项标成「胜负」。`set_config` 传的是 `winMode` 键，不是界面名字。不要在页面上搜这些中文。只有下面三种。

**鏖战（歼灭）**（`annihilation`）。界面上也常写成「鏖战」。引擎开局不传入 `winParam`，并且从不读取它，所以没有步数上限。房间里存着的默认 50 不会结束这局。某次落子引发爆炸，并且已经至少落过 2 子之后，一方仍有自己颜色的格子、另一方这种格子已经没有，则前者获胜。界面理由是「歼灭对手所有棋子」。这种局通常很长。

**步数制**（`steps`）。`winParam` 是双方合计落子次数，界面叫「步数」，至少为 1 的整数。落子次数达到 `winParam` 后，格子更多的一方获胜，双方格子数相同则平局。界面理由是「{n} 步后占据更多面积 ({a} vs {b})」或「{n} 步后双方面积相同 ({a})」。对局在这次比较时结束。想下短局，用 `steps` 和一个小的 `winParam`。

**面积制**（`area`）。`winParam` 是目标格数，界面叫「目标格数」，至少为 1 的整数。某次落子引发爆炸，并且已经至少落过 2 子之后，格子数先达到 `winParam` 的一方获胜。同一次爆炸里双方都达到时，先判红方。界面理由是「率先占据 {n} 格」。格数在落子引发爆炸时检查。

`kind` 是 `agent` 或 `human`。省略则座位保持人类（浏览器重连会省略它，也不会把 `agent` 清掉）。kind 不改变规则。人类大厅会标出 agent 座位。官方客户端始终发送 `kind` `"agent"`。

## 下到分出胜负

对手占座之后，另一个已入座的人会收到：

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

双方接着收到 `start`。没有 ready 握手。客户端发送 `ready` 会被拒绝（`Ready is disabled; game starts with 2 players`）。`start` 表示双方都已连接，对局开始。

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

即使 `hostColor` 是 `blue`，也总是红方先手。等待 `your_turn`。它只推送给当前可以落子的座位。示例里的数组是缩短的；9×9 的 `fullState` 有 81 个数，`board` 有 9 行、每行 9 格。空棋盘上的 `legalActions` 列出每一格。

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

`fullState` 就是人类客户端已经在用的对象。`counts` 和 `colors` 按行展开：下标是 `row * boardSize + col`。数字：`0` 空、`1` 红、`2` 蓝。`currentTurn` 是 `1` 或 `2`。`board` 是同一张棋盘，带颜色名和每格的爆炸 `capacity`（角 2、边 3、中心 4）。`legalActions` 是 `isValidMove` 此刻接受的、**你的**颜色可以下的位置。选一个。不要自己编坐标。官方客户端把 `legalActions` 抄到 `your_turn` 那一行，然后等 stdin。由你来选。

可以用人类的动词，也可以用 `act`（规则相同）。官方客户端发送人类动词：

```json
{"type":"move","payload":{"row":0,"col":0}}
```

```json
{"type":"act","payload":{"type":"move","row":0,"col":0}}
```

`row` 和 `col` 是整数。双方随后都会收到 `move_applied`（落子后的棋盘）以及给人看的 `state` 帧（含动画帧；Agent 可以忽略）：

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

另一座位接着收到带新 observation 的 `your_turn`。刚下过的座位在对手落子之前**不会**再收到 `your_turn`。交互客户端会在这段时间阻塞在连接上，并在对手落子时打印一行 `opponent`。这是规定的等待方式，不是轮询。

非法着法只向该连接返回 `error`。回合不前进，也不会重发 `your_turn`。请从你已经有的 `legalActions` 里改选一项。

```json
{"type":"error","payload":{"message":"Invalid move"}}
```

其他 `error` 文案包括 `Not your turn`、`Game not in progress`、`Spectators cannot move`、`Unknown action`、`Join first`、`Only host can set config`、`Config locked after room create`、`Seat taken`、`seat must be red or blue`、`Cannot change seats after the match starts`。这些是服务器原文。

对局结束时，双方都会收到 `gameOver: true` 的 `move_applied`，以及：

```json
{
  "type": "game_over",
  "payload": { "winner": 1, "winnerColor": "red", "winReason": "4 步后占据更多面积 (2 vs 1)" }
}
```

`winner` 是人类客户端的字段（`1` 红、`2` 蓝，或 `"draw"`）。优先看 `winnerColor`：`red`、`blue` 或 `draw`。官方客户端会把这些字段抄到 JSON 结果里。

对局中，已入座的一方可以投降（不在 `legalActions` 里）：

```json
{"type":"surrender","payload":{}}
```

```json
{"type":"act","payload":{"type":"surrender"}}
```

对手获胜。`game_over` 之后，双方都可以发送 `{"type":"rematch","payload":{}}`。双方都发送后，服务器会再次推送 `start` 和 `your_turn`。官方客户端不发送 `surrender` 或 `rematch`；这里写出来是为了你能读懂服务器推送的结果。不要为此再加一个引擎。

一次性的 `{"type":"observe","payload":{}}` 会返回 `{"type":"observation","payload":{"observation":{...}}}`。加上 `--poll` 时，客户端每次运行发送一次。只在重连错过推送、或无法阻塞时使用。不要循环调用。用**同一个** `playerId` 重新 join 会收回原来的座位（红方、蓝方或旁观），服务器推送 `joined`（`reclaimed: true`）、`observation`，并且在轮到你时推送 `your_turn`。新的 id 是另一个人，以旁观加入，并可以对空着的颜色发送 `claim_seat`。两个座位都满了之后，这个新 id 继续旁观：`joined` 的 `seat` 为 `"spectator"`，没有 `your_turn`。交互客户端会打印 `event` `"spectator"` 并留在进程里，之后每一步打印 `event` `"watch"`，直到 `game_over`。`--poll` 打印一行 `spectator` 然后退出。

`peer_left` 表示对手的连接掉了。座位仍然保留。保持你的连接，对方可以重连回来。`room_closed` 表示已入座的玩家都断开了，房间被回收。

## 设置页提示词之后

人类从爆炸棋设置页 `/play/explosive-chess` 复制一条提示词。提示词只有当前界面语言。先读取提示词里的指南 URL，再在对话里提问并等待。对方回答之前不要连接。没有 MCP。

1. 要和人类对下吗？
2. 需要你来建房吗？
3. 还是对方已经有房间码？

### 对方已经有房间码

对该 host 运行 `join_room -c <code> --seat red` 或 `--seat blue`（如果提示词里已经有完整的 `<ws-origin>/ws/explosive-chess:<code>`，用 `--url` 原样传入）。客户端会以 `kind` `"agent"` 加入，游戏名是 `"explosive-chess"`，然后发送 `claim_seat`。如果 `joined` 行里 `you.canConfig` 为 true，并且你在命令上带了 `--config`、房间仍是 lobby，客户端才会发送它。你不是配置 host 时不要靠它改规则。占那个空着的座位。没有占座的人，包括只加入的人类，都是旁观（`seat: "spectator"`，没有 `your_turn`），可以看棋。人类打开 `<http-origin>/play/explosive-chess?room=<code>`，加入，再点入座。留在这个进程里，把着法写在 stdin。

### 由你建房

运行带 `--seat red` 或 `--seat blue` 的 `create_room`。省略 `-c` 会生成一个 `[a-z0-9]` 房间码，也可以自己用 `-c` 指定（6 位就够）。HTTP 检查是端点一节里的 curl。客户端会先连上，所以 `you.canConfig` 为 true。在另一个座位被占之前，在这条命令上带一次 `--config`。省略时默认 9×9 鏖战（歼灭）、host 为红。想下短局，优先 `"winMode":"steps"` 和一个小的 `winParam`。「胜负模式」一节写了「鏖战（歼灭）」「步数制」「面积制」和键的对应，以及每种模式下 `winParam` 做什么。从 `joined` 行读出 `roomCode` 和 `playUrl` 告诉人类。他们打开链接，加入，再坐到空着的颜色。你下自己占的那一边。他们入座之前保持连接：也就是 `create_room` 之后，交互客户端阻塞等待服务器推送。如果你在他们入座前断开，你的座位仍然保留，对局会一直等。

### 两个 Agent，人类不入座

如果他们想让两个 AI 对打，你是 Agent A：按上面的方式 `create_room --seat red`，并在 B 占座前带上 `--config`。把同一个房间码交给第二个 AI。Agent B 用不同的 `playerId` 运行 `join_room -c <code> --seat blue`，并且不要带 `--config`。人类和其他 Agent 可以不带 `--seat` 地 `join_room`，然后旁观。如果 B 的客户端在 `joined` 之前失败，再运行一次——A 一连接就会建房。连接在 `joined` 之前掉线时，客户端自己会重试几次。`joined` 之后它等待推送。不要轮询。

人类也可以把 `?room=<code>` 分享给另一个人。已经入座的人类点击同样是 `move` 消息。对方座位的 kind 是 `agent` 时，对局状态会显示 `vs Agent`。没有入座的人留在名单里当旁观。

每个 Agent 仍然自己从 `legalActions` 里选着法。不要把局面交给求解器。

## 仓库冒烟测试

在仓库里，对着正在运行的 worker（本地 `npm run dev`，或部署后的 staging）：

```bash
node scripts/explosive-chess-agent-duel.mjs ws://127.0.0.1:8787
node scripts/explosive-chess-agent-duel.mjs wss://micromist-staging.goldeneaglepersonal.dpdns.org
```

这是开发者用来确认两条连接能下完一局短对局的检查。它不是可下载的客户端。它会自己挑落点，只为了把服务器跑通。正在下棋的 Agent 绝不能这么做。不要复制它，不要把它扩成引擎，也不要拿它当你的选着器。下棋的 Agent 下载上面的官方客户端。该脚本需要 Node 22+ 的全局 `WebSocket`。
