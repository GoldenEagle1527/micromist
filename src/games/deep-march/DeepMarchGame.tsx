import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./deep-march.css";
import { useLocale } from "../../i18n";
import { seedFromString } from "./terrain/noise";
import { createDeepMarch, type DeepMarchHandle } from "./scene/world";
import { fullscreenEnabled, isTouchDevice, loadSettings, panelEnabled, saveSettings, takeTip, type SoundSettings } from "./settings";
import { enterFullscreen, exitFullscreen, fullscreenSupported, isFullscreen, onFullscreenChange } from "../../lib/fullscreen";
import { ControlPanel } from "./ui/ControlPanel";
import { acquireAudioContext, closeAudioContext, releaseAudioContext } from "./scene/audioContext";
import { diveParams } from "./scene/dive/params";
import { useDebugModule } from "./modes/debugLoader";
import { LoadingScreen } from "./ui/loading/LoadingScreen";
import type { OpenIntent } from "./conserve";
import type { GameMode } from "./modes/gameMode";
import { useConserveDive } from "./modes/useConserveDive";
import { SetupScreen, type SetupValues } from "./ui/setup/SetupScreen";
import { hudLabels, loadingLabels, panelLabels } from "./gameLabels";
import { enterLandscape, leaveLandscape, useImmersive } from "./useImmersive";

type Screen = "setup" | "playing";

