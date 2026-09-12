import { Link, useParams } from "react-router";
import "../styles/play.css";
import { ExplosiveChessGame } from "../games/explosive-chess/ExplosiveChessGame";
import { ChromaSlideGame } from "../games/chroma-slide/ChromaSlideGame";
import { BladeBreakGame } from "../games/blade-break/BladeBreakGame";
import { PotteryGame } from "../games/pottery/PotteryGame";
import { MistCatchGame } from "../games/mist-catch/MistCatchGame";
import { LumenWeaveGame } from "../games/lumen-weave/LumenWeaveGame";
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
      {game.slug === "chroma-slide" ? <ChromaSlideGame /> : null}
      {game.slug === "blade-break" ? <BladeBreakGame /> : null}
      {game.slug === "pottery" ? <PotteryGame /> : null}
      {game.slug === "lumen-weave" ? <LumenWeaveGame /> : null}
    </>
  );
}
