import {
  CROP_ORDER,
  HARVEST_VALUE,
  SEED_PRICE,
  type CropId,
  type CronTask,
  type InventoryItem,
  type LogLine,
  type OpsState,
  type Plot,
} from "./types";

let seq = 0;
function nid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

function pushLog(
  state: OpsState,
  level: LogLine["level"],
  text: string,
): OpsState {
  const line: LogLine = { id: nid("log"), at: Date.now(), level, text };
  const logs = [line, ...state.logs].slice(0, 80);
  return { ...state, logs };
}

function bumpInventory(
  inventory: InventoryItem[],
  crop: CropId,
  delta: number,
): InventoryItem[] {
  const next = inventory.map((i) => ({ ...i }));
  const row = next.find((i) => i.crop === crop);
  if (row) {
    row.qty = Math.max(0, row.qty + delta);
    return next.filter((i) => i.qty > 0);
  }
  if (delta <= 0) return next;
  return [...next, { id: nid("inv"), crop, qty: delta }];
}

export function createInitialState(): OpsState {
  const now = Date.now();
  const plots: Plot[] = [
    {
      id: "plot-a1",
      host: "web-a1.local",
      status: "growing",
      crop: "lettuce",
      growth: 42,
      moisture: 58,
      lastActionAt: now,
    },
    {
      id: "plot-a2",
      host: "web-a2.local",
      status: "ready",
      crop: "tomato",
      growth: 100,
      moisture: 40,
      lastActionAt: now,
    },
    {
      id: "plot-b1",
      host: "api-b1.local",
      status: "empty",
      crop: null,
      growth: 0,
      moisture: 35,
      lastActionAt: now,
    },
    {
      id: "plot-b2",
      host: "api-b2.local",
      status: "growing",
      crop: "potato",
      growth: 18,
      moisture: 22,
      lastActionAt: now,
    },
    {
      id: "plot-c1",
      host: "edge-c1.local",
      status: "empty",
      crop: null,
      growth: 0,
      moisture: 50,
      lastActionAt: now,
    },
    {
      id: "plot-c2",
      host: "edge-c2.local",
      status: "wilted",
      crop: "chili",
      growth: 55,
      moisture: 8,
      lastActionAt: now,
    },
  ];

  const cron: CronTask[] = [
    { id: "water-all", enabled: true, lastRunAt: null },
    { id: "harvest-ready", enabled: true, lastRunAt: null },
    { id: "scan-pests", enabled: false, lastRunAt: null },
  ];

  const seeds: Record<CropId, number> = {
    lettuce: 3,
    tomato: 1,
    potato: 2,
    chili: 0,
  };

  let state: OpsState = {
    coins: 120,
    day: 1,
    plots,
    inventory: [{ id: "inv-backup-pack", crop: "lettuce", qty: 2 }],
    seeds,
    cron,
    logs: [],
    page: "dashboard",
    sidebarCollapsed: false,
  };

  state = pushLog(state, "ok", "panel boot · node cluster online");
  state = pushLog(state, "info", "loaded 6 websites · 3 cron jobs · app store ready");
  return state;
}

export function normalizeState(raw: unknown): OpsState | null {
  if (raw == null || typeof raw !== "object") return null;
  const s = raw as Partial<OpsState>;
  if (!Array.isArray(s.plots) || typeof s.coins !== "number") return null;
  const base = createInitialState();
  return {
    ...base,
    ...s,
    plots: s.plots as Plot[],
    inventory: Array.isArray(s.inventory) ? (s.inventory as InventoryItem[]) : base.inventory,
    seeds: { ...base.seeds, ...(s.seeds ?? {}) },
    cron: Array.isArray(s.cron) ? (s.cron as CronTask[]) : base.cron,
    logs: Array.isArray(s.logs) ? (s.logs as LogLine[]) : base.logs,
    page: s.page ?? "dashboard",
    sidebarCollapsed: Boolean(s.sidebarCollapsed),
    day: typeof s.day === "number" ? s.day : 1,
  };
}

export function setPage(state: OpsState, page: OpsState["page"]): OpsState {
  return { ...state, page };
}

export function toggleSidebar(state: OpsState): OpsState {
  return { ...state, sidebarCollapsed: !state.sidebarCollapsed };
}

export function buySeed(state: OpsState, crop: CropId): OpsState {
  const price = SEED_PRICE[crop];
  if (state.coins < price) {
    return pushLog(state, "warn", `install ${crop} failed · insufficient balance (${state.coins}/${price})`);
  }
  const seeds = { ...state.seeds, [crop]: state.seeds[crop] + 1 };
  return pushLog(
    { ...state, coins: state.coins - price, seeds },
    "ok",
    `installed package app/${crop} · −${price} credits`,
  );
}

