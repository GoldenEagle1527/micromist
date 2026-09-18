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
export const ATLAS_CELL = 128;

export type GlyphAtlas = {
  texture: THREE.CanvasTexture;
  count: number;
  cols: number;
  rows: number;
};

/** Build a canvas atlas of solid dark ink glyphs on opaque light plaster cells. */
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
  ctx.font = `700 ${Math.floor(cell * 0.62)}px "Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif`;

  const count = Math.min(GLYPH_CHARS.length, cols * rows);
  for (let i = 0; i < count; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x0 = col * cell;
    const y0 = row * cell;
    const cx = x0 + cell * 0.5;
    const cy = y0 + cell * 0.52;
    const ch = GLYPH_CHARS[i]!;

    // Opaque matte plaster cell (no soft glow)
    ctx.fillStyle = "#e6e4de";
    ctx.fillRect(x0, y0, cell, cell);

    // Subtle inset bevel on cell (helps read as a physical block face)
    ctx.strokeStyle = "rgba(0, 0, 0, 0.06)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 1.5, y0 + 1.5, cell - 3, cell - 3);

    // Solid dark ink character — no shadowBlur / outer glow
    ctx.fillStyle = "#2a2c30";
    ctx.fillText(ch, cx, cy);
  }

  // Fill unused cells with plaster so atlas sampling never hits empty
  for (let i = count; i < cols * rows; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    ctx.fillStyle = "#e6e4de";
    ctx.fillRect(col * cell, row * cell, cell, cell);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
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
  // WebGL atlas: v grows upward; canvas row 0 is top → flip
  return {
    u: col / cols,
    v: 1 - (row + 1) / rows,
  };
}
