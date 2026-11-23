import { useEffect } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { parseRoomId } from "../../shared/multiplayer";
import "../styles/play.css";
import { getGame } from "../games/catalog";
import { useLocale } from "../i18n";
import { GameShell } from "../platform/play";

export function PlayPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLocale();
  const parsed = parseRoomId(searchParams.get("room") ?? "");
  const roomGame = parsed?.game;
  const roomId = parsed?.roomId;
  const mismatch = Boolean(roomGame && slug && roomGame !== slug);

  useEffect(() => {
    if (!roomGame || !roomId || !slug || roomGame === slug) return;
    navigate(`/play/${roomGame}?room=${encodeURIComponent(roomId)}`, { replace: true });
  }, [roomGame, roomId, slug, navigate]);

  if (mismatch) return null;

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

  return <GameShell load={game.loadPlay} preview={game.preview} />;
}
