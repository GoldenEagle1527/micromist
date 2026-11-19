import { Link, useParams } from "react-router";
import "../styles/play.css";
import { getGame } from "../games/catalog";
import { useLocale } from "../i18n";
import { GameShell } from "../platform/play";

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

  return <GameShell key={game.slug} load={game.loadPlay} preview={game.preview} />;
}
