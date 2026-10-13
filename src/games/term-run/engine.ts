/**
 * Side-runner: terrain Y from log line length; status codes as hazards.
 * py / groundY are fractions of view height (0 = top).
 * vy is in fraction/s (converted from px/s via viewH).
 */

import {
  heightOf,
  makeLogLine,
  sampleAsLines,
  synthLogs,
  type LogLine,
} from "./logs";

export const SEG_W = 72;
export const GROUND_BASE = 0.78;
export const GROUND_AMP = 0.42;
export const GRAVITY = 2200; // px/s²
export const JUMP_V = -620; // px/s
export const SLIDE_MS = 380;
export const RUN_SPEED_0 = 220;
export const RUN_SPEED_MAX = 380;
export const PLAYER_W = 14;
export const PLAYER_H = 22;
export const PLAYER_H_SLIDE = 12;
export const MAX_UPTIME = 3;

export type HazardKind = "none" | "ice" | "rubble" | "lava" | "bump";

export type Segment = {
  index: number;
  line: LogLine;
  x: number;
  groundY: number;
  hazard: HazardKind;
  boost: boolean;
  scored: boolean;
};

export type GamePhase = "ready" | "running" | "dead";

export type EngineState = {
  phase: GamePhase;
  t: number;
  distance: number;
  score: number;
  combo: number;
  okCount: number;
  linesPassed: number;
  uptime: number;
  speed: number;
  px: number;
  py: number;
  vy: number;
  onGround: boolean;
  sliding: boolean;
  slideLeft: number;
  segments: Segment[];
  nextIndex: number;
  gen: Generator<LogLine, void, unknown>;
  prevH: number;
  deathReason: string;
  seed: number;
};

function hazardFor(line: LogLine): { hazard: HazardKind; boost: boolean } {
  if (line.cliff) return { hazard: "lava", boost: false };
  const ms = line.ms ?? 0;
  const boost = ms >= 100;
  switch (line.statusClass) {
    case "ok":
      return { hazard: boost ? "bump" : "none", boost };
    case "redirect":
      return { hazard: "ice", boost };
    case "client":
      return { hazard: "rubble", boost };
    case "server":
      return { hazard: "lava", boost };
    default:
      return { hazard: boost ? "bump" : "none", boost };
  }
}

function groundYFromHeight(h: number): number {
  if (h <= 0) return GROUND_BASE + 0.35;
  return GROUND_BASE - h * GROUND_AMP;
}

function smoothHeight(prev: number, next: number): number {
  return prev * 0.25 + next * 0.75;
}

function pushSeg(state: EngineState, line: LogLine, x: number): void {
  const rawH = heightOf(line);
  const h = line.cliff ? 0 : smoothHeight(state.prevH, rawH);
  state.prevH = line.cliff ? state.prevH * 0.5 : h;
  const { hazard, boost } = hazardFor(line);
  state.segments.push({
    index: state.nextIndex,
    line,
    x,
    groundY: groundYFromHeight(line.cliff ? 0 : h),
    hazard: line.cliff ? "lava" : hazard,
    boost,
    scored: false,
  });
  state.nextIndex += 1;
}

export function createEngine(seed = Date.now() % 1_000_000): EngineState {
  const sample = sampleAsLines();
  let sampleIdx = 0;
  const synth = synthLogs({ seed });

  function* combined(): Generator<LogLine, void, unknown> {
    while (sampleIdx < sample.length) {
      yield sample[sampleIdx++]!;
    }
    for (const line of synth) yield line;
  }

  const gen = combined();
  const state: EngineState = {
    phase: "ready",
    t: 0,
    distance: 0,
    score: 0,
    combo: 0,
    okCount: 0,
    linesPassed: 0,
    uptime: MAX_UPTIME,
    speed: RUN_SPEED_0,
    px: SEG_W * 2.2,
    py: GROUND_BASE,
    vy: 0,
    onGround: true,
    sliding: false,
    slideLeft: 0,
    segments: [],
    nextIndex: 0,
    gen,
    prevH: 0.35,
    deathReason: "",
    seed,
  };

  for (let i = 0; i < 28; i++) {
    const line = gen.next().value as LogLine;
    pushSeg(state, line, i * SEG_W);
  }

  const startY = state.segments[2]?.groundY ?? GROUND_BASE;
  state.py = startY - PLAYER_H / 480;
  return state;
}

function ensureSegments(state: EngineState, untilX: number): void {
  while (true) {
    const last = state.segments[state.segments.length - 1];
    if (!last || last.x + SEG_W > untilX) break;
    const line = (state.gen.next().value as LogLine) ?? makeLogLine("");
    pushSeg(state, line, last.x + SEG_W);
  }
  const cut = state.px - SEG_W * 8;
  while (state.segments.length > 0 && state.segments[0]!.x + SEG_W < cut) {
    state.segments.shift();
  }
}

