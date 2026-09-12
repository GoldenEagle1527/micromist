import type { Dict } from "../types";
import { bladeEn } from "../../games/blade-break/i18n";
import { chromaEn } from "../../games/chroma-slide/i18n";
import { explosiveEn } from "../../games/explosive-chess/i18n";
import { mistEn } from "../../games/mist-catch/i18n";

export const en: Dict = {
  brand: "micromist",
  brandSub: "微渺",
  navGames: "Games",
  navGamesMobile: "Games",
  menuAria: "Menu",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",
  themeAria: (label) => `Theme: ${label}. Click to switch`,
  langAria: "Switch language",
  langTitle: "Language: English. Click for 中文",
  footer: "MIT · Workers Static Assets · No accounts persisted",
  loading: "Loading…",
  aboutAria: "About micromist",
  aboutTitle: "About micromist",
  aboutBody:
    "micromist is an open-source browser game platform on Cloudflare Workers Static Assets. Solo progress stays on this device. Multiplayer uses share links into Durable Object rooms (no public lobby); empty rooms are recycled.",
  aboutClose: "Close",
  floatAria: "Open float window (disguised as an ad)",
  floatTitle: "Float",
  floatBlocked: "The popup was blocked. Allow popups for this site and try again.",
  floatUnsupported: "Document Picture-in-Picture isn’t supported here. Try the latest Chrome or Edge.",
  floatAdBadge: "Ad",
  floatAdTitle: "Sponsored content",
  playCta: "Play",
  notFoundTitle: "Page not found",
  notFoundBody: "Nothing lives at this path.",
  notFoundLink: "Back to home",
  playMissingTitle: "Game not found",
  playMissingBody: (slug) => `No game named ${slug} in the catalog.`,
  playMissingLink: "Home",
  mist: mistEn,
  explosive: explosiveEn,
  chroma: chromaEn,
  blade: bladeEn,
};
