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
 * (larger NW highlight / SE shadow) — no bloom/glow.
 * Luma doubles as a height atlas for shader bump.
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

    // Base plaster (bright) so stroke luma → height is unambiguous
    ctx.fillStyle = "#f0ebe3";
    ctx.fillRect(x0, y0, cell, cell);

    // Soft plate inset
    ctx.strokeStyle = "rgba(0, 0, 0, 0.1)";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x0 + 2, y0 + 2, cell - 4, cell - 4);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0 + 3.5, y0 + 3.5, cell - 7, cell - 7);

    // Larger bevel offsets so NW highlight / SE shadow read clearly in height
    const ox = cell * 0.048;
    const oy = cell * 0.048;

    // Deep SE shadow — thickness cue + dark luma for height
    ctx.fillStyle = "rgba(18, 20, 24, 0.72)";
    ctx.fillText(ch, cx + ox * 1.55, cy + oy * 1.55);

    // Mid-dark body undercut
    ctx.fillStyle = "rgba(40, 43, 50, 0.85)";
    ctx.fillText(ch, cx + ox * 0.7, cy + oy * 0.7);

    // Main face (dark → high relief in shader)
    ctx.fillStyle = "#262932";
    ctx.fillText(ch, cx, cy);

    // Strong NW highlight ridge (raised edge catching key light)
    ctx.fillStyle = "rgba(255, 252, 245, 0.88)";
    ctx.fillText(ch, cx - ox * 1.15, cy - oy * 1.15);

    // Recarve body so only the NW rim stays bright
    ctx.fillStyle = "#2e323a";
    ctx.fillText(ch, cx - ox * 0.2, cy - oy * 0.2);

    // Soft secondary highlight for bevel crown
    ctx.fillStyle = "rgba(255, 250, 240, 0.35)";
    ctx.fillText(ch, cx - ox * 0.55, cy - oy * 0.55);
    ctx.fillStyle = "#30343c";
    ctx.fillText(ch, cx - ox * 0.08, cy - oy * 0.08);
  }

  for (let i = count; i < cols * rows; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    ctx.fillStyle = "#f0ebe3";
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
