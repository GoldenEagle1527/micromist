import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import "./deep-march.css";
import { useLocale } from "../../i18n";
import { seedFromString } from "./terrain/noise";
import { createDeepMarch, type DeepMarchHandle, type HudLabels } from "./scene/world";
import type { DeepMarchDict } from "./i18n";
import { isTouchDevice, loadSettings, panelEnabled, saveSettings, type SoundSettings } from "./settings";
import { ControlPanel, type PanelLabels } from "./ui/ControlPanel";
import { viewRotation, type Rotation } from "./viewRotation";
import { acquireAudioContext, audioDisabledByUrl, closeAudioContext, releaseAudioContext } from "./scene/audioContext";
import { LoadingScreen, type LoadingLabels } from "./ui/loading/LoadingScreen";
import type { OpenIntent } from "./conserve";
import type { GameMode } from "./modes/gameMode";
import { useConserveDive } from "./modes/useConserveDive";
import { SetupScreen, type SetupValues } from "./ui/setup/SetupScreen";

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
    lockPrompt: dm.lockPrompt,
    gpuLost: dm.gpuLost,
    shaderFailed: dm.shaderFailed,
  };
}

function loadingLabels(dm: DeepMarchDict): LoadingLabels {
  return { ...dm.loading, regionNames: dm.regionNames, lightModes: dm.lightModes, mapCache: dm.expedition.mapCache };
}

function panelLabels(dm: DeepMarchDict): PanelLabels {
  return {
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
    battery: dm.hudBattery,
    lightOff: dm.lightOff,
    lightModes: dm.lightModes,
    batteryEmpty: dm.batteryEmpty,
    batteryCharging: dm.batteryCharging,
    btnUp: dm.btnUp,
    btnDown: dm.btnDown,
    btnSwim: dm.btnSwim,
    btnLamp: dm.btnLamp,
    dialMove: dm.dialMove,
    showPanel: dm.showPanel,
    hidePanel: dm.hidePanel,
    exit: dm.exit,
    flip: dm.flip,
    mute: dm.mute,
    unmute: dm.unmute,
    expedition: dm.expedition,
  };
}

