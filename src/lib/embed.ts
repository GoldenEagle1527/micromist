/** Same-origin game-module embed: parent shell + iframe, chrome-less child. */

import { getGame } from "../games/catalog";

export const EMBED_QUERY = "embed";
export const EMBED_LOCATION = "micromist:embed-location";
export const EMBED_PARENT_LOCATION = "micromist:parent-location";

export type EmbedLocationPayload = {
  type: typeof EMBED_LOCATION | typeof EMBED_PARENT_LOCATION;
  pathname: string;
  search: string;
  hash: string;
};

export function isEmbeddedFrame(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function hasEmbedFlag(search = typeof window !== "undefined" ? window.location.search : ""): boolean {
  try {
    return new URLSearchParams(search.startsWith("?") || search === "" ? search : `?${search}`).get(EMBED_QUERY) === "1";
  } catch {
    return false;
  }
}

export function playSlugFromPath(pathname: string): string | undefined {
  const match = pathname.match(/^\/play\/([^/]+)\/?$/);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function isCatalogPlayPath(pathname: string): boolean {
  const slug = playSlugFromPath(pathname);
  return Boolean(slug && getGame(slug));
}

/** True only inside an iframe for a catalog game (or an explicit embed flag). */
export function isGameEmbedSession(): boolean {
  if (!isEmbeddedFrame()) return false;
  if (hasEmbedFlag()) return true;
  return isCatalogPlayPath(window.location.pathname);
}

export function stripEmbedSearch(search: string): string {
  const params = new URLSearchParams(
    search.startsWith("?") || search === "" ? search : `?${search}`,
  );
  params.delete(EMBED_QUERY);
  const raw = params.toString();
  return raw ? `?${raw}` : "";
}

export function hrefOf(pathname: string, search: string, hash: string): string {
  return `${pathname}${stripEmbedSearch(search)}${hash}`;
}

export function locationFromWindow(): { pathname: string; search: string; hash: string } {
  return {
    pathname: window.location.pathname,
    search: stripEmbedSearch(window.location.search),
    hash: window.location.hash,
  };
}

/** Iframe src for a catalog game. Adds embed=1 so the child can also detect intent. */
export function buildEmbedSrc(pathname: string, search = "", hash = ""): string {
  const params = new URLSearchParams(
    search.startsWith("?") || search === "" ? search : `?${search}`,
  );
  params.set(EMBED_QUERY, "1");
  const raw = params.toString();
  return `${pathname}${raw ? `?${raw}` : ""}${hash}`;
}

export function isEmbedLocationMessage(
  data: unknown,
  type: EmbedLocationPayload["type"],
): data is EmbedLocationPayload {
  if (!data || typeof data !== "object") return false;
  const value = data as Record<string, unknown>;
  return (
    value.type === type &&
    typeof value.pathname === "string" &&
    typeof value.search === "string" &&
    typeof value.hash === "string"
  );
}

export function sameOrigin(event: MessageEvent): boolean {
  return event.origin === window.location.origin;
}
