import { useCallback, useEffect, useRef, useState } from "react";
import "./glyph-matrix.css";
import { useLocale } from "../../i18n";
import { createGlyphMatrixGame } from "./createGame";

type Screen = "setup" | "playing";

export function GlyphMatrixGame() {
  const { locale, t } = useLocale();
  const gm = t.glyphMatrix;

  const [screen, setScreen] = useState<Screen>("setup");
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (screen !== "playing") return;
    const host = hostRef.current;
    if (!host) return;

    const game = createGlyphMatrixGame(host, {
      labels: { hint: gm.hint },
    });

    return () => {
      game.destroy(true);
    };
  }, [screen, locale, gm.hint]);

  const start = useCallback(() => setScreen("playing"), []);
  const back = useCallback(() => setScreen("setup"), []);

  if (screen === "setup") {
    return (
      <div className="glyph-matrix glyph-setup">
        <div className="panel">
          <h2>{gm.setupTitle}</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {gm.setupHint}
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={start}>
              {gm.start}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glyph-matrix glyph-playing">
      <div className="glyph-play-bar">
        <button type="button" className="ghost" onClick={back}>
          {gm.backSetup}
        </button>
        <p className="hint glyph-play-hint">{gm.hint}</p>
      </div>
      <div
        ref={hostRef}
        className="game-stage glyph-stage"
        aria-label={gm.stageAria}
      />
    </div>
  );
}
