/** Gameified micro-datacenter state for the 运维 panel shell. */

export type OpsPageId =
  | "dashboard"
  | "plots"
  | "shop"
  | "warehouse"
  | "cron"
  | "terminal"
  | "settings";

/** Internal package id (UI shows Nginx/MySQL/… via i18n). */
export type CropId = "lettuce" | "tomato" | "potato" | "chili";

export type PlotStatus = "empty" | "growing" | "ready" | "wilted";

export type Plot = {
  id: string;
  /** Fake hostname / site name shown in the ops table. */
  host: string;
  status: PlotStatus;
  crop: CropId | null;
  /** 0–100 build progress while running. */
  growth: number;
  /** Site load % (resource metric). */
  moisture: number;
  lastActionAt: number;
};

export type InventoryItem = {
  id: string;
  crop: CropId;
  qty: number;
};

export type CronTaskId = "water-all" | "harvest-ready" | "scan-pests";

export type CronTask = {
  id: CronTaskId;
  enabled: boolean;
  lastRunAt: number | null;
};

export type LogLine = {
  id: string;
  at: number;
  level: "info" | "warn" | "ok";
  text: string;
};

export type OpsPrefs = {
  /** Tighter padding / denser tables. */
  compact: boolean;
  /** Show host ids and raw status in debug-ish spots. */
  showDebug: boolean;
};

export type OpsState = {
  coins: number;
  day: number;
  plots: Plot[];
  inventory: InventoryItem[];
  seeds: Record<CropId, number>;
  cron: CronTask[];
  logs: LogLine[];
  page: OpsPageId;
  sidebarCollapsed: boolean;
  prefs: OpsPrefs;
};

export const DEFAULT_PREFS: OpsPrefs = {
  compact: false,
  showDebug: false,
};

export const CROP_ORDER: CropId[] = ["lettuce", "tomato", "potato", "chili"];

export const SEED_PRICE: Record<CropId, number> = {
  lettuce: 8,
  tomato: 14,
  potato: 10,
  chili: 18,
};

export const HARVEST_VALUE: Record<CropId, number> = {
  lettuce: 16,
  tomato: 28,
  potato: 20,
  chili: 36,
};

export const SLUG = "ops";

/** Panel version shown in Settings → About. */
export const PANEL_VERSION = "0.2.0";

/** Ops-facing package id. */
export const PACKAGE_SLUG: Record<CropId, string> = {
  lettuce: "nginx",
  tomato: "mysql",
  potato: "redis",
  chili: "postgres",
};

export const PACKAGE_FROM_SLUG: Record<string, CropId> = {
  nginx: "lettuce",
  mysql: "tomato",
  redis: "potato",
  postgres: "chili",
  postgresql: "chili",
};

/** Credits from exporting one harvested artifact. */
export const EXPORT_VALUE: Record<CropId, number> = {
  lettuce: 6,
  tomato: 10,
  potato: 8,
  chili: 14,
};

/** Cost to provision one extra idle website. */
export const SITE_PROVISION_COST = 90;

export const HOST_POOL = [
  "web-a1.local",
  "web-a2.local",
  "api-b1.local",
  "api-b2.local",
  "edge-c1.local",
  "edge-c2.local",
  "app-d1.local",
  "cdn-d2.local",
  "worker-e1.local",
  "gateway-e2.local",
  "batch-f1.local",
  "ops-f2.local",
] as const;
