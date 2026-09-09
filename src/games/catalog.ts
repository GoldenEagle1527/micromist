export type GameMode = "single" | "multiplayer-soon";

export type GameMeta = {
  slug: string;
  title: string;
  titleZh: string;
  blurb: string;
  blurbZh: string;
  mode: GameMode;
};

export const games: GameMeta[] = [
  {
    slug: "mist-catch",
    title: "Mist Catch",
    titleZh: "拾雾",
    blurb: "Steer a bowl through the mist and catch falling motes. Single-player, local high score.",
    blurbZh: "在雾中托住坠落的微光。单人小游戏，最高分仅存在本机。",
    mode: "single",
  },
];

export function getGame(slug: string): GameMeta | undefined {
  return games.find((game) => game.slug === slug);
}

export const BEST_SCORE_KEY = "micromist.mist-catch.best";
