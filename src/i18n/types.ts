export type Locale = "zh" | "en";

export type Dict = {
  brand: string;
  brandSub: string;
  navGames: string;
  navGamesMobile: string;
  themeSystem: string;
  themeLight: string;
  themeDark: string;
  themeAria: (label: string) => string;
  langAria: string;
  langTitle: string;
  footer: string;
  loading: string;
  homeTitle: string;
  homeLede: string;
  playCta: string;
  notFoundTitle: string;
  notFoundBody: string;
  notFoundLink: string;
  playMissingTitle: string;
  playMissingBody: (slug: string) => string;
  playMissingLink: string;
  mist: {
    score: string;
    best: string;
    lives: string;
    gameOver: string;
    tryAgain: string;
    hint: string;
  };
  explosive: Record<string, string>;
};

export type GameLocaleFields = {
  title: string;
  blurb: string;
  badge: string;
};
