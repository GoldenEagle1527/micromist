import type { Locale } from "../i18n";

export type GameMode = "single" | "single-online";

export type GameMeta = {
  slug: string;
  mode: GameMode;
  title: Record<Locale, string>;
  blurb: Record<Locale, string>;
  badge: Record<Locale, string>;
  /** When false, hidden from home and /play (code kept for later). Default true. */
  listed?: boolean;
};

export const games: GameMeta[] = [
  {
    slug: "mist-catch",
    mode: "single",
    listed: false,
    title: { zh: "拾雾", en: "Mist Catch" },
    blurb: {
      zh: "在雾中托住坠落的微光。单人小游戏，最高分仅存在本机。",
      en: "Steer a bowl through the mist and catch falling motes. Solo only; high score stays on this device.",
    },
    badge: { zh: "单机", en: "Offline" },
  },
  {
    slug: "explosive-chess",
    mode: "single-online",
    title: { zh: "爆炸棋", en: "Explosive Chess" },
    blurb: {
      zh: "落子叠满即爆，连锁改色占盘。单人可对战 AI 或热座；联机靠分享链接开房。",
      en: "Place until cells burst and recolor neighbors. Solo vs AI / hotseat, or online via share link.",
    },
    badge: { zh: "单机/联机", en: "Offline / Online" },
  },
  {
    slug: "chroma-slide",
    mode: "single",
    title: { zh: "滑动色块", en: "Chroma Slide" },
    blurb: {
      zh: "滑动色块，把每种颜色收成一块实心矩形。单人本地，步数只记本局。",
      en: "Slide colored tiles until each hue forms one solid rectangle. Solo local; steps are per run.",
    },
    badge: { zh: "单机", en: "Offline" },
  },
  {
    slug: "blade-break",
    mode: "single",
    listed: true,
    title: { zh: "破阵之刃", en: "Blade Break" },
    blurb: {
      zh: "五场对决的破势肉鸽：读意图、削架势、打断致命蓄力。单机本地，进度仅存本标签页。",
      en: "Five-fight poise duels: read telegraphs, shatter stance, interrupt lethal windups. Solo local; progress stays in this tab.",
    },
    badge: { zh: "单机", en: "Offline" },
  },
];

export function listedGames(): GameMeta[] {
  return games.filter((game) => game.listed !== false);
}

export function getGame(slug: string): GameMeta | undefined {
  return listedGames().find((game) => game.slug === slug);
}

/** @deprecated migrated to IndexedDB mist-catch/best */
export const BEST_SCORE_KEY = "micromist.mist-catch.best";
