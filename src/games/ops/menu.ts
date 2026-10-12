import type { OpsPageId } from "./types";

/** Nav order inspired by typical ops panels (home → sites → store → files → cron → terminal). */
export const OPS_MENU: { id: OpsPageId; icon: string }[] = [
  { id: "dashboard", icon: "⌂" },
  { id: "plots", icon: "▦" },
  { id: "shop", icon: "◎" },
  { id: "warehouse", icon: "☰" },
  { id: "cron", icon: "⏱" },
  { id: "terminal", icon: ">_" },
];
