import type { Locale } from "../i18n";
import { siteKind, type SiteKind } from "../lib/sites";

export type GameMode = "single" | "single-online";

/** Where a game is listed on home /play. Default `"all"`. */
export type GameAudience = "all" | "staging" | "prod";

export type GameMeta = {
  slug: string;
  mode: GameMode;
  title: Record<Locale, string>;
  blurb: Record<Locale, string>;
  badge: Record<Locale, string>;
  /**
   * Listing gate:
   * - `"all"` (default): home + /play on every site
   * - `"staging"`: only测试站 (and local)
   * - `"prod"`: only正式站
   * `listed: false` still forces never listed (legacy hide).
   */
  audience?: GameAudience;
  /** When false, never listed. Prefer `audience` for env gates. Default true. */
  listed?: boolean;
};

export const games: GameMeta[] = [
  {
    slug: "mist-catch",
    mode: "single",
    audience: "staging",
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
    slug: "pottery",
    mode: "single",
    audience: "staging",
    title: { zh: "陶艺", en: "Pottery" },
    blurb: {
      zh: "拉坯塑形，烧成收藏。剖面即陶，单机本地，作品只存在本机。",
      en: "Throw clay on the wheel, fire, and keep a shelf. Solo local; pieces stay on this device.",
    },
    badge: { zh: "单机", en: "Offline" },
  },
  {
    slug: "lumen-weave",
    mode: "single",
    audience: "staging",
    title: { zh: "织光", en: "Lumen Weave" },
    blurb: {
      zh: "第一人称漫游无尽的种子粒子生态域。同一种子同一世界，无得分无失败。",
      en: "First-person roam through endless seeded particle biomes. Same seed, same world — experiential, not scored.",
    },
    badge: { zh: "单机", en: "Offline" },
  },
  {
    slug: "blade-break",
    mode: "single",
    title: { zh: "破阵之刃", en: "Blade Break" },
    blurb: {
      zh: "五场对决的破势肉鸽：读意图、削架势、打断致命蓄力。单机本地，进度仅存本标签页。",
      en: "Five-fight poise duels: read telegraphs, shatter stance, interrupt lethal windups. Solo local; progress stays in this tab.",
    },
    badge: { zh: "单机", en: "Offline" },
  },
];

function audienceAllows(audience: GameAudience | undefined, kind: SiteKind): boolean {
  const a = audience ?? "all";
  if (a === "all") return true;
  if (a === "staging") return kind === "staging" || kind === "local";
  if (a === "prod") return kind === "prod";
  return true;
}

export function isGameListed(
  game: GameMeta,
  kind: SiteKind = siteKind(),
): boolean {
  if (game.listed === false) return false;
  return audienceAllows(game.audience, kind);
}

export function listedGames(kind: SiteKind = siteKind()): GameMeta[] {
  return games.filter((game) => isGameListed(game, kind));
}

export function getGame(
  slug: string,
  kind: SiteKind = siteKind(),
): GameMeta | undefined {
  return listedGames(kind).find((game) => game.slug === slug);
}

/** @deprecated migrated to IndexedDB mist-catch/best */
export const BEST_SCORE_KEY = "micromist.mist-catch.best";
