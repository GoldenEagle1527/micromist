/** Farm-as-ops placeholder state for the 运维 shell. */

export type OpsPageId =
  | "dashboard"
  | "plots"
  | "shop"
  | "warehouse"
  | "cron"
  | "terminal";

export type CropId = "lettuce" | "tomato" | "potato" | "chili";

export type PlotStatus = "empty" | "growing" | "ready" | "wilted";

export type Plot = {
  id: string;
  /** Fake hostname / site name shown in the ops table. */
  host: string;
  status: PlotStatus;
  crop: CropId | null;
  /** 0–100 growth while growing. */
  growth: number;
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
