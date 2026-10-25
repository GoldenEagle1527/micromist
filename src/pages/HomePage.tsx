import { Link } from "react-router";
import { listedGames } from "../games/catalog";
import { useLocale } from "../i18n";

export function HomePage() {
  const { locale, t } = useLocale();

  return (
    <section className="grid">
      {listedGames().map((game) => (
        <Link key={game.slug} to={`/play/${game.slug}`} className="card">
          <span className="badge">{game.badge[locale]}</span>
          <h2>{game.title[locale]}</h2>
          <p>{game.blurb[locale]}</p>
          <span className="card-cta">{t.playCta}</span>
        </Link>
      ))}
    </section>
  );
}
