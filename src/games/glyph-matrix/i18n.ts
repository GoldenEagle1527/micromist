export type GlyphMatrixDict = {
  setupTitle: string;
  setupHint: string;
  start: string;
  backSetup: string;
  hint: string;
  stageAria: string;
};

export const glyphMatrixEn: GlyphMatrixDict = {
  setupTitle: "Glyph Matrix",
  setupHint:
    "Visual graybox only — a cool corridor between upper and lower grids of Chinese-character cubes. Move the pointer to raise nearby cubes; no score or puzzle.",
  start: "Enter",
  backSetup: "← Setup",
  hint: "Move mouse / finger — cubes near the pointer bulge. Mild look + gentle forward drift.",
  stageAria: "Glyph Matrix corridor",
};

export const glyphMatrixZh: GlyphMatrixDict = {
  setupTitle: "字阵",
  setupHint:
    "纯视觉灰盒：夹在上下两层汉字立方之间的冷色科幻廊道。指针靠近的方块会鼓起；无得分、无解谜。",
  start: "进入",
  backSetup: "← 返回设置",
  hint: "移动鼠标 / 手指 — 附近方块鼓起。轻微环视 + 缓慢前漂。",
  stageAria: "字阵廊道画面",
};
