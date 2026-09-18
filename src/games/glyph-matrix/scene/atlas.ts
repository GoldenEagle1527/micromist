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

/** Build a canvas atlas of emissive-looking glyphs on transparent cells. */
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

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.floor(cell * 0.62)}px "Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif`;

  const count = Math.min(GLYPH_CHARS.length, cols * rows);
  for (let i = 0; i < count; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = col * cell + cell * 0.5;
    const cy = row * cell + cell * 0.52;
    const ch = GLYPH_CHARS[i]!;

    // Soft outer glow (height for emboss via alpha/luma)
    ctx.save();
    ctx.shadowColor = "rgba(120, 220, 255, 0.95)";
    ctx.shadowBlur = cell * 0.18;
    ctx.fillStyle = "rgba(180, 235, 255, 0.95)";
    ctx.fillText(ch, cx, cy);
    ctx.restore();

    // Crisp core
    ctx.fillStyle = "rgba(230, 248, 255, 1)";
    ctx.fillText(ch, cx, cy);

    // Slight darker edge pass for emboss height contrast
    ctx.globalCompositeOperation = "source-atop";
    const grad = ctx.createRadialGradient(cx, cy - cell * 0.08, 2, cx, cy, cell * 0.38);
    grad.addColorStop(0, "rgba(255,255,255,0.35)");
    grad.addColorStop(0.55, "rgba(255,255,255,0)");
    grad.addColorStop(1, "rgba(0,20,40,0.25)");
    ctx.fillStyle = grad;
    ctx.fillRect(col * cell, row * cell, cell, cell);
    ctx.globalCompositeOperation = "source-over";
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
