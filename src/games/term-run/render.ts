/**
 * Pure terminal look: dense uvicorn.access lines, vertical scroll.
 * No platformer chrome, no hearts/combo, no jagged terrain stroke.
 * Player = blinking block caret on the focus line.
 */

import { MAX_ERR, type EngineState } from "./engine";
import type { LogLine } from "./logs";

const BG = "#0c0c0c";
const FG = "#d4d4d4";
const FG_DIM = "#6a6a6a";
const FG_MUTED = "#3c3c3c";
const GREEN = "#4ec94e";
const AMBER = "#ce9178";
const RED = "#f44747";
const STATUS_OK = "#b5cea8";
const STATUS_3 = "#569cd6";
const STATUS_4 = "#ce9178";
const STATUS_5 = "#f44747";

function lineColor(line: LogLine, isFocus: boolean): string {
  if (line.cliff) return FG_MUTED;
  switch (line.statusClass) {
    case "server":
      return STATUS_5;
    case "client":
      return STATUS_4;
    case "redirect":
      return STATUS_3;
    case "ok":
      return isFocus ? FG : STATUS_OK;
    default:
      return isFocus ? FG : FG_DIM;
  }
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  state: EngineState,
  w: number,
  h: number,
  opts: { best: number; blink: number; locale: "zh" | "en" },
): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  const padX = Math.max(8, Math.floor(w * 0.012));
  const promptH = Math.max(18, Math.floor(h * 0.032));
  const fontPx = Math.max(11, Math.min(15, Math.floor(h / 42)));
  const rowH = fontPx + 4;
  const rows = Math.max(8, Math.floor((h - promptH * 2 - 8) / rowH));

  ctx.font = `${fontPx}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace`;
  ctx.textBaseline = "top";

  const last = Math.floor(state.streamHead);
  const first = Math.max(0, last - rows + 1);
  const frac = state.streamHead - last; // sub-line scroll
  const topY = promptH + 6 - frac * rowH;

  const focusIdx = Math.floor(state.py);
  const charW = ctx.measureText("M").width;

  // Log lines (newest toward bottom)
  for (let i = first; i <= last + 1; i++) {
    const line = state.lines[i];
    if (!line) continue;
    const row = i - first;
    const y = topY + row * rowH;
    if (y < promptH || y > h - promptH - 4) continue;

    const isFocus = i === focusIdx;
    const age = last - i;
    let col = lineColor(line, isFocus);
    if (!isFocus && age > 8) {
      // older lines fade — like a real scrollback
      ctx.globalAlpha = Math.max(0.35, 1 - age * 0.04);
    } else {
      ctx.globalAlpha = 1;
    }
    if (state.warnFlash > 0 && isFocus) {
      col = AMBER;
    }

    const text = line.cliff ? "" : line.raw;
    // Clip to canvas width in characters
    const maxChars = Math.max(20, Math.floor((w - padX * 2) / charW));
    const shown = text.length > maxChars ? text.slice(0, maxChars - 1) + "…" : text;
    ctx.fillStyle = col;
    ctx.fillText(shown || (line.cliff ? "" : " "), padX, y);

    // Dim pad to the right of short lines — keeps the ragged edge readable
    if (!line.cliff && line.len < maxChars && isFocus) {
      // nothing — ragged edge is natural
    }
  }
  ctx.globalAlpha = 1;

  // Player caret — block cursor at (px column, py row), not a sprite
  const caretRow = state.py - first;
  const caretY = topY + caretRow * rowH;
  const caretX = padX + state.px * charW;
  const blinkOn = opts.blink % 1.05 < 0.72 || !state.onGround || state.phase === "ready";
  if (blinkOn && caretY > promptH && caretY < h - promptH) {
    ctx.fillStyle = state.phase === "dead" ? RED : GREEN;
    ctx.globalAlpha = state.onGround ? 0.95 : 0.7;
    ctx.fillRect(Math.min(caretX, w - padX - charW), caretY, Math.max(2, charW * 0.85), fontPx);
    ctx.globalAlpha = 1;
  }

  // Top prompt — only HUD, disguised as shell
  ctx.fillStyle = FG_DIM;
  const errs = `${state.errs}/${MAX_ERR}`;
  const prompt =
    state.phase === "dead"
      ? `$ tail -f access.log  # terminated  bytes=${state.score}  best=${opts.best}`
      : `$ tail -f access.log  # bytes=${state.score}  ok=${state.okCount}  lines=${state.linesPassed}  err=${errs}`;
  ctx.fillText(prompt, padX, 4);

  // Bottom status line — looks like a shell prompt, not a game HUD
  ctx.fillStyle = FG_MUTED;
  const bottom =
    opts.locale === "zh"
      ? `~/logs $  space=跳过异常行  ·  best=${opts.best}`
      : `~/logs $  space=skip  ·  best=${opts.best}`;
  ctx.fillText(bottom, padX, h - promptH);

  if (state.phase === "ready") {
    // No dim overlay title card — only a comment line in the stream band
    ctx.fillStyle = FG_DIM;
    const tip =
      opts.locale === "zh"
        ? "# space / 点击 开始  ·  跳过 5xx 与空行  ·  旁人只看见日志在刷"
        : "# space / click to follow  ·  skip 5xx & voids  ·  looks like logs";
    ctx.fillText(tip, padX, h * 0.42);
  }

  if (state.phase === "dead") {
    // Inline "error" lines — still terminal, not a game over modal
    ctx.fillStyle = RED;
    const y0 = h * 0.4;
    ctx.fillText(`ERROR: ${state.deathReason || "Connection reset"}`, padX, y0);
    ctx.fillStyle = AMBER;
    ctx.fillText(
      `# bytes=${state.score} ok=${state.okCount} lines=${state.linesPassed}  ·  space to retry`,
      padX,
      y0 + rowH,
    );
  }
}
