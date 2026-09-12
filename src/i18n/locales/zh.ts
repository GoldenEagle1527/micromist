import type { Dict } from "../types";
import { bladeZh } from "../../games/blade-break/i18n";
import { chromaZh } from "../../games/chroma-slide/i18n";
import { explosiveZh } from "../../games/explosive-chess/i18n";
import { mistZh } from "../../games/mist-catch/i18n";

export const zh: Dict = {
  brand: "微渺",
  brandSub: "micromist",
  navGames: "游戏",
  navGamesMobile: "游戏",
  menuAria: "菜单",
  themeSystem: "跟随系统",
  themeLight: "浅色",
  themeDark: "深色",
  themeAria: (label) => `主题：${label}，点击切换`,
  langAria: "切换语言",
  langTitle: "语言：中文，点击切换为 English",
  footer: "开源 MIT · Workers Static Assets · 不持久化账号",
  loading: "载入中…",
  aboutAria: "关于微渺",
  aboutTitle: "关于微渺",
  aboutBody:
    "micromist 是一个开源浏览器游戏平台：前端跑在 Cloudflare Workers Static Assets 上，单人进度只存在本机。联机靠分享链接进入房间（Durable Objects + WebSocket），不设公开房间列表；人走了房间也就回收。",
  aboutClose: "关闭",
  floatAria: "打开摸鱼浮窗（假装广告）",
  floatTitle: "浮窗",
  floatBlocked: "弹窗被拦截了。请允许本站弹出窗口后再试。",
  floatUnsupported: "当前浏览器不支持文档画中画。请用最新版 Chrome 或 Edge。",
  floatAdBadge: "广告",
  floatAdTitle: "精选推广",
  playCta: "开始玩",
  notFoundTitle: "没有这个页面",
  notFoundBody: "这条路径没有对应的页面。",
  notFoundLink: "回微渺首页",
  playMissingTitle: "没有这款游戏",
  playMissingBody: (slug) => `目录里还没有 ${slug}。`,
  playMissingLink: "回首页",
  mist: mistZh,
  explosive: explosiveZh,
  chroma: chromaZh,
  blade: bladeZh,
};