export function plantOnPlot(state: OpsState, plotId: string, crop: CropId): OpsState {
  if (state.seeds[crop] <= 0) {
    return pushLog(state, "warn", `deploy ${crop} failed · package not in registry`);
  }
  const plot = state.plots.find((p) => p.id === plotId);
  if (!plot || plot.status !== "empty") {
    return pushLog(state, "warn", `deploy aborted · site ${plotId} not idle`);
  }
  const plots = state.plots.map((p) =>
    p.id === plotId
      ? {
          ...p,
          status: "growing" as const,
          crop,
          growth: 5,
          moisture: Math.max(p.moisture, 40),
          lastActionAt: Date.now(),
        }
      : p,
  );
  const seeds = { ...state.seeds, [crop]: state.seeds[crop] - 1 };
  return pushLog(
    { ...state, plots, seeds },
    "ok",
    `site ${plot.host} provisioned with ${crop} · build started`,
  );
}

export function runCron(state: OpsState, taskId: CronTask["id"]): OpsState {
  const now = Date.now();
  const cron = state.cron.map((t) =>
    t.id === taskId ? { ...t, lastRunAt: now } : t,
  );
  let next: OpsState = { ...state, cron };

  if (taskId === "water-all") {
    const plots = next.plots.map((p) => {
      if (p.status === "empty") return { ...p, moisture: Math.min(100, p.moisture + 8) };
      if (p.status === "wilted") {
        return {
          ...p,
          status: "growing" as const,
          moisture: 55,
          growth: Math.min(99, p.growth + 10),
          lastActionAt: now,
        };
      }
      if (p.status === "growing") {
        const moisture = Math.min(100, p.moisture + 25);
        const growth = Math.min(100, p.growth + 18 + Math.floor(moisture / 20));
        return {
          ...p,
          moisture,
          growth,
          status: growth >= 100 ? ("ready" as const) : ("growing" as const),
          lastActionAt: now,
        };
      }
      return { ...p, moisture: Math.min(100, p.moisture + 10) };
    });
    next = pushLog({ ...next, plots }, "ok", "cron batch-health · refreshed metrics on all sites");
    return next;
  }

  if (taskId === "harvest-ready") {
    let coins = next.coins;
    let inventory = next.inventory;
    let harvested = 0;
    const plots = next.plots.map((p) => {
      if (p.status !== "ready" || !p.crop) return p;
      coins += HARVEST_VALUE[p.crop];
      inventory = bumpInventory(inventory, p.crop, 1);
      harvested += 1;
      return {
        ...p,
        status: "empty" as const,
        crop: null,
        growth: 0,
        moisture: Math.max(20, p.moisture - 15),
        lastActionAt: now,
      };
    });
    next = {
      ...next,
      coins,
      inventory,
      plots,
      day: next.day + (harvested > 0 ? 1 : 0),
    };
    next = pushLog(
      next,
      harvested > 0 ? "ok" : "info",
      harvested > 0
        ? `cron backup-release · ${harvested} sites published · balance updated`
        : "cron backup-release · no pending sites",
    );
    return next;
  }

  // scan-pests
  const plots = next.plots.map((p) => {
    if (p.status === "growing" && p.moisture < 15) {
      return { ...p, status: "wilted" as const };
    }
    if (p.status === "growing") {
      return { ...p, moisture: Math.max(0, p.moisture - 6) };
    }
    return p;
  });
  next = pushLog(
    { ...next, plots },
    "info",
    "cron security-scan · finished (high-load sites may alert)",
  );
  return next;
}

export function toggleCron(state: OpsState, taskId: CronTask["id"]): OpsState {
  const cron = state.cron.map((t) =>
    t.id === taskId ? { ...t, enabled: !t.enabled } : t,
  );
  return pushLog(
    { ...state, cron },
    "info",
    `cron ${taskId} · ${cron.find((t) => t.id === taskId)?.enabled ? "enabled" : "disabled"}`,
  );
}

export function dashboardStats(state: OpsState) {
  const growing = state.plots.filter((p) => p.status === "growing").length;
  const ready = state.plots.filter((p) => p.status === "ready").length;
  const empty = state.plots.filter((p) => p.status === "empty").length;
  const wilted = state.plots.filter((p) => p.status === "wilted").length;
  const avgMoisture = Math.round(
    state.plots.reduce((a, p) => a + p.moisture, 0) / Math.max(1, state.plots.length),
  );
  const seedStock = CROP_ORDER.reduce((a, c) => a + state.seeds[c], 0);
  return { growing, ready, empty, wilted, avgMoisture, seedStock };
}
