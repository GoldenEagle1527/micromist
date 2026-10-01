/**
 * True fullscreen (the Fullscreen API) for game pages — game-agnostic. Entering
 * needs a user gesture (call it inside the click); every call is best effort:
 * unsupported browsers (iPhone Safari) and refusals resolve to false, never throw.
 * The game's "web fullscreen" (its render container filling the viewport) is
 * CSS only: `.game-viewport` in styles/play.css.
 */

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: (opts?: FullscreenOptions) => Promise<void> | void };

/** The browser can put an element into true fullscreen at all. */
export function fullscreenSupported(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.documentElement as FsEl;
  return (document.fullscreenEnabled ?? false) || typeof el.webkitRequestFullscreen === "function";
}

export function isFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  const d = document as FsDoc;
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

/** Enter true fullscreen (default: the whole page). Must run inside a user gesture. */
export async function enterFullscreen(el: HTMLElement = document.documentElement): Promise<boolean> {
  if (isFullscreen()) return true;
  const e = el as FsEl;
  try {
    if (typeof e.requestFullscreen === "function") await e.requestFullscreen({ navigationUI: "hide" });
    else if (typeof e.webkitRequestFullscreen === "function") await e.webkitRequestFullscreen();
    else return false;
    return isFullscreen();
  } catch {
    return false;
  }
}

export function exitFullscreen(): void {
  if (!isFullscreen()) return;
  const d = document as FsDoc;
  try {
    if (typeof d.exitFullscreen === "function") d.exitFullscreen().catch(() => {});
    else void d.webkitExitFullscreen?.();
  } catch {
    /* already out */
  }
}

/** Fires on every enter / leave, including the browser's own Esc / back gesture. Returns the unsubscribe. */
export function onFullscreenChange(cb: (on: boolean) => void): () => void {
  const h = () => cb(isFullscreen());
  document.addEventListener("fullscreenchange", h);
  document.addEventListener("webkitfullscreenchange", h);
  return () => {
    document.removeEventListener("fullscreenchange", h);
    document.removeEventListener("webkitfullscreenchange", h);
  };
}
