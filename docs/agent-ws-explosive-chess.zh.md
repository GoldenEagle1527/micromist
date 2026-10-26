# 爆炸棋 Agent MCP

Agent 通过 MCP 下爆炸棋（explosive-chess）。房间 WebSocket（`GameRoom`）仍是唯一的对局协议。MCP 只是薄封装：它在内部拨号 `wss://<host>/ws/explosive-chess:<code>`，握着这条连接，并转发你已经选定的着法。它不是第二套对局协议。人类网页客户端仍用自己的连接，并继续收到推送。

每一手都由你自己决定。`wait_for_turn` 返回 `your_turn` 时，从 `legalActions` 里选一项，把其中的 `row` 和 `col` 传给 `take_turn`。不要自己编坐标。

不要编写求解器、搜索树、minimax、MCTS、自动对弈循环，或任何代替你选着法的脚本。MCP 只负责传输。它没有棋力。不要把它改成引擎，也不要自己编写 WebSocket 客户端。

公开 Agent Guide（本文）：游戏站点上的 `GET /agent-guide/explosive-chess/zh`。读取这个 URL 即可，不需要 micromist 仓库。Worker 会在本文前面加上当前站点（`origin`、Agent Guide、`mcp`）。请用那个 host。请求带 `Accept: text/html` 时返回 HTML，否则正文是 `text/markdown`。同一份正文也在 `/agent-guide/explosive-chess/zh.md`。英文指南在 `/agent-guide/explosive-chess/en`。不带语言的 `/agent-guide/explosive-chess` 会先看 `?lang=`，再看 `Accept-Language`，否则返回英文。chroma-slide 没有 MCP。

在 `/play/explosive-chess`（打开爆炸棋之后的设置页）里，对局设置底部有一行：「点我，把内容发给 AI 陪你一起玩吧」。整行都是复制按钮。页面上不显示提示词。复制出来的提示词会让你按当前界面语言读取这份指南，连接 MCP，连上之前先在对话里问人类：要不要和他们对下、要不要由你建房，还是他们已经有房间码。提示词里的指南 URL 和 MCP URL 都是该页面 origin 的绝对地址。

下面的例子使用 staging `https://micromist-staging.goldeneaglepersonal.dpdns.org`。如果这份页面来自别的 host，以指南开头的 host 块或人类提示词里的 host 为准。下文 `ORIGIN` 是该 `http`/`https` origin。

## 连接 MCP

Streamable HTTP（优先）。在你的 Agent / MCP 客户端里添加这个 MCP URL：

```
https://micromist-staging.goldeneaglepersonal.dpdns.org/mcp/explosive-chess
```

示例：

```json
{
  "mcpServers": {
    "explosive-chess": {
      "url": "https://micromist-staging.goldeneaglepersonal.dpdns.org/mcp/explosive-chess"
    }
  }
}
```

只支持旧式 HTTP+SSE 的客户端使用同一 host 上的 `GET /mcp/explosive-chess/sse`。第一条 SSE 事件是 `endpoint`；向其中的地址 POST，并带上 `sessionId`。一个 MCP 会话只握一条房间连接。不要再自己开一条 WebSocket。

没有可下载的 WebSocket 客户端。不要用 curl 拉脚本，也不要自己组 `join` / `move` 帧。

## 工具

在这个 MCP 会话上调用。两次调用之间，服务器保持房间连接。

| 工具 | 何时 |
| --- | --- |
| `create_room` | 由你建房。`roomCode` 可选（`[a-z0-9]`，6 位就够）。返回 `roomCode` 和 `playUrl`。 |
| `join_room` | 人类（或 Agent A）已经有房间码。 |
| `set_config` | 仅 host，且只在 `phase` 仍是 `lobby`、对手入座之前调用一次。 |
| `wait_for_turn` | 长轮询，大约 25–55 秒（默认 30）。 |
| `take_turn` | `row` 和 `col` 必须来自上一份 `legalActions`。 |
| `get_state` | 仅调试。不是主循环。 |

`create_room` 和 `join_room` 会以 `kind` `"agent"`、`game` `"explosive-chess"` 加入。第一个入座的是 host。把 `playUrl`（`/play/explosive-chess?room=<code>`）给人类，他们在浏览器里点加入。他们操作期间你的连接保持开着。

`set_config` 参数：

```json
{"boardSize":9,"winMode":"steps","winParam":4,"hostColor":"red"}
```

`boardSize` 是 9、11 或 13。`winMode` 是 `annihilation`、`steps` 或 `area`。不调用本工具时的默认是 9×9 歼灭、host 为红。歼灭局很长；`steps` 配一个小的 `winParam` 会在落子达到该步数后结束。guest 不要调用 `set_config`。第二次调用会被拒绝。

## 对局循环

1. `create_room` 或 `join_room`。
2. 若 `you.role` 是 `"host"` 且房间仍在 lobby，调用一次 `set_config`。
3. `wait_for_turn`。
4. 若 `event` 是 `no_update`，再调用一次 `wait_for_turn`。这样叠调用，人类可以想很久。开销很小。连接保持开着。不要自己对着 WebSocket 写 sleep 循环。
5. 若 `event` 是 `your_turn`，阅读 `board`、`legalActions` 和 `rules`。自己选一个合法格子，用该 `row` 和 `col` 调用 `take_turn`。然后回到第 3 步。
6. 若 `event` 是 `game_over`，停止。`winnerColor` 为 `red`、`blue` 或 `draw`。

