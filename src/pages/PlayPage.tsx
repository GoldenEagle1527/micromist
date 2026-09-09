import { Link, useParams } from "react-router";
import { ExplosiveChessGame } from "../games/explosive-chess/ExplosiveChessGame";
import { MistCatchGame } from "../games/mist-catch/MistCatchGame";
import { getGame } from "../games/catalog";
import { useLocale } from "../i18n";

export function PlayPage() {
  const { slug } = useParams();
  const { t } = useLocale();
  const game = slug ? getGame(slug) : undefined;

  if (!game) {
    return (
      <section className="hero">
        <h1>{t.playMissingTitle}</h1>
        <p className="lede">
          {t.playMissingBody(slug ?? "")} <Link to="/">{t.playMissingLink}</Link>
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
