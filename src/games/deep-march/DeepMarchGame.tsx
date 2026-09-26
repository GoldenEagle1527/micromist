import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import "./deep-march.css";
import { useLocale } from "../../i18n";
import { seedFromString } from "./terrain/noise";
import { createDeepMarch, type DeepMarchHandle, type HudLabels } from "./scene/world";
import type { DeepMarchDict } from "./i18n";
import { isTouchDevice, loadSettings, panelEnabled, randomSeed, saveSettings } from "./settings";
import { ControlPanel } from "./ui/ControlPanel";
import { viewRotation, type Rotation } from "./viewRotation";

/** Best effort: fullscreen + landscape lock (Android Chrome). Rejections are expected elsewhere (iOS). */
async function enterLandscape(): Promise<void> {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && typeof el.requestFullscreen === "function") {
      await el.requestFullscreen({ navigationUI: "hide" });
    }
  } catch {
    /* not allowed / unsupported */
  }
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o?.lock?.("landscape");
  } catch {
    /* iOS Safari, desktop, or not fullscreen */
  }
}

function leaveLandscape(): void {
  try {
    screen.orientation?.unlock?.();
  } catch {
    /* ignore */
  }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function viewportSize() {
  return { w: window.innerWidth, h: window.innerHeight };
}

type Screen = "setup" | "playing";

function hudLabels(dm: DeepMarchDict): HudLabels {
  return {
    chunks: dm.hudChunks,
    floaters: dm.hudFloaters,
    tris: dm.hudTris,
    mainThread: dm.hudMainThread,
    classify: dm.hudClassify,
    spawnDebugTitle: dm.spawnDebugTitle,
    surfaceTypes: dm.surfaceTypes,
    regionDebugTitle: dm.regionDebugTitle,
    regionNames: dm.regionNames,
    regionEdge: dm.regionEdge,
    loading: dm.hudLoading,
    lockPrompt: dm.lockPrompt,
  };
}

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
      labels: hudLabels(dm),
    });
    setGame(g);
    return () => {
      setGame(null);
      g.destroy();
    };
    // Settings/labels are read once per dive; the panel toggle is pushed via setPanelMode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // Language switches mid-dive: push the new strings into the canvas overlay / debug legend.
  useEffect(() => {
    game?.setLabels(hudLabels(dm));
  }, [game, dm]);

  // Immersive landscape play on touch devices; portrait falls back to a CSS-rotated play area.
  const immersive = touch && screen === "playing";
  const [vp, setVp] = useState(viewportSize);
  const [flip, setFlip] = useState(false);
  useEffect(() => {
    if (!immersive) return;
    const onResize = () => setVp(viewportSize());
    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    document.documentElement.classList.add("dm-immersive-on");
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      document.documentElement.classList.remove("dm-immersive-on");
      leaveLandscape();
    };
  }, [immersive]);
  const rot: Rotation = immersive && vp.h > vp.w ? (flip ? -90 : 90) : 0;
  useLayoutEffect(() => {
    viewRotation.deg = rot;
    viewRotation.w = vp.w;
    viewRotation.h = vp.h;
    return () => {
      viewRotation.deg = 0;
    };
  }, [rot, vp.w, vp.h]);
  const rotorStyle: CSSProperties | undefined =
    rot === 90
      ? { width: vp.h, height: vp.w, transform: `translateX(${vp.w}px) rotate(90deg)` }
      : rot === -90
        ? { width: vp.h, height: vp.w, transform: `translateY(${vp.h}px) rotate(-90deg)` }
        : undefined;

  const start = useCallback(() => {
    const s = seed.trim() || "1";
    setSeed(s);
    persist({ seed: s, sensitivity, invertY, panel: panelOn });
    if (touch) void enterLandscape();
    setScreen("playing");
  }, [seed, sensitivity, invertY, panelOn, persist, touch]);
  const back = useCallback(() => {
    leaveLandscape();
    setScreen("setup");
  }, []);

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

  if (immersive) {
    return createPortal(
      <div className="deep-march dm-immersive">
        <div className="dm-rotor" data-rot={rot} style={rotorStyle}>
          <div ref={hostRef} className="game-stage dm-stage" aria-label={dm.stageAria}>
            <ControlPanel
              game={game}
              panelOn={panelOn}
              onTogglePanel={togglePanel}
              onExit={back}
              onFlip={rot !== 0 ? () => setFlip((f) => !f) : undefined}
              labels={{
                depth: dm.hudDepth,
                speed: dm.hudSpeed,
                heading: dm.hudHeading,
                stateSwim: dm.stateSwim,
                stateHover: dm.stateHover,
                contactFloor: dm.hudGrounded,
                contactCeiling: dm.hudCeiling,
                contactWall: dm.hudScrape,
                terrainTitle: dm.hudTerrain,
                terrain: dm.terrainKinds,
                regionTitle: dm.hudRegion,
                regions: dm.regionNames,
                btnUp: dm.btnUp,
                btnDown: dm.btnDown,
                btnSwim: dm.btnSwim,
                btnLamp: dm.btnLamp,
                dialMove: dm.dialMove,
                showPanel: dm.showPanel,
                hidePanel: dm.hidePanel,
                exit: dm.exit,
                flip: dm.flip,
              }}
            />
          </div>
        </div>
      </div>,
      document.body,
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
      <div ref={hostRef} className="game-stage dm-stage" aria-label={dm.stageAria}>
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
                terrainTitle: dm.hudTerrain,
                terrain: dm.terrainKinds,
                regionTitle: dm.hudRegion,
                regions: dm.regionNames,
            btnUp: dm.btnUp,
            btnDown: dm.btnDown,
            btnSwim: dm.btnSwim,
            btnLamp: dm.btnLamp,
            dialMove: dm.dialMove,
            showPanel: dm.showPanel,
            hidePanel: dm.hidePanel,
            exit: dm.exit,
            flip: dm.flip,
          }}
        />
      </div>
    </div>
  );
}
