import {
  CROP_ORDER,
  DEFAULT_PREFS,
  EXPORT_VALUE,
  HARVEST_VALUE,
  HOST_POOL,
  MAX_CATCHUP_DAYS,
  MS_PER_GAME_DAY,
  PACKAGE_FROM_SLUG,
  PACKAGE_SLUG,
  SEED_PRICE,
  SITE_PROVISION_COST,
  TIER_GROWTH_BONUS,
  TIER_LOAD_SOFT_CAP,
  TIER_RELEASE_BONUS,
  TIER_UPGRADE_COST,
  nextTier,
  type CropId,
  type CronTask,
  type InventoryItem,
  type LogLine,
  type OpsPrefs,
  type OpsState,
  type Plot,
  type SiteTier,
} from "./types";

let seq = 0;
function nid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

function pkg(crop: CropId): string {
  return PACKAGE_SLUG[crop];
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

function nextHost(plots: Plot[]): string {
  const used = new Set(plots.map((p) => p.host));
  for (const h of HOST_POOL) {
    if (!used.has(h)) return h;
  }
  return `site-${plots.length + 1}.local`;
}

function normalizeTier(raw: unknown): SiteTier {
  if (raw === "basic" || raw === "standard" || raw === "premium") return raw;
  return "standard";
}

function normalizePlot(raw: Partial<Plot> & { id?: string }, fallbackHost: string): Plot {
  const now = Date.now();
  return {
    id: typeof raw.id === "string" ? raw.id : nid("plot"),
    host: typeof raw.host === "string" ? raw.host : fallbackHost,
    status:
      raw.status === "empty" ||
      raw.status === "growing" ||
      raw.status === "ready" ||
      raw.status === "wilted"
        ? raw.status
        : "empty",
    crop:
      raw.crop === "lettuce" ||
      raw.crop === "tomato" ||
      raw.crop === "potato" ||
      raw.crop === "chili"
        ? raw.crop
        : null,
    growth: typeof raw.growth === "number" ? Math.max(0, Math.min(100, raw.growth)) : 0,
    moisture:
      typeof raw.moisture === "number" ? Math.max(0, Math.min(100, raw.moisture)) : 40,
    tier: normalizeTier(raw.tier),
    lastActionAt: typeof raw.lastActionAt === "number" ? raw.lastActionAt : now,
  };
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
      tier: "standard",
      lastActionAt: now,
    },
    {
      id: "plot-a2",
      host: "web-a2.local",
      status: "ready",
      crop: "tomato",
      growth: 100,
      moisture: 40,
      tier: "standard",
      lastActionAt: now,
    },
    {
      id: "plot-b1",
      host: "api-b1.local",
      status: "empty",
      crop: null,
      growth: 0,
      moisture: 35,
      tier: "basic",
      lastActionAt: now,
    },
    {
      id: "plot-b2",
      host: "api-b2.local",
      status: "growing",
      crop: "potato",
      growth: 18,
      moisture: 22,
      tier: "basic",
      lastActionAt: now,
    },
    {
      id: "plot-c1",
      host: "edge-c1.local",
      status: "empty",
      crop: null,
      growth: 0,
      moisture: 50,
      tier: "basic",
      lastActionAt: now,
    },
    {
      id: "plot-c2",
      host: "edge-c2.local",
      status: "wilted",
      crop: "chili",
      growth: 55,
      moisture: 8,
      tier: "premium",
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
    lastTickAt: now,
    plots,
    inventory: [{ id: "inv-backup-pack", crop: "lettuce", qty: 2 }],
    seeds,
    cron,
    logs: [],
    page: "dashboard",
    sidebarCollapsed: false,
    prefs: { ...DEFAULT_PREFS },
  };

  state = pushLog(state, "ok", "panel boot · node cluster online");
  state = pushLog(state, "info", "loaded 6 websites · 3 cron jobs · app store ready");
  state = pushLog(
    state,
    "info",
    "hint · install → deploy → health-check → release · wall-clock ticks while panel is open",
  );
  return state;
}

