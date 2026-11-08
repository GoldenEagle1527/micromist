export type FrontlineDict = {
  day: (n: number) => string;
  hearts: (n: number, max: number) => string;
  swaps: (n: number) => string;
  points: (n: number) => string;
  front: (col: number) => string;
  dirShore: string;
  dirSea: string;
  terrainShoal: string;
  terrainReef: string;
  terrainRip: string;
  terrainRule: string;
  tonight: (n: number) => string;
  remaining: (n: number) => string;
  phaseMatch: string;
  phaseBuild: string;
  phaseNight: string;
  phaseShift: (from: number, to: number) => string;
  ruleMerge: string;
  ruleRoad: string;
  toBuild: string;
  toNight: string;
  place: (cost: number) => string;
  playAgain: string;
  overTitle: string;
  survived: (day: number) => string;
  overHint: string;
  noteIllegal: string;
  noteNoSwaps: string;
  noteNotGem: string;
  notePoor: string;
  noteOccupied: string;
  noteNeedTool: string;
  noteNight: string;
  notePlaced: string;
  noteMerged: (name: string) => string;
  chain: (n: number, pts: number) => string;
  colorName: (c: 0 | 1 | 2) => string;
  defenseName: (tier: 1 | 2 | 3) => string;
  cellAria: (label: string, row: number, col: number) => string;
  emptyAria: (row: number, col: number) => string;
  enemyAria: (hp: number) => string;
  shore: string;
  sea: string;
  flag: string;
  sit: string;
  agentInviteLine: string;
  agentInviteCopied: string;
  agentInviteFailed: string;
};

export const frontlineZh: FrontlineDict = {
  day: (n) => `第 ${n} 天`,
  hearts: (n, max) => `心 ${n}/${max}`,
  swaps: (n) => `交换 ${n}`,
  points: (n) => `工事点 ${n}`,
  tonight: (n) => `今夜 ${n}`,
  remaining: (n) => `潮噬 ${n}`,
  phaseMatch: "白天 · 点两格相邻潮印，三个连成一行就清掉",
  phaseBuild: "建造 · 先点潮栅，再点没有工事的格子",
  phaseNight: "入夜 · 潮噬沿潮路咬过来，现在不能交换",
  phaseShift: (from, to) => `潮线从第 ${from} 列挪到第 ${to} 列`,
  ruleMerge: "三个正交相邻的同阶工事会合成下一阶。",
  ruleRoad: "潮噬只走高亮的那一行，从右边的外海走向左边的心岸。",
  dirShore: "潮水向岸",
  dirSea: "潮水向外海",
  terrainShoal: "浅滩",
  terrainReef: "礁带",
  terrainRip: "急流",
  terrainRule: "浅滩横竖三连得 1 点。礁带上斜向三个也算。急流只计横向，每格 2 点。箭头那一侧的一列会在每夜被卷走，另一侧补上新地形。",
  front: (col) => `卷走第 ${col} 列`,
  toBuild: "去建造",
  toNight: "入夜",
  place: (cost) => `潮栅 · ${cost}`,
  playAgain: "再来一局",
  overTitle: "潮线溃了",
  survived: (day) => `撑到第 ${day} 天`,
  overHint: "心被咬光了。",
  noteIllegal: "这一换对不成三个。",
  noteNoSwaps: "今天的交换用完了。去建造，或直接入夜。",
  noteNotGem: "工事不能交换。",
  notePoor: "工事点不够。",
  noteOccupied: "这里已经有工事。",
  noteNeedTool: "先点选潮栅。",
  noteNight: "夜里不能交换。",
  notePlaced: "潮栅放下了。",
  noteMerged: (name) => `合成了${name}`,
  chain: (n, pts) => `连锁 ×${n} · 本轮 +${pts}`,
  colorName: (c) => (c === 0 ? "珊瑚" : c === 1 ? "海草" : "浮沫"),
  defenseName: (tier) => (tier === 1 ? "木栅" : tier === 2 ? "石闸" : "潮垒"),
  cellAria: (label, row, col) => `${label}，第 ${row} 行第 ${col} 列`,
  emptyAria: (row, col) => `空地，第 ${row} 行第 ${col} 列`,
  enemyAria: (hp) => `潮噬，还剩 ${hp}`,
  shore: "心岸",
  sea: "外海",
  flag: "潮",
  sit: "入座",
  agentInviteLine: "点我，把内容发给 AI，让它来打这一局",
  agentInviteCopied: "已复制",
  agentInviteFailed: "复制失败",
};

export const frontlineEn: FrontlineDict = {
  day: (n) => `Day ${n}`,
  hearts: (n, max) => `Hearts ${n}/${max}`,
  swaps: (n) => `Swaps ${n}`,
  points: (n) => `Build ${n}`,
  tonight: (n) => `Tonight ${n}`,
  remaining: (n) => `Biters ${n}`,
  phaseMatch: "Day · tap two neighboring marks. Three in a line clear.",
  phaseBuild: "Build · choose a groyne, then tap a cell without one.",
  phaseNight: "Night · biters march the tide road. No swapping.",
  phaseShift: (from, to) => `The front line moves from column ${from} to ${to}.`,
  ruleMerge: "Three orthogonally adjacent defenses of the same tier merge into the next tier.",
  ruleRoad: "Biters walk only the highlighted row, from the sea on the right to the shore on the left.",
  dirShore: "Tide toward shore",
  dirSea: "Tide toward sea",
  terrainShoal: "Shoal",
  terrainReef: "Reef",
  terrainRip: "Rip",
  terrainRule: "Shoal: lines of three, 1 point. Reef: diagonals count too. Rip: horizontal only, 2 points a gem. The arrowed column washes away each night and a new band slides in opposite.",
  front: (col) => `Washes column ${col}`,
  toBuild: "Build",
  toNight: "Start night",
  place: (cost) => `Groyne · ${cost}`,
  playAgain: "Play again",
  overTitle: "The line broke",
  survived: (day) => `Held until day ${day}`,
  overHint: "The biters took the last heart.",
  noteIllegal: "That swap doesn't line up three.",
  noteNoSwaps: "No swaps left today. Build, or start the night.",
  noteNotGem: "Defenses can't be swapped.",
  notePoor: "Not enough build points.",
  noteOccupied: "There's already a defense here.",
  noteNeedTool: "Choose the groyne first.",
  noteNight: "You can't swap during the night.",
  notePlaced: "Groyne placed.",
  noteMerged: (name) => `Merged into ${name}`,
  chain: (n, pts) => `Chain ×${n} · +${pts} this swap`,
  colorName: (c) => (c === 0 ? "Coral" : c === 1 ? "Kelp" : "Foam"),
  defenseName: (tier) => (tier === 1 ? "Stake" : tier === 2 ? "Gate" : "Bastion"),
  cellAria: (label, row, col) => `${label}, row ${row}, column ${col}`,
  emptyAria: (row, col) => `Open cell, row ${row}, column ${col}`,
  enemyAria: (hp) => `Biter, ${hp} left`,
  shore: "Shore",
  sea: "Sea",
  flag: "Ft",
  sit: "Sit",
  agentInviteLine: "Click me to send this to your AI and let it play a run.",
  agentInviteCopied: "Copied",
  agentInviteFailed: "Copy failed",
};