function segAt(state: EngineState, x: number): Segment | null {
  for (const s of state.segments) {
    if (x >= s.x && x < s.x + SEG_W) return s;
  }
  return null;
}

export function groundAt(
  state: EngineState,
  x: number,
): { y: number; seg: Segment | null } {
  const seg = segAt(state, x);
  if (!seg) return { y: GROUND_BASE + 0.4, seg: null };
  const next = segAt(state, seg.x + SEG_W) ?? seg;
  const t = (x - seg.x) / SEG_W;
  const y = seg.groundY + (next.groundY - seg.groundY) * t;
  return { y, seg };
}

/** @returns true if the run ended */
function hurt(state: EngineState, reason: string): boolean {
  state.uptime -= 1;
  state.combo = 0;
  if (state.uptime <= 0) {
    state.phase = "dead";
    state.deathReason = reason;
    return true;
  }
  return false;
}

export function jump(state: EngineState, viewH: number): void {
  if (state.phase === "ready") state.phase = "running";
  if (state.phase !== "running") return;
  const toFrac = 1 / Math.max(viewH, 1);
  if (state.onGround || state.sliding) {
    let v = JUMP_V * toFrac;
    const { seg } = groundAt(state, state.px + PLAYER_W * 0.5);
    if (seg?.boost) v *= 1.35;
    state.vy = v;
    state.onGround = false;
    state.sliding = false;
    state.slideLeft = 0;
  }
}

export function slide(state: EngineState): void {
  if (state.phase === "ready") state.phase = "running";
  if (state.phase !== "running") return;
  if (!state.onGround) return;
  state.sliding = true;
  state.slideLeft = SLIDE_MS / 1000;
}

export function step(state: EngineState, dt: number, viewH: number): void {
  if (state.phase !== "running") return;
  const dts = Math.min(Math.max(dt, 0), 0.05);
  const vh = Math.max(viewH, 1);
  const toFrac = 1 / vh;

  state.t += dts;
  state.speed = Math.min(RUN_SPEED_MAX, RUN_SPEED_0 + state.linesPassed * 1.15);
  state.px += state.speed * dts;
  state.distance = state.px;
  ensureSegments(state, state.px + SEG_W * 20);

  if (state.sliding) {
    state.slideLeft -= dts;
    if (state.slideLeft <= 0) {
      state.sliding = false;
      state.slideLeft = 0;
    }
  }

  state.vy += GRAVITY * toFrac * dts;
  state.py += state.vy * dts;

  const footX = state.px + PLAYER_W * 0.5;
  const { y: gy, seg } = groundAt(state, footX);
  const ph = (state.sliding ? PLAYER_H_SLIDE : PLAYER_H) * toFrac;
  const footY = state.py + ph;

  if (state.vy >= 0 && footY >= gy) {
    if (seg && seg.line.cliff) {
      if (state.py > gy + 0.02) {
        if (hurt(state, "Connection reset by peer (void)")) return;
        state.py = gy - ph - 0.02;
        state.vy = JUMP_V * toFrac * 0.5;
        state.onGround = false;
      }
    } else {
      state.py = gy - ph;
      state.vy = 0;
      state.onGround = true;

      if (seg && !seg.scored) {
        seg.scored = true;
        state.linesPassed += 1;
        if (seg.hazard === "lava") {
          hurt(state, `HTTP ${seg.line.status ?? 500} — Internal Server Error`);
        } else if (seg.hazard === "rubble") {
          hurt(state, `HTTP ${seg.line.status ?? 404} — Client Error`);
        } else if (seg.hazard === "ice") {
          state.speed = Math.min(RUN_SPEED_MAX + 40, state.speed + 40);
          state.score += 5;
          state.combo += 1;
        } else if (seg.line.statusClass === "ok") {
          state.okCount += 1;
          state.combo += 1;
          const mult = 1 + Math.min(4, Math.floor(state.combo / 5));
          state.score += 10 * mult;
        } else {
          state.score += 2;
        }
      }
    }
  } else {
    state.onGround = false;
    if (seg && !seg.scored && seg.hazard === "lava" && !seg.line.cliff) {
      if (state.py + ph < gy - 0.015) {
        seg.scored = true;
        state.linesPassed += 1;
        state.combo += 1;
        state.score += 25;
      }
    }
  }

  if (state.py > 1.25) {
    state.uptime = 0;
    state.phase = "dead";
    state.deathReason = "Process terminated (segfault)";
  }
}

export function resetEngine(seed?: number): EngineState {
  return createEngine(seed ?? Date.now() % 1_000_000);
}
