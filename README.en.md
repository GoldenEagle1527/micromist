# micromist / 微渺

[中文](./README.md)

An open-source browser game platform on **Cloudflare Workers Static Assets** (not Cloudflare Pages).

Offline progress stays in the browser (`localStorage` / IndexedDB). The Worker does **not** persist a user account or score database by default. Optional multiplayer uses **Durable Objects + Hibernation WebSockets**: one DO per room, join via share link, no public lobby; rooms recycle when both seats are offline.

License: **MIT** (see [`LICENSE`](./LICENSE)).

Live:

- Custom domain: https://micromist.572003.xyz
- Fallback: `*.workers.dev`

## Stack

| Layer | Choice |
| --- | --- |
| Language | TypeScript |
| Shell / routing | Vite + React + React Router (SPA) |
| Game rendering | Phaser 3 (as needed; DOM/Canvas is fine too) |
| Hosting | Workers Static Assets (`@cloudflare/vite-plugin`) |
| Multiplayer | Single Durable Object `GameRoom`, `new_sqlite_classes` (Workers Free) |

Intentionally **not** used: D1, KV, R2, auth, Cloudflare Pages.

The client also ships light i18n (one language at a time) and light / dark / system theme.

## Free-tier notes

Workers Static Assets requests are **free and unlimited**. SPA routes that only serve `index.html` / JS / CSS do not invoke the Worker.

The thin Worker mainly handles `/ws` and `/ws/*` (`run_worker_first`); those invocations count toward Workers Free daily request and CPU limits.

Durable Objects are available on the free plan when created with **`new_sqlite_classes`**. This repo already does that. SQLite is only the DO runtime backend (e.g. short-lived room persistence across hibernation), **not** a user or history store. Empty rooms should hibernate and recycle.

Do not add D1, KV, or R2 if you want to stay on the documented free stack.

## Architecture

- **Catalog & routes**: the home page lists published games; `/play/:slug` opens a title. Games with settings use a separate setup page, then the play page.
- **Listing**: register metadata in `src/games/catalog.ts`; set `listed: false` to unlist temporarily while keeping the code.
- **Shared multiplayer shell**: one `GameRoom` plus per-`gameSlug` adapters; room ids look like `gameSlug:code`. Server-authoritative state; no client optimistic updates. Rules are chosen before create and frozen afterward; join only via share link.
- **Offline**: state and scores stay on-device; the Worker does not store them.

## Develop

Requires Node.js 20.19+ (or 22.12+).

```bash
npm install
npm run dev
```

Vite + the Cloudflare plugin serve the React app and the Worker (including `GameRoom`) locally.

```bash
npm run typecheck   # or: npm run check
npm run build
npm run preview     # Workers runtime, from the Vite build output
```

## Deploy

```bash
npm run deploy
```

Runs `vite build` then `wrangler deploy`. You need a Cloudflare account and `wrangler` login. The generated config points assets at the client build and keeps `not_found_handling: "single-page-application"` so client routes survive refresh.

WebSocket: `GET /ws/:roomId` with `Upgrade: websocket` → `GameRoom`.

## Project layout

```
src/                 React SPA (shell, home, /play, i18n, theme)
src/games/           Per-game clients and catalog
worker/              Worker entry, GameRoom, game adapters
shared/              Pure logic shared by SPA and Worker (as needed)
wrangler.jsonc       Static Assets + GAME_ROOM + sqlite migration
```

Add an offline game: register it in `catalog` → implement the play UI → mount it from `/play` by slug. Prefer on-device storage for progress.

Add multiplayer: implement `worker/games/<slug>/adapter.ts`, register it on the shared `GameRoom`, and wire the client to the shared online shell. Do not create a new DO binding per game.

## Scripts

| Script | What it does |
| --- | --- |
| `dev` | Vite + local Workers runtime |
| `build` | `tsc -b` then Vite production build |
| `deploy` | Build and `wrangler deploy` |
| `check` / `typecheck` | TypeScript project check |
| `preview` | Preview the production build in the Workers runtime |
| `cf-typegen` | Regenerate `worker-configuration.d.ts` from bindings |

## License

[MIT](./LICENSE) © 2026 GoldenEagle
