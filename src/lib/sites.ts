/** Canonical origins for prod ↔ staging switcher in About. */

export const PROD_ORIGIN = "https://micromist.goldeneaglepersonal.dpdns.org";
export const STAGING_ORIGIN =
  "https://micromist-staging.goldeneaglepersonal.dpdns.org";

/** Legacy workers.dev host — still treated as staging if opened. */
const STAGING_HOST_MARKERS = [
  "micromist-staging.goldeneaglepersonal.dpdns.org",
  "micromist-staging.",
];

export type SiteKind = "prod" | "staging" | "local";

export function siteKind(hostname = typeof location !== "undefined" ? location.hostname : ""): SiteKind {
  const h = hostname.toLowerCase();
  if (!h || h === "localhost" || h === "127.0.0.1" || h.endsWith(".local")) {
    return "local";
  }
  if (STAGING_HOST_MARKERS.some((m) => h === m || h.startsWith(m) || h.includes("micromist-staging"))) {
    return "staging";
  }
  return "prod";
}

/** Same path/query/hash on the other public site. Local → staging. */
export function switchSiteHref(kind: SiteKind = siteKind()): string | null {
  if (typeof location === "undefined") return null;
  const path = `${location.pathname}${location.search}${location.hash}`;
  if (kind === "staging") return `${PROD_ORIGIN}${path}`;
  if (kind === "prod") return `${STAGING_ORIGIN}${path}`;
  return `${STAGING_ORIGIN}${path}`;
}
