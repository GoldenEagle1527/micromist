/** 直视 (stage 5) HUD strings: the gaze line, 封界 progress, the anchor prompt, the two endings' closing lines. */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export type GazeDict = {
  watching: string;
  phases: readonly [string, string, string, string];
  left: (seconds: number) => string;
  returned: (m: number, need: number) => string;
  anchors: (lit: number, total: number) => string;
  hold: (price: string, touch: boolean) => string;
  short: (price: string) => string;
  sealReady: string;
  sealing: string;
  squeeze: string;
  annihilated: { lines: readonly string[]; title: string; note: string; back: string };
  sealed: { lines: readonly string[]; title: string; close: string };
};

export const gazeZh: GazeDict = {
  watching: "它在看着这里。",
  phases: ["① 躁动", "② 围拢", "③ 侵袭", "④ 崩塌"],
  left: (s) => `离强制潮汐 ${clock(s)}`,
  returned: (m, need) => `归还 m ${m.toFixed(3)} / ${need.toFixed(2)}`,
  anchors: (lit, total) => `锚点 ${lit}/${total}`,
  hold: (price, touch) => `${touch ? "按住吸取键" : "按住 E"}点亮锚点（${price}）`,
  short: (price) => `罐里不够点亮锚点：需要 ${price}`,
  sealReady: "归还与锚点都已完成：回到穹顶内，封界潮就会到来",
  sealing: "封界潮",
  squeeze: "触腕缠住了一座建筑……",
  annihilated: {
    lines: ["潮来了——不是你唤的。", "巨影撞向核心，穹顶碎了。", "基地、仓储、你带着的一切，都回到了海里。", "这滴世界在没有你的情况下重新凝聚，完整如初。", "那只眼慢慢闭上了。"],
    title: "湮灭",
    note: "这个世界已经结束，不能再进入。",
    back: "返回",
  },
  sealed: {
    lines: ["凝聚的粒子填平了裂缝，壁重新变厚。", "竖瞳缓缓闭合。", "发狂的生物平息了。"],
    title: "封界 · 你守住了这滴世界",
    close: "继续",
  },
};

export const gazeEn: GazeDict = {
  watching: "It is looking at this place.",
  phases: ["① Stirring", "② Closing in", "③ Assault", "④ Collapse"],
  left: (s) => `Forced tide in ${clock(s)}`,
  returned: (m, need) => `Returned m ${m.toFixed(3)} / ${need.toFixed(2)}`,
  anchors: (lit, total) => `Anchors ${lit}/${total}`,
  hold: (price, touch) => `${touch ? "Hold absorb" : "Hold E"} to light the anchor (${price})`,
  short: (price) => `Not enough in the tank to light it: needs ${price}`,
  sealReady: "Returned and anchored: go back under the dome and the sealing tide will come",
  sealing: "Sealing tide",
  squeeze: "Tentacles have wrapped a building…",
  annihilated: {
    lines: ["The tide came — not one you called.", "The shadow struck the core; the dome broke.", "The base, the storage, all you carried went back to the sea.", "This drop of a world gathered again without you, whole as it was.", "The eye slowly closed."],
    title: "Annihilation",
    note: "This world has ended and can't be entered again.",
    back: "Back",
  },
  sealed: {
    lines: ["Gathering particles filled the cracks; the wall grew thick again.", "The slit pupil slowly closed.", "The maddened creatures grew calm."],
    title: "Sealed · you kept this drop of a world",
    close: "Continue",
  },
};
