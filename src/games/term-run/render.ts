/**
 * Fish-slacking terminal look: bystanders see scrolling access logs;
 * player is a cursor block running on the line-length skyline.
 */

import {
  PLAYER_H,
  PLAYER_H_SLIDE,
  PLAYER_W,
  SEG_W,
  type EngineState,
  type Segment,
} from "./engine";

const BG = "#0a0c0f";
const FG_DIM = "#1e3d2f";
const FG = "#3dd68c";
const FG_BRIGHT = "#b6f5d0";
const AMBER = "#e6c07b";
const RED = "#ff6b6b";
const ICE = "#7ec8e3";
const RUBBLE = "#c4a574";
const HUD = "#8b949e";

function statusColor(seg: Segment): string {
  switch (seg.hazard) {
    case "lava":
      return RED;
    case "rubble":
      return RUBBLE;
    case "ice":
      return ICE;
    case "bump":
      return AMBER;
    default:
      return FG;
  }
}

function clipText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 4 && ctx.measureText(s + "…").width > maxW) {
    s = s.slice(0, -1);
  }
  return s + "…";
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

  // Subtle scanlines
  ctx.fillStyle = "rgba(255,255,255,0.015)";
  for (let y = 0; y < h; y += 3) {
    ctx.fillRect(0, y, w, 1);
  }

  const camX = state.px - w * 0.28;
  const fontPx = Math.max(10, Math.floor(h * 0.028));
  ctx.font = `${fontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textBaseline = "top";

  // Background log rain (fake stationary columns for depth)
  ctx.fillStyle = FG_DIM;
  ctx.globalAlpha = 0.35;
  const bgShift = (state.px * 0.15) % (fontPx * 1.4);
  for (let row = 0; row < 18; row++) {
    const y = ((row * fontPx * 1.35 - bgShift) % (h + 40)) - 20;
    const fake =
      state.segments[row % Math.max(1, state.segments.length)]?.line.raw ??
      "tail -f access.log";
    ctx.fillText(fake.slice(0, 96), 8 - (state.px * 0.05) % 40, y);
  }
  ctx.globalAlpha = 1;

  // Terrain fill + log text on surface
  if (state.segments.length > 0) {
    ctx.beginPath();
    const first = state.segments[0]!;
    ctx.moveTo(first.x - camX, h + 2);
    ctx.lineTo(first.x - camX, first.groundY * h);
    for (const seg of state.segments) {
      const x0 = seg.x - camX;
      const x1 = seg.x + SEG_W - camX;
      const y0 = seg.groundY * h;
      ctx.lineTo(x0, y0);
      ctx.lineTo(x1, y0);
    }
    const last = state.segments[state.segments.length - 1]!;
    ctx.lineTo(last.x + SEG_W - camX, h + 2);
    ctx.closePath();
    ctx.fillStyle = "rgba(15, 40, 28, 0.92)";
    ctx.fill();

    // Top edge polyline in status colors + log snippets
    for (const seg of state.segments) {
      const x0 = seg.x - camX;
      const x1 = x0 + SEG_W;
      if (x1 < -20 || x0 > w + 20) continue;
      const y = seg.groundY * h;
      const col = statusColor(seg);

      ctx.strokeStyle = col;
      ctx.lineWidth = seg.hazard === "lava" ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();

      // Hazard marks (shape, not only color)
      if (seg.hazard === "lava" && !seg.line.cliff) {
        ctx.fillStyle = RED;
        ctx.beginPath();
        ctx.moveTo(x0 + SEG_W * 0.5, y - 14);
        ctx.lineTo(x0 + SEG_W * 0.5 - 7, y);
        ctx.lineTo(x0 + SEG_W * 0.5 + 7, y);
        ctx.closePath();
        ctx.fill();
      } else if (seg.hazard === "rubble") {
        ctx.fillStyle = RUBBLE;
        ctx.fillRect(x0 + 20, y - 8, 8, 8);
        ctx.fillRect(x0 + 36, y - 5, 6, 5);
      } else if (seg.boost) {
        ctx.fillStyle = AMBER;
        ctx.fillRect(x0 + SEG_W * 0.5 - 4, y - 3, 8, 3);
      }

      // Log line text sitting on the ridge — the fish-slack tell
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.85;
      const snippet = clipText(ctx, seg.line.raw || "—", SEG_W - 6);
      ctx.fillText(snippet, x0 + 3, y + 4);
      ctx.globalAlpha = 1;
    }
  }

  // Player: block cursor █
  const ph = state.sliding ? PLAYER_H_SLIDE : PLAYER_H;
  const px = state.px - camX;
  const py = state.py * h;
  const blinkOn = opts.blink % 1 < 0.7 || state.phase === "running";
  if (blinkOn) {
    ctx.fillStyle = FG_BRIGHT;
    ctx.fillRect(px, py, PLAYER_W, ph);
    ctx.fillStyle = BG;
    ctx.fillRect(px + 3, py + 3, 3, 3);
    ctx.fillRect(px + 8, py + 3, 3, 3);
  }
  // trail
  ctx.fillStyle = "rgba(182, 245, 208, 0.25)";
  for (let i = 1; i <= 4; i++) {
    ctx.fillRect(px - i * 10, py + ph * 0.3, 6, ph * 0.4);
  }

  // HUD — looks like terminal chrome
  ctx.font = `${Math.max(11, Math.floor(h * 0.032))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.fillStyle = HUD;
  const reqs = Math.floor(state.speed / 8);
  const uptimeBar = "♥".repeat(Math.max(0, state.uptime)) + "♡".repeat(Math.max(0, 3 - state.uptime));
  const line1 =
    opts.locale === "zh"
      ? `$ term-run  req/s=${reqs}  bytes=${state.score}  ok=${state.okCount}  combo=x${state.combo}  uptime=${uptimeBar}`
      : `$ term-run  req/s=${reqs}  bytes=${state.score}  ok=${state.okCount}  combo=x${state.combo}  uptime=${uptimeBar}`;
  ctx.fillText(line1, 12, 10);
  ctx.fillStyle = FG_DIM;
  ctx.fillText(
    `best=${opts.best}  lines=${state.linesPassed}  seed=${state.seed}`,
    12,
    10 + fontPx + 6,
  );

  // Title chrome
  ctx.fillStyle = FG;
  ctx.globalAlpha = 0.5;
  ctx.fillText("~/micromist/logs $ tail -f access.log", 12, h - fontPx - 10);
  ctx.globalAlpha = 1;

  if (state.phase === "ready") {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = FG_BRIGHT;
    ctx.font = `bold ${Math.max(16, Math.floor(h * 0.05))}px ui-monospace, Menlo, Consolas, monospace`;
    const title = opts.locale === "zh" ? "term-run — 终端跑酷" : "term-run";
    ctx.fillText(title, w * 0.5 - ctx.measureText(title).width * 0.5, h * 0.36);
    ctx.font = `${Math.max(12, Math.floor(h * 0.032))}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillStyle = FG;
    const tip =
      opts.locale === "zh"
        ? "空格/点击 跳 · ↓ 滑铲 · 躲过 5xx · 踩 2xx"
        : "Space/Click jump · ↓ slide · dodge 5xx · land 2xx";
    ctx.fillText(tip, w * 0.5 - ctx.measureText(tip).width * 0.5, h * 0.46);
    const tip2 =
      opts.locale === "zh"
        ? "别人看来只是 access.log 在刷屏"
        : "Looks like access.log to anyone watching";
    ctx.fillStyle = HUD;
    ctx.fillText(tip2, w * 0.5 - ctx.measureText(tip2).width * 0.5, h * 0.54);
  }

  if (state.phase === "dead") {
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = RED;
    ctx.font = `bold ${Math.max(16, Math.floor(h * 0.048))}px ui-monospace, Menlo, Consolas, monospace`;
    const dead = "Process terminated";
    ctx.fillText(dead, w * 0.5 - ctx.measureText(dead).width * 0.5, h * 0.32);
    ctx.fillStyle = AMBER;
    ctx.font = `${Math.max(12, Math.floor(h * 0.03))}px ui-monospace, Menlo, Consolas, monospace`;
    const reason = state.deathReason || "Connection reset";
    ctx.fillText(reason, w * 0.5 - ctx.measureText(reason).width * 0.5, h * 0.4);
    ctx.fillStyle = FG_BRIGHT;
    const sum = `bytes=${state.score}  ok=${state.okCount}  lines=${state.linesPassed}`;
    ctx.fillText(sum, w * 0.5 - ctx.measureText(sum).width * 0.5, h * 0.5);
    ctx.fillStyle = HUD;
    const again =
      opts.locale === "zh" ? "空格 / 点击 再跑一次 tail -f" : "Space / Click to tail -f again";
    ctx.fillText(again, w * 0.5 - ctx.measureText(again).width * 0.5, h * 0.6);
  }
}