export function normalizeState(raw: unknown): OpsState | null {
  if (raw == null || typeof raw !== "object") return null;
  const s = raw as Partial<OpsState>;
  if (!Array.isArray(s.plots) || typeof s.coins !== "number") return null;
  const base = createInitialState();
  const prefsIn = (s as { prefs?: Partial<OpsPrefs> }).prefs;
  const now = Date.now();
  const plots = (s.plots as Partial<Plot>[]).map((p, i) =>
    normalizePlot(p ?? {}, HOST_POOL[i] ?? `site-${i + 1}.local`),
  );
  return {
    ...base,
    ...s,
    plots,
    inventory: Array.isArray(s.inventory) ? (s.inventory as InventoryItem[]) : base.inventory,
    seeds: { ...base.seeds, ...(s.seeds ?? {}) },
    cron: Array.isArray(s.cron) ? (s.cron as CronTask[]) : base.cron,
    logs: Array.isArray(s.logs) ? (s.logs as LogLine[]) : base.logs,
    page: s.page ?? "dashboard",
    sidebarCollapsed: Boolean(s.sidebarCollapsed),
    day: typeof s.day === "number" ? s.day : 1,
    // Old saves without lastTickAt: start clock now (avoid huge catch-up).
    lastTickAt: typeof s.lastTickAt === "number" ? s.lastTickAt : now,
    prefs: {
      ...DEFAULT_PREFS,
      ...(prefsIn && typeof prefsIn === "object" ? prefsIn : {}),
      compact: Boolean(prefsIn?.compact ?? DEFAULT_PREFS.compact),
      showDebug: Boolean(prefsIn?.showDebug ?? DEFAULT_PREFS.showDebug),
    },
  };
}

export function setPage(state: OpsState, page: OpsState["page"]): OpsState {
  return { ...state, page };
}

export function toggleSidebar(state: OpsState): OpsState {
  return { ...state, sidebarCollapsed: !state.sidebarCollapsed };
}

export function setPref(
  state: OpsState,
  key: keyof OpsPrefs,
  value: boolean,
): OpsState {
  return { ...state, prefs: { ...state.prefs, [key]: value } };
}

export function buySeed(state: OpsState, crop: CropId): OpsState {
  const price = SEED_PRICE[crop];
  const name = pkg(crop);
  if (state.coins < price) {
    return pushLog(
      state,
      "warn",
      `install ${name} failed · insufficient balance (${state.coins}/${price})`,
    );
  }
  const seeds = { ...state.seeds, [crop]: state.seeds[crop] + 1 };
  return pushLog(
    { ...state, coins: state.coins - price, seeds },
    "ok",
    `installed package app/${name} · −${price} credits`,
  );
}

export function plantOnPlot(state: OpsState, plotId: string, crop: CropId): OpsState {
  const name = pkg(crop);
  if (state.seeds[crop] <= 0) {
    return pushLog(state, "warn", `deploy ${name} failed · package not in registry`);
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
    `site ${plot.host} (${plot.tier}) provisioned with ${name} · build started`,
  );
}

/** Single-site health check (revive alert / push build). */
export function healthCheckPlot(state: OpsState, plotId: string): OpsState {
  const now = Date.now();
  const plot = state.plots.find((p) => p.id === plotId);
  if (!plot) {
    return pushLog(state, "warn", `health-check failed · unknown site ${plotId}`);
  }
  if (plot.status === "empty") {
    return pushLog(state, "info", `health-check ${plot.host} · idle (nothing to refresh)`);
  }
  if (plot.status === "ready") {
    return pushLog(
      {
        ...state,
        plots: state.plots.map((p) =>
          p.id === plotId
            ? { ...p, moisture: Math.min(100, p.moisture + 8), lastActionAt: now }
            : p,
        ),
      },
      "ok",
      `health-check ${plot.host} · pending release (metrics refreshed)`,
    );
  }

  const bonus = TIER_GROWTH_BONUS[plot.tier];
  const soft = TIER_LOAD_SOFT_CAP[plot.tier];
  const plots = state.plots.map((p) => {
    if (p.id !== plotId) return p;
    if (p.status === "wilted") {
      return {
        ...p,
        status: "growing" as const,
        moisture: 55,
        growth: Math.min(99, p.growth + 12 + bonus),
        lastActionAt: now,
      };
    }
    const overCap = p.moisture > soft;
    const moisture = Math.min(100, p.moisture + (overCap ? 12 : 28));
    const growthGain = (overCap ? 12 : 22) + Math.floor(moisture / 25) + bonus;
    const growth = Math.min(100, p.growth + growthGain);
    return {
      ...p,
      moisture,
      growth,
      status: growth >= 100 ? ("ready" as const) : ("growing" as const),
      lastActionAt: now,
    };
  });
  const after = plots.find((p) => p.id === plotId)!;
  const overNote =
    plot.moisture > soft ? ` · over soft-cap ${soft}% (${plot.tier})` : "";
  return pushLog(
    { ...state, plots },
    "ok",
    after.status === "ready"
      ? `health-check ${plot.host} · build complete · pending release`
      : `health-check ${plot.host} · load ${after.moisture}% · build ${after.growth}%${overNote}`,
  );
}

