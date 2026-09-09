# 微渺 / micromist

开源浏览器游戏平台，部署在 **Cloudflare Workers Static Assets** 上（不是 Cloudflare Pages）。

An open-source browser game platform on **Cloudflare Workers Static Assets** (not Cloudflare Pages).

单人进度只写进浏览器的 `localStorage` / IndexedDB。默认后端不持久化任何用户数据。可选的多人玩法预留了 **Durable Objects + Hibernation WebSocket**（一个房间一个 DO，内存态随房间消失）。

Single-player progress stays in the browser (`localStorage` / IndexedDB). The Worker does not persist a user database. Optional multiplayer is reserved as **one Durable Object per room** with Hibernation WebSockets; room state is in-memory and dies with the room.

License: **MIT** (see [`LICENSE`](./LICENSE)).

## Stack

| Layer | Choice |
| --- | --- |
| Language | TypeScript |
| UI | Vite + React + React Router (SPA) |
| Games | Phaser 3 |
| Hosting | Workers Static Assets via `@cloudflare/vite-plugin` |
| Future rooms | Durable Object `GameRoom`, `new_sqlite_classes` (required on Workers Free) |

Not in this repo, on purpose: D1, KV, R2, auth, analytics SDKs, Cloudflare Pages.

## Free-tier notes

Workers Static Assets requests are **free and unlimited**. SPA routes that only serve `index.html` / JS / CSS do not invoke the Worker.

The thin Worker runs only for `/ws` and `/ws/:roomId` (`run_worker_first`). Those invocations count toward **Workers Free** daily limits (currently 100,000 requests/day and 10 ms CPU per invocation).

Durable Objects are available on the free plan when created with **`new_sqlite_classes`**. This project does that so a later multiplayer room does not require a paid product. Free-plan DO limits still apply (daily request / duration / SQLite read-write caps; unused rooms should hibernate). This stub does **not** write a persistent user store — SQLite is only the required DO backend.

Do not add D1, KV, or R2 if you want to stay on the documented free-stack constraint.

## Develop

Requires Node.js 20.19+ (or 22.12+).

```bash
npm install   # or: pnpm install
npm run dev
```

Vite + the Cloudflare plugin serve the React app and the Worker (including the `GameRoom` DO) locally.

```bash
npm run typecheck   # also: npm run check
npm run build
npm run preview     # Workers runtime, from the Vite build output
```

## Deploy

```bash
npm run deploy
```

This runs `vite build` then `wrangler deploy`. You need a Cloudflare account and `wrangler` login. The generated `dist` wrangler config points `assets` at the Vite client output and keeps `not_found_handling: "single-page-application"` so React Router paths work on refresh.

SPA pages: `/`, `/play/mist-catch`, `/rooms`.

WebSocket stub: `GET /ws/:roomId` with `Upgrade: websocket` → `GameRoom`.

## Project layout

```
src/                 React SPA (home, per-game routes, rooms placeholder)
src/games/           Phaser games (Mist Catch / 拾雾 is the demo)
worker/index.ts      Upgrade /ws/:roomId to a room DO
worker/game-room.ts  Hibernation WebSocket skeleton
wrangler.jsonc       Static Assets + GAME_ROOM binding + sqlite migration
```

Add a game by registering it in `src/games/catalog.ts`, adding a React route target, and mounting a Phaser scene. Keep save data in `localStorage` or IndexedDB unless you are implementing a room.

## Scripts

| Script | What it does |
| --- | --- |
| `dev` | Vite + Wrangler local runtime |
| `build` | `tsc -b` then Vite production build |
| `deploy` | Build and `wrangler deploy` |
| `check` / `typecheck` | TypeScript project build, no emit |
| `preview` | Preview the production build in the Workers runtime |
| `cf-typegen` | Regenerate `worker-configuration.d.ts` from bindings |

## License

[MIT](./LICENSE) © 2026 GoldenEagle
