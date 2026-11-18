import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { getGame } from "../games/catalog";
import { useLocale } from "../i18n";
import {
  EMBED_LOCATION,
  EMBED_PARENT_LOCATION,
  buildEmbedSrc,
  hrefOf,
  isCatalogPlayPath,
  isEmbedLocationMessage,
  sameOrigin,
  stripEmbedSearch,
} from "../lib/embed";

export type GameReveal = "off" | "streaming" | "printed";

type Props = {
  slug: string;
  reveal: GameReveal;
  /** Search/hash to bake into the iframe src at mount (deep links / rooms). */
  initialSearch?: string;
  initialHash?: string;
};

const TRACE_COUNT = 22;
const GLYPH_COLS = 15;

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

function hexColumn(rng: () => number, rows: number): string {
  return Array.from({ length: rows }, () =>
    Math.floor(rng() * 256)
      .toString(16)
      .toUpperCase()
      .padStart(2, "0"),
  ).join("\n");
}

function StreamFx({ slug }: { slug: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [originPct, setOriginPct] = useState(50);

  useLayoutEffect(() => {
    const box = rootRef.current;
    if (!box) return;
    const place = () => {
      const well = document.querySelector(".dock-well");
      if (!well) return;
      const wr = well.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      if (br.width <= 0) return;
      const pct = ((wr.left + wr.width / 2 - br.left) / br.width) * 100;
      const clamped = Math.min(92, Math.max(8, pct));
      setOriginPct(clamped);
      box.style.setProperty("--origin-x", `${pct}%`);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(box);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, []);

  const traces = useMemo(() => {
    const rng = mulberry32(seedFrom(`${slug}:traces`));
    return Array.from({ length: TRACE_COUNT }, (_, i) => {
      const t = (i / (TRACE_COUNT - 1)) * 2 - 1;
      const spread = t * 46 + (rng() - 0.5) * 3.5;
      const end = Math.min(98, Math.max(2, originPct + spread));
      const mid = originPct + spread * 0.42;
      return {
        d: `M ${originPct.toFixed(2)} 0 Q ${mid.toFixed(2)} 42, ${end.toFixed(2)} 100`,
        delay: `${(Math.abs(t) * 0.12 + rng() * 0.05).toFixed(3)}s`,
        width: i % 4 === 0 ? 1.35 : 0.9,
        dash: i % 3 === 0 ? "3 9" : "2 7",
      };
    });
  }, [originPct, slug]);

  const columns = useMemo(() => {
    const rng = mulberry32(seedFrom(`${slug}:glyphs`));
    return Array.from({ length: GLYPH_COLS }, (_, i) => {
      const t = (i / (GLYPH_COLS - 1)) * 2 - 1;
      return {
        offset: t * 42,
        delay: `${(Math.abs(t) * 0.08 + rng() * 0.06).toFixed(3)}s`,
        duration: `${(0.85 + rng() * 0.35).toFixed(2)}s`,
        text: hexColumn(rng, 36),
        dim: i % 2 === 0,
      };
    });
  }, [slug]);

  return (
    <div ref={rootRef} className="game-embed-stream" aria-hidden="true">
      <span className="game-embed-origin" />
      <svg
        className="game-embed-traces"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        fill="none"
      >
        {traces.map((trace, index) => (
          <path
            key={index}
            d={trace.d}
            pathLength={100}
            style={{
              animationDelay: trace.delay,
              strokeWidth: trace.width,
              strokeDasharray: trace.dash,
            }}
          />
        ))}
      </svg>
      <div className="game-embed-glyphs">
        {columns.map((column, index) => (
          <span
            key={index}
            className={`game-embed-col${column.dim ? " is-dim" : ""}`}
            style={{
              left: `calc(var(--origin-x, 50%) + ${column.offset}%)`,
              animationDelay: column.delay,
              animationDuration: column.duration,
            }}
          >
            {column.text}
          </span>
        ))}
      </div>
      <span className="game-embed-head" />
      <span className="game-embed-scan" />
    </div>
  );
}

export function GameEmbed({ slug, reveal, initialSearch = "", initialHash = "" }: Props) {
  const { locale } = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastFromChildRef = useRef("");
  const [src] = useState(() =>
    buildEmbedSrc(`/play/${slug}`, initialSearch, initialHash),
  );

  const game = getGame(slug);
  const title = game ? game.title[locale] : slug;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!sameOrigin(event)) return;
      if (!isEmbedLocationMessage(event.data, EMBED_LOCATION)) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isCatalogPlayPath(event.data.pathname)) return;
      // Ignore until the parent has opened this game — preload must not
      // replace the lobby URL while the chip is still flying.
      if (!isCatalogPlayPath(location.pathname)) return;
      const href = hrefOf(event.data.pathname, event.data.search, event.data.hash);
      lastFromChildRef.current = href;
      const current = hrefOf(location.pathname, location.search, location.hash);
      if (href === current) return;
      navigate(href, { replace: true });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [location, navigate]);

  useEffect(() => {
    const href = hrefOf(location.pathname, location.search, location.hash);
    if (href === lastFromChildRef.current) return;
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    if (!isCatalogPlayPath(location.pathname)) return;
    target.postMessage(
      {
        type: EMBED_PARENT_LOCATION,
        pathname: location.pathname,
        search: stripEmbedSearch(location.search),
        hash: location.hash,
      },
      window.location.origin,
    );
  }, [location.pathname, location.search, location.hash]);

  const showing = reveal === "streaming" || reveal === "printed";

  return (
    <div
      className={`game-embed${reveal === "streaming" ? " is-revealing" : ""}${reveal === "printed" ? " is-printed" : ""}${showing ? " is-on" : ""}`}
      aria-busy={reveal === "streaming"}
    >
      {reveal === "streaming" ? <StreamFx slug={slug} /> : null}
      <iframe
        ref={iframeRef}
        className="game-embed-frame"
        src={src}
        title={title}
        allow="fullscreen; autoplay; clipboard-write"
        referrerPolicy="same-origin"
      />
    </div>
  );
}