/** Upgrade site plan tier (basic → standard → premium). */
export function upgradePlotTier(state: OpsState, plotId: string): OpsState {
  const plot = state.plots.find((p) => p.id === plotId);
  if (!plot) {
    return pushLog(state, "warn", `upgrade failed · unknown site ${plotId}`);
  }
  const to = nextTier(plot.tier);
  const cost = TIER_UPGRADE_COST[plot.tier];
  if (!to || cost == null) {
    return pushLog(state, "info", `upgrade ${plot.host} · already on premium`);
  }
  if (state.coins < cost) {
    return pushLog(
      state,
      "warn",
      `upgrade ${plot.host} failed · insufficient balance (${state.coins}/${cost})`,
    );
  }
  const plots = state.plots.map((p) =>
    p.id === plotId ? { ...p, tier: to, lastActionAt: Date.now() } : p,
  );
  return pushLog(
    { ...state, coins: state.coins - cost, plots },
    "ok",
    `upgraded ${plot.host} · ${plot.tier} → ${to} · −${cost} credits`,
  );
}

export function upgradeCostFor(plot: Plot): number | null {
  return TIER_UPGRADE_COST[plot.tier];
}

/** Small readable event pool — fires at most once per overnight/tick day. */
function maybeFireEvent(state: OpsState): OpsState {
  const roll = Math.random();
  // ~40% quiet (no event)
  if (roll < 0.4) return state;

  const running = state.plots.filter(
    (p) => p.status === "growing" || p.status === "ready" || p.status === "wilted",
  );
  const pick =
    running.length > 0
      ? running[Math.floor(Math.random() * running.length)]!
      : state.plots[Math.floor(Math.random() * state.plots.length)];

  if (roll < 0.55) {
    // traffic spike
    const plots = state.plots.map((p) => {
      if (p.status !== "growing" && p.status !== "ready") return p;
      const bump = p.tier === "premium" ? 6 : p.tier === "standard" ? 10 : 14;
      return { ...p, moisture: Math.min(100, p.moisture + bump) };
    });
    return pushLog(
      { ...state, plots },
      "warn",
      "event · traffic spike · load rose on running sites",
    );
  }

  if (roll < 0.68) {
    // cert warning (log only, recoverable awareness)
    const host = pick?.host ?? "unknown";
    return pushLog(
      state,
      "warn",
      `event · TLS cert on ${host} expires soon · schedule renew / health-check`,
    );
  }

  if (roll < 0.82) {
    // security finding → alert on one growing site
    const target = state.plots.find((p) => p.status === "growing");
    if (!target) {
      return pushLog(state, "info", "event · security notice · no running target");
    }
    const plots = state.plots.map((p) =>
      p.id === target.id
        ? { ...p, status: "wilted" as const, moisture: Math.min(p.moisture, 18) }
        : p,
    );
    return pushLog(
      { ...state, plots },
      "warn",
      `event · CVE scan hit ${target.host} · site entered alert (health-check to recover)`,
    );
  }

  if (roll < 0.92) {
    // disk pressure — soft warn, slight load on idle/backup sense
    const plots = state.plots.map((p) => ({
      ...p,
      moisture: Math.min(100, p.moisture + (p.status === "empty" ? 2 : 4)),
    }));
    return pushLog(
      { ...state, plots },
      "warn",
      "event · disk pressure · clean exports or free files before next release",
    );
  }

  // quiet / good night
  const plots = state.plots.map((p) => {
    if (p.status === "empty") return p;
    return { ...p, moisture: Math.max(0, p.moisture - 3) };
  });
  return pushLog(
    { ...state, plots },
    "ok",
    "event · quiet night · slight load cooldown across the cluster",
  );
}

/**
 * Overnight pass after a day advances: load drift, worsen ignored alerts,
 * tier soft-cap stress, then run every enabled cron once, then maybe an event.
 */
