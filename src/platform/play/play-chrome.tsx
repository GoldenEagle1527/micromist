import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
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

function OverflowTitle({
  className,
  text,
  current,
}: {
  className: string;
  text: string;
  current?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const overflowing = useCallback(() => {
    const el = ref.current;
    return !!el && el.scrollWidth > el.clientWidth + 1;
  }, []);

  const show = useCallback(() => {
    if (overflowing()) setOpen(true);
  }, [overflowing]);

  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    setOpen(false);
  }, [text]);

  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current;
    const tip = tipRef.current;
    if (!el || !tip) return;
    const place = () => {
      if (!overflowing()) {
        setOpen(false);
        return;
      }
      const r = el.getBoundingClientRect();
      const pad = 8;
      const maxW = Math.min(window.innerWidth - pad * 2, 288);
      tip.style.maxWidth = `${maxW}px`;
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      let left = r.left + r.width / 2 - tw / 2;
      left = Math.min(Math.max(pad, left), window.innerWidth - tw - pad);
      let top = r.bottom + 6;
      if (top + th > window.innerHeight - pad) {
        top = Math.max(pad, r.top - th - 6);
      }
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, overflowing, text]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const onPointerEnter = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.pointerType === "mouse") show();
  };
  const onPointerLeave = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.pointerType === "mouse") hide();
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.pointerType === "mouse") return;
    show();
  };

  return (
    <>
      <span
        ref={ref}
        className={className}
        aria-current={current ? "page" : undefined}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
      >
        {text}
      </span>
      {open
        ? createPortal(
            <div
              ref={tipRef}
              className="play-overflow-tip"
              role="tooltip"
              style={{ position: "fixed", left: 0, top: 0, zIndex: 80 }}
            >
              {text}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

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
    return <OverflowTitle className="topbar-game" text={fallbackTitle} current />;
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
      <OverflowTitle
        className={`play-capsule-title${notice ? " is-notice" : ""}`}
        text={center}
      />
      <span className={`play-capsule-half is-right${rightOn ? " is-on" : ""}`}>
        {chrome.right.value ? (
          <span className="play-capsule-value">{chrome.right.value}</span>
        ) : null}
      </span>
    </div>
  );
}
