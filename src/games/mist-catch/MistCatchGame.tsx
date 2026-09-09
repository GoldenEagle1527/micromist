import { useEffect, useRef } from "react";
import { useLocale } from "../../i18n";
import { createMistCatchGame } from "./createGame";

export function MistCatchGame() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { locale, t } = useLocale();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const game = createMistCatchGame(host, {
      score: t.mist.score,
      best: t.mist.best,
      lives: t.mist.lives,
      gameOver: (score) => `${t.mist.gameOver}  ·  ${score}\n${t.mist.tryAgain}`,
    });
    return () => {
      game.destroy(true);
    };
  }, [locale, t]);

  return (
    <div
      ref={hostRef}
      className="game-stage"
      aria-label={locale === "zh" ? "拾雾" : "Mist Catch"}
    />
  );
}
