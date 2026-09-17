import { useCallback, useEffect, useRef, useState } from "react";
import "./brick-surge.css";
import { useLocale } from "../../i18n";
import { createBrickSurgeGame } from "./createGame";
import { readBestScore } from "./scores";

type Screen = "setup" | "playing";
type SpeedId = "slow" | "normal" | "fast";

function speedMul(id: SpeedId): number {
  if (id === "slow") return 0.82;
  if (id === "fast") return 1.22;
  return 1;
}

function speedLabel(
  t: ReturnType<typeof useLocale>["t"]["brickSurge"],
  id: SpeedId,
): string {
  if (id === "slow") return t.slow;
  if (id === "fast") return t.fast;
  return t.normal;
}

export function BrickSurgeGame() {
  const { locale, t } = useLocale();
  const bs = t.brickSurge;

  const [screen, setScreen] = useState<Screen>("setup");
  const [speed, setSpeed] = useState<SpeedId>("normal");
  const [best, setBest] = useState(() => readBestScore());
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (screen !== "playing") return;
    const host = hostRef.current;
    if (!host) return;

    const game = createBrickSurgeGame(host, {
      speed: speedMul(speed),
      labels: {
        score: bs.score,
        best: bs.best,
        lives: bs.lives,
        wave: bs.wave,
        mult: bs.mult,
        pause: bs.pause,
        resume: bs.resume,
        gameOver: (score) => `${bs.gameOver}  ·  ${score}\n${bs.tryAgain}`,
        clickStart: bs.clickStart,
      },
      onBestChange: (n) => setBest(n),
    });

    return () => {
      game.destroy(true);
    };
  }, [screen, speed, locale, bs]);

  const startGame = useCallback(() => {
    setBest(readBestScore());
    setScreen("playing");
  }, []);

  const backToSetup = useCallback(() => {
    setScreen("setup");
    setBest(readBestScore());
  }, []);

  if (screen === "setup") {
    return (
      <div className="brick-surge brick-setup">
        <div className="panel">
          <h2>{bs.setupTitle}</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {bs.setupHint}
          </p>
          <div className="brick-controls">
            <label>
              {bs.speed}
              <select
                value={speed}
                onChange={(e) => setSpeed(e.target.value as SpeedId)}
              >
                <option value="slow">{speedLabel(bs, "slow")}</option>
                <option value="normal">{speedLabel(bs, "normal")}</option>
                <option value="fast">{speedLabel(bs, "fast")}</option>
              </select>
            </label>
          </div>
          <p className="hint brick-diff-blurb">{bs.speedBlurb(speed)}</p>
          <p className="hint brick-best-line">{bs.bestLine(best)}</p>
          <div className="row">
            <button type="button" className="primary" onClick={startGame}>
              {bs.start}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="brick-surge brick-playing">
      <div className="brick-play-bar">
        <button type="button" className="ghost" onClick={backToSetup}>
          {bs.backSetup}
        </button>
        <p className="hint brick-play-hint">{bs.hint}</p>
      </div>
      <div
        ref={hostRef}
        className="game-stage brick-stage"
        aria-label={bs.stageAria}
      />
    </div>
  );
}
