/**
 * The dive's play layer: every dive fills the browser window ("web fullscreen",
 * the platform's .game-viewport layer). True fullscreen is the player's choice
 * (settings / the in-game menu) and needs the start click. On touch devices the
 * landscape is locked where the browser allows it; portrait falls back to a
 * CSS-rotated play area (the rotation is shared with the input code through viewRotation).
 */
import { useLayoutEffect, useEffect, useState, type CSSProperties } from "react";
import { enterFullscreen, exitFullscreen } from "../../lib/fullscreen";
import { viewRotation, type Rotation } from "./viewRotation";

/** Touch: true fullscreen if wanted, then the landscape lock (Android Chrome needs fullscreen for it; rejections are expected elsewhere, e.g. iOS). */
export async function enterLandscape(fullscreen: boolean): Promise<void> {
  if (fullscreen) await enterFullscreen();
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o?.lock?.("landscape");
  } catch {
    /* iOS Safari, desktop, or not fullscreen */
  }
}

export function leaveLandscape(): void {
  try {
    screen.orientation?.unlock?.();
  } catch {
    /* ignore */
  }
  exitFullscreen();
}

function viewportSize() {
  return { w: window.innerWidth, h: window.innerHeight };
}

export type Immersive = {
  /** Play-area rotation (touch portrait → ±90°; always 0 on desktop). */
  rot: Rotation;
  rotorStyle: CSSProperties | undefined;
  /** Turn the rotated play area the other way round. */
  flip: () => void;
};

/** `playing`: the full-window layer is up; `touch`: rotate a portrait phone's play area. */
export function useImmersive(playing: boolean, touch: boolean): Immersive {
  const [vp, setVp] = useState(viewportSize);
  const [flip, setFlip] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const onResize = () => setVp(viewportSize());
    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    const root = document.documentElement;
    root.classList.add("game-viewport-on");
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      root.classList.remove("game-viewport-on");
      leaveLandscape();
    };
  }, [playing]);
  const rot: Rotation = playing && touch && vp.h > vp.w ? (flip ? -90 : 90) : 0;
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
  return { rot, rotorStyle, flip: () => setFlip((f) => !f) };
}