export function applyOvernight(state: OpsState): OpsState {
  const now = Date.now();
  let crashed = 0;
  let drifted = 0;
  let stressed = 0;
  const plots = state.plots.map((p) => {
    const soft = TIER_LOAD_SOFT_CAP[p.tier];
    if (p.status === "growing") {
      drifted += 1;
      const over = p.moisture > soft;
      const drop = over ? 8 : 4;
      const moisture = Math.max(0, p.moisture - drop);
      let status: Plot["status"] = "growing";
      // Over soft-cap on basic/standard: chance to enter alert
      if (over && p.tier !== "premium" && moisture < soft - 10) {
        if (Math.random() < (p.tier === "basic" ? 0.35 : 0.18)) {
          status = "wilted";
          stressed += 1;
        }
      }
      return { ...p, moisture, status, lastActionAt: now };
    }
    if (p.status === "wilted") {
      if (p.moisture <= 5) {
        crashed += 1;
        return {
          ...p,
          status: "empty" as const,
          crop: null,
          growth: 0,
          moisture: 12,
          lastActionAt: now,
        };
      }
      return {
        ...p,
        moisture: Math.max(0, p.moisture - 10),
        lastActionAt: now,
      };
    }
    if (p.status === "ready") {
      const drop = p.moisture > soft ? 4 : 2;
      return { ...p, moisture: Math.max(0, p.moisture - drop) };
    }
    return p;
  });

  let next: OpsState = { ...state, plots };
  if (drifted > 0) {
    next = pushLog(next, "info", `overnight · load drift on ${drifted} running site(s)`);
  }
  if (stressed > 0) {
    next = pushLog(
      next,
      "warn",
      `overnight · ${stressed} site(s) breached soft-cap · entered alert`,
    );
  }
  if (crashed > 0) {
    next = pushLog(
      next,
      "warn",
      `alert timeout · ${crashed} site(s) crashed · redeploy required`,
    );
  }

  const enabled = next.cron.filter((t) => t.enabled);
  for (const job of enabled) {
    next = runCron(next, job.id, { fromAuto: true });
  }
  if (enabled.length > 0) {
    next = pushLog(
      next,
      "info",
      `overnight automation · ${enabled.length} enabled cron job(s)`,
    );
  }

  next = maybeFireEvent(next);
  return next;
}

function bumpDay(state: OpsState): OpsState {
  return applyOvernight({ ...state, day: state.day + 1 });
}

/**
 * Advance in-game days from real elapsed time since lastTickAt.
 * Caps catch-up so returning after a long absence stays playable.
 * Call on panel open and on a short interval while the panel is open.
 */
export function advanceWallClock(
  state: OpsState,
  now: number = Date.now(),
): OpsState {
  const last = typeof state.lastTickAt === "number" ? state.lastTickAt : now;
  const due = Math.floor((now - last) / MS_PER_GAME_DAY);
  const days = Math.min(Math.max(0, due), MAX_CATCHUP_DAYS);
  if (days <= 0) return state;

  let next: OpsState = state;
  for (let i = 0; i < days; i++) {
    next = bumpDay(next);
  }
  // Drop excess beyond cap so we don't keep owing days forever.
  next = {
    ...next,
    lastTickAt: now,
  };
  if (days >= 2) {
    next = pushLog(
      next,
      "info",
      `wall-clock catch-up · advanced ${days} day(s) (cap ${MAX_CATCHUP_DAYS})`,
    );
  } else {
    next = pushLog(next, "info", `wall-clock · day advanced · uptime day ${next.day}`);
  }
  return next;
}

/** Single-site backup & release. */
export function releasePlot(state: OpsState, plotId: string): OpsState {
  const now = Date.now();
  const plot = state.plots.find((p) => p.id === plotId);
  if (!plot) {
    return pushLog(state, "warn", `release failed · unknown site ${plotId}`);
  }
  if (plot.status !== "ready" || !plot.crop) {
    return pushLog(state, "warn", `release aborted · ${plot.host} not pending`);
  }
  const crop = plot.crop;
  const gain = HARVEST_VALUE[crop] + TIER_RELEASE_BONUS[plot.tier];
  const plots = state.plots.map((p) =>
    p.id === plotId
      ? {
          ...p,
          status: "empty" as const,
          crop: null,
          growth: 0,
          moisture: Math.max(20, p.moisture - 15),
          lastActionAt: now,
        }
      : p,
  );
  let next: OpsState = {
    ...state,
    coins: state.coins + gain,
    inventory: bumpInventory(state.inventory, crop, 1),
    plots,
  };
  const bonusNote =
    TIER_RELEASE_BONUS[plot.tier] > 0
      ? ` (+${TIER_RELEASE_BONUS[plot.tier]} ${plot.tier})`
      : "";
  next = pushLog(
    next,
    "ok",
    `backup-release ${plot.host} · ${pkg(crop)} published · +${gain} credits${bonusNote}`,
  );
  return bumpDay(next);
}

