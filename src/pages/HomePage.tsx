import { Link } from "react-router";
import { games } from "../games/catalog";
import { useLocale } from "../i18n";

export function HomePage() {
  const { locale, t } = useLocale();

  return (
    <>
      <section className="hero">
        <h1>{t.homeTitle}</h1>
        <p className="lede">{t.homeLede}</p>
      </section>
      <section className="grid">
        {games.map((game) => (
          <Link key={game.slug} to={`/play/${game.slug}`} className="card">
            <span className="badge">{game.badge[locale]}</span>
            <h2>{game.title[locale]}</h2>
            <p>{game.blurb[locale]}</p>
            <span className="card-cta">{t.playCta}</span>
          </Link>
        ))}
      </section>
    </>
  );
}
