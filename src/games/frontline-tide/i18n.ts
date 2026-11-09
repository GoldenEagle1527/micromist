export type FrontlineDict = {
  day: (n: number) => string;
  hearts: (n: number, max: number) => string;
  swaps: (n: number) => string;
  points: (n: number) => string;
  wash: (cols: number[]) => string;
  roadStat: (row: number) => string;
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
  ruleDay10: string;
  ruleDay25: string;
  ruleDay50: (row: number) => string;
  teachBite: (row: number) => string;
  teachWash: string;
  toBuild: string;
  toNight: string;
  confirmNight: string;
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
  noteOffRoad: string;
  notePatchRoad: string;
  noteNightGap: string;
  noteShear: string;
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
  phaseBuild: "建造 · 潮栅只能放在潮路上",
  phaseNight: "入夜 · 潮噬沿潮路从外海咬向心岸",
  phaseShift: (from, to) => `卷走线从第 ${from} 列挪到第 ${to} 列`,
  ruleMerge: "三个正交相邻的同阶工事会合成下一阶。合成清掉的格子会补回潮印，潮路上没工事的格子要先补上才能入夜。",
  ruleRoad: "潮噬只走潮路那一行，从右边外海走向左边心岸。标着「卷」的是会被卷走的列，不是潮路。",
  ruleDay10: "第 10 天起，每晚卷走两列，第一只潮噬疾走。",
  ruleDay25: "第 25 天起，只能左右交换潮印。半数潮噬疾走。",
  ruleDay50: (row) => `第 50 天起，潮路翻到第 ${row} 行。旧的那一行不再挡潮。`,
  teachBite: (row) => `今晚咬的是第 ${row} 行。`,
  teachWash: "潮噬从右边外海走进左边心岸。标着「卷」的列会被潮水卷走，工事要建在横着的潮路上。",
  dirShore: "卷向岸",
  dirSea: "卷向外海",
  terrainShoal: "浅滩",
  terrainReef: "礁带",
  terrainRip: "急流",
  terrainRule: "浅滩横竖三连得 1 点。礁带上斜向三个也算。急流只计横向，每格 2 点。标着「卷」的列会在入夜后被卷走，另一侧补上新地形。",
  wash: (cols) => {
    const labels = cols.map((col) => String(col));
    if (labels.length <= 1) return `卷走第 ${labels[0] ?? "?"} 列`;
    return `卷走第 ${labels.join("、")} 列`;
  },
  roadStat: (row) => `潮路 第${row}行 · 外海→心岸`,
  toBuild: "去建造",
  toNight: "入夜",
  confirmNight: "仍要入夜",
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
  noteOffRoad: "只能建在潮路上。这一行以外挡不住潮噬。",
  notePatchRoad: "先补潮路。这一行还有没工事的格子，潮噬会从那里咬到心。",
  noteNightGap: "潮路还有空档，工事点不够补满。再点一次就入夜。",
  noteShear: "第 25 天起只能左右交换。",
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
  flag: "卷",
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
  phaseBuild: "Build · groynes only go on the tide road",
  phaseNight: "Night · biters walk the tide road from the sea into the shore",
  phaseShift: (from, to) => `The wash line moves from column ${from} to ${to}.`,
  ruleMerge: "Three orthogonally adjacent defenses of the same tier merge into the next tier. Cleared cells refill with marks. Patch every road cell that has no defense before night.",
  ruleRoad: "Biters walk only the tide-road row, from the sea on the right to the shore on the left. A cell marked W is the column that will be washed away, not the road.",
  ruleDay10: "From day 10, each night washes two columns, and the first biter rushes.",
  ruleDay25: "From day 25, swaps are horizontal only. Half the biters rush.",
  ruleDay50: (row) => `From day 50, the tide road flips to row ${row}. The old row no longer blocks.`,
  teachBite: (row) => `Tonight bites row ${row}.`,
  teachWash: "Biters walk from the sea on the right into the shore on the left. Columns marked W are washed away. Build on the horizontal tide road.",
  dirShore: "Washes toward shore",
  dirSea: "Washes toward sea",
  terrainShoal: "Shoal",
  terrainReef: "Reef",
  terrainRip: "Rip",
  terrainRule: "Shoal: lines of three, 1 point. Reef: diagonals count too. Rip: horizontal only, 2 points a gem. The column marked W is washed away after the night, and a new band slides in opposite.",
  wash: (cols) => {
    const labels = cols.map((col) => String(col));
    if (labels.length <= 1) return `Washes column ${labels[0] ?? "?"}`;
    return `Washes columns ${labels.join(", ")}`;
  },
  roadStat: (row) => `Road row ${row} · sea→shore`,
  toBuild: "Build",
  toNight: "Start night",
  confirmNight: "Start anyway",
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
  noteOffRoad: "Build on the tide road. Anywhere else does not stop biters.",
  notePatchRoad: "Patch the tide road. A cell on this row without a defense is a free bite to the shore.",
  noteNightGap: "The road still has gaps and you can't afford to fill them. Start night again to go anyway.",
  noteShear: "From day 25, swaps are horizontal only.",
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
  flag: "W",
  sit: "Sit",
  agentInviteLine: "Click me to send this to your AI and let it play a run.",
  agentInviteCopied: "Copied",
  agentInviteFailed: "Copy failed",
};
