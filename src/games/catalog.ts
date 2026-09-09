export type GameMode = "single" | "single-online";

export type GameMeta = {
  slug: string;
  title: string;
  titleZh: string;
  blurb: string;
  blurbZh: string;
  mode: GameMode;
  /** Home card badge, e.g. 单人 · local / 单人/联机 */
  badgeZh: string;
};

export const games: GameMeta[] = [
  {
    slug: "mist-catch",
    title: "Mist Catch",
    titleZh: "拾雾",
    blurb: "Steer a bowl through the mist and catch falling motes. Single-player, local high score.",
    blurbZh: "在雾中托住坠落的微光。单人小游戏，最高分仅存在本机。",
    mode: "single",
    badgeZh: "单人 · local",
  },
  {
    slug: "explosive-chess",
    title: "Explosive Chess",
    titleZh: "爆炸棋",
    blurb:
      "Place dots until cells burst and recolor neighbors. Solo vs AI / hotseat, or online via share link.",
    blurbZh: "落子叠满即爆，连锁改色占盘。单人可对战 AI 或热座；联机靠分享链接开房。",
    mode: "single-online",
    badgeZh: "单人/联机",
  },
];

export function getGame(slug: string): GameMeta | undefined {
  return games.find((game) => game.slug === slug);
}

export const BEST_SCORE_KEY = "micromist.mist-catch.best";
