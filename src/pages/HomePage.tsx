import { Link } from "react-router";
import { CardFx, ChipIcon } from "../components/ChipIcon";
import { useChipFly } from "../components/chip-fly-context";
import { listedGames } from "../games/catalog";
import { useLocale } from "../i18n";

export function HomePage() {
  const { locale, t } = useLocale();
  const { openFromCard, ghostSlug, dimOthers } = useChipFly();

  return (
    <section className="grid">
      {listedGames().map((game) => {
        const className = [
          "card",
          ghostSlug === game.slug ? "is-ghost" : "",
          dimOthers && ghostSlug !== game.slug ? "is-away" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <Link
            key={game.slug}
            to={`/play/${game.slug}`}
            className={className}
            data-game={game.slug}
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
              <ChipIcon />
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
