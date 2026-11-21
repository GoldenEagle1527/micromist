import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  EMBED_LOCATION,
  EMBED_PARENT_LOCATION,
  hrefOf,
  isCatalogPlayPath,
  isEmbedLocationMessage,
  sameOrigin,
} from "../lib/embed";

function searchOf(pathname: string, search: string, hash: string): string {
  const href = hrefOf(pathname, search, hash);
  const withoutHash = hash && href.endsWith(hash) ? href.slice(0, -hash.length) : href;
  return withoutHash.slice(pathname.length);
}

/**
 * Iframe-side bridge. The child uses MemoryRouter so it cannot push browser
 * history entries. Location changes are posted to the parent, which mirrors
 * them onto the top address bar with history.replace. Parent back/forward
 * arrives here as EMBED_PARENT_LOCATION and is applied with replace.
 */
export function EmbedBridge() {
  const location = useLocation();
  const navigate = useNavigate();
  const applyingParentRef = useRef(false);
  const lastReportedRef = useRef("");

  useEffect(() => {
    if (applyingParentRef.current) {
      applyingParentRef.current = false;
    }
    if (window.parent === window.self) return;
    const href = hrefOf(location.pathname, location.search, location.hash);
    if (href === lastReportedRef.current) return;
    lastReportedRef.current = href;
    window.parent.postMessage(
      {
        type: EMBED_LOCATION,
        pathname: location.pathname,
        search: searchOf(location.pathname, location.search, location.hash),
        hash: location.hash,
      },
      window.location.origin,
    );
  }, [location]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!sameOrigin(event)) return;
      if (!isEmbedLocationMessage(event.data, EMBED_PARENT_LOCATION)) return;
      if (!isCatalogPlayPath(event.data.pathname)) return;
      const next = hrefOf(event.data.pathname, event.data.search, event.data.hash);
      const current = hrefOf(location.pathname, location.search, location.hash);
      if (next === current) return;
      applyingParentRef.current = true;
      lastReportedRef.current = next;
      navigate(next, { replace: true });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [location, navigate]);

  return null;
}
