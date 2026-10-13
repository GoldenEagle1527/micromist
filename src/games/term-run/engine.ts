/**
 * Pure obstacle runner in a fake access.log scroll.
 * Player stays screen-centered; world scrolls past.
 * One `#` bump = single jump; two consecutive `#` = double jump; blank = gap.
 * No line-length terrain.
 */

import { makeLogLine, sampleAsLines, synthLogs, type LogLine } from "./logs";

export const GRAVITY = 30;
export const JUMP_V = 12;
export const SCROLL_0 = 3.0;
export const SCROLL_MAX = 8;
export const MAX_JUMPS = 2;
const BODY_H = 0.8;
const BODY_W = 0.12;

export type GamePhase = "ready" | "running" | "dead";

export type EngineState = {
  phase: GamePhase;
  t: number;
  score: number;
  linesPassed: number;
  /** World progress (line index). Camera locks this to screen center. */
  progress: number;
  /** Jump height above ground (0 = on floor). */
  height: number;
  vh: number;
  onGround: boolean;
  jumpsLeft: number;
  lines: LogLine[];
  gen: Generator<LogLine, void, unknown>;
  deathReason: string;
  seed: number;
  scoredAt: number;
};

export function createEngine(seed = Date.now() % 1_000_000): EngineState {
  const sample = sampleAsLines();
  let sampleIdx = 0;

  function* live(): Generator<LogLine, void, unknown> {
    while (sampleIdx < sample.length) {
      yield sample[sampleIdx++]!;
    }
    let emitted = 0;
    while (true) {
      const batch = synthLogs({
        seed: seed + emitted * 997,
        difficulty: emitted / 70,
      });
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
  for (let i = 0; i < 80; i++) {
    lines.push((gen.next().value as LogLine) ?? makeLogLine(""));
  }

  const start = 8;
  return {
    phase: "ready",
    t: 0,
    score: 0,
    linesPassed: 0,
    progress: start,
    height: 0,
    vh: 0,
    onGround: true,
    jumpsLeft: MAX_JUMPS,
    lines,
    gen,
    deathReason: "",
    seed,
    scoredAt: start,
  };
}

function ensureLines(state: EngineState): void {
  const need = Math.floor(state.progress) + 48;
  while (state.lines.length <= need) {
    state.lines.push((state.gen.next().value as LogLine) ?? makeLogLine(""));
  }
}

function lineAt(state: EngineState, idx: number): LogLine | null {
  const i = Math.floor(idx);
  if (i < 0 || i >= state.lines.length) return null;
  return state.lines[i]!;
}

/** Each bump cell is height 1; two in a row need a double jump to clear both. */
export function obstacleHeightAt(state: EngineState, i: number): number {
  const line = lineAt(state, i);
  if (!line || line.bump <= 0) return 0;
  return 1;
}

function isGapAt(state: EngineState, idx: number): boolean {
  const line = lineAt(state, idx);
  return !line || line.kind === "gap";
}

function hasFloor(state: EngineState, idx: number): boolean {
  return !isGapAt(state, idx);
}

function hitBump(state: EngineState): boolean {
  const p = state.progress;
  const feet = state.height;
  const head = state.height + BODY_H;
  const lo = Math.floor(p - BODY_W);
  const hi = Math.floor(p + BODY_W);
  for (let i = lo; i <= hi; i++) {
    const oh = obstacleHeightAt(state, i);
    if (oh <= 0) continue;
    const gateLo = i;
    const gateHi = i + 0.55;
    if (p + BODY_W < gateLo || p - BODY_W > gateHi) continue;
    if (feet < oh && head > 0) return true;
  }
  return false;
}

function die(state: EngineState, reason: string): void {
  state.phase = "dead";
  state.deathReason = reason;
}

export function jump(state: EngineState): void {
  if (state.phase === "ready") state.phase = "running";
  if (state.phase !== "running") return;
  if (state.jumpsLeft <= 0) return;
  state.vh = JUMP_V;
  state.onGround = false;
  state.jumpsLeft -= 1;
}

function scorePass(state: EngineState): void {
  const idx = Math.floor(state.progress);
  if (idx <= state.scoredAt) return;
  for (let i = state.scoredAt + 1; i <= idx; i++) {
    state.linesPassed += 1;
    const line = lineAt(state, i);
    if (!line || line.kind === "gap") state.score += 2;
    else if (line.bump > 0) state.score += 5;
    else state.score += 1;
  }
  state.scoredAt = idx;
}

export function step(state: EngineState, dt: number): void {
  if (state.phase === "dead") return;
  const dts = Math.min(Math.max(dt, 0), 0.05);
  state.t += dts;

  const scroll = Math.min(
    SCROLL_MAX,
    (state.phase === "ready" ? SCROLL_0 * 0.75 : SCROLL_0) +
      state.linesPassed * 0.01,
  );

  if (state.phase === "ready") {
    state.progress += scroll * dts;
    ensureLines(state);
    state.height = 0;
    state.vh = 0;
    state.onGround = true;
    state.jumpsLeft = MAX_JUMPS;
    state.scoredAt = Math.floor(state.progress);
    return;
  }

  state.progress += scroll * dts;
  ensureLines(state);
  scorePass(state);

  if (!state.onGround) {
    state.vh -= GRAVITY * dts;
    state.height += state.vh * dts;
    if (state.height <= 0) {
      state.height = 0;
      state.vh = 0;
      if (!hasFloor(state, state.progress)) {
        die(state, "Connection reset by peer (gap)");
        return;
      }
      if (hitBump(state)) {
        die(state, "broken pipe");
        return;
      }
      state.onGround = true;
      state.jumpsLeft = MAX_JUMPS;
    }
  } else if (!hasFloor(state, state.progress)) {
    state.onGround = false;
    state.vh = 0;
    state.height = 0.01;
  }

  if (hitBump(state)) {
    die(state, "broken pipe");
    return;
  }

  if (state.height < -0.5) {
    die(state, "Process terminated (segfault)");
  }
}

export function resetEngine(seed?: number): EngineState {
  return createEngine(seed ?? Date.now() % 1_000_000);
}
