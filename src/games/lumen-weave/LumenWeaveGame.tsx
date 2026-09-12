import { useCallback, useEffect, useRef, useState } from "react";
import "./lumen-weave.css";
import { useLocale } from "../../i18n";
import { createLumenWeaveGame } from "./createGame";
import type { LumenDifficulty } from "./i18n";
import { readBestScore } from "./scores";

type Screen = "setup" | "playing";

function difficultyLabel(
  t: ReturnType<typeof useLocale>["t"]["lumen"],
  id: LumenDifficulty,
): string {
  if (id === "easy") return t.easy;
  if (id === "hard") return t.hard;
  return t.normal;
}

export function LumenWeaveGame() {
  const { locale, t } = useLocale();
  const lw = t.lumen;

  const [screen, setScreen] = useState<Screen>("setup");
  const [difficulty, setDifficulty] = useState<LumenDifficulty>("normal");
  const [best, setBest] = useState(() => readBestScore());
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (screen === "setup") setBest(readBestScore());
  }, [screen]);

  useEffect(() => {
    if (screen !== "playing") return;
    const host = hostRef.current;
    if (!host) return;

    const game = createLumenWeaveGame(host, {
      difficulty,
      labels: {
        score: lw.score,
        best: lw.best,
        lives: lw.lives,
        nearMiss: lw.nearMiss,
        gameOver: lw.gameOver,
        tryAgain: lw.tryAgain,
        hint: lw.hint,
      },
      onBestChange: (next) => setBest(next),
    });

    return () => {
      game.destroy(true);
    };
  }, [screen, difficulty, locale, lw]);

  const startGame = useCallback(() => {
    setScreen("playing");
  }, []);

  const backToSetup = useCallback(() => {
    setBest(readBestScore());
    setScreen("setup");
  }, []);

  if (screen === "setup") {
    return (
      <div className="lumen-weave lumen-setup">
        <div className="panel">
          <h2>{lw.setupTitle}</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {lw.setupHint}
          </p>
          <div className="lumen-controls">
            <label>
              {lw.difficulty}
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as LumenDifficulty)}
              >
                <option value="easy">{difficultyLabel(lw, "easy")}</option>
                <option value="normal">{difficultyLabel(lw, "normal")}</option>
                <option value="hard">{difficultyLabel(lw, "hard")}</option>
              </select>
            </label>
          </div>
          <p className="hint lumen-diff-blurb">{lw.difficultyBlurb(difficulty)}</p>
          <p className="lumen-best-line">
            {lw.bestLabel}
            {": "}
            <strong>{best > 0 ? lw.bestValue(best) : lw.emptyBest}</strong>
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={startGame}>
              {lw.start}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lumen-weave lumen-playing">
      <div className="lumen-play-bar">
        <button type="button" className="ghost" onClick={backToSetup}>
          {lw.backSetup}
        </button>
        <p className="hint lumen-play-hint">{lw.hint}</p>
      </div>
      <div
        ref={hostRef}
        className="game-stage lumen-stage"
        aria-label={lw.stageAria}
      />
    </div>
  );
}
