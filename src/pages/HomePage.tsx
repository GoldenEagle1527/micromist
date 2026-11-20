import { useEffect } from "react";
import { Link } from "react-router";
import { CardFx } from "../components/ChipIcon";
import {
  useBoardExpand,
  useBoardGrid,
} from "../components/board-expand-context";
import { listedGames, prefetchPlayModules } from "../games/catalog";
import { useLocale } from "../i18n";

export function HomePage() {
  const { locale, t } = useLocale();
  const { openFromCard, currentSlug, fadeOthers, fadeSeed } = useBoardExpand();
  const games = listedGames();
  const { cardStyle, places } = useBoardGrid(games.length);

  useEffect(() => {
    prefetchPlayModules();
  }, []);

  return (
    <>
      {games.map((game, index) => (
        <Link
          key={game.slug}
          to={`/play/${game.slug}`}
          className={`card${fadeOthers && (fadeSeed || game.slug !== currentSlug) ? " is-leaving" : ""}`}
          data-game={game.slug}
          style={cardStyle(index)}
          onClick={(event) => {
            if (event.defaultPrevented) return;
            if (event.button !== 0) return;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
              return;
            }
            event.preventDefault();
            openFromCard(game.slug, places[index]);
          }}
        >
          <CardFx />
          <span className="card-head">
            <span className="badge">{game.badge[locale]}</span>
          </span>
          <h2>{game.title[locale]}</h2>
          <p>{game.blurb[locale]}</p>
          <span className="card-cta">{t.playCta}</span>
        </Link>
      ))}
    </>
  );
}
