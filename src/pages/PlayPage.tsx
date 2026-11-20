import { Link, useParams } from "react-router";
import "../styles/play.css";
import { useBoardGrid } from "../components/board-expand-context";
import { getGame } from "../games/catalog";
import { useLocale } from "../i18n";
import { GameShell } from "../platform/play";

function MissingPlay({ slug }: { slug?: string }) {
  const { t } = useLocale();
  const { cardStyle } = useBoardGrid(1);
  return (
    <section className="board-ink" style={cardStyle(0)}>
      <h2>{t.playMissingTitle}</h2>
      <p>
        {t.playMissingBody(slug ?? "")} <Link to="/">{t.playMissingLink}</Link>
      </p>
    </section>
  );
}

export function PlayPage() {
  const { slug } = useParams();
  const game = slug ? getGame(slug) : undefined;
  if (!game) return <MissingPlay slug={slug} />;
  return <GameShell key={game.slug} load={game.loadPlay} preview={game.preview} />;
}
