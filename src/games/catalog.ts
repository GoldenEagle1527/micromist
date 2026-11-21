import type { Locale } from "../i18n";
import type { GamePlayModule, GamePreview } from "../platform/play";
import { siteKind, type SiteKind } from "../lib/sites";
import { preview as previewChromaSlide } from "./chroma-slide/play-preview";
import { preview as previewExplosiveChess } from "./explosive-chess/play-preview";
import { preview as previewGomoku } from "./gomoku/play-preview";

function loadOnce(load: () => Promise<GamePlayModule>): () => Promise<GamePlayModule> {
  let pending: Promise<GamePlayModule> | undefined;
  return () => {
    pending ??= load();
    return pending;
  };
}

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
  /** Sync first-paint snapshot. Lives in the main bundle so GameShell can paint before the session loads. */
  preview: GamePreview;
  /** Lazy play session runtime. PlayPage mounts GameShell with this; the shell must not switch on slug. */
  loadPlay: () => Promise<GamePlayModule>;
};

export const games: GameMeta[] = [
  {
    slug: "explosive-chess",
    mode: "single-online",
    title: { zh: "爆炸棋", en: "Explosive Chess" },
    blurb: {
      zh: "落子叠满即爆，连锁改色占盘。单人可对战 AI 或热座；联机靠分享链接开房。",
      en: "Place until cells burst and recolor neighbors. Solo vs AI / hotseat, or online via share link.",
    },
    badge: { zh: "单机/联机", en: "Offline / Online" },
    preview: previewExplosiveChess,
    loadPlay: loadOnce(() => import("./explosive-chess/play").then((m) => m.playModule)),
  },
  {
    slug: "gomoku",
    mode: "single-online",
    title: { zh: "五子棋", en: "Gomoku" },
    blurb: {
      zh: "十五路棋盘，黑先，五子连珠。可热座、对战本机 AI，或分享链接联机。",
      en: "A 15×15 board. Black goes first; five in a row wins. Play hotseat, against a built-in AI, or online with a share link.",
    },
    badge: { zh: "单机/联机", en: "Offline / Online" },
    audience: "staging",
    preview: previewGomoku,
    loadPlay: loadOnce(() => import("./gomoku/play").then((m) => m.playModule)),
  },
  {
    slug: "chroma-slide",
    mode: "single",
    title: { zh: "滑动色块", en: "Chroma Slide" },
    blurb: {
      zh: "滑动色块，把每种颜色收成一块实心正方形。本机开局，或用分享链接把单人谜题交给人 / Agent。",
      en: "Slide colored tiles until each hue forms one solid square. Play locally, or share a solo-puzzle room with a person or Agent.",
    },
    badge: { zh: "单机", en: "Offline" },
    preview: previewChromaSlide,
    loadPlay: loadOnce(() => import("./chroma-slide/play").then((m) => m.playModule)),
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

/** Start downloading play runtimes after the lobby is on screen. */
export function prefetchPlayModules(): void {
  for (const game of listedGames()) {
    void game.loadPlay();
  }
}
