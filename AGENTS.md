# AGENTS.md — micromist / 微渺

给在本仓库改代码的 Cursor（或其他编程助手）用的交接说明。先读本文，再动手。面向玩家的简介见 [README.md](./README.md) 与 [README.en.md](./README.en.md)。

本文反映 **2026-11-20** 时仓库的实际情况。工作分支是 `staging`（当时尖端 `103ca84`）。正式站跟踪 `main`，当时仍停在 `2177900`，比测试站旧。

## 这是什么

开源浏览器棋盘游戏站，MIT 许可。Vite + React 19 + TypeScript SPA，部署在 **Cloudflare Workers Static Assets**（不是 Pages）。可选联机用单一 Durable Object `GameRoom` + Hibernation WebSocket，靠分享链接进房，没有公开房间大厅。

刻意不用：D1、KV、R2、自建账号或战绩库、Cloudflare Pages。Workers Free 可用，DO 必须走已有的 `new_sqlite_classes`。SQLite 只给房间抗休眠，不是用户数据库。

## 站点与分支

| | 分支 | URL | 部署命令 |
| --- | --- | --- | --- |
| 测试站 | `staging`（日常工作区、测试站的事实来源） | https://micromist-staging.goldeneaglepersonal.dpdns.org | `npm run deploy:staging` |
| 正式站 | `main`（只在发版时合并） | https://micromist.goldeneaglepersonal.dpdns.org | `npm run deploy` |

- 两个站点是**彼此独立**的 Worker（`micromist-staging` / `micromist`）和独立的 Durable Object 命名空间，房间互不相通。
- 工作目录保持在 `staging`。不要把功能直接提交到 `main`，也不要从尚未合并的 `staging` 提交部署正式站。
- 只有用户明确说「发版 / 生产 / 过审 / ship / LGTM / 通过」时，才把 `staging` merge 进 `main`、推送并 `npm run deploy`。仅仅说「部署」「上测试站」不等于发正式。
- 不要把本机 Vite 当作给用户看的预览；改完类型检查后部署测试站，让用户在测试站验收。
- 关于页可以在测试站 / 正式站之间切换。游戏是否出现在首页，由 `src/games/catalog.ts` 里的 `GameMeta.audience` 控制：`all`（默认）、`staging`（仅测试站和本地）、`prod`（仅正式站）。`listed: false` 会强制隐藏。

### 2026-11-20 两边现状（重要）

**测试站（`staging`）已有，正式站还没有：**

- 大厅回到经典玻璃卡片网格（点击进入独立的 `/play/<slug>` 页）。
- 五子棋（`gomoku`，`audience: "staging"`）：本机热座 / 对战 AI，以及分享链接联机。

**正式站仍是 2026-11-16 抹除「破阵之刃」「深潜」之后的版本：** 大厅是更早的玻璃卡片布局，只上架爆炸棋和滑动色块，没有五子棋。爆炸棋联机（分享链接）在正式站可用；滑动色块在正式站只有本机单人，没有房间 / Agent。爆炸棋与滑动色块的 Agent 适配（指南、本机 HTTP 客户端等）目前只在 `staging` / 测试站。在用户要求发版前，不要动正式站。

## 现在运营哪些游戏

站点后续**只做棋盘类**。当前三款：

| slug | 中文名 | 模式 | 上架 | 说明 |
| --- | --- | --- | --- | --- |
| `explosive-chess` | 爆炸棋 | `single-online` | 测试站 + 正式站 | 本机 AI / 热座 / 分享链接联机（两边都有）。测试站另有 Agent 适配（本机 HTTP + curl）。两座 `red` / `blue`，进房默认观战，`claim_seat` 入座，坐满开局。建房后规则冻结。 |
| `chroma-slide` | 滑动色块 | catalog 仍标 `single` | 测试站 + 正式站（正式站目前仅本机） | 本机单人滑块。测试站还可开分享链接房间，只有一个 `player` 座位（给人打或给 Agent 打），不是双人对战。Agent 适配仅测试站。 |
| `gomoku` | 五子棋 | `single-online` | **仅测试站** | 15 路自由五子棋（无禁手），黑先，连五即胜（≥5）。本机热座或对战内置 AI（easy/normal/hard）。联机同样走分享链接：进房观战，执黑 / 执白入座，坐满开局；可认输，终局双方同意再来一局。**不要**在未要求时做 Agent 适配。 |

