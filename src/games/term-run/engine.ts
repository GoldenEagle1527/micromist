/**
 * Vertical access-log runner (fish-slacking).
 * Looks like `tail -f`: lines scroll up, newest at bottom.
 * Player caret rides the ragged right edge — line length = ground column.
 * Jump hops to older lines to skip 5xx / voids.
 */

import {
  heightOf,
  makeLogLine,
  sampleAsLines,
  synthLogs,
  type LogLine,
} from "./logs";

export const GRAVITY = 52; // lines/s²
export const JUMP_V = -15; // lines/s (negative = older / up screen)
export const SCROLL_0 = 3.4; // lines/s
export const SCROLL_MAX = 8;
export const MAX_ERR = 3;

export type GamePhase = "ready" | "running" | "dead";

export type EngineState = {
  phase: GamePhase;
  t: number;
  score: number;
  okCount: number;
  linesPassed: number;
  errs: number;
  /** Newest line index at bottom of the buffer (fractional). */
  streamHead: number;
  /** Player position in line-index space. */
  py: number;
  vy: number;
  onGround: boolean;
  /** Column in characters; tracks line length on ground. */
  px: number;
  lines: LogLine[];
  gen: Generator<LogLine, void, unknown>;
  deathReason: string;
  seed: number;
  warnFlash: number;
  /** Last integer line we already settled on (avoid double-score). */
  settled: number;
};

export function createEngine(seed = Date.now() % 1_000_000): EngineState {
  const sample = sampleAsLines();
  let sampleIdx = 0;

  function* live(): Generator<LogLine, void, unknown> {
    while (sampleIdx < sample.length) {
      yield sample[sampleIdx++]!;
    }
    // Endless synth; difficulty climbs with emitted count
    let emitted = 0;
    while (true) {
      const batch = synthLogs({
        seed: seed + emitted * 997,
        difficulty: emitted / 70,
      });
      // Take a chunk then bump difficulty
      for (let n = 0; n < 24; n++) {
        const v = batch.next().value as LogLine | undefined;
        if (!v) break;
        emitted += 1;
        yield v;
      }
    }
  }

  const gen = live();
  const lines: LogLine[] = [];
  for (let i = 0; i < 56; i++) {
    lines.push((gen.next().value as LogLine) ?? makeLogLine(""));
  }

  const startIdx = lines.length - 5;
  const startLine = lines[startIdx]!;
  return {
    phase: "ready",
    t: 0,
    score: 0,
    okCount: 0,
    linesPassed: 0,
    errs: 0,
    streamHead: lines.length - 1,
    py: startIdx,
    vy: 0,
    onGround: true,
    px: startLine.cliff ? 2 : startLine.len,
    lines,
    gen,
    deathReason: "",
    seed,
    warnFlash: 0,
    settled: startIdx,
  };
}

function ensureLines(state: EngineState): void {
  const need = Math.floor(state.streamHead) + 32;
  while (state.lines.length <= need) {
    state.lines.push((state.gen.next().value as LogLine) ?? makeLogLine(""));
  }
}

function lineAt(state: EngineState, idx: number): LogLine | null {
  const i = Math.floor(idx);
  if (i < 0 || i >= state.lines.length) return null;
  return state.lines[i]!;
}

function hurt(state: EngineState, reason: string): boolean {
  state.errs += 1;
  if (state.errs >= MAX_ERR) {
    state.phase = "dead";
    state.deathReason = reason;
    return true;
  }
  return false;
}

/** @returns false if the run ended */
function settle(state: EngineState, idx: number): boolean {
  const line = lineAt(state, idx);
  if (!line) return true;
  if (idx === state.settled) {
    if (!line.cliff) {
      state.px = line.len;
    }
    return true;
  }
  state.settled = idx;
  state.linesPassed += 1;
  state.py = idx;
  state.onGround = true;
  state.vy = 0;

  if (line.cliff) {
    state.onGround = false;
    state.vy = 3;
    return !hurt(state, "Connection reset by peer (void)");
  }

  state.px = line.len;
  const h = heightOf(line);
  if (line.statusClass === "server") {
    return !hurt(state, `HTTP ${line.status ?? 500} — Internal Server Error`);
  }
  if (line.statusClass === "client") {
    state.warnFlash = 0.5;
    state.score = Math.max(0, state.score - 5);
  } else if (line.statusClass === "redirect") {
    state.score += 3;
  } else if (line.statusClass === "ok") {
    state.okCount += 1;
    state.score += Math.round(8 + h * 12);
  } else {
    state.score += 1;
  }
  return true;
}

export function jump(state: EngineState): void {
  if (state.phase === "ready") state.phase = "running";
  if (state.phase !== "running") return;
  if (state.onGround) {
    state.vy = JUMP_V;
    state.onGround = false;
  }
}

export function step(state: EngineState, dt: number): void {
  if (state.phase === "dead") return;
  const dts = Math.min(Math.max(dt, 0), 0.05);

  state.t += dts;
  if (state.warnFlash > 0) state.warnFlash = Math.max(0, state.warnFlash - dts);

  // Idle ready: keep the log scrolling so bystanders only see tail -f
  const scroll = Math.min(
    SCROLL_MAX,
    (state.phase === "ready" ? SCROLL_0 * 0.85 : SCROLL_0) + state.linesPassed * 0.014,
  );
  state.streamHead += scroll * dts;
  ensureLines(state);

  if (state.phase === "ready") {
    // Keep caret glued to a near-bottom line while idling
    const focus = state.streamHead - 4;
    state.py = focus;
    const line = lineAt(state, focus);
    if (line && !line.cliff) {
      state.px += (line.len - state.px) * Math.min(1, 10 * dts);
    }
    return;
  }

  if (state.onGround) {
    // Ride the stream: advance through lines with scroll
    const prev = Math.floor(state.py);
    state.py += scroll * dts;
    const next = Math.floor(state.py);
    for (let i = prev + 1; i <= next; i++) {
      if (!settle(state, i)) return;
      if (!state.onGround) break;
    }
    if (state.onGround) {
      const line = lineAt(state, state.py);
      if (line && !line.cliff) {
        state.px += (line.len - state.px) * Math.min(1, 16 * dts);
      }
    }
  } else {
    state.vy += GRAVITY * dts;
    const prev = state.py;
    state.py += state.vy * dts;

    if (state.vy > 0) {
      const from = Math.floor(prev);
      const to = Math.floor(state.py);
      for (let i = from + 1; i <= to; i++) {
        const line = lineAt(state, i);
        if (!line) continue;
        if (line.cliff) continue; // fall through
        if (!settle(state, i)) return;
        if (state.onGround) break;
      }
    }

    if (state.py > state.streamHead + 1.5) {
      state.phase = "dead";
      state.deathReason = "Process terminated (segfault)";
      return;
    }
    if (state.py < state.streamHead - 30) {
      state.vy = Math.max(state.vy, 4);
    }
  }
}

export function resetEngine(seed?: number): EngineState {
  return createEngine(seed ?? Date.now() % 1_000_000);
}

export function visibleRange(
  state: EngineState,
  rows: number,
): { first: number; last: number } {
  const last = Math.floor(state.streamHead);
  const first = Math.max(0, last - rows + 1);
  return { first, last };
}
