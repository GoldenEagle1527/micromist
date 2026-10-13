/**
 * Ordinary terminal look: uniform text, no game chrome.
 * Player caret locked to vertical center; logs scroll past.
 * Bumps = a leading "#" in the gutter; gaps = blank rows.
 */

import type { EngineState } from "./engine";
import type { LogLine } from "./logs";

const BG = "#000000";
const FG = "#cccccc";
const FG_DIM = "#777777";
const FG_FAINT = "#555555";

function gutterOf(line: LogLine): string {
  if (line.kind === "gap") return "  ";
  if (line.bump > 0) return "# ";
  return "  ";
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

  const padX = Math.max(6, Math.floor(w * 0.01));
  const fontPx = Math.max(12, Math.min(14, Math.floor(h / 48)));
  const rowH = fontPx + 3;
  const rowsHalf = Math.max(6, Math.floor(h / rowH / 2));

  ctx.font = `${fontPx}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace`;
  ctx.textBaseline = "top";
  const charW = ctx.measureText("M").width;

  // Camera: player progress is always at vertical center
  const centerY = Math.floor(h / 2 - fontPx / 2);
  const progress = state.progress;
  const first = Math.floor(progress - rowsHalf) - 1;
  const last = Math.ceil(progress + rowsHalf) + 1;

  const maxChars = Math.max(24, Math.floor((w - padX * 2) / charW) - 2);

  for (let i = first; i <= last; i++) {
    if (i < 0 || i >= state.lines.length) continue;
    const line = state.lines[i]!;
    const y = centerY + (i - progress) * rowH;
    if (y < -rowH || y > h + rowH) continue;

    // Jump offset only for drawing player — lines stay put
    const gutter = gutterOf(line);
    let text: string;
    if (line.kind === "gap") {
      text = "";
    } else {
      const body =
        line.raw.length > maxChars
          ? line.raw.slice(0, maxChars - 1) + "…"
          : line.raw;
      text = gutter + body;
    }

    // Uniform color — real terminals don't rainbow status codes here
    ctx.globalAlpha = 1;
    ctx.fillStyle = FG;
    if (text) ctx.fillText(text, padX, y);
  }
  ctx.globalAlpha = 1;

  // Player caret — always at horizontal gutter + vertical center, lift when jumping
  const caretX = padX;
  const caretY = centerY - state.height * rowH;
  const blinkOn =
    opts.blink % 1.1 < 0.75 || !state.onGround || state.phase !== "running";
  if (blinkOn && caretY > -fontPx && caretY < h) {
    ctx.fillStyle = FG;
    ctx.fillRect(caretX, caretY, Math.max(2, charW * 0.9), fontPx);
  }

  // Minimal top line — looks like the shell that launched tail
  ctx.fillStyle = FG_DIM;
  const top =
    state.phase === "dead"
      ? `$ tail -f access.log`
      : `$ tail -f access.log`;
  ctx.fillText(top, padX, 4);

  // Score disguised as a dim status comment — only when running/dead
  if (state.phase !== "ready") {
    ctx.fillStyle = FG_FAINT;
    const meta = `# ${state.score}  best=${opts.best}`;
    ctx.fillText(meta, padX + ctx.measureText(top + "  ").width, 4);
  }

  if (state.phase === "ready") {
    // One faint comment, no overlay card
    ctx.fillStyle = FG_FAINT;
    const tip =
      opts.locale === "zh"
        ? `# space`
        : `# space`;
    ctx.fillText(tip, padX, centerY - rowH * 2);
  }

  if (state.phase === "dead") {
    ctx.fillStyle = FG;
    const y0 = centerY - rowH;
    ctx.fillText(`ERROR: ${state.deathReason || "Connection reset"}`, padX, y0);
    ctx.fillStyle = FG_DIM;
    ctx.fillText(
      `# score=${state.score} lines=${state.linesPassed}  ·  space to retry`,
      padX,
      y0 + rowH,
    );
  }
}