export function DeepMarchGame() {
  const { t } = useLocale();
  const dm = t.deepMarch;

  const [screen, setScreen] = useState<Screen>("setup");
  const [mode, setMode] = useState<GameMode>(() => loadSettings().mode);
  const [seed, setSeed] = useState(() => loadSettings().seed);
  const [sensitivity, setSensitivity] = useState(() => loadSettings().sensitivity);
  const [invertY, setInvertY] = useState(() => loadSettings().invertY);
  const [calmLights, setCalmLights] = useState(() => loadSettings().calmLights);
  const [panelOn, setPanelOn] = useState(() => panelEnabled(loadSettings()));
  const [sound, setSound] = useState<SoundSettings>(() => loadSettings().sound);
  /** Go true fullscreen when a dive starts (the dive fills the window either way). */
  const [fullscreen, setFullscreen] = useState(() => fullscreenEnabled(loadSettings()));
  /** True fullscreen is on right now (Esc / the browser can leave it any time). */
  const [fsActive, setFsActive] = useState(isFullscreen);
  useEffect(() => onFullscreenChange(setFsActive), []);
  /** This dive has an audio context (false: sound off in the debug panel, or no Web Audio) → no mute button. */
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
  // staging builds only (modes/debugLoader.ts): the debug panel and its port factory
  const debugMod = useDebugModule();
  const debugRef = useRef(debugMod);
  debugRef.current = debugMod;
  /** Bumped by the debug panel's restart of a free dive (conserve restarts re-open the save). */
  const [diveEpoch, setDiveEpoch] = useState(0);
  /** A debug restart re-acquired the audio context in its click: the old dive's teardown must not suspend it. */
  const keepAudioRef = useRef(false);

  const persist = useCallback(
    (patch: Partial<{ mode: GameMode; seed: string; panel: boolean; sensitivity: number; invertY: boolean; calmLights: boolean; sound: SoundSettings; fullscreen: boolean }>) => {
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
  // conserve (M5): the base (buildings, storage, energy)
  const diveBase = conservePlay && conserveDive.status === "open" ? conserveDive.base : null;
  // conserve (M7): the tide
  const diveTide = conservePlay && conserveDive.status === "open" ? conserveDive.tide : null;
  // conserve (M8): the generation's chaos (or the debug panel's preview)
  const diveChaos = conservePlay && conserveDive.status === "open" ? conserveDive.chaos : null;
  // the sonar scan record: conserve keeps it in the save; the free dive in this session (world.ts default)
  const diveScans = conservePlay && conserveDive.status === "open" ? conserveDive.scans : null;

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
          base: diveBase,
          tide: diveTide,
          chaos: diveChaos,
          scans: diveScans,
          calmLights,
          debug: debugRef.current?.createDebugPort ?? null,
          firstTime: takeTip,
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
      if (!keepAudioRef.current) releaseAudioContext();
      keepAudioRef.current = false;
    };
    // Settings/labels are read once per dive; the panel toggle is pushed via setPanelMode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, diveSeed, diveWorld, diveExpedition, diveBase, diveTide, diveChaos, diveScans, diveEpoch]);

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

  // Every dive fills the browser window (web fullscreen); touch portrait falls back to a CSS-rotated play area.
  const playing = screen === "playing";
  const { rot, rotorStyle, flip } = useImmersive(playing, touch);

  const start = useCallback((conserveIntent: OpenIntent | null) => {
    const s = seed.trim() || "1";
    setSeed(s);
    setIntent(conserveIntent);
    persist({ mode, seed: s, sensitivity, invertY, calmLights, panel: panelOn, sound, fullscreen });
    // inside the click: true fullscreen needs the gesture
    if (touch) void enterLandscape(fullscreen);
    else if (fullscreen) void enterFullscreen();
    setLoadingOn(true);
    // inside the click: acquire (or reuse) the shared context and resume it; never throws
    audioCtxRef.current = diveParams().noAudio ? null : acquireAudioContext();
    setAudioOn(audioCtxRef.current !== null);
    setScreen("playing");
  }, [mode, seed, sensitivity, invertY, calmLights, panelOn, sound, fullscreen, persist, touch]);
  // debug panel: rebuild the dive with its new overrides (inside the click: the audio context may resume)
  const restartDive = useCallback(() => {
    if (diveParams().noAudio) releaseAudioContext();
    audioCtxRef.current = diveParams().noAudio ? null : acquireAudioContext();
    keepAudioRef.current = audioCtxRef.current !== null;
    setAudioOn(audioCtxRef.current !== null);
    if (intent) setIntent({ kind: "continue" });
    else setDiveEpoch((n) => n + 1);
  }, [intent]);
  const back = useCallback(() => {
    leaveLandscape();
    audioCtxRef.current = null;
    setScreen("setup");
    setIntent(null);
    setSlotRefresh((n) => n + 1);
  }, []);

  const setupValues: SetupValues = { mode, seed, sensitivity, invertY, calmLights, panelOn, sound, fullscreen };
  const changeSetup = useCallback(
    (patch: Partial<SetupValues>) => {
      if (patch.mode !== undefined) {
        setMode(patch.mode);
        persist({ mode: patch.mode });
      }
      if (patch.seed !== undefined) setSeed(patch.seed);
      if (patch.sensitivity !== undefined) setSensitivity(patch.sensitivity);
      if (patch.invertY !== undefined) setInvertY(patch.invertY);
      if (patch.calmLights !== undefined) {
        setCalmLights(patch.calmLights);
        persist({ calmLights: patch.calmLights });
      }
      if (patch.panelOn !== undefined) setPanelOn(patch.panelOn);
      if (patch.fullscreen !== undefined) {
        setFullscreen(patch.fullscreen);
        persist({ fullscreen: patch.fullscreen });
      }
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
  // staging: the debug panel, opened from the ≡ menu (or ` on desktop)
  const [debugSignal, setDebugSignal] = useState(0);
  const [debugOpen, setDebugOpen] = useState(false);
  const debugPanel = debugMod ? (
    <debugMod.DebugPanel game={game} conserve={conservePlay} onRestart={restartDive} openSignal={debugSignal} onOpenChange={setDebugOpen} />
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

  // the ≡ menu's switch (a click: entering is allowed); Esc leaving it only updates the switch
  const toggleFullscreen = useCallback(() => {
    const next = !isFullscreen();
    if (next) {
      if (touch) void enterLandscape(true);
      else void enterFullscreen();
    } else exitFullscreen();
    setFullscreen(next);
    persist({ fullscreen: next });
  }, [touch, persist]);
  const menuSound = useCallback(
    (next: SoundSettings) => {
      soundRef.current = next;
      // inside the click / drag: unmuting resumes the context
      game?.setSound(next);
      changeSound(next);
    },
    [game, changeSound],
  );

  if (screen === "setup") {
    return <SetupScreen dm={dm} values={setupValues} onChange={changeSetup} slotRefresh={slotRefresh} onStart={start} />;
  }

  // Layer 2 (styles/play.css): the platform's full-window layer; the stage inside is the render container.
  return createPortal(
    <div className="deep-march dm-immersive game-viewport">
      <div className="dm-rotor" data-rot={rot} style={rotorStyle}>
        <div ref={hostRef} className="game-stage dm-stage" aria-label={dm.stageAria}>
          {loadingScreen}
          {conserveFailed}
          {debugPanel}
          <ControlPanel
            game={game}
            panelOn={panelOn}
            onTogglePanel={togglePanel}
            onExit={back}
            onFlip={rot !== 0 ? flip : undefined}
            sound={audioOn ? { ...sound, onChange: menuSound } : undefined}
            fullscreen={fullscreenSupported() ? { on: fsActive, toggle: toggleFullscreen } : undefined}
            seed={diveSeed ?? seed}
            onDebug={debugMod ? () => setDebugSignal((n) => n + 1) : undefined}
            debugOpen={debugOpen}
            labels={panelLabels(dm)}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
