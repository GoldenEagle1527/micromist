import { useCallback, useEffect, useRef, useState } from "react";
import "./lumen-weave.css";
import { useLocale } from "../../i18n";
import { createLumenWeaveGame } from "./createGame";
import type { LumenCruise } from "./i18n";
import { randomSeedString } from "./scene/seed";

type Screen = "setup" | "playing";

function cruiseLabel(
  t: ReturnType<typeof useLocale>["t"]["lumen"],
  id: LumenCruise,
): string {
  if (id === "slow") return t.slow;
  if (id === "fast") return t.fast;
  return t.normal;
}

export function LumenWeaveGame() {
  const { locale, t } = useLocale();
  const lw = t.lumen;

  const [screen, setScreen] = useState<Screen>("setup");
  const [seed, setSeed] = useState(() => randomSeedString());
  const [cruise, setCruise] = useState<LumenCruise>("normal");
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (screen !== "playing") return;
    const host = hostRef.current;
    if (!host) return;

    const game = createLumenWeaveGame(host, {
      seed,
      cruise,
      labels: {
        seed: lw.seed,
        biome: lw.biome,
        hint: lw.hint,
      },
      biomeName: lw.biomeName,
    });

    return () => {
      game.destroy(true);
    };
  }, [screen, seed, cruise, locale, lw]);

  const startGame = useCallback(() => {
    setScreen("playing");
  }, []);

  const backToSetup = useCallback(() => {
    setScreen("setup");
  }, []);

  const rollSeed = useCallback(() => {
    setSeed(randomSeedString());
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
              {lw.seed}
              <input
                type="text"
                value={seed}
                placeholder={lw.seedPlaceholder}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setSeed(e.target.value)}
              />
            </label>
            <button type="button" className="ghost lumen-seed-roll" onClick={rollSeed}>
              {lw.randomSeed}
            </button>
            <label>
              {lw.cruise}
              <select
                value={cruise}
                onChange={(e) => setCruise(e.target.value as LumenCruise)}
              >
                <option value="slow">{cruiseLabel(lw, "slow")}</option>
                <option value="normal">{cruiseLabel(lw, "normal")}</option>
                <option value="fast">{cruiseLabel(lw, "fast")}</option>
              </select>
            </label>
          </div>
          <p className="hint lumen-diff-blurb">{lw.cruiseBlurb(cruise)}</p>
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
