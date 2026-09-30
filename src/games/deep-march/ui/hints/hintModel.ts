/**
 * New-player hints of the conserve mode (MVP plan M9: 采集 → 建核心 → 存入 →
 * 唤潮, then 重扫 — the sonar record is stale — and 放流 after the first tide). Pure: the progress is a list of steps
 * done plus an "all off" flag; each poll of the HUD telemetry becomes an
 * observation that completes steps on its own (doing the thing is the best
 * dismissal), and the card shows the first step not done whose moment has
 * come. A returning player (generation ≥ 2) starts with the first four done.
 */
export const HINT_STEPS = ["absorb", "core", "deposit", "tide", "rescan", "release"] as const;
export type HintStep = (typeof HINT_STEPS)[number];

export type HintProgress = { readonly done: readonly HintStep[]; readonly off: boolean };
export const NO_PROGRESS: HintProgress = { done: [], off: false };

/** One poll of the dive, as the hints see it. */
export type HintObservation = {
  /** Particles in the tank now. */
  tank: number;
  founded: boolean;
  /** A deposit / release notice is showing (they last a few seconds: the 8 Hz poll sees them). */
  deposited: boolean;
  released: boolean;
  /** The generation being played. */
  gen: number;
  /** A tide was called (warning, show, murk or done). */
  tideCalled: boolean;
  /** Sonar observation mode (N) is on. */
  observing: boolean;
  /** Something else owns the screen: a tide, the recall, the base panel, the loading screen. */
  busy: boolean;
};

/** Steps the observation completes. */
function reached(o: HintObservation): HintStep[] {
  const later = o.gen >= 2;
  const out: HintStep[] = [];
  if (o.tank > 0 || o.deposited || later) out.push("absorb");
  if (o.founded) out.push("core");
  if (o.deposited || later) out.push("deposit");
  if (o.tideCalled || later) out.push("tide");
  if (o.observing && later) out.push("rescan");
  if (o.released) out.push("release");
  return out;
}

/** Whether a step's moment has come (deposit and 唤潮 need the core; 重扫 and 放流 follow the first tide). */
function available(step: HintStep, o: HintObservation): boolean {
  if (step === "deposit" || step === "tide") return o.founded;
  if (step === "release" || step === "rescan") return o.gen >= 2;
  return true;
}

/** The progress after an observation (the same object when nothing changed). */
export function observe(p: HintProgress, o: HintObservation): HintProgress {
  const add = reached(o).filter((s) => !p.done.includes(s));
  return add.length ? { ...p, done: HINT_STEPS.filter((s) => p.done.includes(s) || add.includes(s)) } : p;
}

/** The hint to show now, or null. */
export function currentHint(p: HintProgress, o: HintObservation): HintStep | null {
  if (p.off || o.busy) return null;
  return HINT_STEPS.find((s) => !p.done.includes(s) && available(s, o)) ?? null;
}

/** 「知道了」: this step is done. */
export function dismissHint(p: HintProgress, step: HintStep): HintProgress {
  return p.done.includes(step) ? p : { ...p, done: HINT_STEPS.filter((s) => s === step || p.done.includes(s)) };
}

/** 「不再提示」 / the setup switch. Turning hints back on starts them over. */
export function setHintsOn(p: HintProgress, on: boolean): HintProgress {
  return on ? NO_PROGRESS : { ...p, off: true };
}

/** Stored progress → valid progress (anything odd → from the start). */
export function parseProgress(raw: unknown): HintProgress {
  const r = raw && typeof raw === "object" ? (raw as { done?: unknown; off?: unknown }) : {};
  const done = Array.isArray(r.done) ? HINT_STEPS.filter((s) => (r.done as unknown[]).includes(s)) : [];
  return { done, off: r.off === true };
}
