import type { Locale } from "../i18n";

export type GameMode = "single" | "single-online";

export type GameMeta = {
  slug: string;
  mode: GameMode;
  title: Record<Locale, string>;
  blurb: Record<Locale, string>;
  badge: Record<Locale, string>;
};

export const games: GameMeta[] = [
  {
    slug: "mist-catch",
    mode: "single",
    title: { zh: "拾雾", en: "Mist Catch" },
    blurb: {
      zh: "在雾中托住坠落的微光。单人小游戏，最高分仅存在本机。",
      en: "Steer a bowl through the mist and catch falling motes. Solo only; high score stays on this device.",
    },
    badge: { zh: "单人 · local", en: "Solo · local" },
  },
  {
    slug: "explosive-chess",
    mode: "single-online",
    title: { zh: "爆炸棋", en: "Explosive Chess" },
    blurb: {
      zh: "落子叠满即爆，连锁改色占盘。单人可对战 AI 或热座；联机靠分享链接开房。",
      en: "Place until cells burst and recolor neighbors. Solo vs AI / hotseat, or online via share link.",
    },
    badge: { zh: "单人/联机", en: "Solo / Online" },
  },
];

export function getGame(slug: string): GameMeta | undefined {
  return games.find((game) => game.slug === slug);
}

export const BEST_SCORE_KEY = "micromist.mist-catch.best";
