import type { BladeDict } from "../games/blade-break/i18n";
import type { ChromaDict } from "../games/chroma-slide/i18n";
import type { ExplosiveDict } from "../games/explosive-chess/i18n";
import type { MistDict } from "../games/mist-catch/i18n";

export type Locale = "zh" | "en";

export type Dict = {
  brand: string;
  brandSub: string;
  navGames: string;
  navGamesMobile: string;
  menuAria: string;
  themeSystem: string;
  themeLight: string;
  themeDark: string;
  themeAria: (label: string) => string;
  langAria: string;
  langTitle: string;
  footer: string;
  loading: string;
  aboutAria: string;
  aboutTitle: string;
  aboutBody: string;
  aboutClose: string;
  playCta: string;
  notFoundTitle: string;
  notFoundBody: string;
  notFoundLink: string;
  playMissingTitle: string;
  playMissingBody: (slug: string) => string;
  playMissingLink: string;
  mist: MistDict;
  explosive: ExplosiveDict;
  chroma: ChromaDict;
  blade: BladeDict;
};

export type GameLocaleFields = {
  title: string;
  blurb: string;
  badge: string;
};
