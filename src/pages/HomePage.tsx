import { Link } from "react-router";
import { games } from "../games/catalog";

export function HomePage() {
  return (
    <>
      <section className="hero">
        <h1>微渺</h1>
        <p className="lede">
          micromist 是一个开源浏览器游戏平台：前端跑在 Cloudflare Workers Static Assets
          上，单人进度只存在本机。联机靠分享链接进入房间（Durable Objects +
          WebSocket），不设公开房间列表；人走了房间也就回收。
        </p>
      </section>
      <section className="grid">
        {games.map((game) => (
          <Link key={game.slug} to={`/play/${game.slug}`} className="card">
            <span className="badge">单人 · local</span>
            <h2>
              {game.titleZh} / {game.title}
            </h2>
            <p>
              {game.blurbZh}
              <br />
              {game.blurb}
            </p>
            <span className="card-cta">开始玩</span>
          </Link>
        ))}
      </section>
    </>
  );
}
