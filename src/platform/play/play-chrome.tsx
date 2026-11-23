import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { PlayChrome } from "./types";
import "./play-chrome.css";

type PlayChromeContextValue = {
  chrome: PlayChrome | null;
  setChrome: (next: PlayChrome | null) => void;
};

const PlayChromeContext = createContext<PlayChromeContextValue | null>(null);

export function PlayChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChromeState] = useState<PlayChrome | null>(null);
  const setChrome = useCallback((next: PlayChrome | null) => {
    setChromeState((prev) => {
      if (prev === next) return prev;
      if (prev == null && next == null) return prev;
      if (prev && next && JSON.stringify(prev) === JSON.stringify(next)) return prev;
      return next;
    });
  }, []);
  const value = useMemo(() => ({ chrome, setChrome }), [chrome, setChrome]);
  return <PlayChromeContext.Provider value={value}>{children}</PlayChromeContext.Provider>;
}

export function usePlayChrome(): PlayChrome | null {
  return useContext(PlayChromeContext)?.chrome ?? null;
}

export function useSetPlayChrome(): (next: PlayChrome | null) => void {
  const ctx = useContext(PlayChromeContext);
  return ctx?.setChrome ?? noopSetChrome;
}

function noopSetChrome(_next: PlayChrome | null): void {
  /* provider missing (tests / isolated mount) */
}

function parseHex(color: string): { r: number; g: number; b: number } | null {
  const hex = color.trim();
  const short = /^#([0-9a-fA-F]{3})$/.exec(hex);
  if (short) {
    const n = short[1];
    return {
      r: Number.parseInt(n[0] + n[0], 16),
      g: Number.parseInt(n[1] + n[1], 16),
      b: Number.parseInt(n[2] + n[2], 16),
    };
  }
  const full = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!full) return null;
  const n = full[1];
  return {
    r: Number.parseInt(n.slice(0, 2), 16),
    g: Number.parseInt(n.slice(2, 4), 16),
    b: Number.parseInt(n.slice(4, 6), 16),
  };
}

function inkFor(color: string): string {
  const rgb = parseHex(color);
  if (!rgb) return "#fff";
  const luma = rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114;
  return luma > 160 ? "#1a1a1e" : "#f7f7f4";
}

function activeColor(chrome: PlayChrome): string {
  if (chrome.active === "right") return chrome.right.color;
  if (chrome.active === "left" || chrome.active === "both") return chrome.left.color;
  return chrome.left.color;
}

export function playFrameStyle(chrome: PlayChrome | null | undefined): CSSProperties | undefined {
  if (!chrome) return undefined;
  return {
    "--play-frame": activeColor(chrome),
  } as CSSProperties;
}

const INTRO_MS = 780;

export function PlayCapsule({ fallbackTitle }: { fallbackTitle: string }) {
  const chrome = usePlayChrome();
  const [intro, setIntro] = useState(false);
  const seen = useRef(false);

  useEffect(() => {
    if (!chrome) {
      seen.current = false;
      setIntro(false);
      return;
    }
    if (seen.current) return;
    seen.current = true;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    setIntro(true);
    const timer = window.setTimeout(() => setIntro(false), INTRO_MS);
    return () => window.clearTimeout(timer);
  }, [chrome]);

  if (!chrome) {
    return (
      <div className="topbar-game" aria-current="page">
        {fallbackTitle}
      </div>
    );
  }

  const title = chrome.title?.trim() || fallbackTitle;
  const notice = chrome.notice?.trim();
  const center = notice || title;
  const leftInk = inkFor(chrome.left.color);
  const rightInk = inkFor(chrome.right.color);
  const leftOn = chrome.active === "left" || chrome.active === "both";
  const rightOn = chrome.active === "right" || chrome.active === "both";

  return (
    <div
      className={`play-capsule${intro ? " play-capsule-intro" : ""}${notice ? " has-notice" : ""}`}
      style={
        {
          "--capsule-left": chrome.left.color,
          "--capsule-right": chrome.right.color,
          "--capsule-left-ink": leftInk,
          "--capsule-right-ink": rightInk,
        } as CSSProperties
      }
      data-active={chrome.active}
      aria-current="page"
      aria-label={notice ? `${title} · ${notice}` : title}
    >
      <span className={`play-capsule-half is-left${leftOn ? " is-on" : ""}`}>
        {chrome.left.value ? <span className="play-capsule-value">{chrome.left.value}</span> : null}
      </span>
      <span className={`play-capsule-title${notice ? " is-notice" : ""}`}>{center}</span>
      <span className={`play-capsule-half is-right${rightOn ? " is-on" : ""}`}>
        {chrome.right.value ? (
          <span className="play-capsule-value">{chrome.right.value}</span>
        ) : null}
      </span>
    </div>
  );
}
