import { Link } from "react-router";
import { CardFx } from "../components/ChipIcon";
import {
  useBoardExpand,
  useBoardGrid,
} from "../components/board-expand-context";
import { listedGames } from "../games/catalog";
import { useLocale } from "../i18n";

export function HomePage() {
  const { locale, t } = useLocale();
  const { openFromCard, ghostSlug } = useBoardExpand();
  const games = listedGames();
  const { boardStyle, cardStyle } = useBoardGrid(games.length);

  return (
    <section className="grid" style={boardStyle}>
      {games.map((game, index) => {
        const className = [
          "card",
          ghostSlug === game.slug ? "is-ghost" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <Link
            key={game.slug}
            to={`/play/${game.slug}`}
            className={className}
            data-game={game.slug}
            style={cardStyle(index)}
            onClick={(event) => {
              if (event.defaultPrevented) return;
              if (event.button !== 0) return;
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                return;
              }
              event.preventDefault();
              openFromCard(game.slug, event.currentTarget);
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
        );
      })}
    </section>
  );
}