`take_turn` 会拒绝不在上一份 `legalActions` 里的格子，并且不会把它发出去。服务器仍拒绝的格子会以 `event` `"error"` 返回，并带上同一份 `legalActions`。请改选另一项。回合不会推进。

轮到你或对局结束时，`wait_for_turn` 返回观察字段：`board`、`legalActions`、`rules`、`publicState`、`you`、`phase`、`yourTurn`，以及等待期间对手落子时的 `lastOpponentMove`。`legalActions` 非空时 `yourTurn` 为 true。

`event` `"spectator"` 表示两个座位都已有人。`event` `"room_closed"` 表示房间里没有仍在线的入座玩家，房间被回收。

座位只有在 WebSocket 开着的时候才在线。从 `join` 到服务器推送 `game_over` 都要保持连接（如果再来一局，也保持到那一局结束）。MCP 会替你做到这一点：不要断开 MCP 会话。发出 `create_room`、`set_config` 或把房间码告诉对方之后，都不要断开。断开会把该座位标成离线（`room` 推送里 `connected: false`），对局不会开始。服务器可能在连接仍然开着时休眠房间；那不是断开，也不要为此重连。只有连接真的断了，才用同一个 `playerId` 在这个 MCP 会话上再调用 `join_room` 或 `create_room` 收回座位。

## 设置页提示之后

人类从 `/play/explosive-chess` 粘贴一条提示。先读取其中的指南 URL，连接 MCP，再在对话里提问并等待。在他们回答之前，不要调用 `create_room` 或 `join_room`。

1. 要和人类对下吗？
2. 要由你建房吗？
3. 还是他们已经有房间码？

### 他们已经有房间码

用该房间码 `join_room`，`kind` 为 `"agent"`。若 `you.role` 是 `"host"`，在对手入座前调用一次 `set_config`。若你是 `guest`，不要调用 `set_config`。一个空位就是这场对局。第三条连接是观战。人类打开 `<origin>/play/explosive-chess?room=<code>`。

### 由你建房

调用 `create_room`。你是 host。在其他人入座之前调用一次 `set_config`。把 `roomCode` 和 `playUrl` 告诉人类。他们入座期间保持 MCP 会话连接：那就是不调用 `take_turn` 的 `wait_for_turn`。若 `event` 是 `no_update`，再调用一次。如果你在他们入座前断开，你就是离线的 host，对局会一直等。

### 两个 Agent，没有人类座位

你是 Agent A：先 `create_room`，并在 B 入座前 `set_config`。把同一个房间码给 B。Agent B 用另一个 `playerId` 调用 `join_room`，并且不调用 `set_config`。如果 B 在 `joined` 之前失败，再调用一次 `join_room`。A 一连接就会把房间建出来。不要自己开连接。

人类也可以把 `?room=<code>` 分享给另一个人。人类的点击同样是 `move` 消息。对方 `kind` 为 `agent` 时，局内状态会显示 `vs Agent`。

每个 Agent 仍然自己从 `legalActions` 里选着法。不要把局面交给求解器。

## MCP 会替你发送的帧

这些帧不用你自己发。它们是工具背后的房间协议，便于你读到返回的 `error` 字符串。只使用文本帧。忽略 `ping` 和 `pong`。

```json
{"type":"join","payload":{"playerId":"agent-a","name":"Agent A","kind":"agent","game":"explosive-chess"}}
```

```json
{"type":"set_config","payload":{"boardSize":9,"winMode":"steps","winParam":4,"hostColor":"red"}}
```

```json
{"type":"move","payload":{"row":0,"col":0}}
```

服务器先推送 `joined`，并且只把 `your_turn` 推给当前可以落子的座位。`legalActions` 是服务器此刻接受的、属于你这方颜色的落点。`board` 是带颜色名和爆炸 `capacity` 的格子（角 2、边 3、中心 4）。`rules` / `publicState.config` 是对局规则。即使 `hostColor` 是 `blue`，也总是红方先手。

非法着法只向该连接返回 `error`（`Invalid move`、`Not your turn`、`Game not in progress`、`Spectators cannot move`、`Only host can set config`、`Config locked after room create`、`Join first`）。不会再推一次 `your_turn`。客户端的 `ready` 会被拒绝（`Ready is disabled; game starts with 2 players`）。

对局结束时，双方都会收到 `game_over`：`winner`（`1` 红、`2` 蓝，或 `"draw"`）、`winnerColor`，以及 `winReason`（可能是中文）。

投降和再来一局存在于这条连接上。MCP 工具不会发送它们。不要为此再写一个引擎。

## 仓库

在仓库里，stdio 进程是同一层封装（它拨号房间并握着连接）。对局中的 Agent 使用上面的托管 MCP URL。stdio 需要 Node 22+ 的全局 `WebSocket`。默认 origin 是 staging。

```bash
npm run mcp:explosive-chess
```

开发者冒烟测试：两条连接能下完一盘短局。它会自己选落点，这正是对局 Agent 不能做的事。不要复制它，也不要把它当成你的选着程序。

```bash
node scripts/explosive-chess-agent-duel.mjs ws://127.0.0.1:8787
node scripts/explosive-chess-agent-duel.mjs wss://micromist-staging.goldeneaglepersonal.dpdns.org
```
