export type PotteryDict = {
  setupTitle: string;
  setupHint: string;
  claySize: string;
  claySmall: string;
  clayMedium: string;
  clayLarge: string;
  clayBlurb: (size: string) => string;
  startStudio: string;
  continueRun: string;
  openCollection: string;
  backSetup: string;
  toolHand: string;
  toolSponge: string;
  toolWire: string;
  toolHintHand: string;
  toolHintSponge: string;
  toolHintWire: string;
  undo: string;
  fire: string;
  firing: string;
  nameTitle: string;
  nameHint: string;
  namePlaceholder: string;
  nameConfirm: string;
  nameCancel: string;
  unnamed: string;
  collectionTitle: string;
  collectionEmpty: string;
  collectionBack: string;
  detailBack: string;
  deletePiece: string;
  deleteConfirmTitle: string;
  deleteConfirmBody: string;
  deleteConfirmOk: string;
  deleteCancel: string;
  firedAt: (at: number) => string;
  claySizeLabel: (size: string) => string;
  studioAria: string;
  studioBack: string;
  pieceCount: (n: number) => string;
};

export const potteryEn: PotteryDict = {
  setupTitle: "Pottery",
  setupHint:
    "Casual clay on a wheel: make it fatter/thinner, rub it smooth, or cut it shorter — then fire it to your shelf. No timers, no scores.",
  claySize: "Clay",
  claySmall: "Small",
  clayMedium: "Medium",
  clayLarge: "Large",
  clayBlurb: (size) => `${size} blank on the wheel`,
  startStudio: "Start studio",
  continueRun: "Continue",
  openCollection: "Collection",
  backSetup: "← Setup",
  toolHand: "Fat / thin",
  toolSponge: "Smooth out",
  toolWire: "Make shorter",
  toolHintHand: "Hold the pot and drag sideways: out = fatter, in = thinner.",
  toolHintSponge: "Drag up and down to rub bumps smooth.",
  toolHintWire: "Cut from the top to make the whole pot shorter.",
  undo: "Undo",
  fire: "Fire",
  firing: "Firing…",
  nameTitle: "Name this piece",
  nameHint: "The form is saved from its profile, not just the thumbnail.",
  namePlaceholder: "A name for the shelf",
  nameConfirm: "Save to collection",
  nameCancel: "Back to wheel",
  unnamed: "Untitled pot",
  collectionTitle: "Collection",
  collectionEmpty: "No fired pieces yet — throw one and fire it.",
  collectionBack: "← Setup",
  detailBack: "← Collection",
  deletePiece: "Delete",
  deleteConfirmTitle: "Delete this piece?",
  deleteConfirmBody: "It will leave the shelf. This cannot be undone.",
  deleteConfirmOk: "Delete",
  deleteCancel: "Cancel",
  firedAt: (at) =>
    new Date(at).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  claySizeLabel: (size) => size,
  studioAria: "Potter's wheel",
  studioBack: "Setup",
  pieceCount: (n) => (n === 1 ? "1 piece" : `${n} pieces`),
};

export const potteryZh: PotteryDict = {
  setupTitle: "陶艺",
  setupHint:
    "纯休闲捏泥巴：捏胖瘦、抹光滑、切矮，满意就烧成放上架。没有计时、没有分数。",
  claySize: "泥料",
  claySmall: "小",
  clayMedium: "中",
  clayLarge: "大",
  clayBlurb: (size) => `${size}号泥坯，上轮开拉`,
  startStudio: "进入工坊",
  continueRun: "继续拉坯",
  openCollection: "作品架",
  backSetup: "← 返回设置",
  toolHand: "捏胖瘦",
  toolSponge: "抹光滑",
  toolWire: "切矮",
  toolHintHand: "按住罐子左右拖：往外拖变胖，往里拖变瘦。",
  toolHintSponge: "上下拖一拖，把鼓包、棱角抹圆滑。",
  toolHintWire: "从口沿往下切，整只罐子变矮（像用线割泥）。",
  undo: "撤销",
  fire: "烧成",
  firing: "入窑中…",
  nameTitle: "给这件作品起名",
  nameHint: "收藏的是剖面数据，缩略图只作展示。",
  namePlaceholder: "架上的名字",
  nameConfirm: "收入作品架",
  nameCancel: "返回拉坯",
  unnamed: "未命名陶",
  collectionTitle: "作品架",
  collectionEmpty: "还没有烧成的作品，拉一件再入窑吧。",
  collectionBack: "← 返回设置",
  detailBack: "← 作品架",
  deletePiece: "删除",
  deleteConfirmTitle: "删除这件作品？",
  deleteConfirmBody: "它会离开作品架，此操作不可撤销。",
  deleteConfirmOk: "删除",
  deleteCancel: "取消",
  firedAt: (at) =>
    new Date(at).toLocaleString("zh-CN", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  claySizeLabel: (size) => size,
  studioAria: "拉坯机",
  studioBack: "设置",
  pieceCount: (n) => `${n} 件`,
};