export function DeepMarchGame() {
  const { t } = useLocale();
  const dm = t.deepMarch;

  const [screen, setScreen] = useState<Screen>("setup");
  const [mode, setMode] = useState<GameMode>(() => loadSettings().mode);
  const [seed, setSeed] = useState(() => loadSettings().seed);
  const [sensitivity, setSensitivity] = useState(() => loadSettings().sensitivity);
  const [invertY, setInvertY] = useState(() => loadSettings().invertY);
  const [panelOn, setPanelOn] = useState(() => panelEnabled(loadSettings()));
  const [sound, setSound] = useState<SoundSettings>(() => loadSettings().sound);
  /** This dive has an audio context (false: ?audio=0 or no Web Audio) → no mute button. */
  const [audioOn, setAudioOn] = useState(false);
  const [game, setGame] = useState<DeepMarchHandle | null>(null);
  const [loadingOn, setLoadingOn] = useState(true);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  // one AudioContext per page session (audioContext.ts): closed when the game unmounts
  useEffect(() => {
    return () => {
      audioCtxRef.current = null;
      closeAudioContext();
    };
  }, []);
  const [touch] = useState(isTouchDevice);

  const persist = useCallback(
    (patch: Partial<{ mode: GameMode; seed: string; panel: boolean; sensitivity: number; invertY: boolean; sound: SoundSettings }>) => {
      const cur = loadSettings();
      saveSettings({ ...cur, ...patch });
    },
    [],
  );

  // Conserve mode: the world save is opened first (the dive's seed comes from it)
  const [intent, setIntent] = useState<OpenIntent | null>(null);
  const [slotRefresh, setSlotRefresh] = useState(0);
  const { dive: conserveDive, onDiveBegun } = useConserveDive(screen === "playing" ? intent : null);
  const conservePlay = intent !== null;
  const diveSeed = !conservePlay ? seed || "1" : conserveDive.status === "open" ? conserveDive.seedText : null;
  const diveSteps = !conservePlay ? undefined : "steps" in conserveDive ? conserveDive.steps : null;
  // conserve: the bounded 10 × 10 world of the save's current generation; free: endless (null)
  const diveWorld = conservePlay && conserveDive.status === "open" ? conserveDive.world : null;
  // conserve: the generation's expedition (nodes, tank, lost caches); the free dive has none
  const diveExpedition = conservePlay && conserveDive.status === "open" ? conserveDive.expedition : null;

  useEffect(() => {
    if (screen !== "playing" || diveSeed === null) return;
    const host = hostRef.current;
    if (!host) return;
    setLoadingOn(true);
    // let the loading screen paint first: world creation (spawn search) is synchronous
    let g: DeepMarchHandle | null = null;
    let timer = 0;
    const raf = requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        g = createDeepMarch(host, {
          seed: seedFromString(diveSeed),
          sensitivity,
          invertY,
          panel: panelOn,
          labels: hudLabels(dm),
          audioContext: audioCtxRef.current,
          sound: soundRef.current,
          onMuteToggle: () => toggleMuteRef.current(),
          world: diveWorld,
          expedition: diveExpedition,
        });
        setGame(g);
      }, 0);
    });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      setGame(null);
      g?.destroy();
      // after the world's audio lifecycle is gone (it would resume it): suspended, reused next dive
      releaseAudioContext();
    };
    // Settings/labels are read once per dive; the panel toggle is pushed via setPanelMode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, diveSeed, diveWorld, diveExpedition]);

  // Volume / mute: live into the running dive, persisted
  const soundRef = useRef(sound);
  soundRef.current = sound;
  useEffect(() => {
    game?.setSound(sound);
  }, [game, sound]);
  const changeSound = useCallback(
    (next: SoundSettings) => {
      setSound(next);
      persist({ sound: next });
    },
    [persist],
  );
  const toggleMute = useCallback(() => {
    const next = { ...soundRef.current, muted: !soundRef.current.muted };
    soundRef.current = next;
    // apply now, inside the click / key gesture (unmuting resumes the context)
    game?.setSound(next);
    changeSound(next);
  }, [game, changeSound]);
  const toggleMuteRef = useRef(toggleMute);
  toggleMuteRef.current = toggleMute;

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

  const start = useCallback((conserveIntent: OpenIntent | null) => {
    const s = seed.trim() || "1";
    setSeed(s);
    setIntent(conserveIntent);
    persist({ mode, seed: s, sensitivity, invertY, panel: panelOn, sound });
    if (touch) void enterLandscape();
    setLoadingOn(true);
    // inside the click: acquire (or reuse) the shared context and resume it; never throws
    audioCtxRef.current = audioDisabledByUrl(window.location.search) ? null : acquireAudioContext();
    setAudioOn(audioCtxRef.current !== null);
    setScreen("playing");
  }, [mode, seed, sensitivity, invertY, panelOn, sound, persist, touch]);
  const back = useCallback(() => {
    leaveLandscape();
    audioCtxRef.current = null;
    setScreen("setup");
    setIntent(null);
    setSlotRefresh((n) => n + 1);
  }, []);

  const setupValues: SetupValues = { mode, seed, sensitivity, invertY, panelOn, sound };
  const changeSetup = useCallback(
    (patch: Partial<SetupValues>) => {
      if (patch.mode !== undefined) {
        setMode(patch.mode);
        persist({ mode: patch.mode });
      }
      if (patch.seed !== undefined) setSeed(patch.seed);
      if (patch.sensitivity !== undefined) setSensitivity(patch.sensitivity);
      if (patch.invertY !== undefined) setInvertY(patch.invertY);
      if (patch.panelOn !== undefined) setPanelOn(patch.panelOn);
      if (patch.sound !== undefined) changeSound(patch.sound);
    },
    [persist, changeSound],
  );

  const loadingDone = useCallback(() => {
    setLoadingOn(false);
    onDiveBegun();
  }, [onDiveBegun]);
  const loadingScreen =
    loadingOn && diveSteps !== null ? (
      <LoadingScreen game={game} seedText={diveSeed ?? ""} seed={seedFromString(diveSeed ?? "")} labels={loadingLabels(dm)} steps={diveSteps} onDone={loadingDone} />
    ) : null;
  const conserveFailed = conservePlay && conserveDive.status === "failed" ? <div className="dm-mode-failed">{dm.setup.moduleFailed}</div> : null;

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
        p.absorb = false;
        p.recall = false;
        game.setPanelMode(next);
      }
      return next;
    });
  }, [game, persist]);

  if (screen === "setup") {
    return <SetupScreen dm={dm} values={setupValues} onChange={changeSetup} slotRefresh={slotRefresh} onStart={start} />;
  }

  if (immersive) {
    return createPortal(
      <div className="deep-march dm-immersive">
        <div className="dm-rotor" data-rot={rot} style={rotorStyle}>
          <div ref={hostRef} className="game-stage dm-stage" aria-label={dm.stageAria}>
            {loadingScreen}
            {conserveFailed}
            <ControlPanel
              game={game}
              panelOn={panelOn}
              onTogglePanel={togglePanel}
              onExit={back}
              onFlip={rot !== 0 ? () => setFlip((f) => !f) : undefined}
              muted={audioOn ? sound.muted : undefined}
              onToggleMute={toggleMute}
              labels={panelLabels(dm)}
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
        <span className="dm-seed-tag">{dm.seedNow(diveSeed ?? seed)}</span>
        <p className="hint dm-play-hint">
          {panelOn ? dm.hintPanel : dm.hint}
          {diveExpedition ? (panelOn ? dm.expedition.hintPanel : dm.expedition.hint) : null}
        </p>
      </div>
      <div ref={hostRef} className="game-stage dm-stage" aria-label={dm.stageAria}>
        {loadingScreen}
        {conserveFailed}
        <ControlPanel
          game={game}
          panelOn={panelOn}
          onTogglePanel={togglePanel}
          muted={audioOn ? sound.muted : undefined}
          onToggleMute={toggleMute}
          labels={panelLabels(dm)}
        />
      </div>
    </div>
  );
}
