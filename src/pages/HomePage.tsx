import { Link } from "react-router";
import { games } from "../games/catalog";

export function HomePage() {
  return (
    <>
      <section className="hero">
        <h1>微渺</h1>
        <p className="lede">
          micromist 是一个开源浏览器游戏平台：前端跑在 Cloudflare Workers Static Assets
          上，单人进度只存在本机。以后的联机房间会用 Durable Objects + Hibernation
          WebSocket，房间散了状态也就散了。
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
            <span className="card-cta">开始玩 →</span>
          </Link>
        ))}
        <Link to="/rooms" className="card">
          <span className="badge soon">即将 · stub</span>
          <h2>同雾房间 / Shared rooms</h2>
          <p>
            预留的多人路径：每个房间一个 Durable Object，Hibernation WebSocket
            维持连接。现在只有回声骨架，没有用户库。
          </p>
          <span className="card-cta">查看占位 →</span>
        </Link>
      </section>
    </>
  );
}
