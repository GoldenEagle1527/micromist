import * as THREE from "three";

/** Characters painted into the atlas (cool / tech / mist flavor). */
export const GLYPH_CHARS = [
  "字",
  "阵",
  "光",
  "影",
  "空",
  "虚",
  "微",
  "渺",
  "星",
  "河",
  "云",
  "雾",
  "电",
  "磁",
  "码",
  "序",
  "层",
  "隙",
  "廊",
  "隧",
  "渊",
  "冥",
  "曜",
  "玄",
  "衡",
  "矩",
  "栅",
  "域",
  "境",
  "界",
  "流",
  "溯",
] as const;

export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;
export const ATLAS_CELL = 160;

export type GlyphAtlas = {
  texture: THREE.CanvasTexture;
  count: number;
  cols: number;
  rows: number;
};

/**
 * Opaque plaster cells + raised-look glyphs via multi-pass bevel
 * (light NW highlight, dark SE shadow, mid fill) — no bloom/glow.
 */
export function createGlyphAtlas(): GlyphAtlas {
  const cols = ATLAS_COLS;
  const rows = ATLAS_ROWS;
  const cell = ATLAS_CELL;
  const canvas = document.createElement("canvas");
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("glyph-matrix: 2d canvas unavailable");
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontPx = Math.floor(cell * 0.64);
  ctx.font = `700 ${fontPx}px "Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif`;

  const count = Math.min(GLYPH_CHARS.length, cols * rows);
  for (let i = 0; i < count; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x0 = col * cell;
    const y0 = row * cell;
    const cx = x0 + cell * 0.5;
    const cy = y0 + cell * 0.52;
    const ch = GLYPH_CHARS[i]!;

    ctx.fillStyle = "#ebe8e1";
    ctx.fillRect(x0, y0, cell, cell);

    // Soft plate inset so the face feels recessed around the raised glyph
    ctx.strokeStyle = "rgba(0, 0, 0, 0.08)";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x0 + 2, y0 + 2, cell - 4, cell - 4);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0 + 3.5, y0 + 3.5, cell - 7, cell - 7);

    const ox = cell * 0.028;
    const oy = cell * 0.028;

    // Deep shadow (SE) — suggests thickness
    ctx.fillStyle = "rgba(32, 34, 38, 0.55)";
    ctx.fillText(ch, cx + ox * 1.35, cy + oy * 1.35);

    // Mid body
    ctx.fillStyle = "#3a3d44";
    ctx.fillText(ch, cx + ox * 0.35, cy + oy * 0.35);

    // Main face
    ctx.fillStyle = "#2c2f36";
    ctx.fillText(ch, cx, cy);

    // NW highlight ridge on strokes (raised edge catching light)
    ctx.fillStyle = "rgba(255, 252, 245, 0.72)";
    ctx.fillText(ch, cx - ox, cy - oy);

    // Carve highlight back so only edges stay bright: redraw body clipped soft
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#32353c";
    ctx.fillText(ch, cx - ox * 0.15, cy - oy * 0.15);
  }

  for (let i = count; i < cols * rows; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    ctx.fillStyle = "#ebe8e1";
    ctx.fillRect(col * cell, row * cell, cell, cell);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  return { texture, count, cols, rows };
}

export function glyphUvOffset(
  index: number,
  cols: number,
  rows: number,
): { u: number; v: number } {
  const i = ((index % (cols * rows)) + cols * rows) % (cols * rows);
  const col = i % cols;
  const row = Math.floor(i / cols);
  return {
    u: col / cols,
    v: 1 - (row + 1) / rows,
  };
}
