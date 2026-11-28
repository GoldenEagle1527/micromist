# AGENTS.md — micromist / 微渺

给在本仓库改代码的 Cursor（或其他编程助手）用的交接说明：**这里只记现状和目录，不写必须遵守的规范。** 规范在 [`.cursor/rules/`](./.cursor/rules/)，按主题拆成规则；先对上对应规则再动手。面向玩家的简介见 [README.md](./README.md) 与 [README.en.md](./README.en.md)。

本文反映 **2026-11-21** 时仓库的实际情况。工作分支是 `staging`。正式站跟踪 `main`，已合入大厅壳、滑动色块联机与五子棋。

## 规则在哪

| 文件 | 管什么 |
| --- | --- |
| [workflow.mdc](./.cursor/rules/workflow.mdc) | 分支、提交、检查、部署 |
| [product.mdc](./.cursor/rules/product.mdc) | 产品、界面、动效、验收 |
| [stack.mdc](./.cursor/rules/stack.mdc) | 托管栈、存储、Durable Object |
| [play-platform.mdc](./.cursor/rules/play-platform.mdc) | 对局壳、catalog、新增游戏、本地进度 |
| [grid-board.mdc](./.cursor/rules/grid-board.mdc) | 共用棋盘壳 |
| [multiplayer.mdc](./.cursor/rules/multiplayer.mdc) | 联机房间、座位、adapter |
| [agent-play.mdc](./.cursor/rules/agent-play.mdc) | Agent 入口、指南、观测 |

## 这是什么

开源浏览器棋盘游戏站，MIT 许可。Vite + React 19 + TypeScript SPA，部署在 **Cloudflare Workers Static Assets**（不是 Pages）。可选联机用单一 Durable Object `GameRoom` + Hibernation WebSocket，靠分享链接进房，没有公开房间大厅。

当前栈没有 D1、KV、R2、自建账号或战绩库。Workers Free 可用；Durable Object 使用已有的 `new_sqlite_classes`。SQLite 只给房间抗休眠。

## 站点与分支

| | 分支 | URL | 部署命令 |
| --- | --- | --- | --- |
| 测试站 | `staging`（日常工作区、测试站的事实来源） | https://micromist-staging.goldeneaglepersonal.dpdns.org | `npm run deploy:staging` |
| 正式站 | `main`（只在发版时合并） | https://micromist.goldeneaglepersonal.dpdns.org | `npm run deploy` |

两个站点是彼此独立的 Worker（`micromist-staging` / `micromist`）和独立的 Durable Object 命名空间，房间互不相通。关于页可以在测试站 / 正式站之间切换。游戏是否出现在首页，由 `src/games/catalog.ts` 里的 `GameMeta.audience` 控制：`all`（默认）、`staging`（仅测试站和本地）、`prod`（仅正式站）。`listed: false` 会强制隐藏。

### 2026-11-21 两边现状

测试站与正式站同一套大厅（玻璃卡片 → `/play/<slug>`）和三款棋盘游戏。五子棋已上正式首页（catalog 默认 `all`）。爆炸棋 / 滑动色块的 Agent 适配（`docs/`、`public/agent-clients/`、指南路由）两边都有代码；房间仍分属两个独立 Durable Object 命名空间。

## 现在运营哪些游戏

当前三款：

| slug | 中文名 | 模式 | 上架 | 说明 |
| --- | --- | --- | --- | --- |
| `explosive-chess` | 爆炸棋 | `single-online` | 测试站 + 正式站 | 人机（内置电脑）/ 同屏双人 / 分享链接联机。两座 `red` / `blue`，进房默认观战，`claim_seat` 入座，坐满开局。建房后规则冻结。跟 AI 玩走首页卡片。 |
| `chroma-slide` | 滑动色块 | catalog 仍标 `single` | 测试站 + 正式站 | 本机单人滑块，也可开分享链接房间，只有一个 `player` 座位，不是双人对战。 |
| `gomoku` | 五子棋 | `single-online` | 测试站 + 正式站 | 15 路自由五子棋（无禁手），黑先，连五即胜（≥5）。同屏双人或人机对战（easy/normal/hard）。联机同样走分享链接：进房观战，执黑 / 执白入座，坐满开局；可认输，终局双方同意再来一局。座位仍是 `red`（黑）/ `blue`（白）。 |

联机座位类型是平台级的 `red` / `blue` / `player` / `spectator`。分享链接形如 `/play/<slug>?room=<slug>:<code>`。

## 目录与真实接线

```
src/                 React SPA（壳、首页、/play、i18n、主题）
src/games/<slug>/    各游戏客户端；登记在 src/games/catalog.ts
src/pages/           HomePage、PlayPage、AgentPage（/agent）
src/multiplayer/     共用房间客户端 OnlineRoomClient
src/platform/play/   通用 GameShell（PlayPage 只挂这个壳）
worker/              Worker 入口、GameRoom、各游戏 adapter
shared/              SPA 与 Worker 共用的纯逻辑（棋规等）
public/agent-clients/  官方 Node/Python HTTP 客户端
docs/                Agent WebSocket 协议（中英分文件）
```

**当前真正生效的页面路径**：

1. 首页 `HomePage`：经典玻璃卡片网格。
2. 点击卡片导航到独立的 `/play/:slug`（不是 iframe 内嵌，也不是大厅内展开）。
3. `PlayPage` 用 catalog 的 `preview` + `loadPlay` 挂载 `GameShell`。
4. 各游戏在 `src/games/<slug>/play.ts` 实现 `GameSession`：菜单 / HUD / 房间 / 弹层走快照，棋盘通过 `bindBoard(host)` 挂进去。棋盘实现是 `src/platform/play/grid-board.ts`。

## 看起来在仓库里、但当前未使用的代码

2026-11-20 用户要求撤销全部大厅进场动效，恢复最初布局。下列文件大多还在磁盘上，但已不再接到 `App` / `Shell` / `HomePage` / `PlayPage`：

- 芯片飞入、iframe 嵌入、数据流溶解：`ChipIcon.tsx`、`GameEmbed.tsx`、`EmbedBridge.tsx`、`src/lib/embed.ts` 等
- 卡片展开 / 网格滑动 / 「盗梦笔记」式网格生长：`board-expand-context.tsx`、`src/lib/board-expand.ts`（`GameShell` 已改成独立 `/play` 玻璃布局，不再依赖这套展开网格）

`package.json` 里仍有 `phaser`，当前三款游戏都没有引用它。

`wrangler.jsonc` 里还留着未再挂到公开路由的 `ExplosiveChessMcp` 绑定（历史 migration）。`/mcp` 与 `/mcp/*` 由 Worker 拦截并 404。

## Agent 游玩（现状）

入口是首页卡片「跟 AI 玩」→ `/agent`，展示一段可复制文本。官方客户端是 `/agent-clients/server.mjs` 与 `server.py`。游戏列表与规则由 Worker 的 `GET /agent-guide` 提供。协议正文在 `docs/agent-ws-*.md`。
