/** Canvas layout + silhouette for a revolved pottery profile. */

import { PROFILE_SAMPLES } from "./engine";

export type PotteryLayout = {
  width: number;
  height: number;
  cx: number;
  yBottom: number;
  yTop: number;
  potHeight: number;
  maxRadius: number;
  sampleCount: number;
};

const TAU = Math.PI * 2;

export function layoutPottery(
  width: number,
  height: number,
  sampleCount: number,
): PotteryLayout {
  const n = Math.max(1, sampleCount);
  const padX = width * 0.09;
  const padTop = height * 0.07;
  const padBottom = height * 0.17;
  const fullHeight = Math.max(8, height - padTop - padBottom);
  const heightRatio = Math.min(1, n / PROFILE_SAMPLES);
  const potHeight = fullHeight * heightRatio;
  const yBottom = height - padBottom;
  const yTop = yBottom - potHeight;
  const cx = width / 2;
  const maxRadius = Math.min(width / 2 - padX, potHeight * 0.5, width * 0.4);
  return { width, height, cx, yBottom, yTop, potHeight, maxRadius, sampleCount: n };
}

export function yAtSample(layout: PotteryLayout, i: number): number {
  const t = i / Math.max(1, layout.sampleCount - 1);
  return layout.yBottom - t * layout.potHeight;
}

export function sampleIndexAtY(layout: PotteryLayout, y: number): number {
  const t = (layout.yBottom - y) / Math.max(1e-6, layout.potHeight);
  const idx = Math.round(t * (layout.sampleCount - 1));
  return Math.max(0, Math.min(layout.sampleCount - 1, idx));
}

export function radiusAt(profile: number[], i: number, layout: PotteryLayout): number {
  return (profile[i] ?? 0.2) * layout.maxRadius;
}

function traceSilhouette(
  ctx: CanvasRenderingContext2D,
  layout: PotteryLayout,
  profile: number[],
): void {
  const n = profile.length;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const y = yAtSample(layout, i);
    const x = layout.cx - radiusAt(profile, i, layout);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = n - 1; i >= 0; i--) {
    const y = yAtSample(layout, i);
    ctx.lineTo(layout.cx + radiusAt(profile, i, layout), y);
  }
  ctx.closePath();
}

function fillWorkshop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createRadialGradient(w * 0.5, h * 0.42, w * 0.05, w * 0.5, h * 0.5, w * 0.75);
  g.addColorStop(0, "#3a2a24");
  g.addColorStop(0.55, "#241914");
  g.addColorStop(1, "#16100d");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawWheel(
  ctx: CanvasRenderingContext2D,
  layout: PotteryLayout,
  spin: number,
): void {
  const { cx, yBottom, maxRadius } = layout;
  const ry = Math.max(8, maxRadius * 0.22);
  const rx = maxRadius * 1.18;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, yBottom + ry * 0.35, rx, ry, 0, 0, TAU);
  ctx.fillStyle = "#2b1c16";
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, yBottom + ry * 0.15, rx * 0.92, ry * 0.78, 0, 0, TAU);
  ctx.fillStyle = "#4a3228";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 220, 180, 0.18)";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 8; i++) {
    const a = spin + (i * TAU) / 8;
    const facing = Math.cos(a);
    if (facing < -0.15) continue;
    ctx.globalAlpha = 0.25 + 0.45 * Math.max(0, facing);
    ctx.beginPath();
    ctx.moveTo(cx, yBottom + ry * 0.15);
    ctx.lineTo(cx + Math.sin(a) * rx * 0.88, yBottom + ry * 0.15 + Math.cos(a) * ry * 0.15);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Deterministic 0..1 hash for stable grain across frames. */
function grainHash(x: number, y: number, salt: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.3) * 43758.5453;
  return n - Math.floor(n);
}

