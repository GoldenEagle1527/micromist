import type { OpsPageId } from "./types";

/** Sidebar order aligned with common ops panels (home → sites → store → files → cron → terminal → settings). */
export const OPS_MENU: { id: OpsPageId; icon: string }[] = [
  { id: "dashboard", icon: "⌂" },
  { id: "plots", icon: "▦" },
  { id: "shop", icon: "◎" },
  { id: "warehouse", icon: "☰" },
  { id: "cron", icon: "⏱" },
  { id: "terminal", icon: ">_" },
  { id: "settings", icon: "⚙" },
];
