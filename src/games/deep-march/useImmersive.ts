/**
 * Immersive landscape play on touch devices: fullscreen + landscape lock where
 * the browser allows it; portrait falls back to a CSS-rotated play area (the
 * rotation is shared with the input code through viewRotation).
 */
import { useLayoutEffect, useEffect, useState, type CSSProperties } from "react";
import { viewRotation, type Rotation } from "./viewRotation";

/** Best effort: fullscreen + landscape lock (Android Chrome). Rejections are expected elsewhere (iOS). */
export async function enterLandscape(): Promise<void> {
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

export function leaveLandscape(): void {
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

export type Immersive = {
  /** Play-area rotation (portrait → ±90°). */
  rot: Rotation;
  rotorStyle: CSSProperties | undefined;
  /** Turn the rotated play area the other way round. */
  flip: () => void;
};

export function useImmersive(immersive: boolean): Immersive {
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
  return { rot, rotorStyle, flip: () => setFlip((f) => !f) };
}