function paintClayBody(
  ctx: CanvasRenderingContext2D,
  layout: PotteryLayout,
  profile: number[],
  spin: number,
): void {
  const { cx, maxRadius, yTop, yBottom, potHeight, width, height } = layout;

  // Base wet grey-brown / raw terracotta clay (not candy orange).
  traceSilhouette(ctx, layout, profile);
  const base = ctx.createLinearGradient(cx - maxRadius, 0, cx + maxRadius, 0);
  base.addColorStop(0, "#5c4538");
  base.addColorStop(0.22, "#7a5a48");
  base.addColorStop(0.48, "#8f6b55");
  base.addColorStop(0.72, "#6e5040");
  base.addColorStop(1, "#4a362c");
  ctx.fillStyle = base;
  ctx.fill();

  ctx.save();
  traceSilhouette(ctx, layout, profile);
  ctx.clip();

  // Soft radial volume: darker silhouette edges, slightly lighter mid.
  const midY = (yTop + yBottom) * 0.5;
  const volume = ctx.createRadialGradient(
    cx - maxRadius * 0.08,
    midY - potHeight * 0.06,
    maxRadius * 0.12,
    cx,
    midY,
    maxRadius * 1.15,
  );
  volume.addColorStop(0, "rgba(196, 168, 140, 0.22)");
  volume.addColorStop(0.35, "rgba(160, 128, 102, 0.08)");
  volume.addColorStop(0.7, "rgba(60, 40, 30, 0.18)");
  volume.addColorStop(1, "rgba(28, 18, 12, 0.42)");
  ctx.fillStyle = volume;
  ctx.fillRect(0, 0, width, height);

  // Horizontal throwing grooves / banding (wheel rings).
  const grooveCount = Math.max(10, Math.round(potHeight / 7));
  for (let g = 0; g < grooveCount; g++) {
    const t = (g + 0.5) / grooveCount;
    const y = yBottom - t * potHeight;
    const sample = Math.round(t * (profile.length - 1));
    const r = radiusAt(profile, sample, layout);
    if (r < 2) continue;
    const wobble = Math.sin(spin * 1.7 + g * 0.85) * 1.1;
    const shade = g % 3 === 0 ? 0.14 : g % 2 === 0 ? 0.08 : 0.05;
    ctx.beginPath();
    ctx.ellipse(cx, y + wobble * 0.15, r * 0.98, Math.max(1.1, r * 0.045), 0, 0, TAU);
    ctx.strokeStyle = `rgba(42, 28, 20, ${shade})`;
    ctx.lineWidth = g % 4 === 0 ? 1.35 : 0.85;
    ctx.stroke();
    if (g % 3 === 1) {
      ctx.beginPath();
      ctx.ellipse(cx, y - 0.6, r * 0.94, Math.max(0.7, r * 0.028), 0, 0, TAU);
      ctx.strokeStyle = "rgba(210, 185, 155, 0.06)";
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
  }

  // Procedural grain / speckles — small dark/light dots, low alpha.
  const speckCount = Math.min(420, Math.round(maxRadius * potHeight * 0.045));
  for (let i = 0; i < speckCount; i++) {
    const u = grainHash(i, 1.7, 2.3);
    const v = grainHash(i, 4.1, 0.9);
    const y = yBottom - v * potHeight;
    const sample = Math.round(v * (profile.length - 1));
    const r = radiusAt(profile, sample, layout);
    if (r < 3) continue;
    const xOff = (u * 2 - 1) * r * 0.92;
    const x = cx + xOff;
    // Keep speckles inside the local radius (silhouette already clipped).
    if (Math.abs(xOff) > r * 0.97) continue;
    const size = 0.55 + grainHash(i, 9.2, 3.1) * 1.35;
    const dark = grainHash(i, 2.2, 7.7) > 0.55;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, TAU);
    ctx.fillStyle = dark
      ? `rgba(35, 24, 16, ${0.08 + grainHash(i, 5.5, 1.1) * 0.12})`
      : `rgba(220, 200, 170, ${0.05 + grainHash(i, 6.6, 2.2) * 0.09})`;
    ctx.fill();
  }

  // Soft wet sheen that drifts with spin (not a hard plastic specular bar).
  const hx = cx + Math.sin(spin) * maxRadius * 0.38;
  const sheen = ctx.createRadialGradient(
    hx,
    midY - potHeight * 0.08,
    maxRadius * 0.05,
    hx,
    midY,
    maxRadius * 0.72,
  );
  sheen.addColorStop(0, "rgba(235, 220, 195, 0.2)");
  sheen.addColorStop(0.35, "rgba(210, 190, 160, 0.1)");
  sheen.addColorStop(0.7, "rgba(180, 160, 130, 0.03)");
  sheen.addColorStop(1, "rgba(180, 160, 130, 0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, width, height);

  // Secondary soft highlight strip following spin — very soft.
  const hx2 = cx + Math.sin(spin + 0.55) * maxRadius * 0.22;
  const softBand = ctx.createLinearGradient(hx2 - maxRadius * 0.35, 0, hx2 + maxRadius * 0.45, 0);
  softBand.addColorStop(0, "rgba(240, 225, 200, 0)");
  softBand.addColorStop(0.4, "rgba(240, 225, 200, 0.09)");
  softBand.addColorStop(0.55, "rgba(240, 225, 200, 0.05)");
  softBand.addColorStop(1, "rgba(240, 225, 200, 0)");
  ctx.fillStyle = softBand;
  ctx.fillRect(0, 0, width, height);

  // Subtle vertical contact shadow on far side for roundness.
  const edgeShade = ctx.createLinearGradient(cx - maxRadius, 0, cx + maxRadius, 0);
  edgeShade.addColorStop(0, "rgba(20, 12, 8, 0.28)");
  edgeShade.addColorStop(0.18, "rgba(20, 12, 8, 0)");
  edgeShade.addColorStop(0.82, "rgba(20, 12, 8, 0)");
  edgeShade.addColorStop(1, "rgba(20, 12, 8, 0.32)");
  ctx.fillStyle = edgeShade;
  ctx.fillRect(0, 0, width, height);

  ctx.restore();
}

export type DrawPotteryOpts = {
  spin?: number;
  showWire?: boolean;
  wireSample?: number;
};

/** Opaque workshop scene — JPEG thumbs stay readable. */
export function drawPottery(
  ctx: CanvasRenderingContext2D,
  profile: number[],
  width: number,
  height: number,
  opts: DrawPotteryOpts = {},
): PotteryLayout {
  const layout = layoutPottery(width, height, profile.length);
  const spin = opts.spin ?? 0;

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  fillWorkshop(ctx, width, height);
  drawWheel(ctx, layout, spin);

  if (profile.length < 2) {
    ctx.restore();
    return layout;
  }

  paintClayBody(ctx, layout, profile, spin);

  // Rim (hollow) + foot ellipse — muted wet clay tones.
  const rimR = radiusAt(profile, profile.length - 1, layout);
  const footR = radiusAt(profile, 0, layout);
  ctx.beginPath();
  ctx.ellipse(layout.cx, layout.yTop, rimR, Math.max(3, rimR * 0.16), 0, 0, TAU);
  ctx.fillStyle = "#4a352c";
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(layout.cx, layout.yTop, rimR * 0.72, Math.max(2, rimR * 0.11), 0, 0, TAU);
  ctx.fillStyle = "#2a1c16";
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(layout.cx, layout.yBottom, footR, Math.max(3, footR * 0.14), 0, 0, TAU);
  ctx.fillStyle = "rgba(28, 16, 10, 0.4)";
  ctx.fill();

  if (opts.showWire && opts.wireSample != null) {
    const y = yAtSample(layout, opts.wireSample);
    ctx.save();
    ctx.strokeStyle = "rgba(220, 230, 240, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(layout.cx - layout.maxRadius * 1.15, y);
    ctx.lineTo(layout.cx + layout.maxRadius * 1.15, y);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
  return layout;
}
