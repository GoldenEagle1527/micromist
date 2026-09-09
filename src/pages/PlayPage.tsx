import { Link, useParams } from "react-router";
import { ExplosiveChessGame } from "../games/explosive-chess/ExplosiveChessGame";
import { MistCatchGame } from "../games/mist-catch/MistCatchGame";
import { getGame } from "../games/catalog";

export function PlayPage() {
  const { slug } = useParams();
  const game = slug ? getGame(slug) : undefined;

  if (!game) {
    return (
      <section className="hero">
        <h1>没有这款游戏</h1>
        <p className="lede">
          目录里还没有 <code>{slug}</code>。<Link to="/">回首页</Link>
        </p>
      </section>
    );
  }

  return (
    <>
      {game.slug === "mist-catch" ? <MistCatchGame /> : null}
      {game.slug === "explosive-chess" ? <ExplosiveChessGame /> : null}
    </>
  );
}