联机座位类型是平台级的 `red` / `blue` / `player` / `spectator`。五子棋**不要**给平台加 `black` / `white` 座位；在适配器和 UI 里把 `red` 显示成黑棋、`blue` 显示成白棋即可。

分享链接必须可打开对应游戏，形如 `/play/<slug>`，联机再带 `?room=<code>`。

## 目录与真实接线

```
src/                 React SPA（壳、首页、/play、i18n、主题）
src/games/<slug>/    各游戏客户端；登记在 src/games/catalog.ts
src/pages/           HomePage、PlayPage
src/multiplayer/     共用房间客户端 OnlineRoomClient
src/platform/play/   一度计划的通用 GameShell（目前未接线）
worker/              Worker 入口、GameRoom、各游戏 adapter
shared/              SPA 与 Worker 共用的纯逻辑（棋规等）
public/agent-clients/  爆炸棋、滑动色块的官方 Node/Python HTTP 客户端
docs/                Agent WebSocket 协议（中英分文件）
```

**当前真正生效的页面路径**（2026-11-20 已恢复）：

1. 首页 `HomePage`：经典玻璃卡片网格。
2. 点击卡片 **导航** 到独立的 `/play/:slug`（不是 iframe 内嵌，也不是大厅内展开）。
3. `PlayPage` **按 slug 分支** 挂载 `ExplosiveChessGame` / `ChromaSlideGame` / `GomokuGame`。

`catalog` 里仍有 `preview` 和 `loadPlay`，那是「通用游戏壳」实验留下的字段；`src/platform/play/GameShell.tsx` **没有**接到 `PlayPage`。新增游戏时，登记 catalog 之外，还要在 `PlayPage` 挂上组件，直到有人被明确要求重新做通用壳。

棋规若联机也要用，放在 `shared/<slug>/`，客户端用 `src/games/<slug>/engine.ts` 再导出。不要让 Worker 去 import `src/`。

联机：`worker/games/<slug>/adapter.ts` + `register.ts`，并在 `worker/game-room.ts` 里 `import` 注册。不要为新游戏再加一个 Durable Object 绑定。客户端包一层 `OnlineRoomClient`（可参考 `src/games/gomoku/online.ts` 或爆炸棋的 `online.ts`）。服务端是权威状态，客户端不要做乐观更新。

单机进度用 `src/lib/game-store.ts` / `src/games/local-persist.ts`（IndexedDB 或现有封装）。**禁止**自建另一套存储。对手是联机时（`opponent === "online"` 或处于房间页）**不要**写本地进度。

## 看起来在仓库里、但当前未使用的代码

2026-11-20 用户要求撤销全部大厅进场动效，恢复最初布局。下列文件大多还在磁盘上，但已不再接到 `App` / `Shell` / `HomePage` / `PlayPage`：

- 芯片飞入、iframe 嵌入、数据流溶解：`ChipIcon.tsx`、`GameEmbed.tsx`、`EmbedBridge.tsx`、`src/lib/embed.ts` 等
- 卡片展开 / 网格滑动 / 「盗梦笔记」式网格生长：`board-expand-context.tsx`、`src/lib/board-expand.ts`、`GameShell` 相关样式

**不要擅自重新启用这些动效，也不要在没有要求时删除它们。** 用户已明确放弃：芯片飞入标题栏、数据流溶解显现、卡片展开铺满、整页网格横滑、侧边网格上抬再长出新网格。若要再做大厅动效，必须先问用户。

`package.json` 里仍有 `phaser`，当前三款游戏都没有引用它。不要为棋盘游戏无故引入 Phaser。

`wrangler.jsonc` 里还留着未再挂到公开路由的 `ExplosiveChessMcp` 绑定（历史 migration）。`/mcp` 与 `/mcp/*` 由 Worker 拦截并 404。不要把 MCP 再做成爆炸棋的主路径。

## 产品与叙事约束

