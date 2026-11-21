import { useEffect, useRef, useState } from "react";
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

type Props = {
  slug: string;
  /** Search/hash to bake into the iframe src at mount (deep links / rooms). */
  initialSearch?: string;
  initialHash?: string;
};

export function GameEmbed({
  slug,
  initialSearch = "",
  initialHash = "",
}: Props) {
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
      // replace the lobby URL while the card is still expanding.
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

  return (
    <div className="game-embed is-on">
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
