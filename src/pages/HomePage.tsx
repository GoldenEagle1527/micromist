import { Link } from "react-router";
import { HomeAgentInvite } from "../games/explosive-chess/HomeAgentInvite";
import { listedGames, type GameMeta } from "../games/catalog";
import { useLocale, type Locale } from "../i18n";

function GameCard({ game, locale, cta }: { game: GameMeta; locale: Locale; cta: string }) {
  return (
    <Link to={`/play/${game.slug}`} className="card">
      <span className="badge">{game.badge[locale]}</span>
      <h2>{game.title[locale]}</h2>
      <p>{game.blurb[locale]}</p>
      <span className="card-cta">{cta}</span>
    </Link>
  );
}

export function HomePage() {
  const { locale, t } = useLocale();
  const ex = t.explosive;
  const games = listedGames();
  const featured = games.find((game) => game.slug === "explosive-chess");
  const rest = featured ? games.filter((game) => game.slug !== featured.slug) : games;

  return (
    <div className="home">
      {featured ? (
        <div className="home-featured">
          <GameCard game={featured} locale={locale} cta={t.playCta} />
          <HomeAgentInvite
            line={ex.agentInviteLine}
            copyLabel={ex.agentInviteCopy}
            copiedLabel={ex.agentInviteCopied}
            failedLabel={ex.agentInviteFailed}
          />
        </div>
      ) : null}
      <section className="grid">
        {rest.map((game) => (
          <GameCard key={game.slug} game={game} locale={locale} cta={t.playCta} />
        ))}
      </section>
    </div>
  );
}