/** Export harvested artifacts from Files for credits. */
export function exportArtifact(state: OpsState, crop: CropId, qty = 1): OpsState {
  const name = pkg(crop);
  const want = Math.max(1, Math.floor(qty));
  const row = state.inventory.find((i) => i.crop === crop);
  const have = row?.qty ?? 0;
  if (have < want) {
    return pushLog(
      state,
      "warn",
      `export ${name} failed · not enough files (${have}/${want})`,
    );
  }
  const unit = EXPORT_VALUE[crop];
  const gained = unit * want;
  return pushLog(
    {
      ...state,
      coins: state.coins + gained,
      inventory: bumpInventory(state.inventory, crop, -want),
    },
    "ok",
    `exported ${want}× ${name} artifact · +${gained} credits`,
  );
}

/** Provision an extra idle website (starts on basic tier). */
export function provisionSite(state: OpsState): OpsState {
  if (state.plots.length >= HOST_POOL.length) {
    return pushLog(state, "warn", "provision failed · site quota reached");
  }
  const cost = SITE_PROVISION_COST + Math.max(0, state.plots.length - 6) * 25;
  if (state.coins < cost) {
    return pushLog(
      state,
      "warn",
      `provision failed · insufficient balance (${state.coins}/${cost})`,
    );
  }
  const host = nextHost(state.plots);
  const plot: Plot = {
    id: nid("plot"),
    host,
    status: "empty",
    crop: null,
    growth: 0,
    moisture: 45,
    tier: "basic",
    lastActionAt: Date.now(),
  };
  return pushLog(
    {
      ...state,
      coins: state.coins - cost,
      plots: [...state.plots, plot],
    },
    "ok",
    `provisioned website ${host} (basic) · −${cost} credits`,
  );
}

export type RunCronOpts = { fromAuto?: boolean };

