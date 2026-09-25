import { useCallback, useEffect, useRef, useState } from "react";
import "./deep-march.css";
import { useLocale } from "../../i18n";
import { seedFromString } from "./terrain/noise";
import { createDeepMarch, type DeepMarchHandle } from "./scene/world";
import type { CamMode } from "./scene/camera";
import { loadSettings, randomSeed, saveSettings } from "./settings";

type Screen = "setup" | "playing";

export function DeepMarchGame() {
  const { t } = useLocale();
  const dm = t.deepMarch;

  const [screen, setScreen] = useState<Screen>("setup");
  const [seed, setSeed] = useState(() => loadSettings().seed);
  const [invertPitch, setInvertPitch] = useState(() => loadSettings().invertPitch);
  const [camMode, setCamMode] = useState<CamMode>("third");
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<DeepMarchHandle | null>(null);

  useEffect(() => {
    if (screen !== "playing") return;
    const host = hostRef.current;
    if (!host) return;
    const game = createDeepMarch(host, {
      seed: seedFromString(seed || "1"),
      invertPitch,
      labels: {
        depth: dm.hudDepth,
        speed: dm.hudSpeed,
        heading: dm.hudHeading,
        chunks: dm.hudChunks,
        loading: dm.hudLoading,
        bump: dm.hudBump,
      },
      onCameraMode: setCamMode,
    });
    gameRef.current = game;
    return () => {
      gameRef.current = null;
      game.destroy();
    };
    // Labels are read once per dive; a locale switch mid-dive keeps the old HUD text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const start = useCallback(() => {
    const s = seed.trim() || "1";
    setSeed(s);
    saveSettings({ seed: s, invertPitch });
    setCamMode("third");
    setScreen("playing");
  }, [seed, invertPitch]);
  const back = useCallback(() => setScreen("setup"), []);

  const hold = (v: number) => ({
    onPointerDown: () => gameRef.current?.setThrottleHold(v),
    onPointerUp: () => gameRef.current?.setThrottleHold(0),
    onPointerLeave: () => gameRef.current?.setThrottleHold(0),
    onPointerCancel: () => gameRef.current?.setThrottleHold(0),
  });

  if (screen === "setup") {
    return (
      <div className="deep-march dm-setup">
        <div className="panel">
          <h2>{dm.setupTitle}</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {dm.setupHint}
          </p>
          <label className="dm-field">
            <span>{dm.seedLabel}</span>
            <div className="dm-seed-row">
              <input
                type="text"
                inputMode="numeric"
                maxLength={32}
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") start();
                }}
              />
              <button type="button" className="ghost" onClick={() => setSeed(randomSeed())}>
                {dm.randomSeed}
              </button>
            </div>
          </label>
          <label className="dm-check">
            <input type="checkbox" checked={invertPitch} onChange={(e) => setInvertPitch(e.target.checked)} />
            <span>{dm.invertPitch}</span>
          </label>
          <div className="row">
            <button type="button" className="primary" onClick={start}>
              {dm.start}
            </button>
          </div>
          <div className="dm-controls">
            <h3>{dm.controlsTitle}</h3>
            <ul>
              {dm.controls.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="deep-march dm-playing">
      <div className="dm-play-bar">
        <button type="button" className="ghost" onClick={back}>
          {dm.backSetup}
        </button>
        <span className="dm-seed-tag">{dm.seedNow(seed)}</span>
        <button type="button" className="ghost" onClick={() => gameRef.current?.toggleCamera()}>
          {camMode === "third" ? dm.camFirst : dm.camThird}
        </button>
        <p className="hint dm-play-hint">{dm.hint}</p>
      </div>
      <div ref={hostRef} className="game-stage dm-stage" aria-label={dm.stageAria}>
        <div className="dm-touch">
          <button type="button" {...hold(-1)} aria-label={dm.slower}>
            −
          </button>
          <button
            type="button"
            onPointerDown={() => gameRef.current?.setBoost(true)}
            onPointerUp={() => gameRef.current?.setBoost(false)}
            onPointerLeave={() => gameRef.current?.setBoost(false)}
            onPointerCancel={() => gameRef.current?.setBoost(false)}
            aria-label={dm.boost}
          >
            ⇈
          </button>
          <button type="button" {...hold(1)} aria-label={dm.faster}>
            +
          </button>
        </div>
      </div>
    </div>
  );
}