- 默认中文界面；同时只显示一种语言（zh 或 en）。支持浅色 / 深色 / 跟随系统。
- 保持现有平面风格：玻璃卡片、蓝调 MD3。只做纯 2D，不要做 3D。
- 内部叙事是「航行在宇宙中的飞船，每个游戏是一个运行模块」，但这是暗含背景，**不要**在大厅或页面上画成飞船或把故事写在表面上。卡片可以有一点科幻模块质感，仍然是选游戏的平面布局。
- 暂不挂广告，暂不做赞赏。
- 验收观感由用户在测试站完成。不要用无头浏览器截图或模拟点击去「证明」看起来对；代码层的规则检查可以做。

## 绝不能做的事

下列游戏已用 `git filter-repo` 从历史中抹除，必须当作从未存在。不要恢复、提及（产品文案/大厅/注释里当新功能介绍）、继续开发或重新加入仓库：

- 破阵之刃（blade-break）
- 深潜（deep-march）
- 前线潮汐（frontline-tide）
- 视界（horizon）
- 拼图（jigsaw）
- 运维 / term-run

也不要为它们写「已下架」说明。没有用户的明确指令，不要改写 git 历史、不要 force-push。

## Agent 游玩（仅爆炸棋、滑动色块）

目前只在测试站提供。正式站的 `main` 还没有 `docs/`、`public/agent-clients/` 或 Agent 指南路由。改协议或发版时必须分清影响面，不要默认正式站已经有同一套 Agent 能力。约定：

- 官方客户端：长挂进程，监听 `127.0.0.1` 随机端口，用 curl 发请求；底层仍是房间 WebSocket。入口在 `/agent-clients/<slug>/` 的 `server.mjs` / `server.py`。
- 盘面必须是结构化观测（含 `legalActions` 等），不要让 Agent 靠截图下棋。
- 落子由 Agent 根据返回的 `legalActions` 自己选。传输层只做连房、发招、等对方，**禁止**求解器、搜索树或自动对战脚本代替下棋。
- 交给人类去复制给 AI 的提示词与指南必须中英分版，随站点当前语言只出对应语言，不要中英混在同一段。指南由 Worker 在 `/agent-guide/<slug>` 与 `/agent-guide/<slug>/zh|en` 提供，不能落到 SPA 壳。协议正文在 `docs/agent-ws-*.md`。
- 没有要求时，不要给五子棋做 Agent 适配。

## 日常改动流程

1. 在 `staging` 上改代码。提交作者用 `GoldenEagle1527` / `goldeneagleking@qq.com`。
2. 修功能或修 bug **之前**先打一个备份标签（例如 `backup-pre-<topic>`）。
3. 日常：写完代码后最多跑一次类型检查 `npm run check`（即 `tsc -b --pretty false`），然后 `git push origin staging` 并 `npm run deploy:staging`，把测试站交给用户试。
4. **不要**每次都跑完整测试套件、回归、或质量大扫描；这些只在用户明确要求时做。
5. 提交说明用区域前缀：`shell:`、`platform:`，或游戏 slug（`explosive-chess:`、`chroma-slide:`、`gomoku:`）。壳和游戏尽量拆成两次提交。
6. 做优化类工作：先分析问题、确认后再改代码，不要一上来就改。同一问题反复出现时，从源头或最初算法统一修，不要继续打补丁。
7. TypeScript 开了 `erasableSyntaxOnly` 等严格选项，不要写 constructor parameter properties。
8. 本地需要 Node.js 20.19+（或 22.12+）。`npm run dev` 会连 React 和本地 Worker 一起跑。部署需要已登录的 Wrangler。

## 新增游戏时的最低步骤

单机：在 `catalog.ts` 登记 → 在 `src/games/<slug>/` 实现 → 在 `PlayPage` 按 slug 挂载 → 补中英文案 → 如仅先上测试站，设 `audience: "staging"`。

联机：把棋规放到 `shared/<slug>/` → 写 `worker/games/<slug>/` adapter 并注册 → 客户端房间页读取 `?room=`、入座、按服务端状态渲染 → 联机过程不要写 local persist。

若现有联机约定（座位、配置冻结、开始条件）无法表达新需求，先问用户，不要在共用壳里加某个游戏的特殊分支，也不要扩展平台座位枚举来迁就一个游戏的叫法。