export function runCron(
  state: OpsState,
  taskId: CronTask["id"],
  opts: RunCronOpts = {},
): OpsState {
  const now = Date.now();
  const fromAuto = Boolean(opts.fromAuto);
  const cron = state.cron.map((t) =>
    t.id === taskId ? { ...t, lastRunAt: now } : t,
  );
  let next: OpsState = { ...state, cron };

  if (taskId === "water-all") {
    const plots = next.plots.map((p) => {
      const bonus = TIER_GROWTH_BONUS[p.tier];
      if (p.status === "empty") return { ...p, moisture: Math.min(100, p.moisture + 8) };
      if (p.status === "wilted") {
        return {
          ...p,
          status: "growing" as const,
          moisture: 55,
          growth: Math.min(99, p.growth + 10 + bonus),
          lastActionAt: now,
        };
      }
      if (p.status === "growing") {
        const soft = TIER_LOAD_SOFT_CAP[p.tier];
        const overCap = p.moisture > soft;
        const moisture = Math.min(100, p.moisture + (overCap ? 12 : 25));
        const growth = Math.min(
          100,
          p.growth + (overCap ? 10 : 18) + Math.floor(moisture / 20) + bonus,
        );
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
    next = pushLog(
      { ...next, plots },
      "ok",
      fromAuto
        ? "cron batch-health (auto) · refreshed metrics on all sites"
        : "cron batch-health · refreshed metrics on all sites",
    );
    return next;
  }

  if (taskId === "harvest-ready") {
    let coins = next.coins;
    let inventory = next.inventory;
    let harvested = 0;
    const plots = next.plots.map((p) => {
      if (p.status !== "ready" || !p.crop) return p;
      coins += HARVEST_VALUE[p.crop] + TIER_RELEASE_BONUS[p.tier];
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
    };
    next = pushLog(
      next,
      harvested > 0 ? "ok" : "info",
      harvested > 0
        ? `cron backup-release${fromAuto ? " (auto)" : ""} · ${harvested} sites published · balance updated`
        : `cron backup-release${fromAuto ? " (auto)" : ""} · no pending sites`,
    );
    if (harvested > 0 && !fromAuto) {
      return bumpDay(next);
    }
    return next;
  }

  // scan-pests
  let alerts = 0;
  const plots = next.plots.map((p) => {
    const soft = TIER_LOAD_SOFT_CAP[p.tier];
    if (p.status === "growing" && (p.moisture < 15 || p.moisture > soft + 8)) {
      alerts += 1;
      return { ...p, status: "wilted" as const };
    }
    if (p.status === "growing") {
      return { ...p, moisture: Math.max(0, p.moisture - 6) };
    }
    return p;
  });
  next = pushLog(
    { ...next, plots },
    alerts > 0 ? "warn" : "info",
    alerts > 0
      ? `cron security-scan${fromAuto ? " (auto)" : ""} · ${alerts} site(s) entered alert`
      : `cron security-scan${fromAuto ? " (auto)" : ""} · finished (no new alerts)`,
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
  const premium = state.plots.filter((p) => p.tier === "premium").length;
  return { growing, ready, empty, wilted, avgMoisture, seedStock, premium };
}

export function listAlerts(state: OpsState): Plot[] {
  return state.plots.filter((p) => p.status === "wilted");
}

export function msUntilNextDay(state: OpsState, now: number = Date.now()): number {
  const last = typeof state.lastTickAt === "number" ? state.lastTickAt : now;
  const elapsed = now - last;
  const rem = MS_PER_GAME_DAY - (elapsed % MS_PER_GAME_DAY);
  return rem <= 0 ? MS_PER_GAME_DAY : rem;
}

export type TermResult = { state: OpsState; echo: string[] };

const TERM_HELP = [
  "commands:",
  "  help                         show this help",
  "  status                       cluster summary",
  "  sites                        list websites",
  "  install <pkg>                buy from app store (nginx|mysql|redis|postgres)",
  "  deploy <host> <pkg>          deploy package on idle site",
  "  health [host]                health-check one site or batch-health",
  "  release [host]               backup-release one site or all pending",
  "  upgrade <host>               upgrade site plan (basic→standard→premium)",
  "  scan                         run security-scan",
  "  export <pkg> [qty]           export files for credits",
  "  provision                    add an idle website",
  "  clear                        clear terminal view",
];

function resolveCrop(token: string): CropId | null {
  const key = token.trim().toLowerCase();
  if (key in PACKAGE_FROM_SLUG) return PACKAGE_FROM_SLUG[key]!;
  if ((CROP_ORDER as string[]).includes(key)) return key as CropId;
  return null;
}

function findPlot(state: OpsState, token: string): Plot | undefined {
  const t = token.trim().toLowerCase();
  return state.plots.find(
    (p) =>
      p.host.toLowerCase() === t ||
      p.id.toLowerCase() === t ||
      p.host.toLowerCase().startsWith(t),
  );
}

/** Parse a terminal line into engine actions. Returns echo lines for the UI. */
export function runTerminalCommand(state: OpsState, raw: string): TermResult {
  const line = raw.trim().replace(/\s+/g, " ");
  if (!line) return { state, echo: [] };

  const parts = line.split(" ");
  const cmd = parts[0]!.toLowerCase();
  const echo: string[] = [`$ ${line}`];

  if (cmd === "help" || cmd === "?") {
    return { state, echo: [...echo, ...TERM_HELP] };
  }

  if (cmd === "clear" || cmd === "cls") {
    return { state, echo: ["__CLEAR__"] };
  }

  if (cmd === "status") {
    const s = dashboardStats(state);
    echo.push(
      `uptime day ${state.day} · balance ${state.coins}`,
      `sites ${state.plots.length} · running ${s.growing} · pending ${s.ready} · idle ${s.empty} · alert ${s.wilted}`,
      `avg load ${s.avgMoisture}% · apps ready ${s.seedStock} · premium ${s.premium}`,
    );
    return { state: pushLog(state, "info", "terminal status · queried"), echo };
  }

  if (cmd === "sites" || cmd === "ls") {
    for (const p of state.plots) {
      const app = p.crop ? pkg(p.crop) : "-";
      echo.push(
        `${p.host.padEnd(16)} ${p.status.padEnd(8)} ${p.tier.padEnd(9)} ${app.padEnd(10)} build=${p.growth}% load=${p.moisture}%`,
      );
    }
    return { state, echo };
  }

  if (cmd === "install") {
    const crop = parts[1] ? resolveCrop(parts[1]) : null;
    if (!crop) {
      echo.push("usage: install <nginx|mysql|redis|postgres>");
      return { state, echo };
    }
    const next = buySeed(state, crop);
    echo.push(next.logs[0]?.text ?? "done");
    return { state: next, echo };
  }

  if (cmd === "deploy") {
    if (parts.length < 3) {
      echo.push("usage: deploy <host> <pkg>");
      return { state, echo };
    }
    const plot = findPlot(state, parts[1]!);
    const crop = resolveCrop(parts[2]!);
    if (!plot) {
      echo.push(`unknown host: ${parts[1]}`);
      return { state, echo };
    }
    if (!crop) {
      echo.push(`unknown package: ${parts[2]}`);
      return { state, echo };
    }
    const next = plantOnPlot(state, plot.id, crop);
    echo.push(next.logs[0]?.text ?? "done");
    return { state: next, echo };
  }

  if (cmd === "health" || cmd === "check") {
    if (parts[1]) {
      const plot = findPlot(state, parts[1]);
      if (!plot) {
        echo.push(`unknown host: ${parts[1]}`);
        return { state, echo };
      }
      const next = healthCheckPlot(state, plot.id);
      echo.push(next.logs[0]?.text ?? "done");
      return { state: next, echo };
    }
    const next = runCron(state, "water-all");
    echo.push(next.logs[0]?.text ?? "done");
    return { state: next, echo };
  }

  if (cmd === "release" || cmd === "backup") {
    if (parts[1]) {
      const plot = findPlot(state, parts[1]);
      if (!plot) {
        echo.push(`unknown host: ${parts[1]}`);
        return { state, echo };
      }
      const next = releasePlot(state, plot.id);
      echo.push(next.logs[0]?.text ?? "done");
      return { state: next, echo };
    }
    const next = runCron(state, "harvest-ready");
    echo.push(next.logs[0]?.text ?? "done");
    return { state: next, echo };
  }

  if (cmd === "upgrade") {
    if (!parts[1]) {
      echo.push("usage: upgrade <host>");
      return { state, echo };
    }
    const plot = findPlot(state, parts[1]);
    if (!plot) {
      echo.push(`unknown host: ${parts[1]}`);
      return { state, echo };
    }
    const next = upgradePlotTier(state, plot.id);
    echo.push(next.logs[0]?.text ?? "done");
    return { state: next, echo };
  }

  if (cmd === "scan") {
    const next = runCron(state, "scan-pests");
    echo.push(next.logs[0]?.text ?? "done");
    return { state: next, echo };
  }

  if (cmd === "export") {
    const crop = parts[1] ? resolveCrop(parts[1]) : null;
    if (!crop) {
      echo.push("usage: export <pkg> [qty]");
      return { state, echo };
    }
    const qty = parts[2] ? Number.parseInt(parts[2], 10) : 1;
    if (!Number.isFinite(qty) || qty < 1) {
      echo.push("qty must be a positive integer");
      return { state, echo };
    }
    const next = exportArtifact(state, crop, qty);
    echo.push(next.logs[0]?.text ?? "done");
    return { state: next, echo };
  }

  if (cmd === "provision" || cmd === "new-site") {
    const next = provisionSite(state);
    echo.push(next.logs[0]?.text ?? "done");
    return { state: next, echo };
  }

  echo.push(`unknown command: ${cmd} · type help`);
  return { state, echo };
}

export function nextProvisionCost(state: OpsState): number {
  return SITE_PROVISION_COST + Math.max(0, state.plots.length - 6) * 25;
}

export type OpsSaveFile = {
  v: number;
  kind: "micromist-ops";
  exportedAt: number;
  data: OpsState;
};

export function buildSaveFile(state: OpsState): OpsSaveFile {
  return {
    v: 1,
    kind: "micromist-ops",
    exportedAt: Date.now(),
    data: state,
  };
}

export function parseSaveFile(raw: unknown): OpsState | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Partial<OpsSaveFile> & { data?: unknown };
  if (obj.kind === "micromist-ops" && obj.data != null) {
    return normalizeState(obj.data);
  }
  // Accept bare state JSON too.
  return normalizeState(raw);
}
