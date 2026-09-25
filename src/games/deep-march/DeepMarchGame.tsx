import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "./deep-march.css";
import { useLocale } from "../../i18n";
import { seedFromString } from "./terrain/noise";
import { createDeepMarch, type DeepMarchHandle } from "./scene/world";
import { isTouchDevice, loadSettings, panelEnabled, randomSeed, saveSettings } from "./settings";
import { ControlPanel } from "./ui/ControlPanel";

type Screen = "setup" | "playing";

export function DeepMarchGame() {
  const { t } = useLocale();
  const dm = t.deepMarch;

  const [screen, setScreen] = useState<Screen>("setup");
  const [seed, setSeed] = useState(() => loadSettings().seed);
  const [sensitivity, setSensitivity] = useState(() => loadSettings().sensitivity);
  const [invertY, setInvertY] = useState(() => loadSettings().invertY);
  const [panelOn, setPanelOn] = useState(() => panelEnabled(loadSettings()));
  const [game, setGame] = useState<DeepMarchHandle | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [touch] = useState(isTouchDevice);

  const persist = useCallback(
    (patch: Partial<{ seed: string; panel: boolean; sensitivity: number; invertY: boolean }>) => {
      const cur = loadSettings();
      saveSettings({ ...cur, ...patch });
    },
    [],
  );

  useEffect(() => {
    if (screen !== "playing") return;
    const host = hostRef.current;
    if (!host) return;
    const g = createDeepMarch(host, {
      seed: seedFromString(seed || "1"),
      sensitivity,
      invertY,
      panel: panelOn,
      labels: {
        chunks: dm.hudChunks,
        loading: dm.hudLoading,
        lockPrompt: dm.lockPrompt,
      },
    });
    setGame(g);
    return () => {
      setGame(null);
      g.destroy();
    };
    // Settings/labels are read once per dive; the panel toggle is pushed via setPanelMode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // Tall mode (touch + panel): fit the stage to the space left below the header / play bar.
  const tall = touch && panelOn && screen === "playing";
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!tall || !host) return;
    const fit = () => {
      const top = host.getBoundingClientRect().top + window.scrollY;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      host.style.setProperty("--dm-stage-h", `${Math.max(220, Math.floor(vh - top - 8))}px`);
    };
    fit();
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      host.style.removeProperty("--dm-stage-h");
    };
  }, [tall]);

  const start = useCallback(() => {
    const s = seed.trim() || "1";
    setSeed(s);
    persist({ seed: s, sensitivity, invertY, panel: panelOn });
    setScreen("playing");
  }, [seed, sensitivity, invertY, panelOn, persist]);
  const back = useCallback(() => setScreen("setup"), []);

  const togglePanel = useCallback(() => {
    setPanelOn((on) => {
      const next = !on;
      persist({ panel: next });
      if (game) {
        const p = game.panelInput;
        p.moveX = 0;
        p.moveY = 0;
        p.swimZone = false;
        p.up = false;
        p.down = false;
        p.swimLatch = false;
        game.setPanelMode(next);
      }
      return next;
    });
  }, [game, persist]);

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
          <label className="dm-field">
            <span>
              {dm.sensitivity} <b className="dm-sens-val">{sensitivity.toFixed(1)}×</b>
            </span>
            <input
              type="range"
              min={0.2}
              max={3}
              step={0.1}
              value={sensitivity}
              onChange={(e) => setSensitivity(Number(e.target.value))}
            />
          </label>
          <label className="dm-check">
            <input type="checkbox" checked={invertY} onChange={(e) => setInvertY(e.target.checked)} />
            <span>{dm.invertY}</span>
          </label>
          <label className="dm-check">
            <input type="checkbox" checked={panelOn} onChange={(e) => setPanelOn(e.target.checked)} />
            <span>
              {dm.panelToggle}
              <small className="dm-check-hint">{dm.panelToggleHint}</small>
            </span>
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
        <p className="hint dm-play-hint">{panelOn ? dm.hintPanel : dm.hint}</p>
      </div>
      <div
        ref={hostRef}
        className={`game-stage dm-stage${tall ? " dm-tall" : ""}`}
        aria-label={dm.stageAria}
      >
        <ControlPanel
          game={game}
          panelOn={panelOn}
          onTogglePanel={togglePanel}
          labels={{
            depth: dm.hudDepth,
            speed: dm.hudSpeed,
            heading: dm.hudHeading,
            stateSwim: dm.stateSwim,
            stateHover: dm.stateHover,
            contactFloor: dm.hudGrounded,
            contactCeiling: dm.hudCeiling,
            contactWall: dm.hudScrape,
            btnUp: dm.btnUp,
            btnDown: dm.btnDown,
            btnSwim: dm.btnSwim,
            btnLamp: dm.btnLamp,
            dialMove: dm.dialMove,
            showPanel: dm.showPanel,
            hidePanel: dm.hidePanel,
          }}
        />
      </div>
    </div>
  );
}
