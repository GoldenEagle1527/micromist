/** The in-game ≡ menu, the help sheet and the desktop key chip (ui/menu). */
export type MenuDict = {
  /** ≡ button (aria / tooltip). */
  open: string;
  title: string;
  resume: string;
  help: string;
  helpTitle: string;
  close: string;
  sound: string;
  volume: string;
  /** True fullscreen (browser chrome hidden). */
  fullscreen: string;
  fullscreenHint: string;
  /** On-screen dial + buttons. */
  touchControls: string;
  flip: string;
  /** Conserve: the new-player tips. */
  hints: string;
  /** Staging only: opens the debug panel. */
  debug: string;
  exit: string;
  /** Surveyed seabed in the sonar record (followed by km²). */
  mapped: string;
  on: string;
  off: string;
  /** Desktop, first seconds of a dive. */
  keyChip: string;
};

export const menuEn: MenuDict = {
  open: "Menu (Esc)",
  title: "Menu",
  resume: "Resume",
  help: "Help",
  helpTitle: "Controls",
  close: "Close",
  sound: "Sound",
  volume: "Volume",
  fullscreen: "Fullscreen",
  fullscreenHint: "Hides the browser bars · Esc leaves it",
  touchControls: "On-screen controls",
  flip: "Flip view 180°",
  hints: "Beginner tips",
  debug: "Debug panel",
  exit: "Leave the dive",
  mapped: "Sonar mapped",
  on: "On",
  off: "Off",
  keyChip: "? help · Esc menu",
};

export const menuZh: MenuDict = {
  open: "菜单（Esc）",
  title: "菜单",
  resume: "继续下潜",
  help: "帮助",
  helpTitle: "操作说明",
  close: "关闭",
  sound: "音效",
  volume: "音量",
  fullscreen: "全屏",
  fullscreenHint: "隐藏浏览器界面 · Esc 退出全屏",
  touchControls: "屏幕操控按钮",
  flip: "画面翻转 180°",
  hints: "新手提示",
  debug: "调试面板",
  exit: "退出下潜",
  mapped: "声呐已测绘",
  on: "开",
  off: "关",
  keyChip: "? 帮助 · Esc 菜单",
};
