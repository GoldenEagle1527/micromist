# 微渺 / micromist

[English](./README.en.md)

开源浏览器游戏平台，部署在 **Cloudflare Workers Static Assets** 上（不是 Cloudflare Pages）。

单机进度只写进浏览器的 `localStorage` / IndexedDB。默认后端**不**持久化用户账号或战绩库。可选联机使用 **Durable Objects + Hibernation WebSocket**：一个房间对应一个 DO，靠分享链接加入，不设公开房间大厅；双方离线后房间回收。

许可证：**MIT**（见 [`LICENSE`](./LICENSE)）。

线上：

- 自定义域：https://micromist.goldeneaglepersonal.dpdns.org
- 备用：`*.workers.dev`

## 技术栈

| 层 | 选型 |
| --- | --- |
| 语言 | TypeScript |
| 壳 / 路由 | Vite + React + React Router（SPA） |
| 游戏渲染 | Phaser 3（按需；纯 DOM/Canvas 亦可） |
| 托管 | Workers Static Assets（`@cloudflare/vite-plugin`） |
| 联机 | 单一 Durable Object `GameRoom`，`new_sqlite_classes`（Workers Free 可用） |

刻意**不**使用：D1、KV、R2、账号体系、Cloudflare Pages。

前端还包含轻量 i18n（同时只显示一种语言）与浅色 / 深色 / 跟随系统主题。

## Free 套餐注意

Workers Static Assets 的静态资源请求**免费且不计次数**。只提供 `index.html` / JS / CSS 的 SPA 路径不会跑 Worker。

薄 Worker 主要在 `/ws`、`/ws/*` 上拦截（`run_worker_first`），计入 Workers Free 每日调用与 CPU 配额。

Durable Objects 在免费计划可用，但创建时需使用 **`new_sqlite_classes`**。本仓库已按此配置；SQLite 仅作 DO 运行时后端（例如房间短暂持久化以防休眠丢状态），**不是**用户库或历史战绩库。空房间应休眠并回收。

若要保持「文档里的免费栈」，请勿再加 D1 / KV / R2。

## 架构要点

- **目录与路由**：首页列出已上架游戏；`/play/:slug` 进入具体玩法。带设置的游戏采用「设置页 → 游玩页」分离。
- **上架控制**：`src/games/catalog.ts` 登记元数据；可用 `listed: false` 暂时下架（代码可保留）。
- **联机共用壳**：单一 `GameRoom` + 按 `gameSlug` 注册 adapter；房间 id 形如 `gameSlug:code`。服务端权威状态，客户端不做乐观更新。建房前选定规则，建房后配置冻结；加入仅靠分享链接。
- **单机**：状态与成绩留在本机，不经 Worker 落库。

## 本地开发

需要 Node.js 20.19+（或 22.12+）。

```bash
npm install
npm run dev
```

Vite + Cloudflare 插件会同时跑 React 与 Worker（含 `GameRoom`）。

```bash
npm run typecheck   # 或 npm run check
npm run build
npm run preview     # 用 Workers 运行时预览构建产物
```

## 部署

```bash
npm run deploy
```

即 `vite build` 后 `wrangler deploy`。需 Cloudflare 账号并已 `wrangler login`。构建产物会把 assets 指到客户端输出，并保持 `not_found_handling: "single-page-application"`，刷新子路径可用。

WebSocket：`GET /ws/:roomId`（`Upgrade: websocket`）→ `GameRoom`。

## 目录结构

```
src/                 React SPA（壳、首页、/play、i18n、主题）
src/games/           各游戏客户端与 catalog
worker/              Worker 入口与 GameRoom / 游戏 adapter
shared/              可在 SPA 与 Worker 间共用的纯逻辑（按需）
wrangler.jsonc       Static Assets + GAME_ROOM + sqlite migration
```

新增游戏（单机）：在 `catalog` 登记 → 实现玩法组件 → 在 `/play` 按 slug 挂载。进度优先写本机存储。

新增联机：写 `worker/games/<slug>/adapter.ts` 并注册到共用 `GameRoom`，客户端接共享联机壳；勿为每个游戏新建 DO 绑定。

## 脚本

| 脚本 | 作用 |
| --- | --- |
| `dev` | Vite + 本地 Workers 运行时 |
| `build` | `tsc -b` + Vite 生产构建 |
| `deploy` | 构建并 `wrangler deploy` |
| `check` / `typecheck` | TypeScript 检查 |
| `preview` | 用 Workers 运行时预览生产构建 |
| `cf-typegen` | 按绑定重新生成 `worker-configuration.d.ts` |

## 许可证

[MIT](./LICENSE) © 2026 GoldenEagle
