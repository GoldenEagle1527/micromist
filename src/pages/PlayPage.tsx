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

  const hint =
    game.slug === "explosive-chess"
      ? "点击棋盘落子；叠满容量会爆炸并连锁改色。红方先手。设置改完后点「新游戏」。"
      : "方向键或 A/D 移动；也可按住指针拖动。最高分写入 localStorage，不会上传。";

  return (
    <>
      <div className="play-header">
        <div>
          <h1>
            {game.titleZh} / {game.title}
          </h1>
          <p className="hint">{hint}</p>
        </div>
        <Link to="/">← 游戏列表</Link>
      </div>
      {game.slug === "mist-catch" ? <MistCatchGame /> : null}
      {game.slug === "explosive-chess" ? <ExplosiveChessGame /> : null}
    </>
  );
}
